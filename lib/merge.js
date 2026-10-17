/**
 * dsh-serper-search, pure merge helpers: URL normalization, ranked interleave,
 * and response mapping for the two direct HTTP search backends.
 *
 * Kept dependency-free (no `@deepseek-ai/*` imports) so `node --test` can import
 * it standalone; the Host half (`lib/index.js`) is the only consumer in the
 * running harness.
 * @module dsh-serper-search/merge
 */

/**
 * Fixed ratio patterns (`P` = primary source, `S` = secondary source) keyed by
 * the accepted `ratio` values. A pattern is cycled one slot at a time; the
 * first eight slots therefore give the documented 8-source composition:
 * `4 → 7P+1S`, `3 → 6P+2S`, `2 → 6P+2S`, `1.5 → 5P+3S`, `1 → 4P+4S`.
 */
export const RATIO_PATTERNS = {
  4: ['P', 'P', 'P', 'P', 'P', 'P', 'P', 'S'],
  3: ['P', 'P', 'P', 'S'],
  2: ['P', 'P', 'S'],
  1.5: ['P', 'P', 'S', 'P', 'P', 'S', 'P', 'S'],
  1: ['P', 'S'],
}

/**
 * Tracking parameters stripped before URL comparison. `utm_*` / `spm_*` use a
 * prefix; every other entry is an exact parameter name. Short or business-like
 * names (`from`, `source`, `ref`, `share`, `scene`, `ch`-prefixed words) are
 * deliberately NOT prefix-matched: stripping them merged distinct pages
 * (`chapter`, `channel`, `from=20` pagination) in review.
 */
const TRACKING_PARAM = /^(?:utm_.*|spm_.*|spm|fromtitle|fromid|bst|ch|wfr|share_token|clicktime|sessionid)$/i

/** Locale path prefixes collapsed when comparing localized variants of one page. */
const LOCALE_PREFIXES = new Set(['en', 'zh', 'zh-cn', 'zh-tw', 'zh-hans', 'zh-hant', 'ja', 'ko', 'de', 'fr', 'es', 'pt', 'pt-br', 'it', 'ru', 'nl'])

/** Social/video hosts sorted behind editorial sources (disable with `demoteSocial: false`). */
const SOCIAL_HOSTS = ['reddit.com', 'x.com', 'twitter.com', 'news.ycombinator.com', 'youtube.com', 'facebook.com', 'instagram.com', 'tiktok.com', 'pinterest.com', 'quora.com']

/** Hostname of a candidate URL, or '' when unparseable. */
function hostOf(raw) {
  try {
    return new URL(raw).hostname.toLowerCase()
  } catch {
    return ''
  }
}

/** True when a host is (or is a subdomain of) a demoted social/video domain. */
function isSocialHost(host) {
  return SOCIAL_HOSTS.some((domain) => host === domain || host.endsWith(`.${domain}`))
}

/**
 * Locale-stripped comparison key for a localized variant (`/de/blog/x` → `origin//blog/x`).
 * Returns null when the first path segment is not a known locale prefix.
 */
function localeKey(raw) {
  try {
    const url = new URL(raw)
    const segments = url.pathname.split('/').filter(Boolean)
    if (segments.length < 2 || !LOCALE_PREFIXES.has(segments[0].toLowerCase())) return null
    return `${url.origin}/${segments.slice(1).join('/')}${url.search}`
  } catch {
    return null
  }
}

/** Stable partition: editorial sources first, social/video last. */
function orderByQuality(list, demoteSocial) {
  if (demoteSocial !== true) return list
  const preferred = []
  const demoted = []
  for (const source of list) (isSocialHost(hostOf(source.url)) ? demoted : preferred).push(source)
  return [...preferred, ...demoted]
}

