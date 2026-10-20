/**
 * dsh-serper-search, Host half: one MERGED search provider for the DSH web
 * capability seam (`ctx.web`). Function-plugin form (named exports only).
 *
 * Two direct HTTP backends run in parallel, one request each, with no auxiliary
 * model turn:
 *
 *   - DeepSeek Search API (primary by default): POST `${baseURL}/search` with
 *     `Authorization: Bearer <key>`, or `x-dsh-auth-token` on a DeepSeek
 *     Account session. Returns `summary` (long excerpt) which is clipped into
 *     `snippet`, plus `date`/`authority`.
 *   - serper.dev (secondary by default): POST `${baseURL}/search` with
 *     `X-API-KEY`, Google's ranked `organic[]` plus the `answerBox`, which
 *     becomes the result-level `content`.
 *
 * Sources dedupe by normalized URL and interleave by a fixed ratio pattern
 * (default 2:1 — six primary + two secondary in the tool layer's eight slots),
 * then the provider truncates to `maxResults` and reports `truncated: false`
 * so the seam never attaches its "Refine the query for more" hint. Either
 * backend may fail, time out, or lack a key — the other still answers; only a
 * double failure throws.
 *
 * Failures are classified (`lib/failure.js`): an auth/quota failure mutes that
 * lane for ten minutes, rate-limit/server for one minute, timeout/network for
 * thirty seconds; the other lane answers and the model-visible `content` gains
 * one `Note:` line explaining the degradation. Both lanes cooling is
 * fail-open. Cooldowns clear on success, on a changed credential fingerprint,
 * on a `credentials/reference-updated` event, and on expiry; the P1-5 probe
 * clears them through `clearHealth()`.
 *
 * Successful results are cached (`lib/cache.js`): a 50-entry LRU with a
 * `cacheMinutes` TTL (default five minutes, 0 disables), keyed by every setting
 * that changes the output, so a repeated query in the window makes zero
 * upstream requests. Degraded single-lane results get a fifth of the TTL
 * (at least one minute) so a temporarily broken lane is not pinned; aborts and
 * failures are never stored.
 *
 * Backwards compatibility: the provider id stays `serper`, so the bundle patch
 * and existing profiles keep working. `native` now means "merge the DeepSeek
 * Search API half"; `native*` key/endpoint fields are accepted but only used as
 * credential fallbacks or ignored.
 *
 * Runtime routes (`lib/routes.js`) expose the settings card's self-check,
 * update check and provider switch as POST endpoints behind DSH's own
 * connection fence: `probe` (both lanes, one paid request each, single-flight),
 * `update-check` (the npm registry answer, cached for ten minutes), and
 * `provider` (pin or release `searchProvider`).
 *
 * Selection: the bundle patch only mounts this plugin. On the first start that
 * sees the `web` seam still on its deployment default (or unset), the plugin
 * pins `searchProvider: serper` in the profile's own cordis.patch.yml and then
 * records `takeOverProvider: false` in its own entry, so a user reset (settings
 * page switch, `{op:'unset'}`, hand-deleted line) is never re-taken over. An
 * operator-set `$DSH_WEB_SEARCH_PROVIDER` counts as an explicit choice and is
 * never silently overridden: only `serper` is pinned, any other id is respected
 * with a warning and the marker is still written.
 * @module dsh-serper-search
 */

import { readFileSync } from 'node:fs'
import z from '@deepseek-ai/schemastery'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { launchEnvironmentOf } from '@deepseek-ai/dsh-launch-environment'
import { WebError } from '@deepseek-ai/dsh-web'
import { ResultCache, cacheKey } from './cache.js'
import {
  FAILURE_LABELS,
  classifyFailure,
  credentialFingerprint,
  redactBodyExcerpt,
} from './failure.js'
import {
  RATIO_PATTERNS,
  effectiveSerperLocale,
  mapDeepSeekSearchResponse,
  mapSerperResponse,
  mergeResults,
  mergeSources,
} from './merge.js'
import { registerRuntimeRoutes } from './routes.js'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'web-search-serper'

/** The web seam this provider registers into. */
export const inject = ['web']

/** Stable id this provider registers under; the `web` seam pins it. */
export const SERPER_PROVIDER_ID = 'serper'

/** Default serper.dev API base; `/search` is appended per request. */
export const SERPER_DEFAULT_BASE_URL = 'https://google.serper.dev'

/** Default DeepSeek Search API base; `/search` is appended per request. */
export const DEEPSEEK_SEARCH_API_DEFAULT_BASE_URL = 'https://api.deepseek.com/v1/tools'

/** Environment variable overriding the serper endpoint independently of config. */
const SEARCH_BASE_URL_ENV = 'SERPER_BASE_URL'

/** Environment variable overriding the DeepSeek Search API endpoint independently of config. */
const DEEPSEEK_SEARCH_API_BASE_URL_ENV = 'DEEPSEEK_SEARCH_API_BASE_URL'

/** Default credential ref the serper API key resolves through. */
const DEFAULT_API_KEY_ENV = 'SERPER_API_KEY'

/** Default credential ref the DeepSeek Search API key resolves through. */
const DEEPSEEK_DEFAULT_API_KEY_ENV = 'DEEPSEEK_API_KEY'

/** Deprecated v0.2.x native-search defaults, kept for config compatibility. */
const NATIVE_DEFAULT_MODEL = 'deepseek-v4-flash'
const NATIVE_DEFAULT_MAX_USES = 5

/** Provider route id `dsh-llm-deepseek-account` registers; `request/context` events record it per Session. */
const ACCOUNT_PROVIDER = 'deepseek-account'

/** Sources one probe asks each lane for; enough to prove the payload maps. */
const PROBE_RESULTS = 3

/** Probe-only `account-only` explanation (the card localizes its own copy). */
const ACCOUNT_ONLY_ERROR = 'no API key; the DeepSeek Account session works only inside a conversation'

/** Deployment-default provider id: the value this plugin is allowed to replace. */
const OFFICIAL_PROVIDER_ID = 'deepseek-official'

/** Settings namespace (profile entry id) this plugin's own config lives under. */
export const OWN_NS = 'web-search-serper'

/** Takeover/user-pin warnings already logged in this process; keeps restarts quiet. */
const warned = new Set()

/** Attribution header sent on every search request. */
const PKG_VERSION = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version
const USER_AGENT = `dsh-serper-search/${PKG_VERSION}`

/** Accepted `ratio` values; mirrors {@link RATIO_PATTERNS}. */
const RATIO_VALUES = Object.keys(RATIO_PATTERNS).map(Number)

