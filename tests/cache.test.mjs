/**
 * Unit tests for the v0.4.0 result cache (P0-2, plan §4).
 *
 * Run with: `npm test`
 *
 * Both backends get stub `fetchImpl` functions, so "a cache hit makes no
 * request" is asserted by counting fetches. TTL/LRU boundaries are checked on
 * `ResultCache` directly (its `now` parameter is injectable) and through the
 * provider with a stubbed `Date.now`.
 */
import test from 'node:test'
import assert from 'node:assert/strict'

import { MergedSearchProvider } from '../lib/index.js'
import { ResultCache, cacheKey } from '../lib/cache.js'

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

/** serper.dev payload. */
function serperPayload(urls) {
  return {
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

/** Provider options with per-lane transports and the real cache default. */
function mergedOptions({ deepseekFetch, serperFetch, overrides = {} } = {}) {
  return {
    deepseekEnabled: true,
    primary: 'deepseek',
    ratio: 2,
    maxPerHost: 2,
    demoteSocial: true,
    logLevel: 'off',
    cacheMinutes: 5,
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
function request(query = 'cache test') {
  return { query, maxResults: 8 }
}

/** Logger that records every line the provider reports. */
function makeLogger() {
  const lines = []
  return {
    lines,
    info(line) {
      lines.push(line)
    },
    warn(line) {
      lines.push(line)
    },
  }
}

/** Wait until `predicate` holds (used to abort a search mid-flight). */
async function waitFor(predicate) {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  throw new Error('condition not met')
}

/** A result with one source per call, used by the direct ResultCache tests. */
function oneSourceResult(title) {
  return { sources: [{ url: `https://example.com/${title}`, title }], truncated: false }
}

// ── §4 acceptance: same query twice → zero requests on the second search ───

test('a repeated query is served from the cache with cache=hit and no requests', async () => {
  const logger = makeLogger()
  const deepseekFetch = stubFetch(() => jsonResponse(deepseekPayload(A_URLS)))
  const serperFetch = stubFetch(() => jsonResponse(serperPayload(B_URLS)))
  const provider = new MergedSearchProvider(
    () => mergedOptions({ deepseekFetch, serperFetch, overrides: { logLevel: 'summary' } }),
    logger,
  )
  const query = request('repeated query')

  const first = await provider.search(query, SIGNAL)
  assert.equal(deepseekFetch.calls.length, 1)
  assert.equal(serperFetch.calls.length, 1)
  assert.equal(first.sources.length, 8)
  assert.match(logger.lines.join('\n'), /cache=store/)

  const second = await provider.search(query, SIGNAL)
  assert.equal(deepseekFetch.calls.length, 1, 'the DeepSeek lane must not be requested again')
  assert.equal(serperFetch.calls.length, 1, 'the serper lane must not be requested again')
  assert.deepEqual(second.sources, first.sources)
  assert.equal(second.truncated, false)
  assert.match(logger.lines.join('\n'), /cache=hit len=8/)
})

test('whitespace is normalized before hashing the query', async () => {
  const deepseekFetch = stubFetch(() => jsonResponse(deepseekPayload(A_URLS)))
  const serperFetch = stubFetch(() => jsonResponse(serperPayload(B_URLS)))
  const provider = new MergedSearchProvider(() => mergedOptions({ deepseekFetch, serperFetch }))

  await provider.search({ query: '  spaced   query  ', maxResults: 8 }, SIGNAL)
  await provider.search({ query: 'spaced query', maxResults: 8 }, SIGNAL)

  assert.deepEqual([deepseekFetch.calls.length, serperFetch.calls.length], [1, 1])
})

test('maxResults is part of the key: 8 and 12 never share an entry', async () => {
  const deepseekFetch = stubFetch(() => jsonResponse(deepseekPayload(A_URLS)))
  const serperFetch = stubFetch(() => jsonResponse(serperPayload(B_URLS)))
  const provider = new MergedSearchProvider(() => mergedOptions({ deepseekFetch, serperFetch }))

  await provider.search({ query: 'cap split', maxResults: 8 }, SIGNAL)
  await provider.search({ query: 'cap split', maxResults: 12 }, SIGNAL)
  assert.deepEqual([deepseekFetch.calls.length, serperFetch.calls.length], [2, 2])

  // The original 8-cap entry is still independent and still fresh.
  await provider.search({ query: 'cap split', maxResults: 8 }, SIGNAL)
  assert.deepEqual([deepseekFetch.calls.length, serperFetch.calls.length], [2, 2])
})

// ── §4 acceptance: every key component changes the key ─────────────────────

/** One mutation per documented key component (the `cap` case is tested above). */
const KEY_MUTATIONS = [
  ['primary', (options) => ({ ...options, primary: 'serper' })],
  ['ratio', (options) => ({ ...options, ratio: 1 })],
  ['maxPerHost', (options) => ({ ...options, maxPerHost: 3 })],
  ['demoteSocial', (options) => ({ ...options, demoteSocial: false })],
  ['serper.baseURL', (options) => ({ ...options, serper: { ...options.serper, baseURL: 'https://proxy.example' } })],
  ['deepseek.baseURL', (options) => ({ ...options, deepseek: { ...options.deepseek, baseURL: 'https://proxy.example' } })],
  ['gl', (options) => ({ ...options, serper: { ...options.serper, gl: 'us' } })],
  ['hl', (options) => ({ ...options, serper: { ...options.serper, hl: 'en' } })],
  ['autoLocale', (options) => ({ ...options, serper: { ...options.serper, autoLocale: false } })],
  ['num', (options) => ({ ...options, serper: { ...options.serper, num: 20 } })],
  ['native', (options) => ({ ...options, deepseekEnabled: false })],
  ['deepseek.count', (options) => ({ ...options, deepseek: { ...options.deepseek, count: 5 } })],
  ['summaryMaxChars', (options) => ({ ...options, deepseek: { ...options.deepseek, summaryMaxChars: 300 } })],
  ['minAuthority', (options) => ({ ...options, deepseek: { ...options.deepseek, minAuthority: 2 } })],
]

for (const [label, mutate] of KEY_MUTATIONS) {
  test(`key component ${label}: a change forces a refetch and keeps both entries`, async () => {
    const deepseekFetch = stubFetch(() => jsonResponse(deepseekPayload(A_URLS)))
    const serperFetch = stubFetch(() => jsonResponse(serperPayload(B_URLS)))
    const original = mergedOptions({ deepseekFetch, serperFetch })
    let current = original
    const provider = new MergedSearchProvider(() => current)
    const query = request(`key ${label}`)
    const total = () => deepseekFetch.calls.length + serperFetch.calls.length

    await provider.search(query, SIGNAL)
    assert.equal(total(), 2)
    assert.equal(provider.cache.map.size, 1)

    current = mutate(original)
    await provider.search(query, SIGNAL)
    assert.ok(total() > 2, `changing ${label} must miss the cache`)
    assert.equal(provider.cache.map.size, 2, `changing ${label} must create a second key`)

    // Reverting is a hit on the original entry: no request, nothing evicted.
    const afterMutation = total()
    current = original
    await provider.search(query, SIGNAL)
    assert.equal(total(), afterMutation)
  })
}

// ── §4 acceptance: TTL expiry ──────────────────────────────────────────────

test('a 5-minute entry expires and the next search refetches', async () => {
  const realNow = Date.now
  let clock = 1_700_000_000_000
  Date.now = () => clock
  try {
    const deepseekFetch = stubFetch(() => jsonResponse(deepseekPayload(A_URLS)))
    const serperFetch = stubFetch(() => jsonResponse(serperPayload(B_URLS)))
    const provider = new MergedSearchProvider(() => mergedOptions({ deepseekFetch, serperFetch }))
    const query = request('ttl')
    const total = () => deepseekFetch.calls.length + serperFetch.calls.length

    await provider.search(query, SIGNAL)
    assert.equal(total(), 2)
    assert.equal([...provider.cache.map.values()][0].expiresAt - clock, 5 * 60_000)

    clock += 5 * 60_000 - 1
    await provider.search(query, SIGNAL)
    assert.equal(total(), 2, 'still fresh one millisecond before the TTL')

    clock += 2
    await provider.search(query, SIGNAL)
    assert.equal(total(), 4, 'expired: both lanes are requested again')
  } finally {
    Date.now = realNow
  }
})

test('the ResultCache itself treats expiry as a miss and drops the entry', () => {
  const cache = new ResultCache()
  cache.set('k', oneSourceResult('ttl'), 1_000, 0)

  assert.equal(cache.get('k', 999).sources[0].title, 'ttl')
  assert.equal(cache.get('k', 1_000), undefined)
  assert.equal(cache.map.size, 0)
})

// ── §4 acceptance: degraded results get the short TTL ──────────────────────

test('a degraded result is cached for one minute, not five, and refetches after that', async () => {
  const realNow = Date.now
  let clock = 1_700_000_000_000
  Date.now = () => clock
  try {
    const deepseekFetch = stubFetch(() => jsonResponse(deepseekPayload(A_URLS)))
    const serperFetch = stubFetch(() => jsonResponse({ message: 'bad key' }, 401))
    const provider = new MergedSearchProvider(() => mergedOptions({ deepseekFetch, serperFetch }))
    const query = request('degraded ttl')

    const first = await provider.search(query, SIGNAL)
    assert.match(first.content, /^Note: serper auth failed \(HTTP 401\), using deepseek\./)
    const entry = [...provider.cache.map.values()][0]
    assert.equal(entry.expiresAt - clock, 60_000, 'TTL is max(60s, cacheMinutes/5)')

    clock += 59_000
    const cached = await provider.search(query, SIGNAL)
    assert.equal(deepseekFetch.calls.length, 1, 'a hit makes no request')
    assert.match(cached.content, /^Note: serper auth failed \(HTTP 401\)/, 'the Note is part of the cached result')

    clock += 2_000
    await provider.search(query, SIGNAL)
    assert.equal(deepseekFetch.calls.length, 2, 'the short TTL expired and the live lane was used again')
    assert.equal(serperFetch.calls.length, 1, 'serper is still cooling from the 401, so it was not retried')
  } finally {
    Date.now = realNow
  }
})

// ── §4 acceptance: aborts / failures are never stored ──────────────────────

test('an aborted search is never cached', async () => {
  let requested = false
  const serperFetch = (url, init) => {
    requested = true
    return hangingFetch()(url, init)
  }
  const provider = new MergedSearchProvider(() => mergedOptions({
    serperFetch,
    overrides: { deepseekEnabled: false },
  }))
  const controller = new AbortController()

  const pending = provider.search(request('abort cache'), controller.signal)
  await waitFor(() => requested)
  controller.abort()

  await assert.rejects(pending, (error) => error.code === 'WEB_ABORTED')
  assert.equal(provider.cache.map.size, 0)
})

test('a double failure and an empty 200 are not cached', async () => {
  const failingDeepseek = stubFetch(() => jsonResponse({ error: { message: 'no' } }, 500))
  const failingSerper = stubFetch(() => jsonResponse({ message: 'bad key' }, 401))
  const failing = new MergedSearchProvider(() => mergedOptions({
    deepseekFetch: failingDeepseek,
    serperFetch: failingSerper,
  }))

  await assert.rejects(failing.search(request('failure cache'), SIGNAL))
  assert.equal(failing.cache.map.size, 0)

  const emptyDeepseek = stubFetch(() => jsonResponse(deepseekPayload([])))
  const emptySerper = stubFetch(() => jsonResponse(serperPayload([])))
  const empty = new MergedSearchProvider(() => mergedOptions({
    deepseekFetch: emptyDeepseek,
    serperFetch: emptySerper,
  }))
  const query = request('empty cache')

  await empty.search(query, SIGNAL)
  await empty.search(query, SIGNAL)

  assert.equal(empty.cache.map.size, 0)
  assert.deepEqual([emptyDeepseek.calls.length, emptySerper.calls.length], [2, 2])
})

// ── §4 acceptance: cacheMinutes=0 turns the cache off ──────────────────────

test('cacheMinutes=0 always misses, never stores, and logs nothing about the cache', async () => {
  const logger = makeLogger()
  const deepseekFetch = stubFetch(() => jsonResponse(deepseekPayload(A_URLS)))
  const serperFetch = stubFetch(() => jsonResponse(serperPayload(B_URLS)))
  const provider = new MergedSearchProvider(
    () => mergedOptions({ deepseekFetch, serperFetch, overrides: { cacheMinutes: 0, logLevel: 'summary' } }),
    logger,
  )
  const query = request('cache off')

  await provider.search(query, SIGNAL)
  await provider.search(query, SIGNAL)

  assert.deepEqual([deepseekFetch.calls.length, serperFetch.calls.length], [2, 2])
  assert.equal(provider.cache.map.size, 0)
  assert.doesNotMatch(logger.lines.join('\n'), /cache=/)
})

// ── LRU bound ──────────────────────────────────────────────────────────────

test('the cache keeps 50 entries and evicts the least recently used one', () => {
  const cache = new ResultCache()
  assert.equal(cache.max, 50)

  for (let index = 0; index < 50; index += 1) {
    cache.set(`k${index}`, oneSourceResult(`t${index}`), 60_000, 0)
  }
  assert.equal(cache.map.size, 50)

  // Touch k0 so k1 becomes the least recently used entry.
  assert.equal(cache.get('k0', 1).sources[0].title, 't0')
  cache.set('k50', oneSourceResult('t50'), 60_000, 2)

  assert.equal(cache.map.size, 50)
  assert.equal(cache.get('k1', 3), undefined, 'the least recently used entry was evicted')
  assert.equal(cache.get('k0', 3).sources[0].title, 't0')
  assert.equal(cache.get('k50', 3).sources[0].title, 't50')
})

test('an intervention clears cached results, so the fixed lane is retried at once', async () => {
  const logger = makeLogger()
  const deepseekFetch = stubFetch(() => jsonResponse(deepseekPayload(A_URLS)))
  let serperMode = 'unauthorized'
  const serperFetch = stubFetch(() => (serperMode === 'ok'
    ? jsonResponse(serperPayload(B_URLS))
    : jsonResponse({ message: 'bad key' }, 401)))
  const provider = new MergedSearchProvider(
    () => mergedOptions({ deepseekFetch, serperFetch, overrides: { logLevel: 'summary' } }),
    logger,
  )
  const query = request('intervention')

  // A degraded answer is cached for one minute, with its Note.
  const degraded = await provider.search(query, SIGNAL)
  assert.match(degraded.content, /^Note: serper auth failed \(HTTP 401\)/)
  assert.equal(provider.cache.map.size, 1)
  assert.equal(serperFetch.calls.length, 1)

  // The user fixed the key: the credential event clears the cooldown and the
  // cached degraded answer, so the next search uses both lanes immediately.
  serperMode = 'ok'
  provider.clearHealth('serper')
  provider.clearCachedResults()
  const fixed = await provider.search(query, SIGNAL)
  assert.equal(serperFetch.calls.length, 2, 'the recovered lane must be retried')
  assert.equal(fixed.content, undefined, 'the stale degradation Note must be gone')
  assert.equal(fixed.sources.length, 8)
})

test('refreshCooldowns drops cached results when a credential fingerprint change clears a lane', () => {
  const deepseekFetch = stubFetch(() => jsonResponse(deepseekPayload(A_URLS)))
  const serperFetch = stubFetch(() => jsonResponse(serperPayload(B_URLS)))
  const options = mergedOptions({ deepseekFetch, serperFetch })
  const provider = new MergedSearchProvider(() => options)

  provider.health.serper = { until: Date.now() + 60_000, cls: 'auth', detail: '', fingerprint: 'stale-fingerprint' }
  provider.cache.set('cached', { sources: [{ url: 'https://x.example/1' }], truncated: false }, 60_000)
  assert.equal(provider.cache.map.size, 1)

  provider.refreshCooldowns(options)

  assert.equal(provider.health.serper.until, 0)
  assert.equal(provider.cache.map.size, 0, 'the stale cached answer goes with the cooldown')
})

test('a probe that answers clears cached degraded results, a failing probe leaves them', async () => {
  const deepseekFetch = stubFetch(() => jsonResponse(deepseekPayload(A_URLS)))
  const serperFetch = stubFetch(() => jsonResponse({ message: 'bad key' }, 401))
  const provider = new MergedSearchProvider(() => mergedOptions({ deepseekFetch, serperFetch }))
  provider.cache.set('cached', { sources: [{ url: 'https://x.example/1' }], truncated: false }, 60_000)

  await provider.probe()
  assert.equal(provider.cache.map.size, 0, 'a successful lane proves the cache may be stale')

  provider.cache.set('cached', { sources: [{ url: 'https://x.example/1' }], truncated: false }, 60_000)
  const failing = new MergedSearchProvider(() => mergedOptions({
    deepseekFetch: stubFetch(() => jsonResponse({ error: { message: 'no' } }, 500)),
    serperFetch: stubFetch(() => jsonResponse({ message: 'bad key' }, 401)),
  }))
  failing.cache.set('cached', { sources: [{ url: 'https://x.example/1' }], truncated: false }, 60_000)
  await failing.probe()
  assert.equal(failing.cache.map.size, 1, 'a failed probe must not touch the cache')
})

test('a source-less result is not logged as cache=store', async () => {
  const logger = makeLogger()
  const provider = new MergedSearchProvider(
    () => mergedOptions({
      deepseekFetch: stubFetch(() => jsonResponse(deepseekPayload([]))),
      serperFetch: stubFetch(() => jsonResponse(serperPayload([]))),
      overrides: { logLevel: 'summary' },
    }),
    logger,
  )

  await provider.search(request('empty store'), SIGNAL)
  await provider.search(request('empty store'), SIGNAL)

  assert.equal(provider.cache.map.size, 0)
  assert.doesNotMatch(logger.lines.join('\n'), /cache=store/)
})

test('set ignores source-less results and non-positive TTLs', () => {
  const cache = new ResultCache()

  assert.equal(cache.set('empty', { sources: [] }, 60_000, 0), false)
  assert.equal(cache.set('zero-ttl', oneSourceResult('x'), 0, 0), false)
  assert.equal(cache.set('negative-ttl', oneSourceResult('y'), -1, 0), false)
  assert.equal(cache.set('no-sources', { truncated: false }, 60_000, 0), false)
  assert.equal(cache.set('ok', oneSourceResult('z'), 60_000, 0), true)

  assert.equal(cache.map.size, 1)
})

// ── Result hygiene ─────────────────────────────────────────────────────────

test('a hit returns a copy, so mutating it cannot corrupt the cache', async () => {
  const deepseekFetch = stubFetch(() => jsonResponse(deepseekPayload(A_URLS)))
  const serperFetch = stubFetch(() => jsonResponse(serperPayload(B_URLS)))
  const provider = new MergedSearchProvider(() => mergedOptions({ deepseekFetch, serperFetch }))
  const query = request('clone')

  const first = await provider.search(query, SIGNAL)
  first.sources[0].title = 'mutated'
  first.sources.pop()

  const second = await provider.search(query, SIGNAL)
  assert.equal(second.sources.length, 8)
  assert.notEqual(second.sources[0].title, 'mutated')
})

test('cacheKey changes whenever a documented component changes', () => {
  const base = mergedOptions({ deepseekFetch: () => {}, serperFetch: () => {} })
  const key = cacheKey('q', base, 8)

  assert.equal(cacheKey(' q ', base, 8), key)
  for (const [label, mutate] of KEY_MUTATIONS) {
    assert.notEqual(cacheKey('q', mutate(base), 8), key, label)
  }
  assert.notEqual(cacheKey('q', base, 12), key, 'cap')
})
