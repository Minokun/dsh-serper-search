/**
 * Unit tests for the v0.4.0 cooldown / health state and degradation `Note`
 * (P0-3, plan §5).
 *
 * Run with: `node --test tests/`
 *
 * The two backends get stub `fetchImpl` functions; the credential-event path is
 * exercised through a fake context so `apply()`'s listener wiring is covered
 * without a real profile or credentials service.
 */
import test from 'node:test'
import assert from 'node:assert/strict'

import { MergedSearchProvider, apply } from '../lib/index.js'

const SIGNAL = new AbortController().signal
const A_URLS = Array.from({ length: 6 }, (_, index) => `https://a${index}.example/${index}`)
const B_URLS = Array.from({ length: 6 }, (_, index) => `https://b${index}.example/${index}`)

/** DeepSeek Search API payload. */
function deepseekPayload(urls) {
  return {
    results: urls.map((url, index) => ({
      title: `A${index}`,
      url,
      snippet: `a-snippet-${index}`,
      date: '2026-01-02T00:00:00+00:00',
      authority: 3,
    })),
  }
}

/** serper.dev payload, optionally with an answer box. */
function serperPayload(urls, answerBox) {
  return {
    ...(answerBox === undefined ? {} : { answerBox }),
    organic: urls.map((url, index) => ({
      title: `B${index}`,
      link: url,
      snippet: `b-snippet-${index}`,
      position: index + 1,
    })),
  }
}

/** A JSON response. */
function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json' } })
}

/** Stub fetch recording every call. */
function stubFetch(handler) {
  const calls = []
  const impl = async (url, init) => {
    calls.push({ url, init })
    return await handler(url, init, calls.length)
  }
  impl.calls = calls
  return impl
}

/** A fetch stub that only settles when its signal aborts. */
function hangingFetch() {
  return (url, init) => new Promise((resolve, reject) => {
    const onAbort = () => reject(new DOMException('aborted', 'AbortError'))
    if (init.signal?.aborted === true) onAbort()
    else init.signal?.addEventListener('abort', onAbort, { once: true })
  })
}

/** Provider options with per-lane transports and the real defaults. */
function mergedOptions({ deepseekFetch, serperFetch, overrides = {} } = {}) {
  return {
    deepseekEnabled: true,
    primary: 'deepseek',
    ratio: 2,
    maxPerHost: 2,
    demoteSocial: true,
    logLevel: 'off',
    // These tests assert per-search network/health behaviour; the P0-2 result
    // cache is disabled here and covered by tests/cache.test.mjs.
    cacheMinutes: 0,
    deepseek: {
      apiKey: 'deepseek-test-key',
      apiKeyEnv: 'DEEPSEEK_API_KEY',
      baseURL: 'https://api.deepseek.com/v1/tools',
      count: 10,
      timeoutMs: 1000,
      summaryMaxChars: 600,
      minAuthority: -1,
      maxRetries: 0,
      fetchImpl: deepseekFetch,
    },
    serper: {
      apiKey: 'serper-test-key',
      apiKeyEnv: 'SERPER_API_KEY',
      baseURL: 'https://google.serper.dev',
      gl: 'cn',
      hl: 'zh-cn',
      autoLocale: true,
      num: 10,
      timeoutMs: 1000,
      fetchImpl: serperFetch,
    },
    ...overrides,
  }
}

/** A fixed request. */
function request(query = 'cooldown test') {
  return { query, maxResults: 8 }
}

/** Milliseconds left on a lane's cooldown. */
function remaining(provider, lane) {
  return provider.health[lane].until - Date.now()
}

// ── §5 acceptance: 401 → skip + Note ───────────────────────────────────────

test('serper 401 cools for ten minutes; the next search skips it and adds a Note', async () => {
  const deepseekFetch = stubFetch(() => jsonResponse(deepseekPayload(A_URLS)))
  const serperFetch = stubFetch(() => jsonResponse({ message: 'bad key' }, 401))
  const provider = new MergedSearchProvider(() => mergedOptions({ deepseekFetch, serperFetch }))

  const first = await provider.search(request(), SIGNAL)
  assert.equal(serperFetch.calls.length, 1)
  assert.match(first.content, /^Note: serper auth failed \(HTTP 401\), using deepseek\./)
  assert.equal(provider.health.serper.cls, 'auth')
  assert.ok(remaining(provider, 'serper') > 599_000 && remaining(provider, 'serper') <= 600_000)

  const second = await provider.search(request(), SIGNAL)
  assert.equal(serperFetch.calls.length, 1, 'serper must not be requested while cooling')
  assert.match(second.content, /^Note: serper auth failed, using deepseek\./)
  assert.equal(second.sources.length, 6)
})

