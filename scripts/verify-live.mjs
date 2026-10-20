/**
 * Release check for the v0.4 merged provider. Two layers, one command:
 *
 * 1. Offline assertions (no keys, no network, no credits): injected `fetchImpl`
 *    stubs assert the v0.4 behaviours — a repeated query is served from the
 *    result cache with zero upstream requests, a serper 401 degrades to the
 *    deepseek lane with a `Note:` and starts an auth cooldown, and clearing the
 *    cooldown + cache makes the next search hit both backends again. This layer
 *    always runs.
 * 2. Live smoke check (real network, real credits): requires SERPER_API_KEY and
 *    DEEPSEEK_API_KEY in the environment. Runs three queries through both
 *    backends, merges them exactly as the harness does, and prints latency /
 *    composition / snippet lengths. Skipped with a notice when keys are absent.
 *
 * It never prints a key. It exits non-zero when an offline assertion fails or
 * when a merged live search fails; per-backend live probe failures are reported
 * as warnings (a slow serper run still reports partial results).
 *
 *   # offline assertions only — no key needed
 *   node scripts/verify-live.mjs
 *
 *   # offline assertions + real-API smoke check (small cost)
 *   set -a; . /tmp/keys.env; set +a
 *   node scripts/verify-live.mjs
 */
import assert from 'node:assert/strict'

import { DeepSeekSearchApiBackend, MergedSearchProvider, SerperSearchProvider } from '../lib/index.js'

/** An aborted-by-default-never signal for the offline stub searches. */
const OFFLINE_SIGNAL = new AbortController().signal

/** Stub result URLs, six per lane (the default 8-slot merge is 6 + 2); a
 * distinct host per URL keeps the `maxPerHost` merge rule from trimming them. */
const DEEPSEEK_URLS = Array.from({ length: 6 }, (_, index) => `https://d${index}.example/${index}`)
const SERPER_URLS = Array.from({ length: 6 }, (_, index) => `https://s${index}.example/${index}`)

/** DeepSeek Search API payload shaped like the real endpoint. */
function deepseekPayload(urls) {
  return {
    results: urls.map((url, index) => ({
      title: `D${index}`,
      url,
      snippet: `d-snippet-${index}`,
      date: '2026-01-02T00:00:00+00:00',
      authority: 3,
    })),
  }
}

/** serper.dev payload shaped like the real endpoint. */
function serperPayload(urls) {
  return {
    organic: urls.map((url, index) => ({
      title: `S${index}`,
      link: url,
      snippet: `s-snippet-${index}`,
      position: index + 1,
    })),
  }
}

/** A JSON `Response`, matching the only transport the backends use. */
function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

/**
 * Stub `fetch`: records every request and answers from `handler`.
 * @param {(url: string, init: object, call: number) => Response | Promise<Response>} handler - transport body.
 * @returns {((url: string, init: object) => Promise<Response>) & {calls: object[]}} the stub plus its request log.
 */
function stubFetch(handler) {
  const calls = []
  const impl = async (url, init) => {
    calls.push({ url })
    return await handler(url, init, calls.length)
  }
  impl.calls = calls
  return impl
}

/**
 * One merged-provider options snapshot backed by stub transports. The literal
 * keys are obvious placeholders ("offline-stub"), never real credentials, and
 * nothing in this script prints them.
 */