export const Config = z.object({
  // ── serper (secondary by default) ────────────────────────────────────────
  apiKey: z.string().role('secret').volatile(),
  apiKeyEnv: z.string().role('credential-ref').pattern(/^[A-Za-z_][A-Za-z0-9_]*$/).default(DEFAULT_API_KEY_ENV).volatile(),
  baseURL: z.string().volatile(),
  gl: z.string().default('cn').volatile(),
  hl: z.string().default('zh-cn').volatile(),
  /** Route pure-English queries to gl=us/hl=en when the configured region is cn. */
  autoLocale: z.boolean().default(true).volatile(),
  num: z.number().step(1).min(1).max(100).default(10).volatile(),
  serperTimeoutMs: z.number().step(1).min(500).default(4500).volatile(),

  // ── DeepSeek Search API (primary by default) ─────────────────────────────
  deepseekApiKey: z.string().role('secret').volatile(),
  deepseekApiKeyEnv: z.string().role('credential-ref').pattern(/^[A-Za-z_][A-Za-z0-9_]*$/).default(DEEPSEEK_DEFAULT_API_KEY_ENV).volatile(),
  deepseekBaseURL: z.string().volatile(),
  deepseekCount: z.number().step(1).min(1).max(50).default(10).volatile(),
  deepseekTimeoutMs: z.number().step(1).min(500).default(4500).volatile(),
  /** Clip the Search API `summary` into `snippet`; 0 keeps the short snippet. */
  summaryMaxChars: z.number().step(1).min(0).max(2000).default(600).volatile(),
  /** Which backend leads the interleave and wins URL-dedupe ties. */
  primary: z.union(['deepseek', 'serper']).default('deepseek').volatile(),
  /** Primary:secondary slot pattern, one of the fixed five ratios. */
  ratio: z.union(RATIO_VALUES).default(2).volatile(),
  /** Minimum Search API `authority`; -1 disables the filter. */
  minAuthority: z.number().step(1).min(-1).max(4).default(-1).volatile(),
  /** Retries for DeepSeek 429/5xx responses (1s, 2s backoff with jitter). */
  maxRetries: z.number().step(1).min(0).max(2).default(1).volatile(),
  /** Maximum sources per hostname; 0 disables the diversity cap. */
  maxPerHost: z.number().step(1).min(0).max(10).default(2).volatile(),
  /** Sort social/video hosts (reddit, x.com, HN, YouTube) behind editorial sources. */
  demoteSocial: z.boolean().default(true).volatile(),
  logLevel: z.union(['off', 'summary', 'verbose']).default('summary').volatile(),

  // ── v0.2.x compatibility (GUI-visible / deprecated) ──────────────────────
  /** v3 meaning: merge the DeepSeek Search API half. `false` = serper only. */
  native: z.boolean().default(true).volatile(),
  nativeApiKey: z.string().role('secret').volatile(),
  nativeApiKeyEnv: z.string().role('credential-ref').pattern(/^[A-Za-z_][A-Za-z0-9_]*$/).default(DEEPSEEK_DEFAULT_API_KEY_ENV).volatile(),
  nativeBaseURL: z.string().volatile(),
  nativeModel: z.string().default(NATIVE_DEFAULT_MODEL).volatile(),
  nativeMaxUses: z.number().step(1).min(1).default(NATIVE_DEFAULT_MAX_USES).volatile(),

  // ── v0.4.0 runtime behaviour ─────────────────────────────────────────────
  /** Successful-result cache lifetime in minutes; 0 disables the cache. */
  cacheMinutes: z.number().step(1).min(0).max(5).default(5).volatile(),
  /**
   * `true` = the next start may take `web.searchProvider` over once. The plugin
   * writes `false` into its own entry after deciding (taken over, or the user
   * already pinned an id), so a later reset is never re-taken over.
   */
  takeOverProvider: z.boolean().default(true).volatile(),
})

/**
 * The DeepSeek Search API half: one direct request per search, no model turn.
 * Auth mirrors `@deepseek-ai/dsh-web-deepseek-api`: a DeepSeek Account session
 * sends `x-dsh-auth-token`, everything else sends a Bearer API key.
 */
export class DeepSeekSearchApiBackend {
  /**
   * @param {() => object} resolveOptions - options for the NEXT search, snapshotted per operation.
   */
  constructor(resolveOptions) {
    this.resolveOptions = resolveOptions
  }

  /** Cheap synchronous usability check; the key itself resolves asynchronously per search. */
  available() {
    const options = this.resolveOptions()
    return URL.canParse(options.baseURL) && Number.isInteger(options.count) && options.count > 0
  }

  /**
   * Run one Search API request.
   * @param {import('@deepseek-ai/dsh-web').WebSearchRequest} request - the query and optional result limit.
   * @param {AbortSignal} [signal] - cancellation signal from the seam/tool layer.
   * @returns {Promise<import('@deepseek-ai/dsh-web').WebSearchResult>}
   */
  async search(request, signal) {
    const options = this.resolveOptions()
    const endpoint = `${options.baseURL.replace(/\/+$/, '')}/search`
    const headers = await this.authHeaders(options, endpoint, signal)
    throwIfSearchAborted(signal)

    const body = {
      query: request.query,
      count: clampCount(Math.max(request.maxResults ?? 8, options.count ?? 10), 1, 50),
      need_content: false,
    }
    const maxRetries = options.maxRetries ?? 1
    const guidance = DEEPSEEK_GUIDANCE
    const budgetMs = options.timeoutMs ?? 4500
    const deadline = Date.now() + budgetMs

    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
      throwIfSearchAborted(signal)
      const remaining = deadline - Date.now()
      if (remaining <= 0 || (attempt > 0 && remaining < 250)) {
        const error = new WebError(`DeepSeek Search API request budget (${budgetMs}ms) exhausted before attempt ${attempt + 1}. ${guidance}`, 'WEB_PROVIDER_ERROR')
        error.failureKind = 'timeout'
        error.timeoutMs = budgetMs
        throw error
      }
      let opened
      try {
        opened = await postJson({
          endpoint,
          body,
          headers: {
            ...headers,
            'content-type': 'application/json',
            accept: 'application/json',
            'user-agent': USER_AGENT,
          },
          timeoutMs: remaining,
          signal,
          fetchImpl: options.fetchImpl,
          subject: 'DeepSeek Search API',
          guidance,
        })
      } catch (error) {
        if (error?.retryable === true && attempt < maxRetries) {
          const wait = backoffMs(attempt)
          if (Date.now() + wait < deadline) {
            await sleep(wait, signal)
            continue
          }
        }
        throw error
      }

      const { response, gate } = opened
      try {
        if (!response.ok) {
          // Read the error body once: it is the retry decision's drain and the
          // `bodyExcerpt` quota evidence at the same time.
          const bodyExcerpt = await drainBody(response, signal)
          const retryableStatus = response.status === 429 || response.status >= 500
          if (retryableStatus && attempt < maxRetries) {
            const wait = backoffMs(attempt)
            // Draining can itself consume the remaining budget (a stalled error
            // body); re-check before spending the backoff.
            if (Date.now() + wait < deadline) {
              await sleep(wait, signal)
              continue
            }
          }
          const error = new WebError(`DeepSeek Search API error (HTTP ${response.status}). ${guidance}`, 'WEB_PROVIDER_ERROR')
          error.httpStatus = response.status
          error.bodyExcerpt = bodyExcerpt
          throw error
        }
        const payload = await readJsonBody(opened, { subject: 'DeepSeek Search API', guidance, signal })
        return mapDeepSeekSearchResponse(payload, {
          summaryMaxChars: options.summaryMaxChars ?? 600,
          minAuthority: options.minAuthority ?? -1,
        })
      } finally {
        gate.cleanup()
      }
    }
    throw new WebError('DeepSeek Search API exhausted its retries. ' + guidance, 'WEB_PROVIDER_ERROR')
  }

  /**
   * Build the auth headers for one request: account token first (DeepSeek
   * Account sessions only), then the API key.
   * @param {object} options - the search's options snapshot.
   * @param {string} endpoint - the endpoint the account token is scoped to.
   * @param {AbortSignal} [signal] - abort signal for the surrounding search.
   * @returns {Promise<Record<string, string>>} request headers.
   */
  async authHeaders(options, endpoint, signal) {
    if (options.resolveAccountToken !== undefined) {
      const token = await resolveCredential(options.resolveAccountToken.bind(undefined, endpoint), signal)
      if (typeof token === 'string' && token.length > 0) return { 'x-dsh-auth-token': token }
    }
    const apiKey = await resolveKey(options, signal, 'DeepSeek Search API')
    return { authorization: `Bearer ${apiKey}` }
  }
}

