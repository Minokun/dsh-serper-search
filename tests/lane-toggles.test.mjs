/**
 * v0.5.0 second round: the `serperEnabled` lane switch.
 *
 * The card exposes one enable switch per search-source group; `native` (DeepSeek)
 * and `yuanbaoEnabled` are covered in `tests/yuanbao.test.mjs`, this file covers
 * the serper switch end to end: lane assembly, the probe protocol, the cache key,
 * and the explicit error when every lane is switched off.
 */
import test from 'node:test'
import assert from 'node:assert/strict'

import { cacheKey } from '../lib/cache.js'
import { MergedSearchProvider } from '../lib/index.js'

const A_URLS = Array.from({ length: 12 }, (_, i) => `https://a${i}.example/a${i}`)
const B_URLS = Array.from({ length: 12 }, (_, i) => `https://b${i}.example/b${i}`)
const C_URLS = Array.from({ length: 12 }, (_, i) => `https://c${i}.example/c${i}`)

function deepseekPayload(urls) {
  return { results: urls.map((url, i) => ({ title: `A${i}`, url, snippet: `a-${i}` })) }
}
function serperPayload(urls) {
  return { organic: urls.map((url, i) => ({ title: `B${i}`, link: url, snippet: `b-${i}` })) }
}
function yuanbaoPayload(urls) {
  return {
    Response: {
      RequestId: 'req-1',
      Query: 'q',
      Pages: urls.map((url, i) => JSON.stringify({ title: `C${i}`, url, passage: `c-${i}`, date: '2026-10-20' })),
    },
  }
}
function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json' } })
}
function stubFetch(handler) {
  const calls = []
  const impl = async (url, init) => {
    calls.push({ url: String(url), init, body: JSON.parse(init.body) })
    return await handler(url, init, calls.length)
  }
  impl.calls = calls
  return impl
}
const signal = () => new AbortController().signal

/** Options for a provider whose stubs answer every lane successfully. */
function options({ serperEnabled = true, deepseekEnabled = true, yuanbaoEnabled = true, overrides = {} } = {}) {
  return {
    deepseekEnabled,
    serperEnabled,
    yuanbaoEnabled,
    primary: 'deepseek',
    ratio: yuanbaoEnabled ? '1:1:1' : 2,
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
      fetchImpl: stubFetch(() => jsonResponse(deepseekPayload(A_URLS))),
    },
    serper: {
      apiKey: 'serper-test-key',
      baseURL: 'https://google.serper.dev',
      gl: 'cn',
      hl: 'zh-cn',
      autoLocale: true,
      num: 10,
      timeoutMs: 1000,
      fetchImpl: stubFetch(() => jsonResponse(serperPayload(B_URLS))),
    },
    yuanbao: {
      apiKey: 'yuanbao-test-key',
      endpoint: 'https://api.wsa.cloud.tencent.com/SearchPro',
      count: 0,
      timeoutMs: 1000,
      fetchImpl: stubFetch(() => jsonResponse(yuanbaoPayload(C_URLS))),
    },
    ...overrides,
  }
}

/** Host-prefix composition of a merged list. */
function composition(sources) {
  const counts = { a: 0, b: 0, c: 0 }
  for (const source of sources) counts[new URL(source.url).hostname[0]] += 1
  return counts
}

test('serperEnabled:false drops the serper lane from the interleave (DeepSeek + Yuanbao 12/12)', async () => {
  const base = options({ serperEnabled: false })
  const provider = new MergedSearchProvider(() => base)
  const result = await provider.search({ query: 'serper off', maxResults: 24 }, signal())

  assert.equal(base.serper.fetchImpl.calls.length, 0, 'no serper request')
  assert.deepEqual(composition(result.sources), { a: 12, b: 0, c: 12 })
  assert.equal(result.sources.length, 24)
  assert.equal(result.content, undefined, 'switching a lane off is not a degradation, so no Note')
  assert.deepEqual(
    result.sources.slice(0, 4).map((source) => new URL(source.url).hostname[0]),
    ['a', 'c', 'a', 'c'],
  )
})

