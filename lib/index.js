/**
 * dsh-serper-search, Host half: a MERGED search provider for the DSH web
 * capability seam (`ctx.web`). Function-plugin form (named exports only).
 *
 * One registered provider (`serper`) fans every search out to TWO backends in
 * parallel and merges the results, so the model's references are the union:
 *
 *   - serper.dev (Google Search API): fast ranked organic results plus the
 *     answer box — POST `${baseURL}/search` with the `X-API-KEY` header;
 *   - DeepSeek native web_search (reusing @deepseek-ai/dsh-web-search-deepseek's
 *     provider): a full auxiliary model turn whose server-side retrieval
 *     returns citation excerpts.
 *
 * Sources dedupe by URL and interleave 2:1 (serper's Google ranking leads,
 * native-only sources take every third slot, so the tool layer's result cap
 * can no longer truncate them away). `answerBox` becomes the optional
 * `content`. Either backend may fail or lack a key — the other still answers;
 * only a double failure throws. Set `native: false` to run serper-only.
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
import { DeepSeekSearchProvider } from '@deepseek-ai/dsh-web-search-deepseek'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'web-search-serper'

/** The web seam this provider registers into. */
export const inject = ['web']

/** Stable id this provider registers under; the `web` seam pins it. */
export const SERPER_PROVIDER_ID = 'serper'

/** Default serper.dev API base; `/search` is appended per request. */
export const SERPER_DEFAULT_BASE_URL = 'https://google.serper.dev'

/** Environment variable overriding the serper endpoint independently of config. */
const SEARCH_BASE_URL_ENV = 'SERPER_BASE_URL'

/** Default credential ref the serper API key resolves through. */
const DEFAULT_API_KEY_ENV = 'SERPER_API_KEY'

/** DeepSeek native-search defaults, mirrored from @deepseek-ai/dsh-web-search-deepseek. */
const NATIVE_DEFAULT_BASE_URL = 'https://api.deepseek.com/anthropic/v1'
const NATIVE_BASE_URL_ENV = 'DEEPSEEK_SEARCH_BASE_URL'
const NATIVE_DEFAULT_MODEL = 'deepseek-v4-flash'
const NATIVE_DEFAULT_API_VERSION = '2023-06-01'
const NATIVE_DEFAULT_MAX_TOKENS = 4096
const NATIVE_DEFAULT_MAX_USES = 5
const NATIVE_DEFAULT_API_KEY_ENV = 'DEEPSEEK_API_KEY'

/** Provider route id `dsh-llm-deepseek-account` registers; `request/context` events record it per Session. */
const ACCOUNT_PROVIDER = 'deepseek-account'

/** Attribution header sent on every serper request. */
const PKG_VERSION = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version
const USER_AGENT = `dsh-serper-search/${PKG_VERSION}`

export const Config = z.object({
  apiKey: z.string().role('secret').volatile(),
  apiKeyEnv: z.string().role('credential-ref').default(DEFAULT_API_KEY_ENV).volatile(),
  baseURL: z.string().volatile(),
  gl: z.string().default('cn').volatile(),
  hl: z.string().default('zh-cn').volatile(),
  num: z.number().step(1).min(1).max(100).default(10).volatile(),
  /** Merge DeepSeek native web_search results into every search. */
  native: z.boolean().default(true).volatile(),
  nativeApiKey: z.string().role('secret').volatile(),
  nativeApiKeyEnv: z.string().role('credential-ref').default(NATIVE_DEFAULT_API_KEY_ENV).volatile(),
  nativeBaseURL: z.string().volatile(),
  nativeModel: z.string().default(NATIVE_DEFAULT_MODEL).volatile(),
  nativeMaxUses: z.number().step(1).min(1).default(NATIVE_DEFAULT_MAX_USES).volatile(),
})

/**
 * The serper.dev-backed half. HTTP redirects fail as `WEB_PROVIDER_ERROR`;
 * failures after dispatch name the endpoint and tell the model how the user
 * can configure it.
 */