test('a literal-key change clears the cooldown (credential fingerprint changed)', async () => {
  let literalKey = 'bad-key'
  let serperMode = 'unauthorized'
  const deepseekFetch = stubFetch(() => jsonResponse(deepseekPayload(A_URLS)))
  const serperFetch = stubFetch(() => (serperMode === 'unauthorized'
    ? jsonResponse({ message: 'bad key' }, 401)
    : jsonResponse(serperPayload(B_URLS))))
  const provider = new MergedSearchProvider(() => {
    const base = mergedOptions({ deepseekFetch, serperFetch })
    return { ...base, serper: { ...base.serper, apiKey: literalKey } }
  })

  await provider.search(request(), SIGNAL)
  assert.equal(serperFetch.calls.length, 1)

  // Unchanged key/baseURL: still cooling.
  await provider.search(request(), SIGNAL)
  assert.equal(serperFetch.calls.length, 1)

  // The user fixed the key in the config: the changed fingerprint clears it.
  literalKey = 'good-key'
  serperMode = 'ok'
  const result = await provider.search(request(), SIGNAL)
  assert.equal(serperFetch.calls.length, 2)
  assert.equal(provider.health.serper.until, 0)
  assert.equal(result.content, undefined)
})

test('a baseURL change clears the cooldown too', async () => {
  let baseURL = 'https://google.serper.dev'
  let serperMode = 'unauthorized'
  const deepseekFetch = stubFetch(() => jsonResponse(deepseekPayload(A_URLS)))
  const serperFetch = stubFetch(() => (serperMode === 'unauthorized'
    ? jsonResponse({ message: 'bad key' }, 401)
    : jsonResponse(serperPayload(B_URLS))))
  const provider = new MergedSearchProvider(() => {
    const base = mergedOptions({ deepseekFetch, serperFetch })
    return { ...base, serper: { ...base.serper, baseURL } }
  })

  await provider.search(request(), SIGNAL)
  await provider.search(request(), SIGNAL)
  assert.equal(serperFetch.calls.length, 1)

  baseURL = 'https://serper-proxy.example'
  serperMode = 'ok'
  await provider.search(request(), SIGNAL)
  assert.equal(serperFetch.calls.length, 2)
})

// ── §5 acceptance: credentials/reference-updated ───────────────────────────

/** Config volatile refs for `apply()`. */
function configRefs(overrides = {}) {
  const values = {
    apiKey: 'serper-literal-key',
    apiKeyEnv: 'SERPER_API_KEY',
    baseURL: 'https://google.serper.dev',
    gl: 'cn',
    hl: 'zh-cn',
    autoLocale: true,
    num: 10,
    serperTimeoutMs: 1000,
    deepseekApiKey: 'deepseek-literal-key',
    deepseekApiKeyEnv: 'DEEPSEEK_API_KEY',
    deepseekBaseURL: 'https://api.deepseek.com/v1/tools',
    deepseekCount: 10,
    deepseekTimeoutMs: 1000,
    summaryMaxChars: 600,
    primary: 'deepseek',
    ratio: 2,
    minAuthority: -1,
    maxRetries: 0,
    maxPerHost: 2,
    demoteSocial: true,
    logLevel: 'off',
    cacheMinutes: 0,
    native: true,
    nativeApiKey: undefined,
    nativeApiKeyEnv: 'DEEPSEEK_API_KEY',
    nativeBaseURL: undefined,
    nativeModel: 'deepseek-v4-flash',
    nativeMaxUses: 5,
    takeOverProvider: false,
    ...overrides,
  }
  return Object.fromEntries(Object.entries(values).map(([key, value]) => [key, { get: () => value }]))
}

