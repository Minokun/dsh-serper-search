/**
 * v0.5.0: the Yuanbao (Tencent Cloud WSA SearchPro) third lane, the three-lane
 * interleave, and the failure/degradation matrix that comes with it.
 *
 * Network is never used: every lane gets a stub `fetchImpl`, so these tests
 * assert request bodies (`Cnt` rounding, structured `Site`), envelope-error
 * classification, lane precedence, and cache-key coverage.
 */
import test from 'node:test'
import assert from 'node:assert/strict'

import { RATIO_PATTERNS, mergeLanes } from '../lib/merge.js'
import { classifyFailure } from '../lib/failure.js'
import { cacheKey } from '../lib/cache.js'
import {
  MergedSearchProvider,
  YuanbaoBackend,
  mapYuanbaoResponse,
  resolveYuanbaoCnt,
} from '../lib/index.js'

/** Build a SearchPro response whose Pages entries are JSON *strings*. */
function yuanbaoPayload(urls) {
  return {
    Response: {
      RequestId: 'yb-request-1',
      Query: 'query',
      Version: 'standard',
      Pages: urls.map((url, index) => JSON.stringify({
        title: `Y${index}`,
        url,
        passage: `y-passage-${index}`,
        content: `y-content-${index}-longer-than-passage`,
        date: '2026年10月1日',
        site: 'yuanbao',
        score: 0.9 - index * 0.01,
      })),
    },
  }
}

/** Build a DeepSeek Search API payload. */
function deepseekPayload(urls) {
  return { results: urls.map((url, index) => ({ title: `A${index}`, url, snippet: `a-${index}`, summary: `s-${index}` })) }
}

/** Build a serper.dev payload. */
function serperPayload(urls) {
  return { organic: urls.map((url, index) => ({ title: `B${index}`, link: url, snippet: `b-${index}` })) }
}

/** JSON response helper. */
function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json' } })
}

/** Recording stub fetch. */
function stubFetch(handler) {
  const calls = []
  const impl = async (url, init) => {
    calls.push({ url: String(url), init, body: JSON.parse(init.body) })
    return await handler(url, init, calls.length)
  }
  impl.calls = calls
  return impl
}

/** Request payload the provider receives from the seam. */
const request = (query = 'test query', maxResults = 8) => ({ query, ...(maxResults === undefined ? {} : { maxResults }) })
const SIGNAL = () => new AbortController().signal

const A_URLS = Array.from({ length: 10 }, (_, index) => `https://a${index}.example/${index}`)
const B_URLS = Array.from({ length: 10 }, (_, index) => `https://b${index}.example/${index}`)
const C_URLS = Array.from({ length: 10 }, (_, index) => `https://c${index}.example/${index}`)

/** Options snapshot for a provider with all three lanes enabled and wired to stubs. */
function threeLaneOptions({ deepseekFetch, serperFetch, yuanbaoFetch, overrides = {} } = {}) {
  const base = {
    deepseekEnabled: true,
    yuanbaoEnabled: true,
    primary: 'deepseek',
    ratio: '1:1:1',
    pattern: RATIO_PATTERNS['1:1:1'],
    slotNames: { P: 'deepseek', S: 'serper', Y: 'yuanbao' },
    lanes: ['deepseek', 'serper', 'yuanbao'],
    maxPerHost: 2,
    demoteSocial: true,
    logLevel: 'off',
    cacheMinutes: 0,
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
    yuanbao: {
      apiKey: 'yuanbao-test-key',
      endpoint: 'https://api.wsa.cloud.tencent.com/SearchPro',
      count: 0,
      timeoutMs: 1000,
      fetchImpl: yuanbaoFetch,
    },
  }
  return { ...base, ...overrides }
}

/** Lane composition of a merged source list, keyed by the stub host prefix. */
function composition(sources) {
  const counts = { a: 0, b: 0, c: 0 }
  for (const source of sources) {
    const host = new URL(source.url).hostname
    const prefix = host[0]
    if (prefix in counts) counts[prefix] += 1
  }
  return counts
}

