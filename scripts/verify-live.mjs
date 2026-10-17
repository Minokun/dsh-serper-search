/**
 * Live smoke check for the v3 merged provider (real network, real credits).
 *
 *   set -a; . /tmp/keys.env; set +a
 *   node scripts/verify-live.mjs
 *
 * Requires SERPER_API_KEY and DEEPSEEK_API_KEY in the environment. Runs three
 * queries through both backends, merges them exactly as the harness does, and
 * prints latency / composition / snippet lengths. It never prints the keys and
 * exits non-zero only when a merged search fails; per-backend probe failures are
 * reported as warnings (a slow serper run still reports partial results).
 */
import { DeepSeekSearchApiBackend, MergedSearchProvider, SerperSearchProvider } from '../lib/index.js'

const deepseekKey = process.env.DEEPSEEK_API_KEY
const serperKey = process.env.SERPER_API_KEY
if (deepseekKey === undefined || deepseekKey.length === 0) throw new Error('DEEPSEEK_API_KEY is required')
if (serperKey === undefined || serperKey.length === 0) throw new Error('SERPER_API_KEY is required')

const QUERIES = [
  'DeepSeek V4 发布 时间',
  'SQLite WAL mode concurrency limitations',
  'React 19 useActionState 用法',
]

/** Options for both backends, mirroring what resolveOptions() feeds them. */
function backendOptions() {
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

const provider = new MergedSearchProvider(backendOptions)
const deepseek = new DeepSeekSearchApiBackend(() => backendOptions().deepseek)
const serper = new SerperSearchProvider(() => backendOptions().serper)

/** Short failure description for a caught backend error. */
function failureOf(error) {
  return `${error?.code ?? 'ERROR'}: ${String(error?.message ?? error).slice(0, 100)}`
}

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

if (probeFailures > 0) console.warn(`\nverify-live: ${probeFailures} per-backend probe failure(s) (non-fatal)`)
if (mergedFailures > 0) {
  console.error(`\nverify-live: ${mergedFailures} merged failure(s)`)
  process.exitCode = 1
} else {
  console.log('\nverify-live: OK')
}