/**
 * Normalize one result URL for dedupe comparison: drop the fragment, strip
 * tracking parameters, trim a trailing slash, lowercase the host.
 *
 * The returned string is only a comparison key — providers keep the original
 * URL on the source they return, so links the model sees are never rewritten.
 * @param {unknown} raw - the candidate URL.
 * @returns {string} the comparison key, or `''` when `raw` is not a string.
 */
export function normalizeUrl(raw) {
  if (typeof raw !== 'string') return ''
  const trimmed = raw.trim()
  try {
    const url = new URL(trimmed)
    url.hash = ''
    for (const key of [...url.searchParams.keys()]) {
      if (TRACKING_PARAM.test(key)) url.searchParams.delete(key)
    }
    if (url.pathname.length > 1 && url.pathname.endsWith('/')) {
      url.pathname = url.pathname.replace(/\/+$/, '')
    }
    url.hostname = url.hostname.toLowerCase()
    return url.toString()
  } catch {
    return trimmed
  }
}

/**
 * Merge two ranked source lists: dedupe by normalized URL (the primary list
 * wins duplicates), demote social/video hosts, interleave by the fixed ratio
 * pattern under a per-host diversity cap, then truncate to `maxResults`.
 *
 * The provider truncates instead of leaving it to `ctx.web.capSources()`: a
 * result longer than `maxResults` makes the seam flag `truncated: true`, and
 * `dsh-tool-web` then appends a "Refine the query for more" hint to every
 * search, nudging the model into extra re-searches.
 *
 * v3.1 quality rules (measured against two real research sessions):
 * - `maxPerHost` (default 2) keeps one site from squatting on the result list;
 *   localized variants of the same page (`/de/…` vs `/fr/…`) collapse first.
 * - `demoteSocial` (default true) sorts reddit/x.com/HN/YouTube-style hosts
 *   behind editorial and official sources, so they only fill leftover slots.
 * - The host cap is strict: when the pool cannot supply enough distinct hosts,
 *   the result is shorter than `maxResults` rather than repeating one site.
 *
 * @param {Array<{url?: unknown}>} primarySources - the primary backend's sources, in rank order.
 * @param {Array<{url?: unknown}>} secondarySources - the secondary backend's sources, in rank order.
 * @param {{ ratio?: number, maxResults?: number, maxPerHost?: number, demoteSocial?: boolean }} [options]
 * - ratio key, result cap, per-host cap (0 disables) and social demotion.
 * @returns {{ sources: Array<object>, truncated: false }} the merged sources plus a fixed `truncated: false`.
 */
export function mergeSources(primarySources, secondarySources, { ratio = 2, maxResults, maxPerHost = 2, demoteSocial = true } = {}) {
  const seenExact = new Set()
  const seenLocalized = new Set()
  const dedupe = (list) => (Array.isArray(list) ? list : []).filter((source) => {
    if (typeof source?.url !== 'string' || source.url.length === 0) return false
    const key = normalizeUrl(source.url)
    if (seenExact.has(key)) return false
    const localized = localeKey(source.url)
    if (localized !== null) {
      const localizedKey = localized.toLowerCase()
      if (seenLocalized.has(localizedKey)) return false
      seenLocalized.add(localizedKey)
    }
    seenExact.add(key)
    return true
  })
  const primary = orderByQuality(dedupe(primarySources), demoteSocial)
  const secondary = orderByQuality(dedupe(secondarySources), demoteSocial)

  const pattern = RATIO_PATTERNS[ratio] ?? RATIO_PATTERNS[2]
  const cap = Number.isInteger(maxResults) && maxResults > 0
    ? maxResults
    : primary.length + secondary.length
  const hostCap = Number.isInteger(maxPerHost) && maxPerHost > 0 ? maxPerHost : 0
  const hostCounts = new Map()
  const sources = []
  const take = (source) => {
    const host = hostOf(source.url)
    hostCounts.set(host, (hostCounts.get(host) ?? 0) + 1)
    sources.push(source)
  }
  const eligible = (source) => hostCap === 0 || (hostCounts.get(hostOf(source.url)) ?? 0) < hostCap

  let i = 0
  let j = 0
  let step = 0
  while (sources.length < cap && (i < primary.length || j < secondary.length)) {
    const slot = pattern[step % pattern.length]
    step += 1
    let source
    if (slot === 'P') {
      if (i < primary.length) source = primary[i++]
      else if (j < secondary.length) source = secondary[j++]
    } else if (j < secondary.length) {
      source = secondary[j++]
    } else if (i < primary.length) {
      source = primary[i++]
    }
    if (source === undefined) break
    if (eligible(source)) take(source)
  }
  return { sources, truncated: false }
}

