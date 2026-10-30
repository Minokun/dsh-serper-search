/**
 * The Tencent Cloud WSA / Yuanbao Search (`SearchPro`) lane.
 *
 * One direct HTTP request per search, no model turn: `POST {endpoint}` with a
 * Bearer service key, body `{Query, Cnt, Site?}`. `Response.Pages` is an array
 * of **JSON strings** (each needs a second `JSON.parse`), and every page object
 * carries `title` / `url` / `passage` / `content` / `date` / `site` / `score`.
 *
 * Two measured traps this module exists to contain:
 *
 * 1. `Cnt` only accepts multiples of ten, 10..50. Anything else (8, 15, 60, …)
 *    answers **HTTP 200** with `{"Response":{"Error":{"Code":"InvalidParameter",
 *    "Message":"illegal Cnt"}}}` and **no `Pages` at all** — a status-code-only
 *    client therefore builds a tool that silently never returns a result.
 *    {@link resolveYuanbaoCnt} rounds up to the next legal value before the
 *    request leaves the process, and the client-side truncation to
 *    `maxResults` happens in the merge layer.
 * 2. `passage` is server-clipped to ~803 characters while `content` is longer,
 *    but the 20-topic measurement (docs/report §3) found feeding `content`
 *    instead of `passage` *lowered* one-shot answer accuracy (6/8 → 5/8), so
 *    `snippet` comes from `passage` and `content` is deliberately not used.
 *
 * The lane is off by default (`yuanbaoEnabled: false`); enabling it costs one
 * extra paid request per search (standard edition 20 CNY / 1000 calls, billed
 * per call regardless of `Cnt`).
 * @module dsh-serper-search/yuanbao
 */

import { WebError } from '@deepseek-ai/dsh-web'
import { normalizePublishedDate } from './merge.js'
import { postJson, readJsonBody, throwIfSearchAborted } from './http.js'
import { redactBodyExcerpt } from './failure.js'

/** Default WSA SearchPro endpoint. */
export const YUANBAO_DEFAULT_ENDPOINT = 'https://api.wsa.cloud.tencent.com/SearchPro'

/** Default credential ref the Yuanbao service key resolves through. */
export const YUANBAO_DEFAULT_API_KEY_ENV = 'YUANBAO_API_KEY'

/** Legal `Cnt` values: the API rejects anything that is not one of these. */
export const YUANBAO_LEGAL_CNT = Object.freeze([10, 20, 30, 40, 50])

/** Guidance appended to Yuanbao lane failures. */
export const YUANBAO_GUIDANCE = 'Check the YUANBAO_API_KEY credential (Tencent Cloud WSA service API key) and the "yuanbaoEndpoint" setting (default https://api.wsa.cloud.tencent.com/SearchPro).'

/** Envelope error codes that mean "the credential was rejected". */
const AUTH_CODES = new Set(['UnauthorizedOperation', 'AuthFailure', 'Unauthorized', 'InvalidApiKey', 'SignatureFailure'])

/** Envelope error codes that mean "slow down / out of quota". */
const RATE_CODES = new Set(['RequestLimitExceeded', 'LimitExceeded', 'TooManyRequests', 'ResourceInsufficient'])

/** Envelope error codes that mean "the upstream failed". */
const SERVER_CODES = new Set(['InternalError', 'InternalError.InternalError', 'ServiceUnavailable', 'ServiceError'])

/**
 * Round a requested result count up to a legal `Cnt` (multiple of ten, 10..50).
 *
 * `configured` (the `yuanbaoCnt` setting) wins when it is a positive number; it
 * is rounded too, so an operator cannot poison the wire with `Cnt: 15`.
 * @param {unknown} maxResults - the tool layer's result cap for this search.
 * @param {unknown} [configured] - the configured `yuanbaoCnt` override (0 = auto).
 * @returns {number} one of {@link YUANBAO_LEGAL_CNT}.
 */
