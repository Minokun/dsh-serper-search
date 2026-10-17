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
 * Backwards compatibility: the provider id stays `serper`, so the bundle patch
 * and existing profiles keep working. `native` now means "merge the DeepSeek
 * Search API half"; `native*` key/endpoint fields are accepted but only used as
 * credential fallbacks or ignored.
 *
 * Selection: the bundle's cordis.patch.yml pins the `web` seam's
 * `searchProvider` to this provider's id (`serper`).
 * @module dsh-serper-search
 */

import { readFileSync } from 'node:fs'
import z from '@deepseek-ai/schemastery'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { launchEnvironmentOf } from '@deepseek-ai/dsh-launch-environment'
import { WebError } from '@deepseek-ai/dsh-web'
import {
  RATIO_PATTERNS,
  effectiveSerperLocale,
  mapDeepSeekSearchResponse,
  mapSerperResponse,
  mergeResults,
} from './merge.js'

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
        throw new WebError(`DeepSeek Search API request budget (${budgetMs}ms) exhausted before attempt ${attempt + 1}. ${guidance}`, 'WEB_PROVIDER_ERROR')
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
        const retryableStatus = response.status === 429 || response.status >= 500
        if (retryableStatus && attempt < maxRetries) {
          const wait = backoffMs(attempt)
          if (Date.now() + wait < deadline) {
            // Draining can itself consume the remaining budget (a stalled error
            // body); re-check before spending the backoff.
            await drainBody(response, signal)
            if (Date.now() + wait < deadline) {
              await sleep(wait, signal)
              continue
            }
          }
        }
        if (!response.ok) {
          await drainBody(response, signal)
          throw new WebError(`DeepSeek Search API error (HTTP ${response.status}). ${guidance}`, 'WEB_PROVIDER_ERROR')
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
        let message = `Serper API error (HTTP ${response.status})`
        try {
          const parsed = await response.json()
          const detail = typeof parsed.error === 'string' ? parsed.error : parsed.message
          if (detail !== undefined && detail.length > 0) message += `: ${detail}`
        } catch (error) {
          if (signal?.aborted === true) throw searchAborted(signal, error)
        }
        if (response.status === 401 || response.status === 403) {
          throw new WebError(`${message}\n\nSerper rejected the key from credential ref "${options.apiKeyEnv ?? DEFAULT_API_KEY_ENV}". ${SERPER_GUIDANCE}`, 'WEB_PROVIDER_ERROR')
        }
        throw new WebError(`${message}. ${SERPER_GUIDANCE}`, 'WEB_PROVIDER_ERROR')
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
  }

  /** Usable while either half is; a failing half degrades per search. */
  available() {
    return this.deepseek.available() || this.serper.available()
  }

  /**
   * Run one merged search. A user-facing failure requires BOTH backends to
   * fail; the thrown error names both causes.
   * @param {import('@deepseek-ai/dsh-web').WebSearchRequest} request - the query and optional result limit.
   * @param {AbortSignal} [signal] - cancellation signal from the seam/tool layer.
   * @returns {Promise<import('@deepseek-ai/dsh-web').WebSearchResult>}
   */
  async search(request, signal) {
    const options = this.resolveOptions()
    const cap = Number.isInteger(request.maxResults) && request.maxResults > 0 ? request.maxResults : undefined

    if (options.deepseekEnabled !== true || !this.deepseek.available()) {
      const only = await this.serper.search(request, signal)
      this.report(options, `primary=serper only serper=${describe(only, 0)}`)
      return capResult(only, cap)
    }

    const [deepseekResult, serperResult] = await Promise.all([
      settle(() => this.deepseek.search(request, signal)),
      settle(() => this.serper.search(request, signal)),
    ])
    if (signal?.aborted === true) throw searchAborted(signal)

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
      return merged
    }

    if (deepseekResult.ok || serperResult.ok) {
      const winner = deepseekResult.ok ? deepseekResult : serperResult
      const loser = deepseekResult.ok ? serperResult : deepseekResult
      const winnerName = deepseekResult.ok ? 'deepseek' : 'serper'
      const result = capResult(winner.value, cap)
      this.report(options, [
        `primary=${options.primary}`,
        `degraded to ${winnerName} after ${loser.ok ? 'ok' : messageOf(loser.error)}`,
        `${winnerName}=${describe(result, winner.ms)}`,
      ].join(' '), 'warn')
      return result
    }

    const abortReason = [deepseekResult.error, serperResult.error].find((error) => error?.code === 'WEB_ABORTED')
    if (abortReason !== undefined) throw abortReason
    throw new WebError(`Merged search failed on both backends.\n\nDeepSeek Search API: ${messageOf(deepseekResult.error)}\n\nSerper: ${messageOf(serperResult.error)}`, 'WEB_PROVIDER_ERROR')
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

/** Register the merged DeepSeek Search API + serper provider with `ctx.web`. */
export function apply(ctx, config) {
  ctx.web.registerSearchProvider(new MergedSearchProvider(() => resolveOptions(ctx, {
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
    native: config.native.get(),
    nativeApiKey: config.nativeApiKey.get(),
    nativeApiKeyEnv: config.nativeApiKeyEnv.get(),
    nativeBaseURL: config.nativeBaseURL.get(),
    nativeModel: config.nativeModel.get(),
    nativeMaxUses: config.nativeMaxUses.get(),
  }), ctx.logger))
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
      throw timeoutError
    }
    const failure = new WebError(`${subject} request failed: ${String(error)}. ${guidance}`, 'WEB_PROVIDER_ERROR', { cause: error })
    failure.retryable = true
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
      throw timeoutError
    }
    throw new WebError(`${subject} returned an unprocessable response body: ${String(error)}. ${guidance}`, 'WEB_PROVIDER_ERROR', { cause: error })
  }
}

/** Consume a response body before a retry or an error return; abort wins over drain failures. */
async function drainBody(response, signal) {
  try {
    await response.text()
  } catch {
    // The retry/caller owns the outcome; a failed drain must not mask it.
  }
  if (signal?.aborted === true) throw searchAborted(signal)
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
