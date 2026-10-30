/**
 * dsh-serper-search, Host half: one MERGED search provider for the DSH web
 * capability seam (`ctx.web`). Function-plugin form (named exports only).
 *
 * Up to three direct HTTP backends run in parallel, one request each, with no
 * auxiliary model turn (the third, Tencent Cloud WSA / Yuanbao Search, is off
 * by default and costs one extra paid request per search when enabled):
 *
 *   - DeepSeek Search API (primary by default): POST `${baseURL}/search` with
 *     `Authorization: Bearer <key>`, or `x-dsh-auth-token` on a DeepSeek
 *     Account session. Returns `summary` (long excerpt) which is clipped into
 *     `snippet`, plus `date`/`authority`.
 *   - serper.dev (secondary by default): POST `${baseURL}/search` with
 *     `X-API-KEY`, Google's ranked `organic[]` plus the `answerBox`, which
 *     becomes the result-level `content`.
 *   - 元宝搜索 / Tencent Cloud WSA SearchPro (third lane, `yuanbaoEnabled`):
 *     POST `${yuanbaoEndpoint}` with a Bearer service key; `Response.Pages` is
 *     an array of JSON strings, and `Cnt` must be a multiple of ten (10..50) —
 *     an illegal value answers HTTP 200 with an error envelope and no pages.
 *
 * Sources dedupe by normalized URL and interleave by a fixed slot pattern
 * (default 2:1 — six primary + two secondary in the tool layer's eight slots;
 * with the third lane on, `ratio: '1:1:1'` at a 24-slot cap gives 8+8+8), then
 * the provider truncates to `maxResults` and reports `truncated: false` so the
 * seam never attaches its "Refine the query for more" hint. Any lane may fail,
 * time out, or lack a key — the rest still answer; only all enabled lanes
 * failing throws.
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
  mergeLanes,
} from './merge.js'
import {
  clampCount,
  drainBody,
  postJson,
  readJsonBody,
  searchAborted,
  sleep,
  throwIfSearchAborted,
} from './http.js'
import { YUANBAO_DEFAULT_API_KEY_ENV, YUANBAO_DEFAULT_ENDPOINT, YuanbaoBackend } from './yuanbao.js'
import { registerRuntimeRoutes } from './routes.js'

// Public lane surface: the settings card, tests, and embedders reach the
// Yuanbao lane through the Host entry point (the other lanes are exported here
// as classes already).
export { YUANBAO_DEFAULT_ENDPOINT, YuanbaoBackend, mapYuanbaoResponse, resolveYuanbaoCnt } from './yuanbao.js'

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

/** Environment variable overriding the Yuanbao SearchPro endpoint independently of config. */
const YUANBAO_ENDPOINT_ENV = 'YUANBAO_ENDPOINT'

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

/** Accepted two-lane `ratio` values (numeric keys of {@link RATIO_PATTERNS}). */
const RATIO_VALUES = Object.keys(RATIO_PATTERNS).map(Number).filter(Number.isFinite)

/** Accepted three-lane `ratio` keys (`'1:1:1'`, `'2:1:1'`), used when the Yuanbao lane is on. */
const THREE_LANE_RATIOS = Object.keys(RATIO_PATTERNS).filter((key) => key.includes(':'))

/** Every accepted `ratio` value; the schema union is built from this. */
const RATIO_KEYS = [...RATIO_VALUES, ...THREE_LANE_RATIOS]