export function resolveYuanbaoCnt(maxResults, configured) {
  const wanted = Number.isFinite(configured) && configured > 0
    ? configured
    : Number.isFinite(maxResults) && maxResults > 0
      ? maxResults
      : 8
  const rounded = Math.ceil(wanted / 10) * 10
  return Math.min(50, Math.max(10, rounded))
}

/**
 * Map one WSA envelope error to the lane's error contract: `WEB_PROVIDER_ERROR`
 * plus a `providerClass` the shared classifier understands, so an envelope
 * error on an HTTP 200 mutes the lane exactly like a status-code failure would.
 * @param {unknown} envelope - the `Response.Error` object.
 * @param {string} [requestId] - `Response.RequestId`, kept for the log.
 * @returns {WebError} the classified error (never carries the key).
 */
function envelopeError(envelope, requestId) {
  const code = typeof envelope?.Code === 'string' ? envelope.Code : 'InvalidParameter'
  const message = typeof envelope?.Message === 'string' ? envelope.Message : 'unknown error'
  const error = new WebError(
    `Yuanbao Search API error ${code}: ${redactBodyExcerpt(message, 200)}. ${YUANBAO_GUIDANCE}`,
    'WEB_PROVIDER_ERROR',
  )
  error.providerClass = AUTH_CODES.has(code)
    ? 'auth'
    : RATE_CODES.has(code)
      ? 'rate-limit'
      : SERVER_CODES.has(code)
        ? 'server'
        : 'invalid-response'
  error.providerCode = code
  if (typeof requestId === 'string' && requestId.length > 0) error.requestId = requestId
  return error
}

/**
 * Map a parsed SearchPro response to the seam's normalized result.
 *
 * Duplicate URLs inside one `Pages` array are collapsed (the API can repeat a
 * page across positions); the first occurrence wins, matching the merge layer's
 * rule that the earlier-ranked source keeps the slot.
 * @param {unknown} payload - the parsed response body.
 * @returns {{ sources: Array<object>, truncated: false }} the normalized sources.
 * @throws {WebError} when the body is an error envelope or has no usable pages.
 */
export function mapYuanbaoResponse(payload) {
  const envelope = payload?.Response?.Error ?? payload?.Error
  if (envelope !== undefined && envelope !== null) {
    throw envelopeError(envelope, payload?.Response?.RequestId)
  }
  const pages = payload?.Response?.Pages
  if (!Array.isArray(pages)) {
    const error = new WebError(
      `Yuanbao Search API returned no Pages array (HTTP 200 with an unrecognized body). ${YUANBAO_GUIDANCE}`,
      'WEB_PROVIDER_ERROR',
    )
    error.failureKind = 'invalid-response'
    throw error
  }
  const seen = new Set()
  const sources = []
  for (const raw of pages) {
    let page = raw
    if (typeof raw === 'string') {
      try {
        page = JSON.parse(raw)
      } catch {
        continue
      }
    }
    const url = typeof page?.url === 'string' ? page.url.trim() : ''
    if (url.length === 0 || seen.has(url)) continue
    seen.add(url)
    const title = typeof page.title === 'string' && page.title.length > 0 ? page.title : undefined
    const snippet = typeof page.passage === 'string' && page.passage.length > 0 ? page.passage : undefined
    const publishedAt = normalizePublishedDate(page.date)
    sources.push({
      url,
      ...(title === undefined ? {} : { title }),
      ...(snippet === undefined ? {} : { snippet }),
      ...(publishedAt === undefined ? {} : { publishedAt }),
    })
  }
  return { sources, truncated: false }
}

/**
 * The Yuanbao lane: one SearchPro request per search, degrading through the
 * merged provider like the other two lanes.
 */
export class YuanbaoBackend {
  /** Lane name used by health records, notes, and the probe protocol. */
  id = 'yuanbao'

