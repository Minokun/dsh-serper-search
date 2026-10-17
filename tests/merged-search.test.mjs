/**
 * Unit tests for the v3 merged search provider.
 *
 * Run with: `node --test tests/`
 *
 * Network is never used: every backend receives a stub `fetchImpl`, so the
 * tests assert request bodies, retry/degrade behavior, and merge composition.
 */
import test from 'node:test'
import http from 'node:http'
import assert from 'node:assert/strict'

import {
  RATIO_PATTERNS,
  effectiveSerperLocale,
  mapDeepSeekSearchResponse,
  mapSerperResponse,
  mergeResults,
  mergeSources,
  normalizeSerperDate,
  normalizeUrl,
} from '../lib/merge.js'
import { DeepSeekSearchApiBackend, MergedSearchProvider, apply } from '../lib/index.js'

/** Build a DeepSeek Search API payload for the given URLs. */
function deepseekPayload(urls) {
  return {
    results: urls.map((url, index) => ({
      title: `A${index}`,
      url,
      snippet: `a-snippet-${index}`,
      summary: `summary-${index}`,
      date: '2026-01-02T00:00:00+00:00',
      authority: 3,
      rerank_score: 2.2,
    })),
  }
}

/** Build a serper.dev payload for the given URLs. */
function serperPayload(urls, answerBox) {
  return {
    ...(answerBox === undefined ? {} : { answerBox }),
    organic: urls.map((url, index) => ({
      title: `B${index}`,
      link: url,
      snippet: `b-snippet-${index}`,
      date: '2026年1月2日',
      position: index + 1,
    })),
  }
}

/** Build a JSON Response. */
function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json' } })
}

/** Create a stub fetch that records every call. */
function stubFetch(handler) {
  const calls = []
  const impl = async (url, init) => {
    calls.push({ url, init, body: JSON.parse(init.body) })
    return await handler(url, init, calls.length)
  }
  impl.calls = calls
  return impl
}

/** A fetch stub that never resolves until aborted. */
function hangingFetch() {
  return (url, init) => new Promise((resolve, reject) => {
    const onAbort = () => reject(new DOMException('aborted', 'AbortError'))
    if (init.signal?.aborted === true) onAbort()
    else init.signal?.addEventListener('abort', onAbort, { once: true })
  })
}