/** Fake context that records the provider and the credential listener. */
function makeContext() {
  const registered = []
  const listeners = new Map()
  return {
    registered,
    listeners,
    ctx: {
      logger: { info() {}, warn() {} },
      get: () => undefined,
      inject: () => {},
      on(name, listener) {
        listeners.set(name, listener)
        return () => listeners.delete(name)
      },
      web: {
        registerSearchProvider(provider) {
          registered.push(provider)
        },
      },
    },
  }
}

test('a matching credentials/reference-updated clears only that lane', async () => {
  const { ctx, registered, listeners } = makeContext()
  const originalFetch = globalThis.fetch
  let deepseekMode = 'unauthorized'
  let serperMode = 'unauthorized'
  globalThis.fetch = async (url) => {
    if (String(url).includes('api.deepseek.com')) {
      return deepseekMode === 'ok'
        ? jsonResponse(deepseekPayload(A_URLS))
        : jsonResponse({ error: { message: 'no' } }, 401)
    }
    return serperMode === 'ok'
      ? jsonResponse(serperPayload(B_URLS))
      : jsonResponse({ message: 'bad key' }, 401)
  }
  try {
    apply(ctx, configRefs())
    const provider = registered[0]

    // Both lanes fail: both records exist.
    await assert.rejects(provider.search(request(), SIGNAL))
    assert.equal(provider.health.deepseek.cls, 'auth')
    assert.equal(provider.health.serper.cls, 'auth')

    const listener = listeners.get('credentials/reference-updated')
    assert.equal(typeof listener, 'function')

    // An unrelated ref clears nothing.
    listener('SOME_OTHER_REF')
    assert.ok(remaining(provider, 'deepseek') > 0)
    assert.ok(remaining(provider, 'serper') > 0)

    // The serper ref clears serper, and leaves deepseek's cooldown alone.
    listener('SERPER_API_KEY')
    assert.equal(provider.health.serper.until, 0)
    assert.ok(remaining(provider, 'deepseek') > 0)

    // The next search therefore requests serper again (deepseek stays skipped).
    serperMode = 'ok'
    const result = await provider.search(request(), SIGNAL)
    assert.equal(result.sources.length, 6)
    assert.match(result.content, /^Note: deepseek auth failed, using serper\./)
  } finally {
    globalThis.fetch = originalFetch
  }
})

// ── §5 acceptance: probe success / probe failure ───────────────────────────

test('clearHealth (probe success) clears a cooldown; an unknown lane is a no-op', async () => {
  let serperMode = 'unauthorized'
  const deepseekFetch = stubFetch(() => jsonResponse(deepseekPayload(A_URLS)))
  const serperFetch = stubFetch(() => (serperMode === 'unauthorized'
    ? jsonResponse({ message: 'bad key' }, 401)
    : jsonResponse(serperPayload(B_URLS))))
  const provider = new MergedSearchProvider(() => mergedOptions({ deepseekFetch, serperFetch }))

  await provider.search(request(), SIGNAL)
  assert.equal(provider.health.serper.cls, 'auth')

  assert.equal(provider.clearHealth('serper'), true)
  assert.equal(provider.health.serper.until, 0)
  assert.equal(provider.clearHealth('nope'), false)

  serperMode = 'ok'
  await provider.search(request(), SIGNAL)
  assert.equal(serperFetch.calls.length, 2)
})

test('a probe failure (a direct backend call) does not write a cooldown', async () => {
  let serperMode = 'ok'
  const deepseekFetch = stubFetch(() => jsonResponse(deepseekPayload(A_URLS)))
  const serperFetch = stubFetch(() => (serperMode === 'ok'
    ? jsonResponse(serperPayload(B_URLS))
    : jsonResponse({ message: 'bad key' }, 401)))
  const provider = new MergedSearchProvider(() => mergedOptions({ deepseekFetch, serperFetch }))

  await provider.search(request(), SIGNAL)
  assert.equal(provider.health.serper.until, 0)

  // The P1-5 probe calls the backend directly; its failure must not mute the
  // lane used by normal searches.
  serperMode = 'unauthorized'
  await assert.rejects(provider.serper.search(request('probe'), SIGNAL))
  assert.equal(provider.health.serper.until, 0)

  serperMode = 'ok'
  const before = serperFetch.calls.length
  await provider.search(request(), SIGNAL)
  assert.equal(serperFetch.calls.length, before + 1)
})

// ── §5 acceptance: quota window / server cooldown ──────────────────────────

