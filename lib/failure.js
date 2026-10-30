/**
 * Failure classification, cooldown table, credential fingerprints, and response
 * excerpt redaction for the v0.4.0 health-aware merged provider (P0-3).
 *
 * The table is deliberately small and stable; the merged provider stores one
 * cooldown per lane and asks this module how long to mute a failing backend:
 *
 *   auth             401 / 403 / WEB_PROVIDER_CREDENTIAL_MISSING   10 minutes
 *   quota            402 / 429 whose body mentions quota/credit      10 minutes
 *   rate-limit       429 without quota evidence                       60 seconds
 *   server           5xx                                              60 seconds
 *   timeout          the lane's own budget ran out                    30 seconds
 *   network          DNS / connection reset / certificate failure     30 seconds
 *   invalid-response JSON parse failure / unusable response             no cooldown
 *   empty            200 with zero sources                              no cooldown
 *
 * `classifyFailure` is pure and never throws; aborted searches are filtered by
 * the caller (they are not a backend failure), so they return `null`.
 *
 * Lanes whose provider reports failures in a 200 body (Tencent Cloud WSA
 * answers `{"Response":{"Error":{"Code":"..."}}}` with HTTP 200) attach a
 * `providerClass` hint; it is honoured before any status-code heuristics so an
 * envelope error mutes the lane exactly like a status-code failure would.
 */

import { createHash } from 'node:crypto'

/** Cooldown per failure class, in milliseconds. */
export const COOLDOWN_MS = Object.freeze({
  auth: 10 * 60_000,
  quota: 10 * 60_000,
  'rate-limit': 60_000,
  server: 60_000,
  timeout: 30_000,
  network: 30_000,
  'invalid-response': 0,
  empty: 0,
})

/** Short, user-facing label per class (used by the degradation `Note`). */
export const FAILURE_LABELS = Object.freeze({
  auth: 'auth failed',
  quota: 'quota exhausted',
  'rate-limit': 'rate limited',
  server: 'server error',
  timeout: 'timed out',
  network: 'network error',
  'invalid-response': 'invalid response',
  empty: 'no results',
})

/** The `empty` outcome: a 200 response that carried no sources (never cooled). */
export const EMPTY_OUTCOME = Object.freeze({
  cls: 'empty',
  label: FAILURE_LABELS.empty,
  cooldownMs: 0,
})

/** Classes a lane may declare directly (`providerClass` on the thrown error). */
const PROVIDER_CLASSES = new Set(['auth', 'quota', 'rate-limit', 'server', 'invalid-response'])

/** Build the immutable classification record for one class. */
function outcome(cls) {
  return { cls, label: FAILURE_LABELS[cls], cooldownMs: COOLDOWN_MS[cls] }
}

/** True when a 429 body looks like an exhausted balance rather than a burst limit. */
function looksLikeQuota(text) {
  return /(?:quota|credits?\b|balance|insufficient)/.test(text)
}

/**
 * Classify one backend failure.
 * @param {unknown} error - the rejected value from a backend request.
 * @returns {{cls: string, label: string, cooldownMs: number} | null} the
 *   classification, or `null` for an aborted search (not a failure).
 */
export function classifyFailure(error) {
  if (error === undefined || error === null) return outcome('invalid-response')
  if (error.code === 'WEB_ABORTED') return null
  if (error.code === 'WEB_PROVIDER_CREDENTIAL_MISSING') return outcome('auth')
  // A lane that classifies its own provider envelope (WSA answers errors with
  // HTTP 200) names the class up front; a recognized hint wins.
  if (typeof error.providerClass === 'string' && PROVIDER_CLASSES.has(error.providerClass)) {
    return outcome(error.providerClass)
  }

  const rawStatus = Number(error.httpStatus)
  const status = Number.isInteger(rawStatus) && rawStatus > 0 ? rawStatus : undefined
  if (status !== undefined) {
    if (status === 401 || status === 403) return outcome('auth')
    if (status === 402) return outcome('quota')
    if (status === 429) {
      // Prefer the response excerpt: our own guidance text contains the word
      // "credential", which must not count as balance/credit evidence.
      const evidence = typeof error.bodyExcerpt === 'string' ? error.bodyExcerpt : String(error.message ?? '')
      return looksLikeQuota(evidence.toLowerCase()) ? outcome('quota') : outcome('rate-limit')
    }
    if (status >= 500) return outcome('server')
    if (status >= 400) return outcome('invalid-response')
  }

  switch (error.failureKind) {
    case 'timeout':
      return outcome('timeout')
    case 'network':
      return outcome('network')
    case 'invalid-response':
      return outcome('invalid-response')
    default:
      break
  }

  if (error.name === 'TimeoutError' || error.cause?.name === 'TimeoutError') return outcome('timeout')
  const text = `${error.message ?? ''} ${error.cause?.message ?? ''}`.toLowerCase()
  if (/timed out|timeout|budget \(\d+ms\) exhausted|budget exhausted/.test(text)) return outcome('timeout')
  if (error instanceof TypeError || /fetch failed|econn|enotfound|eai_again|socket hang up|certificate|network/.test(text)) {
    return outcome('network')
  }
  if (/unprocessable|invalid json|json parse|unexpected token/.test(text)) return outcome('invalid-response')
  // Unknown internal failures are treated as a bad response, not as a reason to
  // mute a paid backend for 30 seconds.
  return outcome('invalid-response')
}

/** SHA-1 hex digest of one value. */
function sha1(value) {
  return createHash('sha1').update(String(value)).digest('hex')
}

/**
 * Fingerprint the inputs that decide which credential a lane uses:
 * `sha1(apiKeyEnv | baseURL | sha1(literalKey))`, first 12 hex characters.
 * The literal key is hashed twice so the stored cooldown never contains it.
 * @param {{apiKeyEnv?: string, baseURL?: string, apiKey?: string}} options - one lane's options snapshot.
 * @returns {string} a 12-character fingerprint.
 */
export function credentialFingerprint(options = {}) {
  const ref = options?.apiKeyEnv ?? ''
  const base = options?.baseURL ?? ''
  const literal = options?.apiKey ?? ''
  return sha1(`${ref}|${base}|${sha1(literal)}`).slice(0, 12)
}

/** Redact common credential shapes from a response body before keeping it. */
function redactSecrets(text) {
  return text
    .replace(/\b(Bearer)\s+[A-Za-z0-9._~+/=-]+/gi, '$1 [redacted]')
    .replace(/\bsk-[A-Za-z0-9_-]{6,}/g, 'sk-[redacted]')
    .replace(
      // `api key: value` / `api_key=value` / `X-API-KEY: value` all name the
      // same secret; the separator may be a space, dash, underscore, or nothing.
      /(\b(?:api[\s_-]*key|access[\s_-]*token|refresh[\s_-]*token|token|secret|password)\b["']?\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,;&}]+)/gi,
      '$1[redacted]',
    )
    .replace(/\b[A-Za-z0-9_-]{32,}\b/g, '[redacted]')
}

/**
 * Keep at most `maxChars` characters of a response body for diagnostics, with
 * credential-like values redacted and whitespace collapsed to one line.
 * @param {unknown} body - raw body text (already read).
 * @param {number} [maxChars] - hard cap, default 300.
 * @returns {string} the redacted excerpt.
 */
export function redactBodyExcerpt(body, maxChars = 300) {
  const text = typeof body === 'string' ? body : body === undefined || body === null ? '' : String(body)
  const singleLine = redactSecrets(text).replace(/\s+/g, ' ').trim()
  return singleLine.slice(0, Math.max(0, maxChars))
}
