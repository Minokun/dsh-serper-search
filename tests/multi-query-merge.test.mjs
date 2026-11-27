/**
 * Multi-query merge (autoresearch fix, debug finding #5).
 *
 * One `web_search` call may carry several queries. `@deepseek-ai/dsh-tool-web`
 * starts them concurrently with one shared AbortSignal, gives every query the
 * full `maxResults`, and then merges the per-query lists by rank (round-robin)
 * under the same cap: with 3 queries x 24 it keeps the first 8 ranks of each
 * and drops the other 48 — which flags the result `truncated` and appends
 * "Refine the query for more", pushing the model into extra searches (333 of
 * 334 real multi-query results carried that hint).
 *
 * With `mergeMultiQuery: true` the provider merges the queries of one call
 * itself — every query still fetches the whole cap (the APIs bill per request)
 * — and hands the tool layer slices that reassemble into exactly the merged
 * list. The call returns the same number of sources as before, nothing is
 * dropped, the hint disappears, and the per-host cap holds for the whole call.
 * Off by default.
 *
 * Run with: `node --test tests/`
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { MergedSearchProvider, mergeQueryBatch } from '../lib/index.js'

const slug = (query) => String(query).replace(/[^a-z0-9]+/gi, '').toLowerCase()

/** Sources of one lane for one query: `shared` identical-across-queries URLs first, then the query's own. */
function lane(kind, n, query, shared = 0) {
  const tag = slug(query)
  const url = (k) => `https://${k}-${kind}.example/${k}`
  const own = Array.from({ length: n }, (_, i) => url(`${tag}${kind}${i}`))
  const common = Array.from({ length: shared }, (_, i) => url(`shared${kind}${i}`))
  return [...common, ...own].slice(0, n)
}

/** A DeepSeek Search API payload. */
function deepseekPayload(urls) {
  return { results: urls.map((u, i) => ({ title: `D${i}`, url: u, snippet: 'd', date: '2026-01-02', authority: 3 })) }
}

/** A serper payload. */
function serperPayload(urls) {
  return { organic: urls.map((u, i) => ({ title: `S${i}`, link: u, snippet: 's', position: i + 1 })) }
}

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json' } })
}

/** Stubs for both lanes: 48 candidates per query (24 shared across queries when asked), failures for `failQueries`. */
function lanes({ shared = 0, failQueries = [], sameHost = false } = {}) {
  const deepseek = { calls: [] }
  const serper = { calls: [] }
  const deepseekFetch = async (_url, init) => {
    const body = JSON.parse(init.body)
    deepseek.calls.push(body)
    if (failQueries.includes(body.query)) return jsonResponse({ error: 'boom' }, 500)
    let urls = lane('d', 48, body.query, shared)
    if (sameHost) urls = urls.map((u, i) => (i < 40 ? `https://same.example/${slug(body.query)}-${i}` : u))
    return jsonResponse(deepseekPayload(urls))
  }
  const serperFetch = async (_url, init) => {
    const body = JSON.parse(init.body)
    serper.calls.push(body)
    if (failQueries.includes(body.q)) return jsonResponse({ message: 'boom' }, 500)
    let urls = lane('s', 48, body.q, shared)
    if (sameHost) urls = urls.map((u, i) => (i < 40 ? `https://same.example/${slug(body.q)}-s-${i}` : u))
    return jsonResponse(serperPayload(urls))
  }
  return { deepseek, serper, deepseekFetch, serperFetch }
}

/** Two-lane options; the per-host cap is off unless a test says otherwise. */
function options({ stubs, mergeMultiQuery, maxPerHost = 0, cacheMinutes = 0 }) {
  return {
    deepseekEnabled: true,
    primary: 'deepseek',
    ratio: 2,
    maxPerHost,
    demoteSocial: true,
    logLevel: 'off',
    cacheMinutes,
    mergeMultiQuery,
    deepseek: {
      apiKey: 'deepseek-test-key',
      apiKeyEnv: 'DEEPSEEK_API_KEY',
      baseURL: 'https://api.deepseek.com/v1/tools',
      count: 10,
      timeoutMs: 1000,
      summaryMaxChars: 600,
      minAuthority: -1,
      maxRetries: 0,
      fetchImpl: stubs.deepseekFetch,
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
      fetchImpl: stubs.serperFetch,
    },
  }
}

/** The deciding part of dsh-tool-web's `mergeSearchResults`: round-robin by rank under the cap. */
function toolLayerMerge(results, maxResults) {
  const seen = new Set()
  const sources = []
  let dropped = false
  const ranks = Math.max(...results.map((result) => result.sources.length))
  merge: for (let rank = 0; rank < ranks; rank += 1) {
    for (const result of results) {
      const source = result.sources[rank]
      if (source === undefined || seen.has(source.url)) continue
      seen.add(source.url)
      if (sources.length === maxResults) {
        dropped = true
        break merge
      }
      sources.push(source)
    }
  }
  return { sources, truncated: results.some((result) => result.truncated) || dropped }
}