function offlineOptions({ deepseekFetch, serperFetch }) {
  return {
    deepseekEnabled: true,
    primary: 'deepseek',
    ratio: 2,
    maxPerHost: 2,
    demoteSocial: true,
    logLevel: 'summary',
    cacheMinutes: 5,
    deepseek: {
      apiKey: 'offline-stub',
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
      apiKey: 'offline-stub',
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

/** Logger that records the provider's structured summary lines. */
function recordingLogger() {
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

/**
 * Offline assertion 1: the second search of the same query is a cache hit with
 * zero upstream requests (plan §4, the `cache=hit` acceptance).
 */
async function assertRepeatedQueryHitsCache() {
  const deepseekFetch = stubFetch(() => jsonResponse(deepseekPayload(DEEPSEEK_URLS)))
  const serperFetch = stubFetch(() => jsonResponse(serperPayload(SERPER_URLS)))
  const logger = recordingLogger()
  const provider = new MergedSearchProvider(() => offlineOptions({ deepseekFetch, serperFetch }), logger)
  const request = { query: 'offline repeated query', maxResults: 8 }

  const first = await provider.search(request, OFFLINE_SIGNAL)
  assert.equal(first.sources.length, 8)
  assert.deepEqual([deepseekFetch.calls.length, serperFetch.calls.length], [1, 1])
  assert.match(logger.lines.join('\n'), /cache=store/)

  const second = await provider.search(request, OFFLINE_SIGNAL)
  assert.deepEqual(
    [deepseekFetch.calls.length, serperFetch.calls.length],
    [1, 1],
    'a cache hit must make no upstream request',
  )
  assert.match(logger.lines.join('\n'), /cache=hit len=8/)
  assert.deepEqual(second.sources, first.sources)
}

/**
 * Offline assertions 2 + 3: a serper 401 degrades to deepseek with a `Note:`
 * and starts an auth cooldown (cached as a degraded result for the short TTL);
 * after clearing that cooldown and the cache, the same query is requested from
 * both backends again.
 */
async function assertDegradationCooldownAndRecovery() {
  const deepseekFetch = stubFetch(() => jsonResponse(deepseekPayload(DEEPSEEK_URLS)))
  const serperFetch = stubFetch(() => jsonResponse({ message: 'invalid api key' }, 401))
  const provider = new MergedSearchProvider(() => offlineOptions({ deepseekFetch, serperFetch }))
  const request = { query: 'offline degraded query', maxResults: 8 }

  const startedAt = Date.now()
  const degraded = await provider.search(request, OFFLINE_SIGNAL)
  assert.ok(
    (degraded.content ?? '').startsWith('Note: serper auth failed'),
    `expected the serper auth Note, got ${JSON.stringify(degraded.content)}`,
  )
  assert.ok(degraded.sources.length > 0, 'the healthy lane must still answer')
  assert.ok(provider.health.serper.until > startedAt, 'a 401 must start a serper cooldown')
  assert.equal(provider.health.serper.cls, 'auth')
  assert.deepEqual([deepseekFetch.calls.length, serperFetch.calls.length], [1, 1])

  // The degraded result is cached: the same query inside the window makes no request.
  const cached = await provider.search(request, OFFLINE_SIGNAL)
  assert.equal(deepseekFetch.calls.length, 1, 'the cached degraded result must not re-request deepseek')
  assert.equal(serperFetch.calls.length, 1, 'the cached degraded result must not re-request serper')
  assert.equal(cached.content, degraded.content, 'the Note is part of the cached result')

  // Clearing the cooldown and the cache makes the next search try both lanes again.
  provider.clearHealth('serper')
  provider.cache.clear()
  const recovered = await provider.search(request, OFFLINE_SIGNAL)
  assert.deepEqual(
    [deepseekFetch.calls.length, serperFetch.calls.length],
    [2, 2],
    'clearing health + cache must force a fresh request on both lanes',
  )
  assert.ok(
    (recovered.content ?? '').startsWith('Note: serper auth failed'),
    'the stub still answers 401, so the fresh search is degraded again',
  )
  assert.ok(provider.health.serper.until > Date.now(), 'the fresh 401 re-cools the lane')
}

/** Run every offline assertion, stopping at the first failure. */
async function runOfflineAssertions() {
  await assertRepeatedQueryHitsCache()
  console.log('offline: cache hit — a repeated query made 0 upstream requests')
  await assertDegradationCooldownAndRecovery()
  console.log('offline: degradation + cooldown — serper 401 → Note + auth cooldown, cached degraded result')
  console.log('offline: recovery — clearing health/cache re-requested both lanes')
}

/** Short failure description for a caught error (never includes a request body). */
function failureOf(error) {
  return `${error?.code ?? 'ERROR'}: ${String(error?.message ?? error).slice(0, 100)}`
}

const QUERIES = [
  'DeepSeek V4 发布 时间',
  'SQLite WAL mode concurrency limitations',
  'React 19 useActionState 用法',
]

/** Options for both live backends, mirroring what resolveOptions() feeds them. */
function backendOptions(deepseekKey, serperKey) {
  return {
    deepseekEnabled: true,
    primary: 'deepseek',
    ratio: 2,
    logLevel: 'off',
    deepseek: {
      apiKey: deepseekKey,
      baseURL: 'https://api.deepseek.com/v1/tools',
      count: 10,
      timeoutMs: 4500,
      summaryMaxChars: 600,
      minAuthority: -1,
      maxRetries: 1,
    },
    serper: {
      apiKey: serperKey,
      baseURL: 'https://google.serper.dev',
      gl: 'cn',
      hl: 'zh-cn',
      autoLocale: true,
      num: 10,
      timeoutMs: 4500,
    },
  }
}

/**
 * The original real-network smoke check: three merged queries plus one
 * per-backend probe, printing latency / composition / snippet lengths.
 * @returns {Promise<{mergedFailures: number, probeFailures: number}>} failure counts.
 */
async function runLiveChecks(deepseekKey, serperKey) {
  const provider = new MergedSearchProvider(() => backendOptions(deepseekKey, serperKey))
  const deepseek = new DeepSeekSearchApiBackend(() => backendOptions(deepseekKey, serperKey).deepseek)
  const serper = new SerperSearchProvider(() => backendOptions(deepseekKey, serperKey).serper)

  let mergedFailures = 0
  let probeFailures = 0

  for (const query of QUERIES) {
    const started = Date.now()
    try {
      const result = await provider.search({ query, maxResults: 8 })
      const elapsed = Date.now() - started
      const snippetLengths = result.sources.map((source) => source.snippet?.length ?? 0)
      const dated = result.sources.filter((source) => source.publishedAt !== undefined).length
      console.log('\n=== query:', query)
      console.log(`merged: ${elapsed}ms, ${result.sources.length} sources, truncated=${String(result.truncated)}, dated=${dated}/${result.sources.length}`)
      console.log(`snippet lengths: ${JSON.stringify(snippetLengths)}`)
      console.log(`content (serper answerBox): ${result.content === undefined ? '(none)' : JSON.stringify(result.content.slice(0, 80))}`)
      console.table(result.sources.slice(0, 8).map((source, index) => ({
        rank: index + 1,
        host: new URL(source.url).hostname,
        snippet: source.snippet?.length ?? 0,
      })))
    } catch (error) {
      mergedFailures += 1
      console.error(`\n=== query: ${query}\nmerged: FAILED ${failureOf(error)}`)
    }
  }

  // Per-backend timings for the first query; failures are reported, not thrown.
  for (const [label, backend] of [['deepseek', deepseek], ['serper', serper]]) {
    const started = Date.now()
    try {
      const result = await backend.search({ query: QUERIES[0], maxResults: 8 })
      const first = result.sources[0]
      console.log(`\n${label}: ${Date.now() - started}ms, ${result.sources.length} sources, first snippet ${first?.snippet?.length ?? 0} chars, dated ${result.sources.filter((source) => source.publishedAt !== undefined).length}/${result.sources.length}`)
    } catch (error) {
      probeFailures += 1
      console.log(`\n${label}: FAILED after ${Date.now() - started}ms — ${failureOf(error)}`)
    }
  }

  return { mergedFailures, probeFailures }
}

// ── Offline layer: no keys, no network, no credits ─────────────────────────
let failures = 0
try {
  await runOfflineAssertions()
} catch (error) {
  failures += 1
  console.error(`\nverify-live: OFFLINE ASSERTION FAILED — ${failureOf(error)}`)
  if (error?.stack !== undefined) console.error(error.stack)
}

// ── Live layer: only when both keys are present ────────────────────────────
const deepseekKey = process.env.DEEPSEEK_API_KEY
const serperKey = process.env.SERPER_API_KEY
const hasKeys = typeof deepseekKey === 'string' && deepseekKey.length > 0
  && typeof serperKey === 'string' && serperKey.length > 0

if (!hasKeys) {
  console.warn('\nverify-live: DEEPSEEK_API_KEY / SERPER_API_KEY not set — live network checks skipped (the offline assertions above needed no keys).')
} else {
  const { mergedFailures, probeFailures } = await runLiveChecks(deepseekKey, serperKey)
  if (probeFailures > 0) console.warn(`\nverify-live: ${probeFailures} per-backend probe failure(s) (non-fatal)`)
  if (mergedFailures > 0) {
    failures += 1
    console.error(`\nverify-live: ${mergedFailures} merged failure(s)`)
  }
}

if (failures > 0) {
  process.exitCode = 1
} else {
  console.log('\nverify-live: OK')
}