/**
 * The serper.dev half: Google's ranked organic results plus the answer box.
 * Failures surface as `WEB_PROVIDER_ERROR`; the merged provider degrades.
 */
export class SerperSearchProvider {
  id = SERPER_PROVIDER_ID

  /**
   * @param {() => object} resolveOptions - options for the NEXT search, snapshotted per operation.
   */
  constructor(resolveOptions) {
    this.resolveOptions = resolveOptions
  }

  /** Cheap synchronous usability check; the key itself resolves asynchronously per search. */
  available() {
    const options = this.resolveOptions()
    return URL.canParse(options.baseURL) && Number.isInteger(options.num) && options.num > 0
  }

  /**
   * Run one serper.dev request.
   * @param {import('@deepseek-ai/dsh-web').WebSearchRequest} request - the query and optional result limit.
   * @param {AbortSignal} [signal] - cancellation signal from the seam/tool layer.
   * @returns {Promise<import('@deepseek-ai/dsh-web').WebSearchResult>}
   */
  async search(request, signal) {
    const options = this.resolveOptions()
    const endpoint = `${options.baseURL.replace(/\/+$/, '')}/search`
    const apiKey = await resolveKey(options, signal, 'Serper')
    throwIfSearchAborted(signal)

    const locale = effectiveSerperLocale(request.query, {
      gl: options.gl,
      hl: options.hl,
      autoLocale: options.autoLocale,
    })
    const body = {
      q: request.query,
      gl: locale.gl,
      hl: locale.hl,
      num: clampCount(Math.max(request.maxResults ?? 8, options.num ?? 10), 1, 100),
    }

    const opened = await postJson({
      endpoint,
      body,
      headers: {
        'X-API-KEY': apiKey,
        'content-type': 'application/json',
        accept: 'application/json',
        'user-agent': USER_AGENT,
      },
      timeoutMs: options.timeoutMs ?? 4500,
      signal,
      fetchImpl: options.fetchImpl,
      subject: 'Serper',
      guidance: SERPER_GUIDANCE,
    })
    const { response, gate } = opened
    try {
      if (!response.ok) {
        let raw = ''
        try {
          raw = await response.text()
        } catch (error) {
          if (signal?.aborted === true) throw searchAborted(signal, error)
        }
        const bodyExcerpt = redactBodyExcerpt(raw)
        let message = `Serper API error (HTTP ${response.status})`
        try {
          const parsed = JSON.parse(raw)
          const detail = typeof parsed?.error === 'string' ? parsed.error : parsed?.message
          // The upstream body is redacted before it becomes part of the error:
          // this message reaches the tool result (the model) and the warn log,
          // not just the card, so a body that echoes a credential must not leak.
          if (typeof detail === 'string' && detail.length > 0) message += `: ${redactBodyExcerpt(detail, 200)}`
        } catch {
          // A non-JSON error body is still attached below as a redacted excerpt.
        }
        const error = response.status === 401 || response.status === 403
          ? new WebError(`${message}\n\nSerper rejected the key from credential ref "${options.apiKeyEnv ?? DEFAULT_API_KEY_ENV}". ${SERPER_GUIDANCE}`, 'WEB_PROVIDER_ERROR')
          : new WebError(`${message}. ${SERPER_GUIDANCE}`, 'WEB_PROVIDER_ERROR')
        error.httpStatus = response.status
        error.bodyExcerpt = bodyExcerpt
        throw error
      }
      const payload = await readJsonBody(opened, { subject: 'Serper', guidance: SERPER_GUIDANCE, signal })
      return mapSerperResponse(payload)
    } finally {
      gate.cleanup()
    }
  }

}

/**
 * The merged provider the seam actually calls: both backends in parallel, one
 * ranked interleave, graceful degradation to whichever answered.
 *
 * It also keeps one health record per lane. A failing lane is muted for the
 * class's cooldown (see `lib/failure.js`), skipped while the other lane is
 * healthy, and always retried when both lanes are cooling (fail-open: a stale
 * cooldown must never make search unavailable). Cooldowns clear on success, on
 * a credential-fingerprint change, on a `credentials/reference-updated` event
 * (wired in `apply`), on `clearHealth()` (the P1-5 probe), or on expiry.
 */
export class MergedSearchProvider {
  id = SERPER_PROVIDER_ID

  /**
   * @param {() => object} resolveOptions - one thunk snapshotting both backends'
   * options plus merge settings per search.
   * @param {object} [logger] - cordis logger used by `logLevel`.
   */
  constructor(resolveOptions, logger) {
    this.resolveOptions = resolveOptions
    this.logger = logger
    this.deepseek = new DeepSeekSearchApiBackend(() => this.resolveOptions().deepseek)
    this.serper = new SerperSearchProvider(() => this.resolveOptions().serper)
    this.health = { deepseek: emptyHealth(), serper: emptyHealth() }
    this.cache = new ResultCache()
  }

  /** Usable while either half is; a failing half degrades per search. */
  available() {
    return this.deepseek.available() || this.serper.available()
  }

  /**
   * Drop one lane's cooldown immediately. Public for the P1-5 probe (success)
   * and the credential-update listener in `apply`.
   * @param {'deepseek' | 'serper'} lane - the lane to clear.
   * @returns {boolean} true when the lane name was recognized.
   */
  clearHealth(lane) {
    if (lane !== 'deepseek' && lane !== 'serper') return false
    this.health[lane] = emptyHealth()
    return true
  }

  /**
   * Drop every cached search result. Called when an intervention proves the
   * cached answers may be stale (a probe that answered, a credential update, a
   * cooldown cleared by a fingerprint change) — a cached degraded answer must
   * not outlive the fix that made it obsolete.
   */
  clearCachedResults() {
    this.cache.clear()
  }

  /**
   * Probe both lanes once for the settings card (P1-5). Each lane gets one real
   * request with a temporary `timeoutMs` override: the outer budget alone would
   * be pre-empted by each lane's own 4.5s default, so an 8s probe could never be
   * observed. `maxRetries` is forced to 0 so a probe costs exactly one request
   * per lane, and the result count is pinned to the probe budget instead of the
   * user's configured count ("three per lane" holds on the wire too).
   *
   * A successful lane clears its cooldown; a failing one writes nothing — a
   * manual self-check must not mute a lane for the next real search. When any
   * lane answers, cached results are dropped too: the card just proved the
   * backend works, so a cached degraded answer (and its stale `Note`) must not
   * outlive the intervention. The result is the stable wire protocol: one
   * record per lane, never a key.
   * @param {{query?: string, timeoutMs?: number}} [options] - probe query and outer budget.
   * @returns {Promise<object[]>} one lane report per backend.
   */
  async probe({ query = 'dsh web search plugin', timeoutMs = 8000 } = {}) {
    const options = this.resolveOptions()
    const laneTimeout = Math.max(timeoutMs, 1000)
    const deepseek = new DeepSeekSearchApiBackend(() => ({
      ...options.deepseek,
      count: PROBE_RESULTS,
      timeoutMs: laneTimeout,
      maxRetries: 0,
    }))
    const serper = new SerperSearchProvider(() => ({
      ...options.serper,
      num: PROBE_RESULTS,
      timeoutMs: laneTimeout,
    }))
    // `settle` itself never throws, so `allSettled` would only nest another layer.
    const [deepseekOutcome, serperOutcome] = await Promise.all([
      settle(() => deepseek.search({ query, maxResults: PROBE_RESULTS })),
      settle(() => serper.search({ query, maxResults: PROBE_RESULTS })),
    ])
    if (deepseekOutcome.ok) this.clearHealth('deepseek')
    if (serperOutcome.ok) this.clearHealth('serper')
    if (deepseekOutcome.ok || serperOutcome.ok) this.clearCachedResults()
    return [
      laneReport('deepseek', deepseekOutcome, {
        accountService: options.deepseek.hasAccountService?.() === true,
      }),
      laneReport('serper', serperOutcome),
    ]
  }