test('Cnt rounds up to the next legal multiple of ten (10..50)', () => {
  assert.equal(resolveYuanbaoCnt(8), 10, '8-slot tool cap → 10')
  assert.equal(resolveYuanbaoCnt(10), 10)
  assert.equal(resolveYuanbaoCnt(16), 20)
  assert.equal(resolveYuanbaoCnt(24), 30, '24-slot tool cap → 30')
  assert.equal(resolveYuanbaoCnt(30), 30)
  assert.equal(resolveYuanbaoCnt(50), 50)
  assert.equal(resolveYuanbaoCnt(100), 50, 'over the cap is clamped, never sent raw')
  assert.equal(resolveYuanbaoCnt(0), 10)
  assert.equal(resolveYuanbaoCnt(undefined), 10)
  assert.equal(resolveYuanbaoCnt(Number.NaN), 10)
  // A configured override is rounded too, so an operator cannot poison the wire.
  assert.equal(resolveYuanbaoCnt(8, 15), 20)
  assert.equal(resolveYuanbaoCnt(8, 5), 10)
  assert.equal(resolveYuanbaoCnt(24, 40), 40)
  assert.equal(resolveYuanbaoCnt(24, 999), 50)
})

test('mapYuanbaoResponse parses double-encoded pages, dedupes URLs, and uses passage', () => {
  const payload = yuanbaoPayload(['https://c0.example/0', 'https://c1.example/1'])
  payload.Response.Pages.push('not json at all')
  payload.Response.Pages.push(JSON.stringify({ url: 'https://c0.example/0', title: 'dup' }))
  const mapped = mapYuanbaoResponse(payload)
  assert.equal(mapped.truncated, false)
  assert.equal(mapped.sources.length, 2)
  assert.equal(mapped.sources[0].snippet, 'y-passage-0', 'snippet comes from passage, not content')
  assert.equal(mapped.sources[0].publishedAt, '2026-10-01')
  assert.equal(mapped.sources[0].title, 'Y0')
})

test('a 200 envelope error becomes a classified WEB_PROVIDER_ERROR, never a bare throw', () => {
  const cases = [
    ['InvalidParameter', 'invalid-response'],
    ['UnauthorizedOperation', 'auth'],
    ['RequestLimitExceeded', 'rate-limit'],
    ['InternalError', 'server'],
    ['SomethingNew', 'invalid-response'],
  ]
  for (const [code, expectedClass] of cases) {
    const payload = { Response: { RequestId: 'r1', Error: { Code: code, Message: `boom ${code}` } } }
    assert.throws(
      () => mapYuanbaoResponse(payload),
      (error) => {
        assert.equal(error.code, 'WEB_PROVIDER_ERROR')
        assert.equal(error.providerClass, expectedClass)
        assert.equal(classifyFailure(error)?.cls, expectedClass, `${code} classifies as ${expectedClass}`)
        assert.match(error.message, new RegExp(code))
        return true
      },
    )
  }
})

test('a missing key fails with WEB_PROVIDER_CREDENTIAL_MISSING and names only the ref', async () => {
  const yuanbaoFetch = stubFetch(() => jsonResponse(yuanbaoPayload(C_URLS)))
  const provider = new MergedSearchProvider(() => threeLaneOptions({
    deepseekFetch: stubFetch(() => jsonResponse(deepseekPayload(A_URLS))),
    serperFetch: stubFetch(() => jsonResponse(serperPayload(B_URLS))),
    yuanbaoFetch,
    overrides: {
      yuanbao: { endpoint: 'https://api.wsa.cloud.tencent.com/SearchPro', count: 0, timeoutMs: 1000, fetchImpl: yuanbaoFetch, apiKeyEnv: 'YUANBAO_API_KEY' },
    },
  }))
  // Only the Yuanbao lane fails; the merge still answers from the other two.
  const result = await provider.search(request('query', 24), SIGNAL())
  assert.equal(result.sources.length, 20, 'the two healthy lanes answer; the cap of 24 is not reached')
  assert.match(result.content, /^Note: yuanbao auth failed, using deepseek, serper\./)
  assert.equal(yuanbaoFetch.calls.length, 0, 'no request without a credential')
  assert.equal(provider.health.yuanbao.cls, 'auth')
})

