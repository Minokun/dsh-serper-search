/**
 * Unit tests for the v0.4.0 failure classifier and body-excerpt handling
 * (P0-3, plan §5).
 *
 * Run with: `node --test tests/`
 *
 * Nothing here touches the network: the two backends receive stub `fetchImpl`
 * functions, and the pure helpers are called directly.
 */
import test from 'node:test'
import assert from 'node:assert/strict'

import { DeepSeekSearchApiBackend, SerperSearchProvider } from '../lib/index.js'
import {
  COOLDOWN_MS,
  EMPTY_OUTCOME,
  FAILURE_LABELS,
  classifyFailure,
  credentialFingerprint,
  redactBodyExcerpt,
} from '../lib/failure.js'

/** Build an error carrying the properties the backends attach to non-2xx failures. */
function httpError(status, { bodyExcerpt, message = `HTTP ${status}` } = {}) {
  const error = new Error(message)
  error.httpStatus = status
  if (bodyExcerpt !== undefined) error.bodyExcerpt = bodyExcerpt
  return error
}

/** A JSON response. */
function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json' } })
}

/** DeepSeek Search API backend with a stub transport. */
function deepseekBackend(fetchImpl, overrides = {}) {
  return new DeepSeekSearchApiBackend(() => ({
    apiKey: 'deepseek-key',
    baseURL: 'https://api.deepseek.com/v1/tools',
    count: 10,
    timeoutMs: 500,
    maxRetries: 0,
    fetchImpl,
    ...overrides,
  }))
}

/** serper.dev backend with a stub transport. */
function serperBackend(fetchImpl, overrides = {}) {
  return new SerperSearchProvider(() => ({
    apiKey: 'serper-key',
    apiKeyEnv: 'SERPER_API_KEY',
    baseURL: 'https://google.serper.dev',
    gl: 'cn',
    hl: 'zh-cn',
    autoLocale: false,
    num: 10,
    timeoutMs: 500,
    fetchImpl,
    ...overrides,
  }))
}

const SIGNAL = new AbortController().signal

// ── classification table (§5) ──────────────────────────────────────────────

test('the table exposes exactly the eight documented classes', () => {
  assert.deepEqual(Object.keys(COOLDOWN_MS).sort(), [
    'auth',
    'empty',
    'invalid-response',
    'network',
    'quota',
    'rate-limit',
    'server',
    'timeout',
  ])
  for (const cls of Object.keys(COOLDOWN_MS)) {
    assert.equal(typeof FAILURE_LABELS[cls], 'string')
  }
})

test('auth: 401, 403, and credential-missing cool for ten minutes', () => {
  for (const error of [
    httpError(401),
    httpError(403),
    Object.assign(new Error('no key'), { code: 'WEB_PROVIDER_CREDENTIAL_MISSING' }),
  ]) {
    assert.deepEqual(classifyFailure(error), { cls: 'auth', label: 'auth failed', cooldownMs: 600_000 })
  }
})

test('quota: 402 and 429 with quota/credit/balance evidence cool for ten minutes', () => {
  for (const error of [
    httpError(402, { bodyExcerpt: 'payment required' }),
    httpError(429, { bodyExcerpt: 'insufficient credits remaining' }),
    httpError(429, { bodyExcerpt: 'quota exceeded for this month' }),
    httpError(429, { bodyExcerpt: 'your balance is too low' }),
    // No excerpt: the message is the only evidence available.
    httpError(429, { message: 'quota exceeded' }),
  ]) {
    assert.equal(classifyFailure(error).cls, 'quota', error.bodyExcerpt ?? error.message)
    assert.equal(classifyFailure(error).cooldownMs, 600_000)
  }
})

test('rate-limit: a plain 429 cools only sixty seconds (guidance words are not quota evidence)', () => {
  for (const error of [
    httpError(429, { bodyExcerpt: 'slow down' }),
    httpError(429, { bodyExcerpt: '' }),
    // "credential" must not be read as "credit".
    httpError(429, { bodyExcerpt: '', message: 'rate limited; check the credential ref' }),
  ]) {
    assert.deepEqual(classifyFailure(error), { cls: 'rate-limit', label: 'rate limited', cooldownMs: 60_000 })
  }
})

test('server: 5xx cools sixty seconds', () => {
  for (const status of [500, 502, 503, 504]) {
    assert.deepEqual(classifyFailure(httpError(status)), { cls: 'server', label: 'server error', cooldownMs: 60_000 })
  }
})