  /**
   * Run one merged search. A successful result inside the cache window is
   * served from `this.cache` without any request; on a miss the user-facing
   * failure rule still holds — BOTH backends must fail, and the thrown error
   * names both causes.
   * @param {import('@deepseek-ai/dsh-web').WebSearchRequest} request - the query and optional result limit.
   * @param {AbortSignal} [signal] - cancellation signal from the seam/tool layer.
   * @returns {Promise<import('@deepseek-ai/dsh-web').WebSearchResult>}
   */
  async search(request, signal) {
    const options = this.resolveOptions()
    const cap = Number.isInteger(request.maxResults) && request.maxResults > 0 ? request.maxResults : undefined
    if (signal?.aborted === true) throw searchAborted(signal)

    // Cache before touching health state: a hit makes no request, so it can
    // neither learn anything new nor clear a cooldown.
    const minutes = options.cacheMinutes ?? 5
    const key = minutes > 0 ? cacheKey(request.query, options, cap) : null
    const cached = key === null ? undefined : this.cache.get(key)
    if (cached !== undefined) {
      this.report(options, `cache=hit len=${cached.sources.length}`)
      return cached
    }

    // A changed credential configuration means the user already intervened:
    // forget the cooldown before deciding what to skip.
    this.refreshCooldowns(options)

    // `searchUncached` reports degradation separately so the result cache can
    // shorten its TTL; the tool layer never sees the extra field.
    const { result, degraded } = await this.searchUncached(request, signal, options, cap)
    // An aborted search says nothing about result quality, so it is not stored.
    // `set()` refuses source-less results; only a real store is logged, so the
    // `cache=store` line README tells users to verify with stays truthful.
    if (key !== null && signal?.aborted !== true) {
      const ttl = degraded ? Math.max(60_000, (minutes * 60_000) / 5) : minutes * 60_000
      if (this.cache.set(key, result, ttl)) this.report(options, 'cache=store')
    }
    return result
  }

  /**
   * The uncached merge. Returns the final tool-layer result plus the internal
   * `degraded` flag (true when one lane answered because the other failed or
   * was cooling); the Note is already at the top of `result.content`.
   * @param {import('@deepseek-ai/dsh-web').WebSearchRequest} request - the query and optional result limit.
   * @param {AbortSignal} [signal] - cancellation signal from the seam/tool layer.
   * @param {object} options - this operation's settings snapshot.
   * @param {number} [cap] - requested result cap.
   * @returns {Promise<{result: import('@deepseek-ai/dsh-web').WebSearchResult, degraded: boolean}>}
   */
  async searchUncached(request, signal, options, cap) {
    if (options.deepseekEnabled !== true || !this.deepseek.available()) {
      // Serper is the only enabled lane; a cooldown cannot fail it open to
      // anything, so always try rather than making search unavailable.
      const only = await settle(() => this.serper.search(request, signal))
      if (signal?.aborted === true) throw searchAborted(signal)
      if (!only.ok) {
        if (only.error?.code === 'WEB_ABORTED') throw only.error
        this.recordFailure('serper', only.error, options)
        throw only.error
      }
      this.recordSuccess('serper', options)
      const result = applyQualityRules(only.value, options, cap)
      this.report(options, `primary=serper only serper=${describe(result, only.ms)}`)
      return { result, degraded: false }
    }

    const skip = this.coolingLanes()
    const [deepseekResult, serperResult] = await Promise.all([
      skip.deepseek === undefined ? settle(() => this.deepseek.search(request, signal)) : skippedOutcome(skip.deepseek),
      skip.serper === undefined ? settle(() => this.serper.search(request, signal)) : skippedOutcome(skip.serper),
    ])
    if (signal?.aborted === true) throw searchAborted(signal)

    if (skip.deepseek === undefined) this.recordLane('deepseek', deepseekResult, options)
    if (skip.serper === undefined) this.recordLane('serper', serperResult, options)

    if (deepseekResult.ok && serperResult.ok) {
      const primaryIsDeepseek = options.primary !== 'serper'
      const primary = primaryIsDeepseek ? deepseekResult.value : serperResult.value
      const secondary = primaryIsDeepseek ? serperResult.value : deepseekResult.value
      const merged = capResult(mergeResults(primary, secondary, {
        ratio: options.ratio,
        maxResults: cap,
        maxPerHost: options.maxPerHost,
        demoteSocial: options.demoteSocial,
      }), cap)
      this.report(options, [
        `primary=${primaryIsDeepseek ? 'deepseek' : 'serper'}`,
        `ratio=${options.ratio}`,
        `deepseek=${describe(deepseekResult.value, deepseekResult.ms)}`,
        `serper=${describe(serperResult.value, serperResult.ms)}`,
        `merged=${merged.sources.length}`,
      ].join(' '))
      return { result: merged, degraded: false }
    }

    if (deepseekResult.ok || serperResult.ok) {
      const winner = deepseekResult.ok ? deepseekResult : serperResult
      const loser = deepseekResult.ok ? serperResult : deepseekResult
      const winnerName = deepseekResult.ok ? 'deepseek' : 'serper'
      const loserName = deepseekResult.ok ? 'serper' : 'deepseek'
      // Quality rules apply to a degraded single-backend result too: without
      // this, a serper timeout let three same-host DeepSeek pages through the
      // per-host cap (caught in the v3.1 live check).
      const result = applyQualityRules(winner.value, options, cap)
      const note = noteFor(loserName, loser, winnerName)
      this.report(options, [
        `primary=${options.primary}`,
        `degraded to ${winnerName} after ${loser.ok ? 'ok' : messageOf(loser.error)}`,
        `${winnerName}=${describe(result, winner.ms)}`,
      ].join(' '), 'warn')
      return { result: withNote(result, note), degraded: true }
    }

    const abortReason = [deepseekResult.error, serperResult.error].find((error) => error?.code === 'WEB_ABORTED')
    if (abortReason !== undefined) throw abortReason
    throw new WebError(
      `Merged search failed on both backends.\n\nDeepSeek Search API: ${laneTag(deepseekResult)}${messageOf(deepseekResult.error)}\n\nSerper: ${laneTag(serperResult)}${messageOf(serperResult.error)}`,
      'WEB_PROVIDER_ERROR',
    )
  }

  /**
   * Lanes muted right now. Both cooling means fail-open: return nothing to
   * skip, because a stale cooldown must never disable search entirely.
   * @param {number} [now] - clock, injectable for tests.
   * @returns {{deepseek?: object, serper?: object}} the lanes to skip.
   */
  coolingLanes(now = Date.now()) {
    const deepseekCooling = (this.health.deepseek.until ?? 0) > now
    const serperCooling = (this.health.serper.until ?? 0) > now
    if (deepseekCooling && serperCooling) return {}
    return {
      ...(deepseekCooling ? { deepseek: this.health.deepseek } : {}),
      ...(serperCooling ? { serper: this.health.serper } : {}),
    }
  }