test('three lanes at a 24-slot cap: DeepSeek count=24, serper num=24, Yuanbao Cnt=30, merged 8/8/8', async () => {
  const deepseekFetch = stubFetch(() => jsonResponse(deepseekPayload(A_URLS)))
  const serperFetch = stubFetch(() => jsonResponse(serperPayload(B_URLS)))
  const yuanbaoFetch = stubFetch(() => jsonResponse(yuanbaoPayload(C_URLS)))
  const provider = new MergedSearchProvider(() => threeLaneOptions({ deepseekFetch, serperFetch, yuanbaoFetch }))

  const result = await provider.search(request('three lane', 24), SIGNAL())

  assert.deepEqual(composition(result.sources), { a: 8, b: 8, c: 8 })
  assert.equal(result.sources.length, 24)
  assert.equal(result.truncated, false)
  assert.equal(deepseekFetch.calls[0].body.count, 24)
  assert.equal(serperFetch.calls[0].body.num, 24)
  assert.equal(yuanbaoFetch.calls[0].body.Cnt, 30)
  assert.equal(yuanbaoFetch.calls[0].body.Query, 'three lane')
  assert.equal(yuanbaoFetch.calls[0].init.headers.authorization, 'Bearer yuanbao-test-key')
  // Interleave order is the pattern, not the completion order.
  assert.deepEqual(
    result.sources.slice(0, 6).map((source) => new URL(source.url).hostname[0]),
    ['a', 'b', 'c', 'a', 'b', 'c'],
  )
})

test('the Yuanbao lane receives the structured Site parameter, not an inline operator', async () => {
  const yuanbaoFetch = stubFetch(() => jsonResponse(yuanbaoPayload(C_URLS)))
  const provider = new MergedSearchProvider(() => threeLaneOptions({
    deepseekFetch: stubFetch(() => jsonResponse(deepseekPayload(A_URLS))),
    serperFetch: stubFetch(() => jsonResponse(serperPayload(B_URLS))),
    yuanbaoFetch,
  }))
  await provider.search({ query: 'dsh plugin', maxResults: 24, site: 'github.com' }, SIGNAL())
  assert.equal(yuanbaoFetch.calls[0].body.Site, 'github.com')
  assert.equal(yuanbaoFetch.calls[0].body.Query, 'dsh plugin', 'the operator stays out of the query text')
})

test('one lane down degrades to the other two, with a Note naming the failure', async () => {
  const deepseekFetch = stubFetch(() => jsonResponse({ error: 'boom' }, 500))
  const serperFetch = stubFetch(() => jsonResponse(serperPayload(B_URLS)))
  const yuanbaoFetch = stubFetch(() => jsonResponse(yuanbaoPayload(C_URLS)))
  const provider = new MergedSearchProvider(() => threeLaneOptions({ deepseekFetch, serperFetch, yuanbaoFetch }))

  const result = await provider.search(request('two left', 24), SIGNAL())
  assert.match(result.content, /^Note: deepseek server error \(HTTP 500\), using serper, yuanbao\./)
  assert.deepEqual(composition(result.sources), { a: 0, b: 10, c: 10 })
  assert.equal(provider.health.deepseek.cls, 'server')
})

test('two lanes down degrade to the single survivor', async () => {
  const deepseekFetch = stubFetch(() => jsonResponse({ error: 'boom' }, 500))
  const serperFetch = stubFetch(() => jsonResponse({ message: 'bad key' }, 401))
  const yuanbaoFetch = stubFetch(() => jsonResponse(yuanbaoPayload(C_URLS)))
  const provider = new MergedSearchProvider(() => threeLaneOptions({ deepseekFetch, serperFetch, yuanbaoFetch }))

  const result = await provider.search(request('only yuanbao', 24), SIGNAL())
  assert.match(result.content, /^Note: deepseek server error \(HTTP 500\), serper auth failed \(HTTP 401\), using yuanbao\./)
  assert.equal(result.sources.length, 10, 'every distinct host of the survivor is kept')
  assert.deepEqual(composition(result.sources), { a: 0, b: 0, c: 10 })
})