/**
 * Merge two normalized backend results: interleave their sources and keep the
 * result-level `content` (serper's answer box) whichever side is primary.
 * @param {{ sources?: Array<object>, content?: string }} primary - the primary backend result.
 * @param {{ sources?: Array<object>, content?: string }} secondary - the secondary backend result.
 * @param {{ ratio?: number, maxResults?: number, maxPerHost?: number, demoteSocial?: boolean }} [options]
 * - merge options forwarded to {@link mergeSources}.
 * @returns {{ sources: Array<object>, content?: string, truncated: false }} the merged result.
 */
export function mergeResults(primary, secondary, { ratio = 2, maxResults, maxPerHost = 2, demoteSocial = true } = {}) {
  const { sources } = mergeSources(primary?.sources, secondary?.sources, { ratio, maxResults, maxPerHost, demoteSocial })
  // Pick the first non-empty answer box, so an empty primary `content` cannot
  // shadow a usable secondary one (unreachable with the current backends).
  const content = [primary?.content, secondary?.content].find((value) => typeof value === 'string' && value.length > 0)
  return {
    ...(content === undefined ? {} : { content }),
    sources,
    truncated: false,
  }
}

/** Collapse all whitespace runs (including newlines) into single spaces. */
function foldWhitespace(text) {
  return text.replace(/\s+/gu, ' ').trim()
}

/**
 * Clip a long summary to the configured character budget.
 * @param {string} summary - the raw `summary` field.
 * @param {number} summaryMaxChars - budget; `0` disables summary injection.
 * @returns {string | undefined} the folded, clipped text, or `undefined` when disabled/empty.
 */
function clipSummary(summary, summaryMaxChars) {
  if (!Number.isInteger(summaryMaxChars) || summaryMaxChars <= 0) return undefined
  const folded = foldWhitespace(summary)
  if (folded.length === 0) return undefined
  if (folded.length <= summaryMaxChars) return folded
  return `${folded.slice(0, Math.max(0, summaryMaxChars - 1))}…`
}

/**
 * Map a DeepSeek Search API (`POST /v1/tools/search`) response to the seam's
 * normalized result. `summary` replaces the short `snippet` when
 * `summaryMaxChars > 0` — the shipped DSH provider drops `summary` entirely,
 * which measured 1893 characters versus 231 for `snippet`.
 * @param {unknown} payload - the parsed response body.
 * @param {{ summaryMaxChars?: number, minAuthority?: number }} [options] - mapping options.
 * @returns {{ sources: Array<object>, truncated: false }} normalized sources.
 */
export function mapDeepSeekSearchResponse(payload, { summaryMaxChars = 600, minAuthority = -1 } = {}) {
  const results = Array.isArray(payload?.results) ? payload.results : []
  const sources = []
  for (const item of results) {
    if (typeof item?.url !== 'string' || item.url.length === 0) continue
    const authority = typeof item.authority === 'number' ? item.authority : -1
    if (Number.isInteger(minAuthority) && minAuthority >= 0 && authority >= 0 && authority < minAuthority) continue
    const title = typeof item.title === 'string' && item.title.length > 0 ? item.title : undefined
    const summary = typeof item.summary === 'string' ? clipSummary(item.summary, summaryMaxChars) : undefined
    const rawSnippet = typeof item.snippet === 'string' && item.snippet.length > 0 ? item.snippet : undefined
    const publishedAt = typeof item.date === 'string' && item.date.length > 0 ? item.date : undefined
    sources.push({
      url: item.url,
      ...(title === undefined ? {} : { title }),
      ...(summary !== undefined ? { snippet: summary } : rawSnippet === undefined ? {} : { snippet: rawSnippet }),
      ...(publishedAt === undefined ? {} : { publishedAt }),
    })
  }
  return { sources, truncated: false }
}