  /**
   * Clear active cooldowns whose credential fingerprint changed. Cached results
   * are dropped with them: the cooldown existed because the old credentials
   * failed, so answers produced under it are stale too.
   * @param {object} options - the search's options snapshot.
   * @param {number} [now] - clock, injectable for tests.
   */
  refreshCooldowns(options, now = Date.now()) {
    let cleared = false
    for (const lane of LANE_NAMES) {
      const health = this.health[lane]
      if (health?.fingerprint === undefined || (health.until ?? 0) <= now) continue
      if (credentialFingerprint(options[lane]) === health.fingerprint) continue
      this.health[lane] = emptyHealth()
      cleared = true
      this.report(options, `cooldown ${lane} cleared (credential fingerprint changed)`)
    }
    if (cleared) this.clearCachedResults()
  }

  /** Record a successful lane result (which also proves the lane is reachable). */
  recordLane(lane, settled, options) {
    if (settled.ok) this.recordSuccess(lane, options)
    else this.recordFailure(lane, settled.error, options)
  }

  /**
   * Write one lane's cooldown from a failure classification.
   * @param {'deepseek' | 'serper'} lane - the failing lane.
   * @param {unknown} error - the rejection.
   * @param {object} options - the search's options snapshot.
   * @param {number} [now] - clock, injectable for tests.
   * @returns {object | null | undefined} the classification that was applied.
   */
  recordFailure(lane, error, options, now = Date.now()) {
    if (error?.code === 'WEB_ABORTED') return undefined
    const failure = classifyFailure(error)
    if (failure === null || failure.cooldownMs <= 0) return failure ?? undefined
    const fingerprint = credentialFingerprint(options[lane])
    this.health[lane] = {
      until: now + failure.cooldownMs,
      cls: failure.cls,
      detail: redactBodyExcerpt(messageOf(error), 200),
      fingerprint,
    }
    this.report(options, `cooldown ${lane}=${failure.cls} until=+${Math.round(failure.cooldownMs / 1000)}s fp=${fingerprint}`)
    return failure
  }

  /** Clear a lane's cooldown because it just answered (200, even when empty). */
  recordSuccess(lane, options) {
    const wasCooling = (this.health[lane].until ?? 0) > Date.now()
    this.clearHealth(lane)
    if (wasCooling) this.report(options, `cooldown ${lane} cleared (backend answered)`)
  }

  /**
   * Emit one structured summary line when `logLevel` allows it.
   * @param {object} options - the search's settings snapshot.
   * @param {string} line - the summary text.
   */
  report(options, line, level = 'info') {
    if (options.logLevel === 'off' || this.logger === undefined) return
    const write = level === 'warn' ? (this.logger.warn ?? this.logger.info) : this.logger.info
    try {
      write?.call(this.logger, `web-search-serper: ${line}`)
    } catch {
      // Logging must never fail a search.
    }
  }
}

/** Lanes the health table tracks. */
const LANE_NAMES = ['deepseek', 'serper']

/** One empty health record; `until` in the past means "healthy". */
function emptyHealth() {
  return { until: 0, cls: null, detail: undefined, fingerprint: undefined }
}

/** Represent a muted lane in the settle() shape so composition stays uniform. */
function skippedOutcome(health) {
  const error = new WebError(`skipped: ${health?.cls ?? 'failure'} cooldown active`, 'WEB_PROVIDER_ERROR')
  error.skipped = true
  return { ok: false, skipped: true, error, health, ms: 0 }
}

/** The one-line degradation note, or '' when the loser was aborted. */
function noteFor(loserName, loser, winnerName) {
  if (loser?.skipped === true) {
    const label = FAILURE_LABELS[loser.health?.cls] ?? 'skipped'
    return `Note: ${loserName} ${label}, using ${winnerName}.`
  }
  const failure = classifyFailure(loser?.error)
  if (failure === null) return ''
  const status = Number.isInteger(loser?.error?.httpStatus) ? ` (HTTP ${loser.error.httpStatus})` : ''
  const timeout = failure.cls === 'timeout' && Number.isFinite(loser?.error?.timeoutMs)
    ? ` after ${loser.error.timeoutMs}ms`
    : ''
  return `Note: ${loserName} ${failure.label}${timeout}${status}, using ${winnerName}.`
}

/** Prefix a both-backends-failed message with each lane's failure class. */
function laneTag(settled) {
  const failure = settled?.skipped === true
    ? { cls: settled.health?.cls }
    : classifyFailure(settled?.error)
  return failure?.cls ? `[${failure.cls}] ` : ''
}

/**
 * Project one `settle()` outcome into the probe's lane protocol. The
 * `account-only` class separates "no API key, but a DeepSeek Account session
 * exists" (which only works inside a conversation) from a real auth failure.
 * @param {'deepseek' | 'serper'} lane - the lane that was probed.
 * @param {{ok: boolean, ms: number, value?: object, error?: unknown}} outcome - the settled result.
 * @param {{accountService?: boolean}} [extra] - whether a DeepSeek Account service is mounted.
 * @returns {object} the lane report, holding no credential material.
 */
function laneReport(lane, outcome, { accountService = false } = {}) {
  if (outcome.ok) {
    return {
      lane,
      ok: true,
      ms: outcome.ms,
      sources: outcome.value.sources.length,
      httpStatus: 200,
      class: null,
      error: null,
    }
  }
  const error = outcome.error
  const accountOnly = lane === 'deepseek'
    && accountService
    && error?.code === 'WEB_PROVIDER_CREDENTIAL_MISSING'
  return {
    lane,
    ok: false,
    ms: outcome.ms,
    sources: 0,
    httpStatus: Number.isInteger(error?.httpStatus) ? error.httpStatus : null,
    class: accountOnly ? 'account-only' : (classifyFailure(error)?.cls ?? 'invalid-response'),
    error: accountOnly ? ACCOUNT_ONLY_ERROR : firstSentence(messageOf(error)),
  }
}

/**
 * First sentence of a probe failure, collapsed to one line and redacted: an
 * upstream error body can echo a key, and the probe answer crosses the wire.
 * @param {string} message - the backend error message.
 * @returns {string} the one-line, credential-free excerpt.
 */
function firstSentence(message) {
  return redactBodyExcerpt(message, 300).split(/\.\s/)[0]
}

/** Put one Note line at the top of the model-visible content. */
function withNote(result, note) {
  if (note === undefined || note === null || note === '') return result
  return { ...result, content: result.content ? `${note}\n\n${result.content}` : note }
}

/**
 * Project one resolved section into the options both backends serve their next
 * search with. Environment fallbacks stay here rather than in the providers.
 * @param {import('@deepseek-ai/cordis').Context} ctx - plugin context.
 * @param {object} config - the currently authoritative section.
 * @returns {object} the merged options snapshot.
 */