test('all three lanes failing throws one error naming each lane', async () => {
  const provider = new MergedSearchProvider(() => threeLaneOptions({
    deepseekFetch: stubFetch(() => jsonResponse({ error: 'boom' }, 500)),
    serperFetch: stubFetch(() => jsonResponse({ message: 'bad key' }, 401)),
    yuanbaoFetch: stubFetch(() => jsonResponse({ Response: { Error: { Code: 'InvalidParameter', Message: 'illegal Cnt' } } })),
  }))
  await assert.rejects(
    () => provider.search(request('all down', 24), SIGNAL()),
    (error) => {
      assert.equal(error.code, 'WEB_PROVIDER_ERROR')
      assert.match(error.message, /DeepSeek Search API: \[server\]/)
      assert.match(error.message, /Serper: \[auth\]/)
      assert.match(error.message, /Yuanbao Search API: \[invalid-response\]/)
      assert.doesNotMatch(error.message, /yuanbao-test-key/)
      return true
    },
  )
})

test('native:false with the Yuanbao lane on merges serper + Yuanbao only', async () => {
  const deepseekFetch = stubFetch(() => jsonResponse(deepseekPayload(A_URLS)))
  const serperFetch = stubFetch(() => jsonResponse(serperPayload(B_URLS)))
  const yuanbaoFetch = stubFetch(() => jsonResponse(yuanbaoPayload(C_URLS)))
  const provider = new MergedSearchProvider(() => threeLaneOptions({
    deepseekFetch,
    serperFetch,
    yuanbaoFetch,
    overrides: { deepseekEnabled: false, lanes: ['serper', 'yuanbao'], slotNames: { P: 'serper', S: 'deepseek', Y: 'yuanbao' } },
  }))

  const result = await provider.search(request('serper plus yuanbao', 24), SIGNAL())
  assert.equal(deepseekFetch.calls.length, 0)
  assert.deepEqual(composition(result.sources), { a: 0, b: 10, c: 10 })
  assert.deepEqual(
    result.sources.slice(0, 4).map((source) => new URL(source.url).hostname[0]),
    ['b', 'c', 'b', 'c'],
  )
})

test('mergeLanes applies the per-host cap across lanes and backfills exhausted lanes', () => {
  const merged = mergeLanes(
    [
      { name: 'deepseek', sources: [{ url: 'https://same.example/1' }, { url: 'https://same.example/2' }, { url: 'https://a1.example/1' }] },
      { name: 'serper', sources: [{ url: 'https://same.example/1#x' }, { url: 'https://b1.example/1' }] },
      { name: 'yuanbao', sources: [{ url: 'https://c1.example/1' }, { url: 'https://c2.example/2' }] },
    ],
    {
      pattern: RATIO_PATTERNS['1:1:1'],
      slotNames: { P: 'deepseek', S: 'serper', Y: 'yuanbao' },
      maxResults: 9,
    },
  )
  const hosts = merged.sources.map((source) => new URL(source.url).hostname)
  assert.equal(hosts.filter((host) => host === 'same.example').length, 2, 'host cap holds across lanes')
  assert.equal(merged.sources.length, 6, 'the cross-lane duplicate URL is dropped, nothing is repeated')
  assert.equal(new Set(merged.sources.map((source) => source.url)).size, merged.sources.length)
})