export class SerperSearchProvider {
  id = SERPER_PROVIDER_ID

  /**
   * @param {() => object} resolveOptions - the options for the NEXT operation,
   * snapshotted once at each operation's entry so one search never mixes two
   * sections. A thunk rather than a value because the plugin's settings
   * section can change between searches (volatile config commits in place).
   */
  constructor(resolveOptions) {
    this.resolveOptions = resolveOptions
  }

  /** Cheap local usability check; the key itself resolves asynchronously per search. */
  available() {
    const options = this.resolveOptions()
    return URL.canParse(options.baseURL) && Number.isInteger(options.num) && options.num > 0
  }

  /**
   * Run one search against serper.dev.
   * @param {import('@deepseek-ai/dsh-web').WebSearchRequest} request - the query and optional result limit.
   * @param {AbortSignal} [signal] - cancellation signal from the seam/tool layer.
   * @returns {Promise<import('@deepseek-ai/dsh-web').WebSearchResult>}
   */
  async search(request, signal) {
    const options = this.resolveOptions()
    const endpoint = `${options.baseURL.replace(/\/+$/, '')}/search`
    const apiKey = await this.apiKey(options, signal)
    throwIfSearchAborted(signal)

    const num = clampNum(request.maxResults ?? options.num)
    const body = { q: request.query, gl: options.gl, hl: options.hl, num }

    let response
    try {
      response = await fetch(endpoint, {
        method: 'POST',
        redirect: 'error',
        headers: {
          'X-API-KEY': apiKey,
          'content-type': 'application/json',
          'accept': 'application/json',
          'user-agent': USER_AGENT,
        },
        body: JSON.stringify(body),
        ...(signal !== undefined ? { signal } : {}),
      })
    } catch (error) {
      if (signal?.aborted === true || isAbortError(error)) throw searchAborted(signal, error)
      throw searchEndpointError(endpoint, `Serper search request failed: ${String(error)}`, error)
    }

    if (!response.ok) {
      const status = response.status
      let message = `Serper API error (HTTP ${status})`
      try {
        const parsed = await response.json()
        const detail = typeof parsed.error === 'string' ? parsed.error : parsed.message
        if (detail !== undefined && detail.length > 0) message += `: ${detail}`
      } catch (error) {
        if (signal?.aborted === true || isAbortError(error)) throw searchAborted(signal, error)
      }
      if (status === 401 || status === 403) {
        throw new WebError(`${message}\n\nSerper rejected the API key from credential ref "${options.apiKeyEnv}". Guide the user to check the key (serper.dev dashboard) and update ~/.dsh/.credentials.yaml or the web-search-serper config.`, 'WEB_PROVIDER_ERROR')
      }
      throw searchEndpointError(endpoint, message)
    }

    try {
      return mapSerperResponse(await response.json())
    } catch (error) {
      if (signal?.aborted === true || isAbortError(error)) throw searchAborted(signal, error)
      throw searchEndpointError(endpoint, `Serper returned an unprocessable response body: ${String(error)}`, error)
    }
  }

  /**
   * Resolve one operation's API key without retaining it on the provider.
   * @param {object} options - the caller's snapshot, so the key and the endpoint it is sent to come from one section.
   * @param {AbortSignal} [signal] - abort signal for the surrounding search.
   * @returns {Promise<string>} the resolved key.
   */
  async apiKey(options, signal) {
    throwIfSearchAborted(signal)
    if (options.apiKey !== undefined && options.apiKey.length > 0) return options.apiKey
    const { resolveApiKey } = options
    const resolved = resolveApiKey === undefined ? undefined : await resolveCredential(resolveApiKey, signal)
    if (resolved !== undefined && resolved.length > 0) return resolved
    throw new WebError(`Serper search has no API key for "${options.apiKeyEnv ?? DEFAULT_API_KEY_ENV}"; add it under "refs:" in ~/.dsh/.credentials.yaml, export it in the launching environment, or set a literal "apiKey" in the web-search-serper config (get a key at https://serper.dev)`, 'WEB_PROVIDER_CREDENTIAL_MISSING')
  }
}