function resolveOptions(ctx, config) {
  const launch = launchEnvironmentOf(ctx)
  const serperKeyEnv = credentialRef(config.apiKeyEnv)
  const literalSerperKey = nonEmpty(config.apiKey)

  // v0.2.x users configured the native half's key; keep it as a fallback under
  // the new DeepSeek Search API field names.
  const configuredDeepseekEnv = config.deepseekApiKeyEnv
  const legacyDeepseekEnv = config.nativeApiKeyEnv
  const legacyEnvWins = configuredDeepseekEnv === DEEPSEEK_DEFAULT_API_KEY_ENV
    && legacyDeepseekEnv !== undefined
    && legacyDeepseekEnv.length > 0
    && legacyDeepseekEnv !== DEEPSEEK_DEFAULT_API_KEY_ENV
  const deepseekKeyEnv = credentialRef(legacyEnvWins ? legacyDeepseekEnv : configuredDeepseekEnv)
  const literalDeepseekKey = nonEmpty(config.deepseekApiKey) ?? nonEmpty(config.nativeApiKey)

  return {
    deepseekEnabled: config.native !== false,
    primary: config.primary === 'serper' ? 'serper' : 'deepseek',
    ratio: RATIO_VALUES.includes(config.ratio) ? config.ratio : 2,
    maxPerHost: Number.isInteger(config.maxPerHost) ? config.maxPerHost : 2,
    demoteSocial: config.demoteSocial !== false,
    logLevel: config.logLevel === 'off' || config.logLevel === 'verbose' ? config.logLevel : 'summary',
    cacheMinutes: config.cacheMinutes,
    deepseek: {
      ...(literalDeepseekKey === undefined ? {} : { apiKey: literalDeepseekKey }),
      resolveAccountToken: async (endpoint) => {
        if (ctx.get('agents')?.currentInitiator()?.session.requestContext()?.provider !== ACCOUNT_PROVIDER) return undefined
        return await ctx.get('deepseekAccount')?.resolveToken(endpoint)
      },
      resolveApiKey: async () => {
        const credentials = ctx.get('credentials')
        if (credentials !== undefined) return (await credentials.resolve(deepseekKeyEnv))?.value
        const ambient = launch.get(deepseekKeyEnv)
        return ambient !== undefined && ambient.value.length > 0 ? ambient.value : undefined
      },
      apiKeyEnv: String(deepseekKeyEnv),
      /**
       * A mounted DeepSeek Account service means "signed in without an API key"
       * is a legitimate state; the probe reports it as `account-only` instead
       * of an auth failure (no initiator exists inside an HTTP route).
       */
      hasAccountService: () => ctx.get('deepseekAccount') !== undefined,
      baseURL: config.deepseekBaseURL ?? launch.get(DEEPSEEK_SEARCH_API_BASE_URL_ENV)?.value ?? DEEPSEEK_SEARCH_API_DEFAULT_BASE_URL,
      count: config.deepseekCount,
      timeoutMs: config.deepseekTimeoutMs,
      summaryMaxChars: config.summaryMaxChars,
      minAuthority: config.minAuthority,
      maxRetries: config.maxRetries,
    },
    serper: {
      ...(literalSerperKey === undefined ? {} : { apiKey: literalSerperKey }),
      resolveApiKey: async () => {
        const credentials = ctx.get('credentials')
        if (credentials !== undefined) return (await credentials.resolve(serperKeyEnv))?.value
        const ambient = launch.get(serperKeyEnv)
        return ambient !== undefined && ambient.value.length > 0 ? ambient.value : undefined
      },
      apiKeyEnv: config.apiKeyEnv,
      baseURL: config.baseURL ?? launch.get(SEARCH_BASE_URL_ENV)?.value ?? SERPER_DEFAULT_BASE_URL,
      gl: config.gl,
      hl: config.hl,
      autoLocale: config.autoLocale,
      num: config.num,
      timeoutMs: config.serperTimeoutMs,
    },
  }
}

/**
 * The provider id the seam would resolve right now. rc.2+ exposes it as the
 * volatile `web.config.searchProvider` ref; very old builds exposed the
 * `web.searchProviderId` attribute instead, which is still read as a fallback.
 * `undefined` means "unset" (the deployment default applies).
 * @param {object} web - the `web` service.
 * @returns {string | undefined} the configured id, if any.
 */
function currentProvider(web) {
  const ref = web?.config?.searchProvider
  if (typeof ref?.get === 'function') return ref.get()
  const legacy = web?.searchProviderId
  return typeof legacy === 'string' ? legacy : undefined
}

/**
 * Log a warning once per process. `key` identifies the situation (not the
 * message), so repeated applies of the same composition stay quiet.
 * @param {object} [logger] - cordis logger.
 * @param {string} key - dedupe key.
 * @param {string} message - the warning text.
 */
function warnOnce(logger, key, message) {
  if (warned.has(key)) return
  warned.add(key)
  logger?.warn?.(message)
}

/**
 * Persist the one-shot marker `takeOverProvider: false` into this plugin's own
 * entry. The next start re-decides only when this write failed; a failure is
 * logged at error level because a later "restore deployment default" could be
 * re-taken over if the marker never lands.
 * @param {object} sctx - context that injected `settings`.
 * @param {object} [logger] - cordis logger.
 * @returns {Promise<void>} settles after the write attempt.
 */
function markTakenOver(sctx, logger) {
  return Promise.resolve()
    .then(() => sctx.settings.mutate(OWN_NS, [{ op: 'set', path: ['takeOverProvider'], value: false }]))
    .catch((error) => {
      const message = `web-search-serper: could not persist the one-shot takeover marker (${String(error)}); a later "restore deployment default" may be taken over again. Check that ~/.dsh/profiles/<profile>/cordis.patch.yml is writable and not overridden by a home patch.`
      const write = logger?.error ?? logger?.warn
      try {
        write?.call(logger, message)
      } catch {
        // Logging must never fail boot.
      }
    })
}

/**
 * Pin `web.searchProvider` to this provider once, unless the user (or the
 * operator) already made the choice. The two writes go to different entries and
 * run strictly one after the other.
 *
 * Behaviour matrix (`takeOverProvider` / user layer / env / resolved value):
 * - `false` → nothing (already took over, or explicitly disabled).
 * - user layer says `serper` → marker only (pin untouched).
 * - user layer says another id → warn + marker, pin untouched.
 * - `$DSH_WEB_SEARCH_PROVIDER` says another id → warn + marker, pin untouched
 *   (env and config are the same field; config would win, so the operator's
 *   choice must be recorded instead of silently overridden).
 * - user/env unset + resolved unset/`deployment default` → pin `serper` + marker.
 * - resolved `serper` already (and unset env) → marker only, no redundant pin.
 * - resolved another id (another bundle) → warn only, no marker (the operator
 *   keeps control; unpinning is their move).
 *
 * The decision runs after the loader settles: DSH itself defers boot-time
 * profile edits this way, and `configEditor.edit()` is only reliable once every
 * entry has its final identity.
 *
 * @param {import('@deepseek-ai/cordis').Context} ctx - plugin context (`inject: ['web']`).
 * @param {{takeOverProvider?: boolean}} options - the config snapshot.
 * @param {object} [logger] - cordis logger.
 */