test('cacheKey covers the Yuanbao lane and the resolved pattern', () => {
  const base = threeLaneOptions({})
  const key = cacheKey('q', base, 24)
  assert.equal(cacheKey(' q ', base, 24), key)
  assert.notEqual(cacheKey('q', { ...base, yuanbaoEnabled: false }, 24), key, 'yuanbaoEnabled')
  assert.notEqual(cacheKey('q', { ...base, yuanbao: { ...base.yuanbao, endpoint: 'https://other.example/SearchPro' } }, 24), key, 'yuanbao endpoint')
  assert.notEqual(cacheKey('q', { ...base, yuanbao: { ...base.yuanbao, count: 30 } }, 24), key, 'yuanbao Cnt override')
  assert.notEqual(cacheKey('q', { ...base, pattern: RATIO_PATTERNS['2:1:1'] }, 24), key, 'pattern')
  assert.notEqual(cacheKey('q', { ...base, lanes: ['deepseek', 'serper'] }, 24), key, 'lane set')
  assert.notEqual(cacheKey('q', { ...base, yuanbao: { ...base.yuanbao, snippetMaxChars: 300 } }, 24), key, 'yuanbao snippet budget')
})

test('the Yuanbao lane alone is usable (direct backend call)', async () => {
  const yuanbaoFetch = stubFetch(() => jsonResponse(yuanbaoPayload(C_URLS)))
  const backend = new YuanbaoBackend(() => ({
    apiKey: 'yuanbao-test-key',
    endpoint: 'https://api.wsa.cloud.tencent.com/SearchPro',
    count: 0,
    timeoutMs: 1000,
    fetchImpl: yuanbaoFetch,
  }))
  assert.equal(backend.available(), true)
  assert.equal(backend.id, 'yuanbao')
  const result = await backend.search({ query: 'direct', maxResults: 8 }, SIGNAL())
  assert.equal(result.sources.length, 10)
  assert.equal(yuanbaoFetch.calls[0].body.Cnt, 10)
})

test('a Yuanbao timeout degrades instead of failing the search', async () => {
  const hanging = (url, init) => new Promise((resolve, reject) => {
    const onAbort = () => reject(new DOMException('aborted', 'AbortError'))
    if (init.signal?.aborted === true) onAbort()
    else init.signal?.addEventListener('abort', onAbort, { once: true })
  })
  const yuanbaoFetch = stubFetch(hanging)
  const provider = new MergedSearchProvider(() => threeLaneOptions({
    deepseekFetch: stubFetch(() => jsonResponse(deepseekPayload(A_URLS))),
    serperFetch: stubFetch(() => jsonResponse(serperPayload(B_URLS))),
    yuanbaoFetch,
    overrides: {
      yuanbao: { apiKey: 'yuanbao-test-key', endpoint: 'https://api.wsa.cloud.tencent.com/SearchPro', count: 0, timeoutMs: 20, fetchImpl: yuanbaoFetch },
    },
  }))
  const result = await provider.search(request('timeout lane', 24), SIGNAL())
  assert.match(result.content, /^Note: yuanbao timed out after 20ms, using deepseek, serper\./)
  assert.equal(provider.health.yuanbao.cls, 'timeout')
})

test('relative dates resolve against the clock on the Yuanbao lane too', () => {
  const now = Date.parse('2026-11-27T04:00:00Z')
  const mapped = mapYuanbaoResponse(yuanbaoPayload(['https://c0.example/0']), { now })
  assert.equal(mapped.sources[0].publishedAt, '2026-10-01', 'an exact date is untouched')
  const relative = mapYuanbaoResponse({
    Response: { Pages: [JSON.stringify({ title: 't', url: 'https://c.example/x', passage: 'p', date: '2 days ago' })] },
  }, { now })
  assert.equal(relative.sources[0].publishedAt, '2026-11-25')
})