test('a quota 429 cools ten minutes: skipped at +9min, retried at +11min', async () => {
  let serperMode = 'quota'
  const deepseekFetch = stubFetch(() => jsonResponse(deepseekPayload(A_URLS)))
  const serperFetch = stubFetch(() => (serperMode === 'quota'
    ? jsonResponse({ message: 'insufficient credits remaining' }, 429)
    : jsonResponse(serperPayload(B_URLS))))
  const provider = new MergedSearchProvider(() => mergedOptions({ deepseekFetch, serperFetch }))

  const first = await provider.search(request(), SIGNAL)
  assert.match(first.content, /^Note: serper quota exhausted \(HTTP 429\), using deepseek\./)
  assert.equal(provider.health.serper.cls, 'quota')
  assert.ok(remaining(provider, 'serper') > 599_000 && remaining(provider, 'serper') <= 600_000)

  // Nine minutes in: still cooling.
  provider.health.serper.until = Date.now() + 9 * 60_000
  const skipped = await provider.search(request(), SIGNAL)
  assert.equal(serperFetch.calls.length, 1)
  assert.match(skipped.content, /^Note: serper quota exhausted, using deepseek\./)

  // Eleven minutes in: the cooldown expired, the lane is retried.
  provider.health.serper.until = Date.now() - 1
  serperMode = 'ok'
  const recovered = await provider.search(request(), SIGNAL)
  assert.equal(serperFetch.calls.length, 2)
  assert.equal(provider.health.serper.until, 0)
  assert.equal(recovered.content, undefined)
  assert.equal(recovered.sources.length, 8)
})

test('deepseek 5xx retries once, then cools sixty seconds; serper keeps answering with a Note', async () => {
  const deepseekFetch = stubFetch(() => jsonResponse({ error: { message: 'overloaded' } }, 500))
  const serperFetch = stubFetch(() => jsonResponse(serperPayload(B_URLS, { answer: 'box answer' })))
  const provider = new MergedSearchProvider(() => {
    const base = mergedOptions({ deepseekFetch, serperFetch })
    return { ...base, deepseek: { ...base.deepseek, maxRetries: 1, timeoutMs: 5000 } }
  })

  const first = await provider.search(request(), SIGNAL)
  assert.equal(deepseekFetch.calls.length, 2, 'one internal retry')
  assert.equal(provider.health.deepseek.cls, 'server')
  assert.ok(remaining(provider, 'deepseek') > 59_000 && remaining(provider, 'deepseek') <= 60_000)
  assert.match(first.content, /^Note: deepseek server error \(HTTP 500\), using serper\./)
  assert.ok(first.content.endsWith('box answer'))

  const second = await provider.search(request(), SIGNAL)
  assert.equal(deepseekFetch.calls.length, 2, 'deepseek must be skipped while cooling')
  assert.match(second.content, /^Note: deepseek server error, using serper\./)
  assert.ok(second.content.endsWith('box answer'))
})

// ── §5 acceptance: fail-open, empty, invalid-response ──────────────────────

test('both lanes 401 fail-open: both are retried on the next search and both classes are named', async () => {
  const deepseekFetch = stubFetch(() => jsonResponse({ error: { message: 'no key' } }, 401))
  const serperFetch = stubFetch(() => jsonResponse({ message: 'bad key' }, 401))
  const provider = new MergedSearchProvider(() => mergedOptions({ deepseekFetch, serperFetch }))

  await assert.rejects(provider.search(request(), SIGNAL), (error) => {
    assert.equal(error.code, 'WEB_PROVIDER_ERROR')
    assert.match(error.message, /DeepSeek Search API: \[auth\]/)
    assert.match(error.message, /Serper: \[auth\]/)
    return true
  })
  assert.deepEqual([deepseekFetch.calls.length, serperFetch.calls.length], [1, 1])
  assert.equal(provider.health.deepseek.cls, 'auth')
  assert.equal(provider.health.serper.cls, 'auth')

  // Both cooling: fail-open, so neither lane is skipped.
  await assert.rejects(provider.search(request(), SIGNAL), (error) => {
    assert.match(error.message, /\[auth\]/)
    return true
  })
  assert.deepEqual([deepseekFetch.calls.length, serperFetch.calls.length], [2, 2])
})