export function installProviderTakeover(ctx, options, logger) {
  if (options?.takeOverProvider === false) return

  ctx.inject(['settings'], (sctx) => {
    const decide = () => {
      const settings = sctx.settings
      let descriptor
      try {
        descriptor = settings.describe().find((row) => row.ns === 'web')
      } catch (error) {
        logger?.warn?.(`web-search-serper: could not read the settings descriptors (${String(error)}); searchProvider is left alone this start.`)
        return
      }
      if (descriptor === undefined) {
        warnOnce(
          logger,
          'web-config-unavailable',
          'web-search-serper: the "web" settings entry is not configurable in this build, so searchProvider cannot be pinned automatically. Set searchProvider: serper in this profile\'s cordis.patch.yml to use this plugin.',
        )
        return
      }

      const userPin = descriptor.user?.searchProvider
      const current = currentProvider(ctx.web)
      // The deployment default comes from the inherited layer when this build
      // exposes it (`describe().base`); the shipped default is the fallback.
      const deploymentDefault = typeof descriptor.base?.searchProvider === 'string'
        ? descriptor.base.searchProvider
        : OFFICIAL_PROVIDER_ID
      // `$DSH_WEB_SEARCH_PROVIDER` feeds the same field as `searchProvider`; it
      // is never silently overridden by this plugin.
      const envPin = launchEnvironmentOf(ctx).get('DSH_WEB_SEARCH_PROVIDER')?.value

      // The user already decided in their own patch layer: honour it, and record
      // that this plugin must never take over again.
      if (userPin !== undefined) {
        if (userPin !== SERPER_PROVIDER_ID) {
          warnOnce(
            logger,
            `user-pin:${userPin}`,
            `web-search-serper: searchProvider is set to "${userPin}" in your profile patch; leaving it alone. To use this plugin instead, set searchProvider: ${SERPER_PROVIDER_ID}.`,
          )
        }
        void markTakenOver(sctx, logger)
        return
      }

      // The operator set the environment variable: same field, same respect.
      if (envPin !== undefined && envPin !== SERPER_PROVIDER_ID) {
        warnOnce(
          logger,
          `env-pin:${envPin}`,
          `web-search-serper: searchProvider is set to "${envPin}" through DSH_WEB_SEARCH_PROVIDER; leaving it alone. To use this plugin instead, unset that variable or set it to ${SERPER_PROVIDER_ID}.`,
        )
        void markTakenOver(sctx, logger)
        return
      }

      // The seam already resolves to this provider (env pin or a previous manual
      // pin) and no config field beats it: consume the one-shot, do not re-pin.
      if (current === SERPER_PROVIDER_ID || (current === undefined && envPin === SERPER_PROVIDER_ID)) {
        void markTakenOver(sctx, logger)
        return
      }

      // Another bundle pinned an id: do not fight it and do not consume the
      // one-shot marker, so the operator can still switch deliberately.
      if (current !== undefined && current !== deploymentDefault) {
        warnOnce(
          logger,
          `bundle-pin:${current}`,
          `web-search-serper: searchProvider is pinned to "${current}" by another bundle, so this plugin will not take over. To use it, set searchProvider: ${SERPER_PROVIDER_ID} in this profile's cordis.patch.yml.`,
        )
        return
      }

      void Promise.resolve()
        .then(() => settings.mutate('web', [{ op: 'set', path: ['searchProvider'], value: SERPER_PROVIDER_ID }]))
        .then(() => {
          logger?.info?.(`web-search-serper: took over searchProvider (${current ?? 'unset'} → ${SERPER_PROVIDER_ID})`)
          return markTakenOver(sctx, logger)
        })
        .catch((error) => {
          const message = `web-search-serper: searchProvider takeover failed (${String(error)}); search keeps the deployment default. The move is retried on the next start; if the profile patch is read-only or overridden by a home patch, set searchProvider: serper manually.`
          const write = logger?.error ?? logger?.warn
          try {
            write?.call(logger, message)
          } catch {
            // Logging must never fail boot.
          }
        })
    }

    const loader = ctx.get('loader')
    const settled = typeof loader?.await === 'function' ? loader.await() : undefined
    void Promise.resolve(settled).then(decide, decide)
  })

  warnWhenSettingsAbsent(ctx, logger)
}

/**
 * Report a missing `settings` service once, after the loader has settled.
 *
 * `settings` may simply load after this plugin (entries start concurrently), so
 * an immediate check would warn on every healthy boot. Old DSH builds disable
 * the entry outright; the post-boot check is what distinguishes the two.
 * @param {import('@deepseek-ai/cordis').Context} ctx - plugin context.
 * @param {object} [logger] - cordis logger.
 */
function warnWhenSettingsAbsent(ctx, logger) {
  if (ctx.get('settings') !== undefined) return
  const settled = ctx.get('loader')?.await?.()
  const check = () => {
    if (ctx.get('settings') !== undefined) return
    warnOnce(
      logger,
      'no-settings',
      'web-search-serper: the settings service is unavailable, so searchProvider cannot be pinned automatically. Set searchProvider: serper in this profile\'s cordis.patch.yml to use this plugin.',
    )
  }
  void Promise.resolve(settled).then(check, check)
}

/** Register the merged DeepSeek Search API + serper provider with `ctx.web`. */
export function apply(ctx, config) {
  /** One config snapshot; the provider and the credential listener share it. */
  const snapshot = () => ({
    apiKey: config.apiKey.get(),
    apiKeyEnv: config.apiKeyEnv.get(),
    baseURL: config.baseURL.get(),
    gl: config.gl.get(),
    hl: config.hl.get(),
    autoLocale: config.autoLocale.get(),
    num: config.num.get(),
    serperTimeoutMs: config.serperTimeoutMs.get(),
    deepseekApiKey: config.deepseekApiKey.get(),
    deepseekApiKeyEnv: config.deepseekApiKeyEnv.get(),
    deepseekBaseURL: config.deepseekBaseURL.get(),
    deepseekCount: config.deepseekCount.get(),
    deepseekTimeoutMs: config.deepseekTimeoutMs.get(),
    summaryMaxChars: config.summaryMaxChars.get(),
    primary: config.primary.get(),
    ratio: config.ratio.get(),
    minAuthority: config.minAuthority.get(),
    maxRetries: config.maxRetries.get(),
    maxPerHost: config.maxPerHost.get(),
    demoteSocial: config.demoteSocial.get(),
    logLevel: config.logLevel.get(),
    cacheMinutes: config.cacheMinutes.get(),
    native: config.native.get(),
    nativeApiKey: config.nativeApiKey.get(),
    nativeApiKeyEnv: config.nativeApiKeyEnv.get(),
    nativeBaseURL: config.nativeBaseURL.get(),
    nativeModel: config.nativeModel.get(),
    nativeMaxUses: config.nativeMaxUses.get(),
  })
  const resolve = () => resolveOptions(ctx, snapshot())
  const provider = new MergedSearchProvider(resolve, ctx.logger)
  ctx.web.registerSearchProvider(provider)

  // Saving a key in the settings card goes through `credentials.set(ref, value)`
  // and leaves every config field (and therefore the fingerprint) unchanged, so
  // the credential event is the only signal that the user already intervened.
  // Cached results are dropped with the cooldown: a cached degraded answer and
  // its stale `Note` must not survive the fix.
  ctx.on('credentials/reference-updated', (ref) => {
    const options = resolve()
    let touched = false
    if (options.serper.apiKeyEnv === ref) {
      provider.clearHealth('serper')
      touched = true
    }
    if (options.deepseek.apiKeyEnv === ref) {
      provider.clearHealth('deepseek')
      touched = true
    }
    if (touched) provider.clearCachedResults()
  })

  // Automatically point the seam at this provider once; the marker write turns
  // this into a one-shot so a later reset in the settings page is not undone.
  installProviderTakeover(ctx, { takeOverProvider: config.takeOverProvider.get() }, ctx.logger)

  // The settings card's self-check and provider switch (P1-5). Registration is
  // silent when the deployment lacks webServer/connection/settings, so the card
  // sees a 404 (or the SPA fallback's 405) and says the feature is unsupported.
  registerRuntimeRoutes(ctx, { provider, version: PKG_VERSION })
}

/** Guidance appended to DeepSeek Search API failures. */
const DEEPSEEK_GUIDANCE = 'Check the "deepseekBaseURL" setting (default https://api.deepseek.com/v1/tools) and the DEEPSEEK_API_KEY credential / DeepSeek account sign-in.'

/** Guidance appended to serper failures. */
const SERPER_GUIDANCE = 'Check the SERPER_API_KEY credential and the "baseURL" setting (default https://google.serper.dev).'

/**
 * Dispatch one JSON POST with a per-request timeout. Transport failures are
 * classified so callers can decide whether to retry.
 * @param {object} options - request description.
 * @returns {Promise<Response>} the response; the caller owns status handling.
 */