/** Serper's organic `date` is a human string; Chinese dates are the common case. */
const CN_DATE = /^(\d{4})年(\d{1,2})月(\d{1,2})日$/

/**
 * Normalize a serper organic `date` for the seam's `publishedAt`.
 * @param {unknown} value - the raw date field.
 * @returns {string | undefined} `YYYY-MM-DD` for Chinese dates, ISO for parseable
 * strings, the trimmed original for anything else, `undefined` when absent.
 */
export function normalizeSerperDate(value) {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  if (trimmed.length === 0) return undefined
  const chinese = CN_DATE.exec(trimmed)
  if (chinese !== null) {
    const [, year, month, day] = chinese
    return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
  }
  if (/^\d{4}-\d{2}-\d{2}/u.test(trimmed)) return trimmed
  const parsed = Date.parse(trimmed)
  if (!Number.isNaN(parsed)) return new Date(parsed).toISOString()
  return trimmed
}

/**
 * Map a serper.dev `/search` response to the seam's normalized result:
 * `organic[]` becomes sources (deduped by normalized URL), `answerBox` becomes
 * the result-level `content` — the only backend that fills it.
 * @param {unknown} payload - the parsed response body.
 * @returns {{ sources: Array<object>, content?: string, truncated: false }} the normalized result.
 */
export function mapSerperResponse(payload) {
  const organic = Array.isArray(payload?.organic) ? payload.organic : []
  const seen = new Set()
  const sources = []
  for (const item of organic) {
    const url = item?.link
    if (typeof url !== 'string' || url.length === 0) continue
    const key = normalizeUrl(url)
    if (seen.has(key)) continue
    seen.add(key)
    const title = typeof item.title === 'string' && item.title.length > 0 ? item.title : undefined
    const snippet = typeof item.snippet === 'string' && item.snippet.length > 0 ? item.snippet : undefined
    const publishedAt = normalizeSerperDate(item.date)
    sources.push({
      url,
      ...(title === undefined ? {} : { title }),
      ...(snippet === undefined ? {} : { snippet }),
      ...(publishedAt === undefined ? {} : { publishedAt }),
    })
  }
  const box = payload?.answerBox
  const content = box === null || box === undefined
    ? undefined
    : [box.answer, box.snippet].find((value) => typeof value === 'string' && value.length > 0)
  return {
    ...(content === undefined ? {} : { content }),
    sources,
    truncated: false,
  }
}

/** CJK detection used to pick the serper locale for a query. */
export const CJK = /[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/u

/**
 * Pick the region/language a serper request should use. When `autoLocale` is on
 * and the configured region is `cn`, pure-English/code queries go to `us`/`en`:
 * measured latency dropped from 3.6–10.5 s to 1.0–1.7 s for four English
 * queries, while Chinese queries keep the configured region.
 * @param {string} query - the search query.
 * @param {{ gl?: string, hl?: string, autoLocale?: boolean }} [options] - configured locale.
 * @returns {{ gl: string, hl: string }} the locale for this request.
 */
export function effectiveSerperLocale(query, { gl = 'cn', hl = 'zh-cn', autoLocale = true } = {}) {
  if (autoLocale !== true || gl !== 'cn') return { gl, hl }
  if (typeof query !== 'string' || CJK.test(query)) return { gl, hl }
  return { gl: 'us', hl: 'en' }
}