/** One `web_search` call as the tool layer runs it: every query with the full cap, one shared signal. */
async function toolCall(provider, queries, maxResults = 24) {
  const signal = new AbortController().signal
  const results = await Promise.all(queries.map((query) => provider.search({ query, maxResults }, signal)))
  return { results, merged: toolLayerMerge(results, maxResults) }
}

const urlsOf = (sources) => sources.map((source) => source.url)

test('mergeQueryBatch: round-robin by rank across the queries, duplicates collapsed, slices reassemble', () => {
  const results = [
    { sources: [{ url: 'https://a.example/1' }, { url: 'https://dup.example/x' }, { url: 'https://a.example/2' }, { url: 'https://a.example/3' }] },
    { sources: [{ url: 'https://dup.example/x' }, { url: 'https://b.example/1' }, { url: 'https://b.example/2' }] },
  ]
  const first = mergeQueryBatch(results, { maxPerHost: 0 }, 24, 0)
  const second = mergeQueryBatch(results, { maxPerHost: 0 }, 24, 1)
  // Merged order by rank: a1, b1, dup (first seen in list one), b2, a2, a3 — the duplicate's
  // second occurrence, at the head of list two, is what gets skipped.
  assert.deepEqual(toolLayerMerge([{ sources: first.sources }, { sources: second.sources }], 24).sources.map((s) => s.url), [
    'https://a.example/1', 'https://b.example/1', 'https://dup.example/x', 'https://b.example/2', 'https://a.example/2', 'https://a.example/3',
  ])
  assert.equal(first.sources.length + second.sources.length, 6)
  assert.equal(first.truncated, false)
})

test('default (off): every query fetches the whole cap and the tool layer drops the rest', async () => {
  const stubs = lanes()
  const provider = new MergedSearchProvider(() => options({ stubs, mergeMultiQuery: false }))
  const { results, merged } = await toolCall(provider, ['alpha', 'beta', 'gamma'])
  assert.deepEqual(results.map((result) => result.sources.length), [24, 24, 24])
  assert.equal(merged.sources.length, 24)
  assert.equal(merged.truncated, true, '48 of 72 candidates dropped — the "Refine the query" hint')
  assert.deepEqual(stubs.deepseek.calls.map((body) => body.count), [24, 24, 24])
})

test('on: still 24 sources for the call — also when the queries overlap, or their count does not divide the cap', async () => {
  const queries = ['alpha', 'beta', 'gamma']
  const stubs = lanes({ shared: 8 })
  const provider = new MergedSearchProvider(() => options({ stubs, mergeMultiQuery: true }))
  const { results, merged } = await toolCall(provider, queries)

  // Exactly the cap comes back, nothing is dropped, so nothing says "Refine the query".
  assert.equal(merged.sources.length, 24)
  assert.equal(merged.truncated, false)
  assert.equal(new Set(urlsOf(merged.sources)).size, 24, 'no duplicate survives the merge')
  // How the 24 are split differs from the default path, deliberately. The tool layer lets a
  // duplicate take its turn without consuming a candidate, so the query that lists the shared
  // links first hogs the slots (here 16 / 4 / 3); merged across the queries, the duplicates are
  // gone before the turns are taken and every query is represented (8 / 8 / 8).
  // Slots per query = how many merged sources each query's list was the first to offer
  // (a shared link is charged to the query that listed it first).
  const contributions = (sources) => queries.map((query) => sources.filter((source) => {
    const name = new URL(source.url).hostname.split('-')[0]
    return name.startsWith('shared') ? query === queries[0] : name.startsWith(query)
  }).length)
  assert.deepEqual(contributions(merged.sources), [8, 8, 8])
  assert.equal(merged.sources.filter((source) => new URL(source.url).hostname.startsWith('shared')).length, 8, 'shared links appear once each')
  // The default path for the same queries, for contrast: the first query hogs the slots.
  const off = new MergedSearchProvider(() => options({ stubs: lanes({ shared: 8 }), mergeMultiQuery: false }))
  const offMerged = (await toolCall(off, queries)).merged
  assert.equal(offMerged.sources.length, 24)
  assert.deepEqual(contributions(offMerged.sources), [17, 4, 3])
  // Each query still fetched the whole cap: the APIs bill per request, so nothing is saved by asking for less.
  assert.deepEqual(stubs.deepseek.calls.map((body) => body.count), [24, 24, 24])
  assert.deepEqual(stubs.serper.calls.map((body) => body.num), [24, 24, 24])
  // The slices reassemble: their sizes add up to the cap.
  assert.equal(results.reduce((total, result) => total + result.sources.length, 0), 24)

  // Five queries: 24 does not divide by 5, the call still returns exactly 24.
  const five = await toolCall(provider, ['q1', 'q2', 'q3', 'q4', 'q5'])
  assert.equal(five.merged.sources.length, 24)
  assert.equal(five.merged.truncated, false)
})