/**
 * The merged provider the seam actually calls: serper.dev and DeepSeek native
 * search in parallel, union of sources. Degrades to whichever backend answers
 * when the other fails, is unconfigured, or is disabled (`native: false`).
 */
export class MergedSearchProvider {
  id = SERPER_PROVIDER_ID

  /**
   * @param {() => { serper: object, native: object, nativeEnabled: boolean }} resolveOptions
   * - one thunk snapshotting both backends' options per search.
   */
  constructor(resolveOptions) {
    this.resolveOptions = resolveOptions
    this.serper = new SerperSearchProvider(() => this.resolveOptions().serper)
    this.native = new DeepSeekSearchProvider(() => this.resolveOptions().native)
  }

  /** Usable while the serper half is; the native half degrades per search. */
  available() {
    return this.serper.available()
  }

  /**
   * Run one merged search. Both backends honor `signal`; a user-facing failure
   * requires BOTH to fail, and the thrown error names both causes.
   * @param {import('@deepseek-ai/dsh-web').WebSearchRequest} request - the query and optional result limit.
   * @param {AbortSignal} [signal] - cancellation signal from the seam/tool layer.
   * @returns {Promise<import('@deepseek-ai/dsh-web').WebSearchResult>}
   */
  async search(request, signal) {
    const { nativeEnabled } = this.resolveOptions()
    if (!nativeEnabled || !this.native.available()) return this.serper.search(request, signal)
    const [serperSettled, nativeSettled] = await Promise.allSettled([
      this.serper.search(request, signal),
      this.native.search(request, signal),
    ])
    if (signal?.aborted === true) throw searchAborted(signal)
    if (serperSettled.status === 'fulfilled' && nativeSettled.status === 'fulfilled') {
      return mergeResults(serperSettled.value, nativeSettled.value)
    }
    if (serperSettled.status === 'fulfilled') return serperSettled.value
    if (nativeSettled.status === 'fulfilled') return nativeSettled.value
    const serperReason = serperSettled.reason
    const nativeReason = nativeSettled.reason
    if (serperReason?.code === 'WEB_ABORTED') throw serperReason
    if (nativeReason?.code === 'WEB_ABORTED') throw nativeReason
    throw new WebError(`Merged search failed on both backends.\n\nSerper: ${messageOf(serperReason)}\n\nDeepSeek native: ${messageOf(nativeReason)}`, 'WEB_PROVIDER_ERROR')
  }
}

/**
 * Union of two results: the serper (Google-ranked) sources first, then the
 * native-only sources, deduped by URL. `content` comes from serper's answer
 * box when present (native search returns none). The seam owns the final
 * `maxResults` truncation, so `truncated` is always `false` here.
 *
 * Merge order is a 2:1 INTERLEAVE (two serper sources, then one native-only
 * source, repeat), not serper-then-native concatenation: `dsh-tool-web` caps
 * every call's combined sources (8 as of writing), so appending native after
 * serper meant truncation silently dropped nearly every native source —
 * measured 38:2 across two real research sessions. Interleaving reserves
 * native up to a third of the slots while Google's ranking still leads.
 *
 * @param {import('@deepseek-ai/dsh-web').WebSearchResult} primary - the serper result.
 * @param {import('@deepseek-ai/dsh-web').WebSearchResult} secondary - the native result.
 * @returns {import('@deepseek-ai/dsh-web').WebSearchResult}
 */
function mergeResults(primary, secondary) {
  const seen = new Set(primary.sources.map((source) => source.url))
  const extras = secondary.sources.filter((source) => !seen.has(source.url))
  const sources = []
  let i = 0
  let j = 0
  while (i < primary.sources.length || j < extras.length) {
    for (let k = 0; k < 2 && i < primary.sources.length; k++) sources.push(primary.sources[i++])
    if (j < extras.length) sources.push(extras[j++])
  }
  return {
    ...(primary.content !== undefined ? { content: primary.content } : {}),
    sources,
    truncated: false,
  }
}