  /**
   * @param {() => object} resolveOptions - options for the NEXT search, snapshotted per operation.
   */
  constructor(resolveOptions) {
    this.resolveOptions = resolveOptions
  }

  /** Cheap synchronous usability check; the key itself resolves asynchronously per search. */
  available() {
    const options = this.resolveOptions()
    return typeof options?.endpoint === 'string' && URL.canParse(options.endpoint)
  }

  /**
   * Run one SearchPro request.
   * @param {{query: string, maxResults?: number, site?: string}} request - query, result cap, optional structured site filter.
   * @param {AbortSignal} [signal] - cancellation signal from the seam/tool layer.
   * @returns {Promise<{sources: Array<object>, truncated: false}>} the normalized result.
   */
  async search(request, signal) {
    const options = this.resolveOptions()
    throwIfSearchAborted(signal)
    const apiKey = await resolveYuanbaoKey(options, signal)
    throwIfSearchAborted(signal)

    // Rounded before it leaves the process: an illegal Cnt is answered with
    // HTTP 200 + an error envelope and zero pages, i.e. a silent empty result.
    const body = {
      Query: request.query,
      Cnt: resolveYuanbaoCnt(request.maxResults ?? options.count ?? 10, options.count),
    }
    if (typeof request.site === 'string' && request.site.length > 0) body.Site = request.site

    const opened = await postJson({
      endpoint: options.endpoint,
      body,
      headers: {
        authorization: `Bearer ${apiKey}`,
        'content-type': 'application/json',
        accept: 'application/json',
        'user-agent': options.userAgent ?? 'dsh-serper-search',
      },
      timeoutMs: options.timeoutMs ?? 4500,
      signal,
      fetchImpl: options.fetchImpl,
      subject: 'Yuanbao Search API',
      guidance: YUANBAO_GUIDANCE,
    })
    const { response, gate } = opened
    try {
      if (!response.ok) {
        let raw = ''
        try {
          raw = await response.text()
        } catch (error) {
          if (signal?.aborted === true) throw error
        }
        const error = new WebError(
          `Yuanbao Search API error (HTTP ${response.status}). ${YUANBAO_GUIDANCE}`,
          'WEB_PROVIDER_ERROR',
        )
        error.httpStatus = response.status
        error.bodyExcerpt = redactBodyExcerpt(raw)
        throw error
      }
      const payload = await readJsonBody(opened, { subject: 'Yuanbao Search API', guidance: YUANBAO_GUIDANCE, signal })
      return mapYuanbaoResponse(payload)
    } finally {
      gate.cleanup()
    }
  }
}

/**
 * Resolve the lane's service key: a literal configured key first, then the
 * credentials service (or the launching environment) through the credential ref.
 * The failure message names the ref, never a value.
 * @param {object} options - the lane's options snapshot.
 * @param {AbortSignal} [signal] - cancellation signal.
 * @returns {Promise<string>} the key.
 */
async function resolveYuanbaoKey(options, signal) {
  if (typeof options.apiKey === 'string' && options.apiKey.length > 0) return options.apiKey
  throwIfSearchAborted(signal)
  let resolved
  try {
    resolved = options.resolveApiKey === undefined ? undefined : await options.resolveApiKey()
  } catch (error) {
    if (signal?.aborted === true) throw error
    throw new WebError(`Yuanbao Search credential resolution failed: ${String(error)}`, 'WEB_PROVIDER_ERROR', { cause: error })
  }
  if (typeof resolved === 'string' && resolved.length > 0) return resolved
  const ref = options.apiKeyEnv ?? YUANBAO_DEFAULT_API_KEY_ENV
  throw new WebError(
    `Yuanbao Search has no API key for "${ref}"; store it through the credentials service (~/.dsh/.credentials.yaml "refs:"), export it in the launching environment, or set a literal key in the web-search-serper config`,
    'WEB_PROVIDER_CREDENTIAL_MISSING',
  )
}