test('on: the per-host cap holds for the whole call instead of per query', async () => {
  const stubs = lanes({ sameHost: true })
  const run = async (mergeMultiQuery) => {
    const provider = new MergedSearchProvider(() => options({ stubs: lanes({ sameHost: true }), maxPerHost: 2, mergeMultiQuery }))
    return (await toolCall(provider, ['alpha', 'beta', 'gamma'])).merged
  }
  const off = await run(false)
  const on = await run(true)
  const sameHost = (merged) => merged.sources.filter((source) => new URL(source.url).hostname === 'same.example').length
  assert.equal(off.sources.length, 24)
  assert.equal(sameHost(off), 6, 'off: two per query, six for the call')
  assert.equal(on.sources.length, 24, 'on: still the full cap')
  assert.equal(sameHost(on), 2, 'on: two for the whole call')
})

test('on: a failed query fails the whole call and never leaves the others hanging', { timeout: 8000 }, async () => {
  const stubs = lanes({ failQueries: ['beta'] })
  const provider = new MergedSearchProvider(() => options({ stubs, mergeMultiQuery: true }))
  // As the tool layer does: the first failure aborts the shared signal.
  const controller = new AbortController()
  const settled = await Promise.allSettled(['alpha', 'beta', 'gamma'].map(async (query) => {
    try {
      return await provider.search({ query, maxResults: 24 }, controller.signal)
    } catch (error) {
      controller.abort(error)
      throw error
    }
  }))
  assert.ok(settled.every((outcome) => outcome.status === 'rejected'), 'no query returns a list that is missing one of the call\'s queries')
  assert.ok(settled.some((outcome) => /Merged search failed on all backends/.test(String(outcome.reason?.message ?? outcome.reason))))
})

test('on: the cache keeps each query\'s own full result; a lone query and a call without a signal are unchanged', async () => {
  const stubs = lanes()
  const provider = new MergedSearchProvider(() => options({ stubs, mergeMultiQuery: true, cacheMinutes: 5 }))
  const { results } = await toolCall(provider, ['alpha', 'beta', 'gamma'])
  assert.ok(results.every((result) => result.sources.length === 8), 'each query hands back its slice')
  // The same query searched on its own later is a cache hit of its own full result, not of the slice.
  const alone = await provider.search({ query: 'alpha', maxResults: 24 })
  assert.equal(alone.sources.length, 24)
  assert.equal(stubs.deepseek.calls.length, 3, 'served from the cache')
  // A lone query in a call of its own, and a direct call without a signal, keep the whole cap too.
  const single = await provider.search({ query: 'lone query', maxResults: 24 }, new AbortController().signal)
  assert.equal(single.sources.length, 24)
  const direct = await provider.search({ query: 'direct call', maxResults: 24 })
  assert.equal(direct.sources.length, 24)
})

test('property: for any query count, overlap, result sizes and cap, the call returns exactly as many sources as with the switch off', async () => {
  // Seeded, so a failure reproduces. Each round draws a query count, a cap and a
  // result list per query from one URL pool (so the queries overlap at random).
  let seed = 0x5eed
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
    return seed / 0x100000000
  }
  const pick = (n) => Math.floor(random() * n)
  const shuffled = (items) => {
    const copy = [...items]
    for (let i = copy.length - 1; i > 0; i -= 1) {
      const j = pick(i + 1)
      ;[copy[i], copy[j]] = [copy[j], copy[i]]
    }
    return copy
  }
  const build = (lists, mergeMultiQuery) => {
    const listFor = (query) => lists[Number(query)] ?? []
    const deepseekFetch = async (_url, init) => jsonResponse(deepseekPayload(listFor(JSON.parse(init.body).query)))
    const serperFetch = async (_url, init) => jsonResponse(serperPayload(listFor(JSON.parse(init.body).q)))
    return new MergedSearchProvider(() => options({ stubs: { deepseekFetch, serperFetch }, mergeMultiQuery }))
  }
  for (let round = 0; round < 40; round += 1) {
    const count = 1 + pick(6)
    const cap = 1 + pick(30)
    const pool = Array.from({ length: count + pick(3 * cap + 10) }, (_, i) => `https://h${i}.example/${i}`)
    const lists = Array.from({ length: count }, () => shuffled(pool).slice(0, pick(2 * cap + 1)))
    const queries = lists.map((_, index) => String(index))
    const off = (await toolCall(build(lists, false), queries, cap)).merged
    const on = (await toolCall(build(lists, true), queries, cap)).merged
    const label = `round ${round}: ${count} queries, cap ${cap}, sizes ${lists.map((list) => list.length).join('/')}`
    assert.equal(on.sources.length, off.sources.length, `${label}: same number of sources for the call`)
    assert.equal(new Set(urlsOf(on.sources)).size, on.sources.length, `${label}: no duplicates`)
    assert.equal(on.truncated, false, `${label}: nothing dropped, so no "Refine the query"`)
  }
})