/** Three-lane default when the Yuanbao lane is enabled and `ratio` is a two-lane number. */
const DEFAULT_THREE_LANE_RATIO = '1:1:1'

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
  /** Enable the serper.dev lane; `false` drops it from the interleave and the probe. */
  serperEnabled: z.boolean().default(true).volatile(),

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
  /**
   * Slot pattern. Two-lane mode accepts the numeric ratios (1 / 1.5 / 2 / 3 / 4);
   * with the Yuanbao lane enabled use a three-lane key (`'1:1:1'` default, or
   * `'2:1:1'`); a numeric value is then treated as `'1:1:1'`.
   */
  ratio: z.union(RATIO_KEYS).default(2).volatile(),
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

  // ── Yuanbao Search / Tencent Cloud WSA SearchPro (third lane, v0.5.0) ────
  /** Enable the third lane. Off by default: enabling it adds one paid request per search. */
  yuanbaoEnabled: z.boolean().default(false).volatile(),
  yuanbaoApiKey: z.string().role('secret').volatile(),
  yuanbaoApiKeyEnv: z.string().role('credential-ref').pattern(/^[A-Za-z_][A-Za-z0-9_]*$/).default(YUANBAO_DEFAULT_API_KEY_ENV).volatile(),
  yuanbaoEndpoint: z.string().volatile(),
  /** `Cnt` override; 0 = derive from `maxResults` (rounded up to a legal 10..50). */
  yuanbaoCnt: z.number().step(1).min(0).max(50).default(0).volatile(),
  yuanbaoTimeoutMs: z.number().step(1).min(500).default(4500).volatile(),

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
 * The merged provider the seam actually calls: every enabled lane in parallel,
 * one ranked interleave, graceful degradation to whichever answered.
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
    this.yuanbao = new YuanbaoBackend(() => this.resolveOptions().yuanbao)
    this.health = { deepseek: emptyHealth(), serper: emptyHealth(), yuanbao: emptyHealth() }
    this.cache = new ResultCache()
  }

  /** Usable while any *enabled* lane is; a failing lane degrades per search. */
  available() {
    const options = this.resolveOptions()
    return this.laneBackends(options).some(({ backend }) => backend.available())
  }

  /**
   * The lanes enabled by the current settings, in precedence order. Precedence
   * decides who wins URL-dedupe ties and which lane fills an exhausted slot.
   * @param {object} [options] - this operation's settings snapshot.
   * @returns {Array<{name: string, backend: object}>} the enabled lanes.
   */
  laneBackends(options = this.resolveOptions()) {
    const enabled = {
      deepseek: options.deepseekEnabled !== false,
      serper: options.serperEnabled !== false,
      yuanbao: options.yuanbaoEnabled === true,
    }
    // Precedence order: the configured primary lane first (it wins URL-dedupe
    // ties and exhausted-slot fallback), then the rest, Yuanbao last.
    const order = options.primary === 'serper' ? ['serper', 'deepseek', 'yuanbao'] : ['deepseek', 'serper', 'yuanbao']
    return order
      .filter((name) => enabled[name])
      .map((name) => ({ name, backend: name === 'deepseek' ? this.deepseek : name === 'serper' ? this.serper : this.yuanbao }))
  }

  /**
   * Drop one lane's cooldown immediately. Public for the P1-5 probe (success)
   * and the credential-update listener in `apply`.
   * @param {'deepseek' | 'serper' | 'yuanbao'} lane - the lane to clear.
   * @returns {boolean} true when the lane name was recognized.
   */
  clearHealth(lane) {
    if (lane !== 'deepseek' && lane !== 'serper' && lane !== 'yuanbao') return false
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
   * Probe every enabled lane once for the settings card (P1-5); a lane that is
   * configured off (`native: false`, `serperEnabled: false`, `yuanbaoEnabled:
   * false`) is reported with `class: 'disabled'` and costs no request. Each lane
   * gets one real request with a temporary `timeoutMs` override: the outer
   * budget alone would be pre-empted by each lane's own 4.5s default, so an 8s
   * probe could never be observed. `maxRetries` is forced to 0 so a probe costs exactly one request
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
   * @returns {Promise<object[]>} one lane report per backend (always three
   *   entries in deepseek / serper / yuanbao order; switched-off lanes carry
   *   `class: 'disabled'`).
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
    // A self-check must not spend a paid request on a lane the user turned off,
    // but the row stays visible: the report says "disabled" explicitly.
    const deepseekEnabled = options.deepseekEnabled !== false
    const serperEnabled = options.serperEnabled !== false
    const yuanbaoEnabled = options.yuanbaoEnabled === true
    const yuanbao = new YuanbaoBackend(() => ({
      ...options.yuanbao,
      count: PROBE_RESULTS,
      timeoutMs: laneTimeout,
    }))
    // `settle` itself never throws, so `allSettled` would only nest another layer.
    const [deepseekOutcome, serperOutcome, yuanbaoOutcome] = await Promise.all([
      deepseekEnabled
        ? settle(() => deepseek.search({ query, maxResults: PROBE_RESULTS }))
        : Promise.resolve(undefined),
      serperEnabled
        ? settle(() => serper.search({ query, maxResults: PROBE_RESULTS }))
        : Promise.resolve(undefined),
      yuanbaoEnabled
        ? settle(() => yuanbao.search({ query, maxResults: PROBE_RESULTS }))
        : Promise.resolve(undefined),
    ])
    if (deepseekOutcome?.ok === true) this.clearHealth('deepseek')
    if (serperOutcome?.ok === true) this.clearHealth('serper')
    if (yuanbaoOutcome?.ok === true) this.clearHealth('yuanbao')
    const anyAnswered = deepseekOutcome?.ok === true || serperOutcome?.ok === true || yuanbaoOutcome?.ok === true
    if (anyAnswered) this.clearCachedResults()
    return [
      deepseekOutcome === undefined
        ? disabledLaneReport('deepseek')
        : laneReport('deepseek', deepseekOutcome, {
          accountService: options.deepseek.hasAccountService?.() === true,
        }),
      serperOutcome === undefined ? disabledLaneReport('serper') : laneReport('serper', serperOutcome),
      yuanbaoOutcome === undefined ? disabledLaneReport('yuanbao') : laneReport('yuanbao', yuanbaoOutcome),
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
    const lanes = this.laneBackends(options)
    const usable = lanes.filter(({ backend }) => backend.available())
    if (usable.length === 0) {
      // Not a degradation: every lane is switched off (or its endpoint is
      // unparseable), so say exactly that instead of returning zero sources.
      throw new WebError(
        `Merged search failed: no search lane is enabled (DeepSeek: ${options.deepseekEnabled !== false ? 'enabled' : 'off'}, serper: ${options.serperEnabled !== false ? 'enabled' : 'off'}, Yuanbao: ${options.yuanbaoEnabled === true ? 'enabled' : 'off'}; configured lanes: ${lanes.map((lane) => lane.name).join(', ') || 'none'}). Enable at least one search lane in the web-search-serper settings.`,
        'WEB_PROVIDER_ERROR',
      )
    }

    // A single enabled lane cannot fail open to anything else, so a cooldown is
    // ignored rather than making search unavailable.
    if (usable.length === 1) {
      const only = usable[0]
      const outcome = await settle(() => only.backend.search(request, signal))
      if (signal?.aborted === true) throw searchAborted(signal)
      if (!outcome.ok) {
        if (outcome.error?.code === 'WEB_ABORTED') throw outcome.error
        this.recordFailure(only.name, outcome.error, options)
        throw outcome.error
      }
      this.recordSuccess(only.name, options)
      const result = applyQualityRules(outcome.value, options, cap)
      this.report(options, `primary=${only.name} only ${only.name}=${describe(result, outcome.ms)}`)
      return { result, degraded: false }
    }

    const skip = this.coolingLanes(usable.map((lane) => lane.name))
    const outcomes = await Promise.all(usable.map(({ name, backend }) => (skip[name] === undefined
      ? settle(() => backend.search(request, signal))
      : Promise.resolve(skippedOutcome(skip[name])))))
    if (signal?.aborted === true) throw searchAborted(signal)

    /** @type {Map<string, {ok: boolean, ms: number, value?: object, error?: unknown}>} */
    const byName = new Map(usable.map((lane, index) => [lane.name, outcomes[index]]))
    for (const { name } of usable) {
      if (skip[name] === undefined) this.recordLane(name, byName.get(name), options)
    }

    const succeeded = usable.filter(({ name }) => byName.get(name).ok === true)
    const failed = usable.filter(({ name }) => byName.get(name).ok !== true)

    if (failed.length === 0) {
      const merged = mergeLaneResults(usable, byName, options, cap)
      this.report(options, [
        `primary=${options.primary}`,
        `pattern=${activePattern(options, usable.map((lane) => lane.name), options.slotNames ?? {}).join('')}`,
        ...usable.map(({ name }) => `${name}=${describe(byName.get(name).value, byName.get(name).ms)}`),
        `merged=${merged.sources.length}`,
      ].join(' '))
      return { result: merged, degraded: false }
    }

    if (succeeded.length > 0) {
      const winnerNames = succeeded.map((lane) => lane.name)
      const result = mergeLaneResults(succeeded, byName, options, cap)
      const note = noteForFailures(
        failed.map(({ name }) => ({ name, outcome: byName.get(name) })),
        winnerNames,
      )
      this.report(options, [
        `primary=${options.primary}`,
        `degraded to ${winnerNames.join('+')}`,
        `after ${failed.map(({ name }) => `${name}:${messageOf(byName.get(name).error)}`).join(' | ')}`,
        `merged=${result.sources.length}`,
      ].join(' '), 'warn')
      return { result: withNote(result, note), degraded: true }
    }

    const abortReason = outcomes.map((outcome) => outcome.error).find((error) => error?.code === 'WEB_ABORTED')
    if (abortReason !== undefined) throw abortReason
    throw new WebError(
      `Merged search failed on all backends.\n\n${usable
        .map(({ name }) => `${LANE_LABELS[name] ?? name}: ${laneTag(byName.get(name))}${messageOf(byName.get(name).error)}`)
        .join('\n\n')}`,
      'WEB_PROVIDER_ERROR',
    )
  }

  /**
   * Lanes muted right now. When *every* active lane is cooling the function
   * returns nothing to skip: a stale cooldown must never disable search.
   * @param {string[]} [laneNames] - the lanes to consider (defaults to all).
   * @param {number} [now] - clock, injectable for tests.
   * @returns {Record<string, object>} the lanes to skip.
   */
  coolingLanes(laneNames = LANE_NAMES, now = Date.now()) {
    const cooling = laneNames.filter((lane) => (this.health[lane]?.until ?? 0) > now)
    if (cooling.length === 0 || cooling.length === laneNames.length) return {}
    return Object.fromEntries(cooling.map((lane) => [lane, this.health[lane]]))
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
   * @param {'deepseek' | 'serper' | 'yuanbao'} lane - the failing lane.
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

/** Lanes the health table tracks (all possible lanes, enabled or not). */
const LANE_NAMES = ['deepseek', 'serper', 'yuanbao']

/** Display name per lane, used by the all-failed error and the card protocol. */
const LANE_LABELS = {
  deepseek: 'DeepSeek Search API',
  serper: 'Serper',
  yuanbao: 'Yuanbao Search API',
}

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

/**
 * The one-line degradation note. Names every lane that failed (with its class,
 * timeout, or HTTP status) and every lane that answered, so a three-lane
 * degradation to one lane stays readable: `Note: serper timed out after
 * 4500ms, yuanbao auth failed (HTTP 401), using deepseek.` Returns '' when the
 * only loser was an aborted search (a cancellation is not a degradation).
 * @param {Array<{name: string, outcome: object}>} failed - lanes that did not answer.
 * @param {string[]} winnerNames - lanes that answered.
 * @returns {string} the note line, or ''.
 */
function noteForFailures(failed, winnerNames) {
  const parts = []
  for (const { name, outcome } of failed) {
    const text = failureText(name, outcome)
    if (text.length > 0) parts.push(text)
  }
  if (parts.length === 0) return ''
  return `Note: ${parts.join(', ')}, using ${winnerNames.join(', ')}.`
}

/**
 * One lane's failure phrase inside the note.
 * @param {string} name - the lane name.
 * @param {object} outcome - the settled (or skipped) outcome.
 * @returns {string} e.g. `serper auth failed (HTTP 401)`, or '' when aborted.
 */
function failureText(name, outcome) {
  if (outcome?.skipped === true) {
    const label = FAILURE_LABELS[outcome.health?.cls] ?? 'skipped'
    return `${name} ${label}`
  }
  const failure = classifyFailure(outcome?.error)
  if (failure === null) return ''
  const status = Number.isInteger(outcome?.error?.httpStatus) ? ` (HTTP ${outcome.error.httpStatus})` : ''
  const timeout = failure.cls === 'timeout' && Number.isFinite(outcome?.error?.timeoutMs)
    ? ` after ${outcome.error.timeoutMs}ms`
    : ''
  return `${name} ${failure.label}${timeout}${status}`
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
 * @param {'deepseek' | 'serper' | 'yuanbao'} lane - the lane that was probed.
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

/**
 * Probe report for a lane that is configured off: the card still renders the
 * row, but no paid request was spent proving it.
 * @param {'yuanbao'} lane - the disabled lane.
 * @returns {object} the lane report with the `disabled` class.
 */
function disabledLaneReport(lane) {
  return { lane, ok: false, ms: 0, sources: 0, httpStatus: null, class: 'disabled', error: null }
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

  const yuanbaoKeyEnv = credentialRef(config.yuanbaoApiKeyEnv)
  const literalYuanbaoKey = nonEmpty(config.yuanbaoApiKey)
  const yuanbaoEnabled = config.yuanbaoEnabled === true
  const deepseekEnabled = config.native !== false
  const serperEnabled = config.serperEnabled !== false
  const primary = config.primary === 'serper' ? 'serper' : 'deepseek'

  /** Lanes that are switched on, independent of what they will answer. */
  const enabledLanes = new Set([
    ...(deepseekEnabled ? ['deepseek'] : []),
    ...(serperEnabled ? ['serper'] : []),
    ...(yuanbaoEnabled ? ['yuanbao'] : []),
  ])

  // Three-lane mode needs a pattern with a third slot; a numeric ratio was
  // written for the two-lane composition, so it falls back to the equal split
  // rather than silently dropping a lane from the interleave.
  const threeLaneRatio = THREE_LANE_RATIOS.includes(config.ratio)
  const ratioKey = yuanbaoEnabled
    ? (threeLaneRatio ? config.ratio : DEFAULT_THREE_LANE_RATIO)
    : (RATIO_VALUES.includes(config.ratio) ? config.ratio : 2)

  // Slot letters: `P` is the configured primary among the two established
  // lanes (falling back to whichever is enabled), `S` the other, `Y` Yuanbao.
  const primaryLane = enabledLanes.has(primary)
    ? primary
    : enabledLanes.has('deepseek')
      ? 'deepseek'
      : enabledLanes.has('serper')
        ? 'serper'
        : undefined
  const secondaryLane = primaryLane === 'serper' ? 'deepseek' : 'serper'
  const slotNames = {
    ...(primaryLane === undefined ? {} : { P: primaryLane }),
    ...(enabledLanes.has(secondaryLane) ? { S: secondaryLane } : {}),
    ...(enabledLanes.has('yuanbao') ? { Y: 'yuanbao' } : {}),
  }
  // Precedence: the primary lane first (it wins URL-dedupe ties and fills an
  // exhausted slot), then the other established lane, then Yuanbao.
  const laneOrder = primary === 'serper' ? ['serper', 'deepseek', 'yuanbao'] : ['deepseek', 'serper', 'yuanbao']
  const lanes = laneOrder.filter((lane) => enabledLanes.has(lane))

  return {
    deepseekEnabled,
    serperEnabled,
    yuanbaoEnabled,
    primary,
    ratio: ratioKey,
    /** Lane names in precedence order (dedupe ties + exhausted-slot fallback). */
    lanes,
    /** Slot letter → lane name, so RATIO_PATTERNS stays backend-agnostic. */
    slotNames,
    /** Cycled slot pattern for the interleave. */
    pattern: RATIO_PATTERNS[ratioKey] ?? RATIO_PATTERNS[2],
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
    yuanbao: {
      ...(literalYuanbaoKey === undefined ? {} : { apiKey: literalYuanbaoKey }),
      resolveApiKey: async () => {
        const credentials = ctx.get('credentials')
        if (credentials !== undefined) return (await credentials.resolve(yuanbaoKeyEnv))?.value
        const ambient = launch.get(yuanbaoKeyEnv)
        return ambient !== undefined && ambient.value.length > 0 ? ambient.value : undefined
      },
      apiKeyEnv: String(yuanbaoKeyEnv),
      endpoint: config.yuanbaoEndpoint ?? launch.get(YUANBAO_ENDPOINT_ENV)?.value ?? YUANBAO_DEFAULT_ENDPOINT,
      count: config.yuanbaoCnt,
      timeoutMs: config.yuanbaoTimeoutMs,
      userAgent: USER_AGENT,
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
    serperEnabled: config.serperEnabled?.get?.(),
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
    yuanbaoEnabled: config.yuanbaoEnabled?.get?.(),
    yuanbaoApiKey: config.yuanbaoApiKey?.get?.(),
    yuanbaoApiKeyEnv: config.yuanbaoApiKeyEnv?.get?.(),
    yuanbaoEndpoint: config.yuanbaoEndpoint?.get?.(),
    yuanbaoCnt: config.yuanbaoCnt?.get?.(),
    yuanbaoTimeoutMs: config.yuanbaoTimeoutMs?.get?.(),
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
    if (options.yuanbao.apiKeyEnv === ref) {
      provider.clearHealth('yuanbao')
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

/** Await one backend, capturing success/failure and elapsed ms. */
async function settle(run) {
  const started = Date.now()
  try {
    return { ok: true, value: await run(), ms: Date.now() - started }
  } catch (error) {
    return { ok: false, error, ms: Date.now() - started }
  }
}

/** Exponential backoff with jitter, used for 429/5xx retries. */
function backoffMs(attempt) {
  return 1000 * 2 ** attempt + Math.floor(Math.random() * 250)
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
  const { sources } = mergeLanes([{ name: 'P', sources: result.sources }], {
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

/**
 * Interleave the successful lanes into the final result: the pattern is the
 * configured one filtered to the lanes that actually answered, so a degraded
 * two-lane search keeps a sensible split instead of leaving holes for the
 * missing lane.
 * @param {Array<{name: string, backend: object}>} lanes - lanes that answered.
 * @param {Map<string, object>} byName - settled outcome per lane.
 * @param {object} options - this operation's settings snapshot.
 * @param {number} [cap] - requested result cap.
 * @returns {object} the merged result (sources + optional answer-box content).
 */
function mergeLaneResults(lanes, byName, options, cap) {
  const names = lanes.map((lane) => lane.name)
  const slotNames = options.slotNames ?? defaultSlotNames(names)
  const content = lanes
    .map(({ name }) => byName.get(name)?.value?.content)
    .find((value) => typeof value === 'string' && value.length > 0)
  const { sources } = mergeLanes(
    names.map((name) => ({ name, sources: byName.get(name)?.value?.sources })),
    {
      pattern: activePattern(options, names, slotNames),
      slotNames,
      maxResults: cap,
      maxPerHost: options.maxPerHost,
      demoteSocial: options.demoteSocial,
    },
  )
  return {
    ...(content === undefined ? {} : { content }),
    sources,
    truncated: false,
  }
}

/**
 * Filter the configured interleave pattern down to the lanes that are active.
 * @param {object} options - this operation's settings snapshot.
 * @param {string[]} names - lane names that answered.
 * @returns {string[]} the pattern to cycle (lane names or slot letters).
 */
function activePattern(options, names, slotNames) {
  const pattern = Array.isArray(options.pattern) && options.pattern.length > 0
    ? options.pattern
    : (RATIO_PATTERNS[options.ratio] ?? names)
  const kept = pattern.filter((entry) => names.includes(slotNames[entry] ?? entry))
  return kept.length > 0 ? kept : names
}

/**
 * Default slot-letter mapping for callers that pass lanes without an explicit
 * `slotNames` (unit tests and older option snapshots): `P` is the first lane,
 * `S` the second, `Y` the third — each mapped only when that lane exists, so an
 * absent lane's slot is dropped by {@link activePattern} instead of aliasing
 * another lane and skewing the interleave.
 * @param {string[]} names - active lane names in precedence order.
 * @returns {Record<string, string>} slot letter → lane name.
 */
function defaultSlotNames(names) {
  const mapping = {}
  if (names[0] !== undefined) mapping.P = names[0]
  if (names[1] !== undefined) mapping.S = names[1]
  if (names[2] !== undefined) mapping.Y = names[2]
  return mapping
}

/** Trim the requested sources to the tool layer's cap without flagging truncation. */
function capResult(result, cap) {
  if (cap === undefined || result.sources.length <= cap) return result
  return { ...result, sources: result.sources.slice(0, cap), truncated: false }
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