/**
 * Map a serper.dev `/search` response to a normalized search result. The
 * `answerBox` (direct answer) becomes the optional `content`; `organic[]`
 * items become citeable sources, deduped by link.
 *
 * @param {object} body - the parsed serper response body.
 * @returns {import('@deepseek-ai/dsh-web').WebSearchResult} the normalized result.
 */
function mapSerperResponse(body) {
  const seen = new Set()
  const sources = []
  for (const item of body.organic ?? []) {
    const url = item.link
    if (typeof url !== 'string' || url.length === 0 || seen.has(url)) continue
    seen.add(url)
    sources.push({
      url,
      ...(typeof item.title === 'string' && item.title.length > 0 ? { title: item.title } : {}),
      ...(typeof item.snippet === 'string' && item.snippet.length > 0 ? { snippet: item.snippet } : {}),
      ...(typeof item.date === 'string' && item.date.length > 0 ? { publishedAt: item.date } : {}),
    })
  }
  const box = body.answerBox
  const content = box === null || box === undefined
    ? undefined
    : [box.answer, box.snippet].find((v) => typeof v === 'string' && v.length > 0)
  return {
    ...(content !== undefined ? { content } : {}),
    sources,
    truncated: false,
  }
}

/** Clamp a requested result count to serper's `num` range (1..100). */
function clampNum(value) {
  if (!Number.isFinite(value)) return 10
  return Math.max(1, Math.min(100, Math.trunc(value)))
}

/** The error's display message, tolerating non-Error rejections. */
function messageOf(reason) {
  return reason instanceof Error ? reason.message : String(reason)
}

/**
 * Run one credential resolver under the search's cancellation signal.
 * @param {() => Promise<string | undefined>} resolve - the resolver; a synchronous throw is mapped like a rejection.
 * @param {AbortSignal} [signal] - abort signal for the surrounding search.
 * @returns {Promise<string | undefined>} the resolved credential, or undefined when the resolver supplied none.
 */
async function resolveCredential(resolve, signal) {
  throwIfSearchAborted(signal)
  try {
    return await resolve()
  } catch (error) {
    if (signal?.aborted === true || isAbortError(error)) throw searchAborted(signal, error)
    throw new WebError(`Serper search credential resolution failed: ${String(error)}`, 'WEB_PROVIDER_ERROR', { cause: error })
  }
}

/** Add endpoint recovery instructions to failures that occur after request dispatch begins. */
function searchEndpointError(endpoint, message, cause) {
  return new WebError(`${message}\n\nThe web search request used endpoint ${JSON.stringify(endpoint)}. Search endpoint configuration is separate from chat. If that endpoint is not intended, guide the user to fix "baseURL" in the web-search-serper plugin config (or unset the SERPER_BASE_URL environment variable). Only the user should choose or change the endpoint.`, 'WEB_PROVIDER_ERROR', cause === undefined ? undefined : { cause })
}

/** Throw the provider's stable cancellation error when the caller already aborted. */
function throwIfSearchAborted(signal) {
  if (signal?.aborted === true) throw searchAborted(signal)
}

/** Build the provider's stable cancellation error while retaining the caller's reason. */
function searchAborted(signal, fallback) {
  return new WebError('Serper search aborted', 'WEB_ABORTED', { cause: signal?.aborted === true ? signal.reason : fallback })
}

/** True for a fetch/`AbortSignal` abort, surfaced as `WEB_ABORTED`. */
function isAbortError(error) {
  return error instanceof DOMException && error.name === 'AbortError'
}