test('timeout: the lane budget cooling thirty seconds', () => {
  const kind = Object.assign(new Error('request timed out after 4500ms'), { failureKind: 'timeout', timeoutMs: 4500 })
  const dom = new DOMException('Search timeout after 30ms', 'TimeoutError')
  const messageOnly = new Error('DeepSeek Search API request budget (4500ms) exhausted before attempt 2.')
  for (const error of [kind, dom, messageOnly]) {
    assert.deepEqual(classifyFailure(error), { cls: 'timeout', label: 'timed out', cooldownMs: 30_000 })
  }
})

test('network: transport failures cool thirty seconds', () => {
  const fetchFailed = new TypeError('fetch failed')
  const dns = Object.assign(new Error('failed'), { cause: new Error('getaddrinfo ENOTFOUND google.serper.dev') })
  const reset = new Error('read ECONNRESET')
  for (const error of [fetchFailed, dns, reset]) {
    assert.deepEqual(classifyFailure(error), { cls: 'network', label: 'network error', cooldownMs: 30_000 })
  }
})

test('invalid-response: parse failures and other 4xx never cool', () => {
  const unprocessable = Object.assign(new Error('returned an unprocessable response body'), { failureKind: 'invalid-response' })
  for (const error of [httpError(400), httpError(404), unprocessable, new Error('Unexpected token < in JSON')]) {
    assert.deepEqual(classifyFailure(error), { cls: 'invalid-response', label: 'invalid response', cooldownMs: 0 })
  }
})

test('empty: a 200 with zero sources is documented and never cools', () => {
  assert.deepEqual(EMPTY_OUTCOME, { cls: 'empty', label: 'no results', cooldownMs: 0 })
})

test('an aborted search is not a backend failure', () => {
  assert.equal(classifyFailure(Object.assign(new Error('aborted'), { code: 'WEB_ABORTED' })), null)
})

// ── credential fingerprint (§5 a) ──────────────────────────────────────────

test('fingerprint is stable and changes for each credential input', () => {
  const base = { apiKeyEnv: 'SERPER_API_KEY', baseURL: 'https://google.serper.dev', apiKey: 'literal-key' }
  const fingerprint = credentialFingerprint(base)
  assert.match(fingerprint, /^[0-9a-f]{12}$/)
  assert.equal(fingerprint, credentialFingerprint({ ...base }))

  assert.notEqual(fingerprint, credentialFingerprint({ ...base, apiKeyEnv: 'OTHER_KEY' }))
  assert.notEqual(fingerprint, credentialFingerprint({ ...base, baseURL: 'https://example.test' }))
  assert.notEqual(fingerprint, credentialFingerprint({ ...base, apiKey: 'other-key' }))
  assert.equal(credentialFingerprint({}), credentialFingerprint({ apiKey: '' }))
})

// ── excerpt redaction ──────────────────────────────────────────────────────

test('body excerpts are capped at 300 characters', () => {
  const excerpt = redactBodyExcerpt('boom '.repeat(200))
  assert.equal(excerpt.length, 300)
})

test('body excerpts redact keys, bearer tokens, and token assignments', () => {
  const body = JSON.stringify({
    error: 'bad key sk-live-0123456789abcdef',
    authorization: 'Bearer abcdefghijklmnopqrstuvwxyz012345',
    apiKey: 'plain-secret-value',
    token: 'another-secret',
  })
  const excerpt = redactBodyExcerpt(body)
  assert.doesNotMatch(excerpt, /sk-live-0123456789abcdef/)
  assert.doesNotMatch(excerpt, /abcdefghijklmnopqrstuvwxyz012345/)
  assert.doesNotMatch(excerpt, /plain-secret-value/)
  assert.doesNotMatch(excerpt, /another-secret/)
  assert.match(excerpt, /\[redacted\]/)
})

test('body excerpts keep harmless diagnostics readable', () => {
  assert.equal(
    redactBodyExcerpt('HTTP 401: the search index is unavailable, retry later'),
    'HTTP 401: the search index is unavailable, retry later',
  )
})

// ── backends attach httpStatus + bodyExcerpt on non-2xx ────────────────────