/** Options for a merged provider whose backend behavior each test controls. */
function mergedOptions({ deepseekFetch, serperFetch, overrides = {} } = {}) {
  return {
    deepseekEnabled: true,
    primary: 'deepseek',
    ratio: 2,
    logLevel: 'off',
    deepseek: {
      apiKey: 'deepseek-test-key',
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

const A_URLS = Array.from({ length: 8 }, (_, index) => `https://a.example/${index}`)
const B_URLS = Array.from({ length: 8 }, (_, index) => `https://b.example/${index}`)

/** Composition of a merged source list by host. */
function composition(sources) {
  const counts = { a: 0, b: 0 }
  for (const source of sources) {
    const host = new URL(source.url).hostname
    if (host.startsWith('a.')) counts.a += 1
    else if (host.startsWith('b.')) counts.b += 1
  }
  return counts
}

test('default 2:1 interleave truncates to maxResults and keeps the documented order', () => {
  const merged = mergeSources(
    deepseekPayload(A_URLS).results.map((item) => ({ url: item.url, title: item.title })),
    serperPayload(B_URLS).organic.map((item) => ({ url: item.link, title: item.title })),
    { ratio: 2, maxResults: 8 },
  )
  assert.equal(merged.truncated, false)
  assert.equal(merged.sources.length, 8)
  assert.deepEqual(merged.sources.map((source) => new URL(source.url).hostname[0]), ['a', 'a', 'b', 'a', 'a', 'b', 'a', 'a'])
})

test('all five ratio patterns produce the documented 8-slot composition', () => {
  const expected = { 4: [7, 1], 3: [6, 2], 2: [6, 2], 1.5: [5, 3], 1: [4, 4] }
  for (const [ratio, [a, b]] of Object.entries(expected)) {
    assert.ok(RATIO_PATTERNS[ratio], `pattern for ratio ${ratio}`)
    const merged = mergeSources(
      A_URLS.map((url) => ({ url })),
      B_URLS.map((url) => ({ url })),
      { ratio: Number(ratio), maxResults: 8 },
    )
    assert.equal(merged.sources.length, 8, `ratio ${ratio} length`)
    assert.deepEqual(composition(merged.sources), { a, b }, `ratio ${ratio} composition`)
    assert.equal(merged.truncated, false)
  }
})

test('primary: serper swaps which backend leads the interleave', () => {
  const merged = mergeResults(
    { sources: B_URLS.map((url) => ({ url })) },
    { sources: A_URLS.map((url) => ({ url })) },
    { ratio: 2, maxResults: 8 },
  )
  assert.deepEqual(composition(merged.sources), { a: 2, b: 6 })
  assert.equal(merged.sources[0].url.startsWith('https://b.example/'), true)
})

test('an exhausted primary is filled by the secondary without gaps', () => {
  const merged = mergeSources(
    A_URLS.slice(0, 3).map((url) => ({ url })),
    B_URLS.map((url) => ({ url })),
    { ratio: 2, maxResults: 8 },
  )
  assert.equal(merged.sources.length, 8)
  assert.deepEqual(composition(merged.sources), { a: 3, b: 5 })
})

test('serper timeout degrades to deepseek-only without throwing', async () => {
  const deepseekFetch = stubFetch(() => jsonResponse(deepseekPayload(A_URLS)))
  const provider = new MergedSearchProvider(() => mergedOptions({
    deepseekFetch,
    serperFetch: hangingFetch(),
    overrides: { serper: { ...mergedOptions().serper, timeoutMs: 30, fetchImpl: hangingFetch() } },
  }))
  const result = await provider.search({ query: 'timeout test', maxResults: 8 }, new AbortController().signal)
  assert.equal(result.sources.length, 8)
  assert.deepEqual(composition(result.sources), { a: 8, b: 0 })
  assert.equal(result.truncated, false)
})

test('deepseek 429 is retried once and then merged with serper', async () => {
  let attempts = 0
  const deepseekFetch = stubFetch(() => {
    attempts += 1
    return attempts === 1 ? jsonResponse({ error: { message: 'rate limited' } }, 429) : jsonResponse(deepseekPayload(A_URLS))
  })
  const serperFetch = stubFetch(() => jsonResponse(serperPayload(B_URLS)))
  const base = mergedOptions({ deepseekFetch, serperFetch })
  const provider = new MergedSearchProvider(() => ({
    ...base,
    deepseek: { ...base.deepseek, maxRetries: 1, timeoutMs: 5000 },
  }))
  const result = await provider.search({ query: 'retry test', maxResults: 8 }, new AbortController().signal)
  assert.equal(attempts, 2)
  assert.deepEqual(composition(result.sources), { a: 6, b: 2 })
})

test('deepseek failure degrades to serper-only without throwing', async () => {
  const deepseekFetch = stubFetch(() => jsonResponse({ error: { message: 'boom' } }, 500))
  const serperFetch = stubFetch(() => jsonResponse(serperPayload(B_URLS)))
  const provider = new MergedSearchProvider(() => mergedOptions({ deepseekFetch, serperFetch }))
  const result = await provider.search({ query: 'degrade test', maxResults: 8 }, new AbortController().signal)
  assert.deepEqual(composition(result.sources), { a: 0, b: 8 })
})

test('both backends failing throws WEB_PROVIDER_ERROR naming both causes', async () => {
  const deepseekFetch = stubFetch(() => jsonResponse({ error: { message: 'deepseek boom' } }, 500))
  const serperFetch = stubFetch(() => jsonResponse({ message: 'serper boom' }, 500))
  const provider = new MergedSearchProvider(() => mergedOptions({ deepseekFetch, serperFetch }))
  await assert.rejects(
    () => provider.search({ query: 'double failure', maxResults: 8 }, new AbortController().signal),
    (error) => {
      assert.equal(error.code, 'WEB_PROVIDER_ERROR')
      assert.match(error.message, /DeepSeek Search API/)
      assert.match(error.message, /Serper/)
      return true
    },
  )
})

test('native:false disables the deepseek half entirely', async () => {
  const deepseekFetch = stubFetch(() => jsonResponse(deepseekPayload(A_URLS)))
  const serperFetch = stubFetch(() => jsonResponse(serperPayload(B_URLS)))
  const provider = new MergedSearchProvider(() => mergedOptions({
    deepseekFetch,
    serperFetch,
    overrides: { deepseekEnabled: false },
  }))
  const result = await provider.search({ query: 'serper only', maxResults: 8 }, new AbortController().signal)
  assert.equal(deepseekFetch.calls.length, 0)
  assert.deepEqual(composition(result.sources), { a: 0, b: 8 })
})

test('normalizeUrl strips tracking parameters and fragments but keeps business parameters', () => {
  assert.equal(normalizeUrl('https://x.example/p#section'), normalizeUrl('https://x.example/p'))
  assert.equal(
    normalizeUrl('https://x.example/p?utm_source=feed&spm=1.2'),
    normalizeUrl('https://x.example/p'),
  )
  assert.equal(
    normalizeUrl('https://baike.baidu.com/item/A?fromtitle=a&fromid=1'),
    normalizeUrl('https://baike.baidu.com/item/A?bst=2'),
  )
  assert.notEqual(normalizeUrl('https://x.example/book?chapter=1'), normalizeUrl('https://x.example/book?chapter=2'))
  assert.notEqual(normalizeUrl('https://x.example/list?from=10'), normalizeUrl('https://x.example/list?from=20'))
  assert.notEqual(normalizeUrl('https://x.example/?channel=tech'), normalizeUrl('https://x.example/?channel=ai'))
  assert.equal(normalizeUrl('not a url'), 'not a url')
  assert.equal(normalizeUrl(undefined), '')
})

test('mergeSources dedupes across backends by normalized URL', () => {
  const merged = mergeSources(
    [{ url: 'https://x.example/article#1' }, { url: 'https://x.example/article?utm_source=a' }],
    [{ url: 'https://x.example/article' }, { url: 'https://y.example/other' }],
    { ratio: 2, maxResults: 8 },
  )
  assert.equal(merged.sources.length, 2)
})

test('summary is clipped into snippet; summaryMaxChars 0 keeps the short snippet', () => {
  const longSummary = 'x'.repeat(1800)
  const payload = {
    results: [{
      title: 'T',
      url: 'https://a.example/1',
      snippet: 'short snippet',
      summary: longSummary,
      date: '2026-04-26T16:00:00+00:00',
      authority: 0,
    }, {
      title: 'U',
      url: 'https://a.example/2',
      snippet: 'snippet two',
      summary: longSummary,
      date: null,
      authority: -1,
    }],
  }
  const clipped = mapDeepSeekSearchResponse(payload, { summaryMaxChars: 600, minAuthority: -1 })
  assert.equal(clipped.sources[0].snippet.length, 600)
  assert.equal(clipped.sources[0].snippet.endsWith('…'), true)
  assert.equal(clipped.sources[0].publishedAt, '2026-04-26T16:00:00+00:00')

  const raw = mapDeepSeekSearchResponse(payload, { summaryMaxChars: 0 })
  assert.equal(raw.sources[0].snippet, 'short snippet')

  const filtered = mapDeepSeekSearchResponse(payload, { summaryMaxChars: 600, minAuthority: 2 })
  assert.equal(filtered.sources.length, 1)
  assert.equal(filtered.sources[0].url, 'https://a.example/2')
  assert.equal(filtered.sources[0].publishedAt, undefined)
})

test('serper mapping normalizes Chinese dates and surfaces the answer box', () => {
  const mapped = mapSerperResponse(serperPayload(B_URLS.slice(0, 2), { answer: 'direct answer' }))
  assert.equal(mapped.content, 'direct answer')
  assert.equal(mapped.sources[0].publishedAt, '2026-01-02')
  assert.equal(normalizeSerperDate('2026年8月13日'), '2026-08-13')
  assert.equal(normalizeSerperDate('2026-08-13'), '2026-08-13')
  assert.equal(normalizeSerperDate('yesterday-ish'), 'yesterday-ish')
  assert.equal(normalizeSerperDate(undefined), undefined)
})

test('autoLocale routes English queries to us/en and keeps Chinese queries on cn', async () => {
  assert.deepEqual(effectiveSerperLocale('SQLite WAL mode concurrency', { gl: 'cn', hl: 'zh-cn' }), { gl: 'us', hl: 'en' })
  assert.deepEqual(effectiveSerperLocale('DeepSeek 发布 时间', { gl: 'cn', hl: 'zh-cn' }), { gl: 'cn', hl: 'zh-cn' })
  assert.deepEqual(effectiveSerperLocale('english query', { gl: 'cn', hl: 'zh-cn', autoLocale: false }), { gl: 'cn', hl: 'zh-cn' })
  assert.deepEqual(effectiveSerperLocale('english query', { gl: 'us', hl: 'en' }), { gl: 'us', hl: 'en' })

  const deepseekFetch = stubFetch(() => jsonResponse(deepseekPayload(A_URLS)))
  const serperFetch = stubFetch(() => jsonResponse(serperPayload(B_URLS, { snippet: 'box snippet' })))
  const provider = new MergedSearchProvider(() => mergedOptions({ deepseekFetch, serperFetch }))
  const result = await provider.search({ query: 'SQLite WAL mode concurrency', maxResults: 8 }, new AbortController().signal)
  const serperCall = serperFetch.calls[0]
  assert.equal(serperCall.body.gl, 'us')
  assert.equal(serperCall.body.hl, 'en')
  assert.equal(serperCall.body.num, 10)
  assert.equal(deepseekFetch.calls[0].body.count, 10)
  assert.equal(deepseekFetch.calls[0].body.need_content, false)
  assert.equal(result.content, 'box snippet')
  assert.equal(result.sources.length, 8)
})

test('caller abort rejects with WEB_ABORTED', async () => {
  const controller = new AbortController()
  const provider = new MergedSearchProvider(() => mergedOptions({
    deepseekFetch: hangingFetch(),
    serperFetch: hangingFetch(),
  }))
  const pending = provider.search({ query: 'abort test', maxResults: 8 }, controller.signal)
  controller.abort()
  await assert.rejects(pending, (error) => {
    assert.equal(error.code, 'WEB_ABORTED')
    return true
  })
})

// ── adversarial additions (v3 verifier findings) ────────────────────────────

test('abort during the retry backoff rejects with WEB_ABORTED after one attempt', async () => {
  let attempts = 0
  const always429 = stubFetch(() => {
    attempts += 1
    return jsonResponse({ error: { message: 'rate limited' } }, 429)
  })
  const backend = new DeepSeekSearchApiBackend(() => ({
    apiKey: 'k',
    baseURL: 'https://api.deepseek.com/v1/tools',
    count: 10,
    timeoutMs: 5000,
    maxRetries: 2,
    fetchImpl: always429,
  }))
  const controller = new AbortController()
  const pending = backend.search({ query: 'abort backoff', maxResults: 8 }, controller.signal)
  setTimeout(() => controller.abort(), 100)
  await assert.rejects(pending, (error) => {
    assert.equal(error.code, 'WEB_ABORTED')
    return true
  })
  assert.equal(attempts, 1)
})

test('abort while the second backend is in flight rejects with WEB_ABORTED', async () => {
  const controller = new AbortController()
  const deepseekFetch = stubFetch(() => jsonResponse(deepseekPayload(A_URLS)))
  const provider = new MergedSearchProvider(() => mergedOptions({
    deepseekFetch,
    serperFetch: hangingFetch(),
  }))
  const pending = provider.search({ query: 'abort second backend', maxResults: 8 }, controller.signal)
  setTimeout(() => controller.abort(), 30)
  await assert.rejects(pending, (error) => {
    assert.equal(error.code, 'WEB_ABORTED')
    return true
  })
})

test('both backends aborting rejects WEB_ABORTED, not WEB_PROVIDER_ERROR', async () => {
  const controller = new AbortController()
  const provider = new MergedSearchProvider(() => mergedOptions({
    deepseekFetch: hangingFetch(),
    serperFetch: hangingFetch(),
  }))
  const pending = provider.search({ query: 'double abort', maxResults: 8 }, controller.signal)
  setTimeout(() => controller.abort(), 20)
  await assert.rejects(pending, (error) => {
    assert.equal(error.code, 'WEB_ABORTED')
    return true
  })
})

test('a backend timeout is not retried (one request, no retryable path)', async () => {
  let attempts = 0
  const hanging = () => {
    attempts += 1
    return new Promise((resolve, reject) => {
      const onAbort = () => reject(new DOMException('aborted', 'AbortError'))
      // The gate's signal aborts the request after timeoutMs.
    })
  }
  const backend = new DeepSeekSearchApiBackend(() => ({
    apiKey: 'k',
    baseURL: 'https://api.deepseek.com/v1/tools',
    count: 10,
    timeoutMs: 40,
    maxRetries: 2,
    fetchImpl: (url, init) => {
      attempts += 1
      return new Promise((resolve, reject) => {
        init.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true })
      })
    },
  }))
  await assert.rejects(backend.search({ query: 'timeout no retry', maxResults: 8 }, new AbortController().signal), (error) => {
    assert.equal(error.code, 'WEB_PROVIDER_ERROR')
    assert.match(error.message, /timed out/i)
    return true
  })
  assert.equal(attempts, 1)
})

test('5xx is retried and a later success wins', async () => {
  let attempts = 0
  const flaky = stubFetch(() => {
    attempts += 1
    return attempts === 1 ? jsonResponse({ error: { message: 'overloaded' } }, 503) : jsonResponse(deepseekPayload(A_URLS))
  })
  const backend = new DeepSeekSearchApiBackend(() => ({
    apiKey: 'k',
    baseURL: 'https://api.deepseek.com/v1/tools',
    count: 10,
    timeoutMs: 2000,
    maxRetries: 1,
    fetchImpl: flaky,
  }))
  const result = await backend.search({ query: '5xx retry', maxResults: 8 }, new AbortController().signal)
  assert.equal(attempts, 2)
  assert.ok(result.sources.length > 0)
})

test('maxRetries: 2 allows exactly three attempts before failing', async () => {
  let attempts = 0
  const always429 = stubFetch(() => {
    attempts += 1
    return jsonResponse({ error: { message: 'rate limited' } }, 429)
  })
  const backend = new DeepSeekSearchApiBackend(() => ({
    apiKey: 'k',
    baseURL: 'https://api.deepseek.com/v1/tools',
    count: 10,
    timeoutMs: 8000,
    maxRetries: 2,
    fetchImpl: always429,
  }))
  await assert.rejects(backend.search({ query: 'retry exhaustion', maxResults: 8 }, new AbortController().signal))
  assert.equal(attempts, 3)
})

test('the request gate also covers reading a stalled response body', async () => {
  const server = http.createServer((request, response) => {
    response.writeHead(200, { 'content-type': 'application/json' })
    response.write('{"results":[')
    // Deliberately never end the body.
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address()
  try {
    const backend = new DeepSeekSearchApiBackend(() => ({
      apiKey: 'k',
      baseURL: `http://127.0.0.1:${port}`,
      count: 10,
      timeoutMs: 150,
      maxRetries: 0,
    }))
    const started = Date.now()
    await assert.rejects(
      backend.search({ query: 'stalled body', maxResults: 8 }, new AbortController().signal),
      (error) => {
        assert.equal(error.code, 'WEB_PROVIDER_ERROR')
        assert.match(error.message, /timed out|budget|unprocessable/i)
        return true
      },
    )
    assert.ok(Date.now() - started < 3000, 'stalled body should be bounded by the request timeout')
  } finally {
    server.closeAllConnections?.()
    await new Promise((resolve) => server.close(resolve))
  }
})

test('apply() registers the merged provider and runs a full search through fake ctx', async () => {
  const registered = []
  const logger = { info() {}, warn() {} }
  const ctx = {
    logger,
    get: () => undefined,
    web: { registerSearchProvider: (provider) => registered.push(provider) },
  }
  const values = {
    apiKey: 'serper-key',
    apiKeyEnv: 'SERPER_API_KEY',
    baseURL: 'https://google.serper.dev',
    gl: 'cn',
    hl: 'zh-cn',
    autoLocale: true,
    num: 10,
    serperTimeoutMs: 4500,
    deepseekApiKey: 'deepseek-key',
    deepseekApiKeyEnv: 'DEEPSEEK_API_KEY',
    deepseekBaseURL: 'https://api.deepseek.com/v1/tools',
    deepseekCount: 10,
    deepseekTimeoutMs: 4500,
    summaryMaxChars: 600,
    primary: 'deepseek',
    ratio: 2,
    minAuthority: -1,
    maxRetries: 1,
    logLevel: 'off',
    native: true,
    nativeApiKey: '',
    nativeApiKeyEnv: 'DEEPSEEK_API_KEY',
    nativeBaseURL: '',
    nativeModel: 'deepseek-v4-flash',
    nativeMaxUses: 5,
  }
  const config = new Proxy({}, { get: (_target, key) => ({ get: () => values[key] }) })
  const originalFetch = globalThis.fetch
  const calls = []
  globalThis.fetch = async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body) })
    return String(url).includes('api.deepseek.com')
      ? jsonResponse(deepseekPayload(A_URLS))
      : jsonResponse(serperPayload(B_URLS))
  }
  try {
    apply(ctx, config)
    assert.equal(registered.length, 1)
    const provider = registered[0]
    assert.equal(provider.id, 'serper')
    assert.equal(provider.available(), true)
    const result = await provider.search({ query: '测试 apply', maxResults: 8 }, new AbortController().signal)
    assert.equal(result.sources.length, 8)
    assert.equal(result.truncated, false)
    assert.deepEqual(composition(result.sources), { a: 6, b: 2 })
    assert.equal(calls.length, 2)
    assert.equal(calls.find((call) => call.url.includes('deepseek')).body.need_content, false)
    assert.equal(calls.find((call) => call.url.includes('serper')).body.gl, 'cn')
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('malformed payloads are tolerated by both mappers', () => {
  assert.deepEqual(mapDeepSeekSearchResponse({ results: 'nope' }), { sources: [], truncated: false })
  assert.deepEqual(mapDeepSeekSearchResponse({ results: [null, 42, {}, { url: '' }] }), { sources: [], truncated: false })
  assert.deepEqual(mapDeepSeekSearchResponse({ results: [{ url: 'https://a.example/1', summary: 5, snippet: 7, authority: 'high' }] }), {
    sources: [{ url: 'https://a.example/1' }],
    truncated: false,
  })
  assert.deepEqual(mapSerperResponse({ organic: 'nope', answerBox: { answer: 1, snippet: '' } }), { sources: [], truncated: false })
  assert.deepEqual(mapSerperResponse({ organic: [{ link: '', title: 'x' }, { link: 'https://b.example/1', date: 123 }] }), {
    sources: [{ url: 'https://b.example/1' }],
    truncated: false,
  })
})

test('mergeResults keeps a secondary answer when the primary content is empty', () => {
  const merged = mergeResults({ sources: [], content: '' }, { sources: [], content: 'usable answer' }, { ratio: 2, maxResults: 8 })
  assert.equal(merged.content, 'usable answer')
})

test('maxResults: 3 and an omitted cap are honored', () => {
  const small = mergeSources(A_URLS.map((url) => ({ url })), B_URLS.map((url) => ({ url })), { ratio: 2, maxResults: 3 })
  assert.equal(small.sources.length, 3)
  const uncapped = mergeSources(A_URLS.map((url) => ({ url })), B_URLS.map((url) => ({ url })), { ratio: 2 })
  assert.equal(uncapped.sources.length, 16)
  assert.equal(uncapped.truncated, false)
})