test('a 200 with zero sources does not cool either lane', async () => {
  const deepseekFetch = stubFetch(() => jsonResponse(deepseekPayload([])))
  const serperFetch = stubFetch(() => jsonResponse(serperPayload([])))
  const provider = new MergedSearchProvider(() => mergedOptions({ deepseekFetch, serperFetch }))

  const first = await provider.search(request(), SIGNAL)
  assert.deepEqual(first.sources, [])
  assert.equal(first.content, undefined)
  assert.equal(provider.health.deepseek.until, 0)
  assert.equal(provider.health.serper.until, 0)

  await provider.search(request(), SIGNAL)
  assert.deepEqual([deepseekFetch.calls.length, serperFetch.calls.length], [2, 2])
})

test('an invalid response degrades with a Note but never cools', async () => {
  let serperMode = 'bad-json'
  const deepseekFetch = stubFetch(() => jsonResponse(deepseekPayload(A_URLS)))
  const serperFetch = stubFetch(() => (serperMode === 'bad-json'
    ? new Response('not json', { status: 200 })
    : jsonResponse(serperPayload(B_URLS))))
  const provider = new MergedSearchProvider(() => mergedOptions({ deepseekFetch, serperFetch }))

  const first = await provider.search(request(), SIGNAL)
  assert.match(first.content, /^Note: serper invalid response, using deepseek\./)
  assert.equal(provider.health.serper.until, 0)

  serperMode = 'ok'
  await provider.search(request(), SIGNAL)
  assert.equal(serperFetch.calls.length, 2)
})

// ── Note shapes / result-object hygiene ────────────────────────────────────

test('a timeout Note names the budget and stays out of the result object', async () => {
  const deepseekFetch = stubFetch(() => jsonResponse(deepseekPayload(A_URLS)))
  const provider = new MergedSearchProvider(() => {
    const base = mergedOptions({ deepseekFetch })
    return { ...base, serper: { ...base.serper, timeoutMs: 30, fetchImpl: hangingFetch() } }
  })

  const result = await provider.search(request(), SIGNAL)
  assert.match(result.content, /^Note: serper timed out after 30ms, using deepseek\./)
  assert.equal(result.degraded, undefined)
  assert.equal('degraded' in result, false)
  assert.equal(provider.health.serper.cls, 'timeout')
  assert.ok(remaining(provider, 'serper') > 29_000 && remaining(provider, 'serper') <= 30_000)
})

test('a transport failure yields a network Note', async () => {
  const deepseekFetch = stubFetch(() => jsonResponse(deepseekPayload(A_URLS)))
  const serperFetch = async () => {
    throw new TypeError('fetch failed')
  }
  const provider = new MergedSearchProvider(() => mergedOptions({ deepseekFetch, serperFetch }))

  const result = await provider.search(request(), SIGNAL)
  assert.match(result.content, /^Note: serper network error, using deepseek\./)
  assert.equal(provider.health.serper.cls, 'network')
})

// ── Upstream error bodies are redacted on the search path too ──────────────

const ECHOED_KEY = 'a1b2c3d4e5f60718293a4b5c6d7e8f90'

test('an upstream body that echoes the key never reaches the merged error message', async () => {
  const deepseekFetch = stubFetch(() => jsonResponse({ error: { message: 'boom' } }, 500))
  const serperFetch = stubFetch(() => jsonResponse({ message: `Unauthorized: invalid key ${ECHOED_KEY}` }, 401))
  const provider = new MergedSearchProvider(() => mergedOptions({ deepseekFetch, serperFetch }))

  await assert.rejects(provider.search(request(), SIGNAL), (error) => {
    assert.equal(error.message.includes(ECHOED_KEY), false, 'the tool-visible error must not carry the key')
    assert.match(error.message, /Serper API error \(HTTP 401\)/)
    return true
  })
})

test('an upstream body that echoes the key never reaches the degradation log', async () => {
  const lines = []
  const logger = { info: (line) => lines.push(line), warn: (line) => lines.push(line) }
  const deepseekFetch = stubFetch(() => jsonResponse(deepseekPayload(A_URLS)))
  const serperFetch = stubFetch(() => jsonResponse({ message: `Unauthorized: invalid key ${ECHOED_KEY}` }, 401))
  const provider = new MergedSearchProvider(
    () => mergedOptions({ deepseekFetch, serperFetch, overrides: { logLevel: 'summary' } }),
    logger,
  )

  const result = await provider.search(request(), SIGNAL)
  assert.match(result.content, /^Note: serper auth failed \(HTTP 401\), using deepseek\./)
  assert.equal(lines.join('\n').includes(ECHOED_KEY), false, 'the warn log must not carry the key')
})