test('DeepSeek non-2xx errors carry httpStatus and a redacted excerpt', async () => {
  const fetchImpl = async () => jsonResponse({
    error: { message: 'bad key sk-live-0123456789abcdef token=topsecretvalue' },
  }, 401)
  await assert.rejects(deepseekBackend(fetchImpl).search({ query: 'q', maxResults: 3 }, SIGNAL), (error) => {
    assert.equal(error.httpStatus, 401)
    assert.equal(typeof error.bodyExcerpt, 'string')
    assert.ok(error.bodyExcerpt.length <= 300)
    assert.doesNotMatch(error.bodyExcerpt, /sk-live-0123456789abcdef/)
    assert.doesNotMatch(error.bodyExcerpt, /topsecretvalue/)
    assert.equal(classifyFailure(error).cls, 'auth')
    return true
  })
})

test('serper non-2xx errors carry httpStatus + excerpt and drive quota/rate-limit', async () => {
  const quota = serperBackend(async () => jsonResponse({ message: 'insufficient credits' }, 429))
  await assert.rejects(quota.search({ query: 'q', maxResults: 3 }, SIGNAL), (error) => {
    assert.equal(error.httpStatus, 429)
    assert.match(error.bodyExcerpt, /insufficient credits/)
    assert.equal(classifyFailure(error).cls, 'quota')
    return true
  })

  const burst = serperBackend(async () => jsonResponse({ message: 'slow down' }, 429))
  await assert.rejects(burst.search({ query: 'q', maxResults: 3 }, SIGNAL), (error) => {
    assert.equal(classifyFailure(error).cls, 'rate-limit')
    return true
  })
})

test('a serper 500 excerpt is capped and classified as server', async () => {
  const body = 'upstream exploded '.repeat(100)
  const backend = serperBackend(async () => new Response(body, { status: 500 }))
  await assert.rejects(backend.search({ query: 'q', maxResults: 3 }, SIGNAL), (error) => {
    assert.equal(error.httpStatus, 500)
    assert.equal(error.bodyExcerpt.length, 300)
    assert.equal(classifyFailure(error).cls, 'server')
    return true
  })
})

test('transport failures are tagged timeout/network by the request gate', async () => {
  const hanging = serperBackend((url, init) => new Promise((resolve, reject) => {
    init.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true })
  }), { timeoutMs: 40 })
  await assert.rejects(hanging.search({ query: 'q', maxResults: 3 }, SIGNAL), (error) => {
    assert.equal(error.failureKind, 'timeout')
    assert.equal(error.timeoutMs, 40)
    assert.equal(classifyFailure(error).cls, 'timeout')
    return true
  })

  const broken = serperBackend(async () => {
    throw new TypeError('fetch failed')
  })
  await assert.rejects(broken.search({ query: 'q', maxResults: 3 }, SIGNAL), (error) => {
    assert.equal(error.failureKind, 'network')
    assert.equal(classifyFailure(error).cls, 'network')
    return true
  })
})

test('an unparseable 200 response is invalid-response, not a timeout', async () => {
  const backend = serperBackend(async () => new Response('not json', { status: 200 }))
  await assert.rejects(backend.search({ query: 'q', maxResults: 3 }, SIGNAL), (error) => {
    assert.equal(error.failureKind, 'invalid-response')
    assert.equal(classifyFailure(error).cls, 'invalid-response')
    assert.equal(classifyFailure(error).cooldownMs, 0)
    return true
  })
})

test('credentialFingerprint follows the Yuanbao endpoint as well as baseURL', () => {
  // Repro R5: the Yuanbao lane names its endpoint `endpoint`, so two different
  // endpoints produced one fingerprint and a cooldown outlived the fix.
  const a = credentialFingerprint({ apiKeyEnv: 'YUANBAO_API_KEY', endpoint: 'https://api.wsa.cloud.tencent.com/SearchPro' })
  const b = credentialFingerprint({ apiKeyEnv: 'YUANBAO_API_KEY', endpoint: 'https://example.invalid/Other' })
  assert.notEqual(a, b)
  assert.equal(a, credentialFingerprint({ apiKeyEnv: 'YUANBAO_API_KEY', endpoint: 'https://api.wsa.cloud.tencent.com/SearchPro' }))
  // Unchanged for the lanes that carry `baseURL`.
  assert.equal(
    credentialFingerprint({ apiKeyEnv: 'SERPER_API_KEY', baseURL: 'https://google.serper.dev' }),
    credentialFingerprint({ apiKeyEnv: 'SERPER_API_KEY', baseURL: 'https://google.serper.dev' }),
  )
})