async function postJson({ endpoint, body, headers, timeoutMs, signal, fetchImpl, subject, guidance }) {
  const gate = withTimeout(signal, timeoutMs)
  try {
    const response = await (fetchImpl ?? fetch)(endpoint, {
      method: 'POST',
      redirect: 'error',
      headers,
      body: JSON.stringify(body),
      signal: gate.signal,
    })
    return { response, gate }
  } catch (error) {
    gate.cleanup()
    if (signal?.aborted === true) throw searchAborted(signal, error)
    if (gate.timedOut()) {
      const timeoutError = new WebError(`${subject} request timed out after ${timeoutMs}ms. ${guidance}`, 'WEB_PROVIDER_ERROR', { cause: error })
      timeoutError.retryable = false
      timeoutError.failureKind = 'timeout'
      timeoutError.timeoutMs = timeoutMs
      throw timeoutError
    }
    const failure = new WebError(`${subject} request failed: ${String(error)}. ${guidance}`, 'WEB_PROVIDER_ERROR', { cause: error })
    failure.retryable = true
    failure.failureKind = 'network'
    throw failure
  }
}

/**
 * Read one response's JSON body while the request gate is still armed, so a
 * stalled body cannot outlive the per-backend timeout or the caller's signal
 * (a fetch that resolved its headers leaves the body stream abortable).
 * @param {{ response: Response, gate: { timedOut: () => boolean } }} opened - the dispatched request.
 * @param {{ subject: string, guidance: string, signal?: AbortSignal }} context - error context.
 * @returns {Promise<unknown>} the parsed body.
 */
async function readJsonBody(opened, { subject, guidance, signal }) {
  try {
    return await opened.response.json()
  } catch (error) {
    if (signal?.aborted === true) throw searchAborted(signal, error)
    if (opened.gate.timedOut()) {
      const timeoutError = new WebError(`${subject} response body timed out after its request budget. ${guidance}`, 'WEB_PROVIDER_ERROR', { cause: error })
      timeoutError.retryable = false
      timeoutError.failureKind = 'timeout'
      throw timeoutError
    }
    const invalid = new WebError(`${subject} returned an unprocessable response body: ${String(error)}. ${guidance}`, 'WEB_PROVIDER_ERROR', { cause: error })
    invalid.failureKind = 'invalid-response'
    throw invalid
  }
}

/**
 * Consume a response body before a retry or an error return; abort wins over
 * drain failures. Returns the redacted excerpt kept on the thrown error.
 * @param {Response} response - the response whose body is drained.
 * @param {AbortSignal} [signal] - the caller's cancellation signal.
 * @returns {Promise<string>} the redacted body excerpt (at most 300 characters).
 */
async function drainBody(response, signal) {
  let text = ''
  try {
    text = await response.text()
  } catch {
    // The retry/caller owns the outcome; a failed drain must not mask it.
  }
  if (signal?.aborted === true) throw searchAborted(signal)
  return redactBodyExcerpt(text)
}

/**
 * Combine the caller's abort signal with an independent per-request timeout.
 * @param {AbortSignal} [parentSignal] - the caller's signal.
 * @param {number} timeoutMs - the timeout budget.
 * @returns {{ signal: AbortSignal, timedOut: () => boolean, cleanup: () => void }} the gate.
 */
function withTimeout(parentSignal, timeoutMs) {
  const controller = new AbortController()
  const timer = setTimeout(() => {
    controller.abort(new DOMException(`Search timeout after ${timeoutMs}ms`, 'TimeoutError'))
  }, timeoutMs)
  const onAbort = () => controller.abort(parentSignal.reason)
  if (parentSignal !== undefined) {
    if (parentSignal.aborted === true) controller.abort(parentSignal.reason)
    else parentSignal.addEventListener('abort', onAbort, { once: true })
  }
  return {
    signal: controller.signal,
    timedOut: () => controller.signal.reason?.name === 'TimeoutError',
    cleanup: () => {
      clearTimeout(timer)
      parentSignal?.removeEventListener?.('abort', onAbort)
    },
  }
}

/** Await one backend, capturing success/failure and elapsed ms. */
async function settle(run) {
  const started = Date.now()
  try {
    return { ok: true, value: await run(), ms: Date.now() - started }
  } catch (error) {
    return { ok: false, error, ms: Date.now() - started }
  }
}

/** Clamp a requested result count into a backend's range. */
function clampCount(value, min, max) {
  if (!Number.isFinite(value)) return min
  return Math.max(min, Math.min(max, Math.trunc(value)))
}

/** Exponential backoff with jitter, used for 429/5xx retries. */
function backoffMs(attempt) {
  return 1000 * 2 ** attempt + Math.floor(Math.random() * 250)
}

/** Sleep that rejects with `WEB_ABORTED` when the search is cancelled. */
function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted === true) {
      reject(searchAborted(signal))
      return
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener?.('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = () => {
      clearTimeout(timer)
      reject(searchAborted(signal))
    }
    signal?.addEventListener?.('abort', onAbort, { once: true })
  })
}

/** Resolve one credential function under the search's cancellation signal. */
async function resolveCredential(resolve, signal) {
  throwIfSearchAborted(signal)
  try {
    return await resolve()
  } catch (error) {
    if (signal?.aborted === true) throw searchAborted(signal, error)
    throw new WebError(`Search credential resolution failed: ${String(error)}`, 'WEB_PROVIDER_ERROR', { cause: error })
  }
}

/** Resolve one backend's API key, failing with the seam's credential-missing code. */
async function resolveKey(options, signal, subject) {
  throwIfSearchAborted(signal)
  if (typeof options.apiKey === 'string' && options.apiKey.length > 0) return options.apiKey
  const resolved = options.resolveApiKey === undefined
    ? undefined
    : await resolveCredential(options.resolveApiKey, signal)
  if (typeof resolved === 'string' && resolved.length > 0) return resolved
  const ref = options.apiKeyEnv ?? DEEPSEEK_DEFAULT_API_KEY_ENV
  throw new WebError(
    `${subject} has no API key for "${ref}"; store it through the credentials service (~/.dsh/.credentials.yaml "refs:"), export it in the launching environment, or set a literal key in the web-search-serper config`,
    'WEB_PROVIDER_CREDENTIAL_MISSING',
  )
}

/** Apply the merge-quality rules (host cap, locale dedupe, social demotion) to a single backend result. */
function applyQualityRules(result, options, cap) {
  const { sources } = mergeSources(result.sources, [], {
    ratio: options.ratio,
    maxResults: cap,
    maxPerHost: options.maxPerHost,
    demoteSocial: options.demoteSocial,
  })
  return {
    ...(result.content === undefined ? {} : { content: result.content }),
    sources,
    truncated: false,
  }
}

/** Trim the requested sources to the tool layer's cap without flagging truncation. */
function capResult(result, cap) {
  if (cap === undefined || result.sources.length <= cap) return result
  return { ...result, sources: result.sources.slice(0, cap), truncated: false }
}

/** Throw the provider's stable cancellation error when the caller already aborted. */
function throwIfSearchAborted(signal) {
  if (signal?.aborted === true) throw searchAborted(signal)
}

/** Build the provider's stable cancellation error while retaining the caller's reason. */
function searchAborted(signal, fallback) {
  return new WebError('Web search aborted', 'WEB_ABORTED', { cause: signal?.aborted === true ? signal.reason : fallback })
}

/** The error's display message, tolerating non-Error rejections. */
function messageOf(reason) {
  return reason instanceof Error ? reason.message : String(reason)
}

/** One-line backend summary for the log. */
function describe(result, ms) {
  return `ok ${ms}ms ${result.sources.length}src`
}

/** Return a string only when non-empty. */
function nonEmpty(value) {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}
