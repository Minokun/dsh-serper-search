/**
 * Live smoke check for the v3 merged provider (real network, real credits).
 *
 *   set -a; . /tmp/keys.env; set +a
 *   node scripts/verify-live.mjs
 *
 * Requires SERPER_API_KEY and DEEPSEEK_API_KEY in the environment. Runs three
 * queries through both backends, merges them exactly as the harness does, and
 * prints latency / composition / snippet lengths. It never prints the keys.
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
      timeoutMs: 5000,
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

/** Which backend produced each host, for the composition report. */
function composition(result) {
  const hosts = result.sources.map((source) => new URL(source.url).hostname)
  return { count: result.sources.length, hosts: hosts.slice(0, 8) }
}

for (const query of QUERIES) {
  const started = Date.now()
  const result = await provider.search({ query, maxResults: 8 })
  const elapsed = Date.now() - started
  const snippetLengths = result.sources.map((source) => source.snippet?.length ?? 0)
  const dated = result.sources.filter((source) => source.publishedAt !== undefined).length
  console.log('\n=== query:', query)
  console.log(`merged: ${elapsed}ms, ${result.sources.length} sources, truncated=${String(result.truncated)}, dated=${dated}/8`)
  console.log(`snippet lengths: ${JSON.stringify(snippetLengths)}`)
  console.log(`content (serper answerBox): ${result.content === undefined ? '(none)' : JSON.stringify(result.content.slice(0, 80))}`)
  console.table(composition(result).hosts.map((host, index) => ({ rank: index + 1, host })))
}

// Per-backend timings for the same first query (two extra requests).
const first = QUERIES[0]
for (const [label, backend] of [['deepseek', deepseek], ['serper', serper]]) {
  const started = Date.now()
  const result = await backend.search({ query: first, maxResults: 8 })
  console.log(`\n${label}: ${Date.now() - started}ms, ${result.sources.length} sources, first snippet ${result.sources[0]?.snippet?.length ?? 0} chars`)
}

console.log('\nverify-live: OK')