test('all three lanes on still merge 8/8/8 at a 24-slot cap', async () => {
  const base = options()
  const provider = new MergedSearchProvider(() => base)
  const result = await provider.search({ query: 'all on', maxResults: 24 }, signal())
  assert.deepEqual(composition(result.sources), { a: 8, b: 8, c: 8 })
  assert.equal(base.deepseek.fetchImpl.calls.length, 1)
  assert.equal(base.serper.fetchImpl.calls.length, 1)
  assert.equal(base.yuanbao.fetchImpl.calls.length, 1)
})

test('every lane switched off throws an explicit error and spends no request', async () => {
  const base = options({ serperEnabled: false, deepseekEnabled: false, yuanbaoEnabled: false })
  const provider = new MergedSearchProvider(() => base)
  assert.equal(provider.available(), false, 'nothing is available to search with')
  await assert.rejects(
    () => provider.search({ query: 'all off', maxResults: 24 }, signal()),
    (error) => {
      assert.equal(error.code, 'WEB_PROVIDER_ERROR')
      assert.match(error.message, /no search lane is enabled/)
      assert.match(error.message, /DeepSeek: off/)
      assert.match(error.message, /serper: off/)
      assert.match(error.message, /Yuanbao: off/)
      return true
    },
  )
  assert.equal(base.deepseek.fetchImpl.calls.length, 0)
  assert.equal(base.serper.fetchImpl.calls.length, 0)
  assert.equal(base.yuanbao.fetchImpl.calls.length, 0)
})

test('probe reports a switched-off lane as disabled without a request', async () => {
  const base = options({ serperEnabled: false })
  const provider = new MergedSearchProvider(() => base)
  const lanes = await provider.probe({ timeoutMs: 2000 })
  assert.deepEqual(lanes.map((lane) => lane.lane), ['deepseek', 'serper', 'yuanbao'])
  assert.deepEqual(lanes.map((lane) => lane.class), [null, 'disabled', null])
  assert.equal(lanes[1].ok, false)
  assert.equal(base.serper.fetchImpl.calls.length, 0, 'a disabled lane is never probed')
  assert.equal(base.deepseek.fetchImpl.calls.length, 1)
  assert.equal(base.yuanbao.fetchImpl.calls.length, 1)
})

test('cacheKey changes when a lane is switched off or on', () => {
  const base = options()
  const key = cacheKey('q', base, 24)
  assert.notEqual(cacheKey('q', { ...base, serperEnabled: false }, 24), key, 'serperEnabled')
  assert.notEqual(cacheKey('q', { ...base, deepseekEnabled: false }, 24), key, 'deepseekEnabled')
  assert.notEqual(cacheKey('q', { ...base, yuanbaoEnabled: false }, 24), key, 'yuanbaoEnabled')
})

test('serperEnabled:false with primary:serper still routes through DeepSeek', async () => {
  const base = options({ serperEnabled: false, overrides: { primary: 'serper' } })
  const provider = new MergedSearchProvider(() => base)
  const result = await provider.search({ query: 'primary serper but off', maxResults: 24 }, signal())
  assert.deepEqual(composition(result.sources), { a: 12, b: 0, c: 12 })
})

test('serperEnabled:false degrades cleanly when Yuanbao also fails', async () => {
  const base = options({ serperEnabled: false })
  base.yuanbao = { ...base.yuanbao, fetchImpl: stubFetch(() => jsonResponse({ message: 'boom' }, 500)) }
  const provider = new MergedSearchProvider(() => base)
  const result = await provider.search({ query: 'deepseek only left', maxResults: 24 }, signal())
  assert.match(result.content, /^Note: yuanbao server error \(HTTP 500\), using deepseek\./)
  assert.deepEqual(composition(result.sources), { a: 12, b: 0, c: 0 })
})
