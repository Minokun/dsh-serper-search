/**
 * Multi-query budget split (autoresearch fix, debug finding #5).
 *
 * One `web_search` call may carry several queries. `@deepseek-ai/dsh-tool-web`
 * starts them concurrently with one shared AbortSignal, gives every query the
 * full `maxResults`, and then merges the per-query lists by rank (round-robin)
 * under the same cap: with 3 queries x 24 it keeps the first 8 ranks of each
 * and drops the other 48 — which flags the result `truncated` and appends
 * "Refine the query for more", pushing the model into extra searches (333 of
 * 334 real multi-query results carried that hint).
 *
 * With `splitMultiQueryBudget: true` the provider recognises the siblings (same
 * signal, started together) and gives each `ceil(cap / siblings)` instead. The
 * merged result is the same set, nothing is dropped, and every lane is asked
 * for a share instead of the whole cap. Off by default.
 *
 * Run with: `node --test tests/`
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { MergedSearchProvider, batchShare } from '../lib/index.js'

const slug = (query) => String(query).replace(/[^a-z0-9]+/gi, '').toLowerCase()

/** A DeepSeek Search API payload with `n` sources, distinct per query as in a real search. */
function deepseekLane(n, query) {
  const tag = slug(query)
  return { results: Array.from({ length: n }, (_, i) => ({ title: `${tag} D${i}`, url: `https://${tag}d${i}.example/${i}`, snippet: 'd', date: '2026-01-02', authority: 3 })) }
}

/** A serper payload with `n` sources, distinct per query. */
function serperLane(n, query) {
  const tag = slug(query)
  return { organic: Array.from({ length: n }, (_, i) => ({ title: `${tag} S${i}`, link: `https://${tag}s${i}.example/${i}`, snippet: 's', position: i + 1 })) }
}

function jsonResponse(payload) {
  return new Response(JSON.stringify(payload), { status: 200, headers: { 'content-type': 'application/json' } })
}

/** A stub answering every request with 48 sources for that query, recording the request bodies. */
function recordingFetch(lane) {
  const calls = []
  const impl = async (_url, init) => {
    const body = JSON.parse(init.body)
    calls.push(body)
    return jsonResponse(lane(48, body.query ?? body.q))
  }
  impl.calls = calls
  return impl
}

/** Two-lane options with the per-host cap off, so source counts stay exact. */
function options({ deepseekFetch, serperFetch, splitMultiQueryBudget }) {
  return {
    deepseekEnabled: true,
    primary: 'deepseek',
    ratio: 2,
    maxPerHost: 0,
    demoteSocial: true,
    logLevel: 'off',
    cacheMinutes: 0,
    splitMultiQueryBudget,
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

test('batchShare: ceil(cap / siblings), at least one, and nothing to split without a cap', () => {
  assert.equal(batchShare(24, 3), 8)
  assert.equal(batchShare(24, 1), 24)
  assert.equal(batchShare(7, 3), 3)
  assert.equal(batchShare(7, 8), 1)
  assert.equal(batchShare(undefined, 3), undefined)
})

test('sibling queries of one call split the cap: same final set, nothing dropped, smaller lane requests', async () => {
  const queries = ['alpha', 'beta', 'gamma']
  const run = async (split) => {
    const deepseekFetch = recordingFetch(deepseekLane)
    const serperFetch = recordingFetch(serperLane)
    const provider = new MergedSearchProvider(() => options({ deepseekFetch, serperFetch, splitMultiQueryBudget: split }))
    const signal = new AbortController().signal // what the tool layer hands every sibling
    const results = await Promise.all(queries.map((query) => provider.search({ query, maxResults: 24 }, signal)))
    return { results, deepseekFetch, serperFetch }
  }
  const before = await run(false)
  const after = await run(true)

  // Default: every query fetched the whole cap and the tool layer dropped two thirds of it.
  assert.deepEqual(before.results.map((result) => result.sources.length), [24, 24, 24])
  const beforeMerged = toolLayerMerge(before.results, 24)
  assert.equal(beforeMerged.sources.length, 24)
  assert.equal(beforeMerged.truncated, true, '48 of 72 candidates were dropped')

  // Split: each sibling got 8; the merged result is the very same set and nothing is dropped.
  assert.deepEqual(after.results.map((result) => result.sources.length), [8, 8, 8])
  const afterMerged = toolLayerMerge(after.results, 24)
  assert.equal(afterMerged.sources.length, 24)
  assert.equal(afterMerged.truncated, false)
  assert.deepEqual(new Set(afterMerged.sources.map((source) => source.url)), new Set(beforeMerged.sources.map((source) => source.url)))

  // And every lane was asked for its share rather than the whole cap.
  assert.deepEqual(before.deepseekFetch.calls.map((body) => body.count), [24, 24, 24])
  assert.deepEqual(after.deepseekFetch.calls.map((body) => body.count), [10, 10, 10])
  assert.deepEqual(before.serperFetch.calls.map((body) => body.num), [24, 24, 24])
  assert.deepEqual(after.serperFetch.calls.map((body) => body.num), [10, 10, 10])
})

test('a lone query, an unrelated concurrent call, or a call without a signal keeps the whole cap', async () => {
  const provider = new MergedSearchProvider(() => options({
    deepseekFetch: recordingFetch(deepseekLane),
    serperFetch: recordingFetch(serperLane),
    splitMultiQueryBudget: true,
  }))
  const alone = await provider.search({ query: 'alone', maxResults: 24 }, new AbortController().signal)
  assert.equal(alone.sources.length, 24)
  // Two different tool calls (different signals) started together are not siblings.
  const pair = await Promise.all([
    provider.search({ query: 'call one', maxResults: 24 }, new AbortController().signal),
    provider.search({ query: 'call two', maxResults: 24 }, new AbortController().signal),
  ])
  assert.deepEqual(pair.map((result) => result.sources.length), [24, 24])
  // No signal (a direct caller): nothing to join on.
  const direct = await Promise.all([
    provider.search({ query: 'direct one', maxResults: 24 }),
    provider.search({ query: 'direct two', maxResults: 24 }),
  ])
  assert.deepEqual(direct.map((result) => result.sources.length), [24, 24])
})