// ── A credential update drops the cached degraded answer with the cooldown ─

test('a credentials update drops the cached degraded answer, so the fixed lane is retried', async () => {
  const { ctx, registered, listeners } = makeContext()
  const originalFetch = globalThis.fetch
  let serperMode = 'unauthorized'
  let serperCalls = 0
  globalThis.fetch = async (url) => {
    if (String(url).includes('api.deepseek.com')) return jsonResponse(deepseekPayload(A_URLS))
    serperCalls += 1
    return serperMode === 'ok' ? jsonResponse(serperPayload(B_URLS)) : jsonResponse({ message: 'bad key' }, 401)
  }
  try {
    apply(ctx, configRefs({ cacheMinutes: 5 }))
    const provider = registered[0]

    // DeepSeek answers, serper 401: a degraded answer is cached for one minute.
    const degraded = await provider.search(request(), SIGNAL)
    assert.match(degraded.content, /^Note: serper auth failed \(HTTP 401\), using deepseek\./)
    assert.equal(provider.cache.map.size, 1)
    assert.equal(serperCalls, 1)

    // The user saved a new key in the card: the event clears health *and* cache.
    serperMode = 'ok'
    listeners.get('credentials/reference-updated')('SERPER_API_KEY')
    assert.equal(provider.health.serper.until, 0)
    assert.equal(provider.cache.map.size, 0)

    const fixed = await provider.search(request(), SIGNAL)
    assert.equal(serperCalls, 2, 'the recovered lane is requested again immediately')
    assert.equal(fixed.content, undefined, 'no stale Note survives the fix')
    assert.equal(fixed.sources.length, 8)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('a lane muted by cooldown is retried once when every live lane then fails', async () => {
  // Real-log error shape (3 of 5 total errors): "[quota] skipped: … cooldown active"
  // plus a live-lane timeout. The muted lane would have answered (balance topped
  // up, or the 402 was transient) but was requested 0 times and the search failed.
  let deepseekAnswers = false
  let serperMode = 'ok'
  const deepseekFetch = stubFetch(() => (deepseekAnswers
    ? jsonResponse(deepseekPayload(A_URLS))
    : jsonResponse({ error: 'Insufficient Balance' }, 402)))
  const serperFetch = stubFetch((url, init) => (serperMode === 'ok' ? jsonResponse(serperPayload(B_URLS)) : hangingFetch()(url, init)))
  const provider = new MergedSearchProvider(() => mergedOptions({ deepseekFetch, serperFetch }))

  const first = await provider.search(request(), SIGNAL)
  assert.match(first.content, /^Note: deepseek quota exhausted \(HTTP 402\), using serper\./)
  assert.equal(provider.health.deepseek.cls, 'quota')

  // DeepSeek recovered but is still muted; serper now hangs.
  deepseekAnswers = true
  serperMode = 'hang'
  const second = await provider.search(request(), SIGNAL)
  assert.equal(deepseekFetch.calls.length, 2, 'the muted lane got its one retry')
  assert.equal(provider.health.deepseek.until, 0, 'answering clears the cooldown')
  assert.ok(second.sources.some((source) => source.url.startsWith('https://a')), 'the recovered lane contributes sources')
  assert.match(second.content, /^Note: serper timed out( after \d+ms)?, using deepseek\./)

  // When the retry fails too, the search still fails the way it always did.
  deepseekAnswers = false
  serperMode = 'ok'
  await provider.search(request(), SIGNAL)
  assert.equal(provider.health.deepseek.cls, 'quota')
  serperMode = 'hang'
  await assert.rejects(provider.search(request(), SIGNAL), /Merged search failed on all backends/)
  assert.equal(deepseekFetch.calls.length, 4, 'first, retry, re-cooled request, failed retry')
  assert.equal(provider.health.deepseek.cls, 'quota', 'the failed retry re-records the cooldown')
})