/**
 * Project one resolved section into the options both providers serve their
 * next search with. Environment fallbacks stay here rather than in the
 * providers: every value they read is already fully defaulted. The native
 * half's wiring mirrors @deepseek-ai/dsh-web-search-deepseek's own
 * resolveOptions (credential ref, account sign-in, session request recording).
 * @param {import('@deepseek-ai/cordis').Context} ctx - plugin context supplying the credential and environment planes.
 * @param {object} config - the currently authoritative section (plain values, refs already dereferenced).
 * @returns {{ serper: object, native: object, nativeEnabled: boolean }} options for one search.
 */
function resolveOptions(ctx, config) {
  const apiKeyEnv = credentialRef(config.apiKeyEnv)
  const literalApiKey = config.apiKey !== undefined && config.apiKey.length > 0 ? config.apiKey : undefined
  const nativeApiKeyEnv = credentialRef(config.nativeApiKeyEnv)
  const literalNativeKey = config.nativeApiKey !== undefined && config.nativeApiKey.length > 0 ? config.nativeApiKey : undefined
  return {
    serper: {
      ...(literalApiKey === undefined ? {} : { apiKey: literalApiKey }),
      resolveApiKey: async () => {
        const credentials = ctx.get('credentials')
        if (credentials !== undefined) return (await credentials.resolve(apiKeyEnv))?.value
        const ambient = launchEnvironmentOf(ctx).get(apiKeyEnv)
        return ambient !== undefined && ambient.value.length > 0 ? ambient.value : undefined
      },
      apiKeyEnv,
      baseURL: config.baseURL ?? launchEnvironmentOf(ctx).get(SEARCH_BASE_URL_ENV)?.value ?? SERPER_DEFAULT_BASE_URL,
      gl: config.gl,
      hl: config.hl,
      num: config.num,
    },
    native: {
      ...(literalNativeKey === undefined ? {} : { apiKey: literalNativeKey }),
      resolveAccountToken: async (endpoint) => {
        if (ctx.get('agents')?.currentInitiator()?.session.requestContext()?.provider !== ACCOUNT_PROVIDER) return undefined
        return await ctx.get('deepseekAccount')?.resolveToken(endpoint)
      },
      resolveApiKey: async () => {
        const credentials = ctx.get('credentials')
        if (credentials !== undefined) return (await credentials.resolve(nativeApiKeyEnv))?.value
        const ambient = launchEnvironmentOf(ctx).get(nativeApiKeyEnv)
        return ambient !== undefined && ambient.value.length > 0 ? ambient.value : undefined
      },
      apiKeyEnv: nativeApiKeyEnv,
      baseURL: config.nativeBaseURL ?? launchEnvironmentOf(ctx).get(NATIVE_BASE_URL_ENV)?.value ?? NATIVE_DEFAULT_BASE_URL,
      model: config.nativeModel,
      apiVersion: NATIVE_DEFAULT_API_VERSION,
      maxTokens: NATIVE_DEFAULT_MAX_TOKENS,
      maxUses: config.nativeMaxUses,
      recordRequest: (request) => {
        ctx.get('agents')?.currentInitiator()?.session.append('web/deepseek-search-llm-request', request)
      },
    },
    nativeEnabled: config.native,
  }
}

/** Register the merged serper+native search provider with `ctx.web`. */
export function apply(ctx, config) {
  ctx.web.registerSearchProvider(new MergedSearchProvider(() => resolveOptions(ctx, {
    apiKey: config.apiKey.get(),
    apiKeyEnv: config.apiKeyEnv.get(),
    baseURL: config.baseURL.get(),
    gl: config.gl.get(),
    hl: config.hl.get(),
    num: config.num.get(),
    native: config.native.get(),
    nativeApiKey: config.nativeApiKey.get(),
    nativeApiKeyEnv: config.nativeApiKeyEnv.get(),
    nativeBaseURL: config.nativeBaseURL.get(),
    nativeModel: config.nativeModel.get(),
    nativeMaxUses: config.nativeMaxUses.get(),
  })))
}