test('a Yuanbao endpoint change clears its cooldown (the fingerprint follows `endpoint`)', async () => {
  // The Yuanbao lane's options carry `endpoint`, not `baseURL`, and the credential
  // fingerprint read `baseURL` only: repointing the endpoint left the old endpoint's
  // cooldown in force (repro R5: two different endpoints, one fingerprint).
  let endpoint = 'https://api.wsa.cloud.tencent.com/SearchPro'
  let yuanbaoMode = 'unauthorized'
  const deepseekFetch = stubFetch(() => jsonResponse(deepseekPayload(A_URLS)))
  const serperFetch = stubFetch(() => jsonResponse(serperPayload(B_URLS)))
  const yuanbaoFetch = stubFetch(() => (yuanbaoMode === 'unauthorized'
    ? jsonResponse({ message: 'bad key' }, 401)
    : jsonResponse(yuanbaoPayload(C_URLS))))
  const provider = new MergedSearchProvider(() => {
    const base = threeLaneOptions({ deepseekFetch, serperFetch, yuanbaoFetch })
    return { ...base, yuanbao: { ...base.yuanbao, endpoint } }
  })

  await provider.search(request(), SIGNAL())
  assert.equal(yuanbaoFetch.calls.length, 1)
  assert.equal(provider.health.yuanbao.cls, 'auth')

  // Unchanged endpoint: still cooling.
  await provider.search(request(), SIGNAL())
  assert.equal(yuanbaoFetch.calls.length, 1)

  // Repointed to a working endpoint: the changed fingerprint clears the cooldown.
  endpoint = 'https://yuanbao-proxy.example/SearchPro'
  yuanbaoMode = 'ok'
  await provider.search(request(), SIGNAL())
  assert.equal(yuanbaoFetch.calls.length, 2, 'the new endpoint must be tried instead of skipped')
  assert.equal(provider.health.yuanbao.until, 0)
})

test('a long Yuanbao passage is clipped to the snippet budget, without splitting a surrogate pair', () => {
  // Real logs: 282 sources over 2000 chars (max 6000) held 23.9% of all snippet
  // text, while the DeepSeek summary was capped at summaryMaxChars (repro R4).
  const page = (passage, options) => mapYuanbaoResponse({ Response: { Pages: [JSON.stringify({ title: 't', url: 'https://c.example/x', passage })] } }, options)
  const long = page('甲'.repeat(6000))
  assert.equal(long.sources[0].snippet.length, 1000)
  assert.ok(long.sources[0].snippet.endsWith('…'))
  // The cut lands one UTF-16 code unit into the emoji: no lone surrogate survives.
  assert.equal(page(`${'x'.repeat(998)}😀tail`).sources[0].snippet, `${'x'.repeat(998)}…`)
  // Within the budget: untouched. The budget is configurable; `0` turns clipping off.
  assert.equal(page('short passage').sources[0].snippet, 'short passage')
  assert.equal(page('甲'.repeat(6000), { snippetMaxChars: 300 }).sources[0].snippet.length, 300)
  assert.equal(page('甲'.repeat(6000), { snippetMaxChars: 0 }).sources[0].snippet.length, 6000)
})

test('the lane clips passages with its configured snippet budget', async () => {
  const payload = yuanbaoPayload(C_URLS)
  payload.Response.Pages = payload.Response.Pages.map((raw) => JSON.stringify({ ...JSON.parse(raw), passage: '甲'.repeat(6000) }))
  const yuanbaoFetch = stubFetch(() => jsonResponse(payload))
  const deepseekFetch = stubFetch(() => jsonResponse(deepseekPayload(A_URLS)))
  const serperFetch = stubFetch(() => jsonResponse(serperPayload(B_URLS)))
  const provider = new MergedSearchProvider(() => {
    const base = threeLaneOptions({ deepseekFetch, serperFetch, yuanbaoFetch })
    return { ...base, yuanbao: { ...base.yuanbao, snippetMaxChars: 300 } }
  })
  const result = await provider.search(request('clipped passage', 24), SIGNAL())
  const yuanbaoSources = result.sources.filter((source) => source.url.startsWith('https://c'))
  assert.ok(yuanbaoSources.length > 0, 'the Yuanbao lane contributed sources')
  assert.ok(yuanbaoSources.every((source) => source.snippet.length <= 300), 'every Yuanbao snippet respects the budget')
})
