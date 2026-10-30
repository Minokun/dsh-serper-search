/**
 * LRU + TTL result cache for the merged provider (P0-2, plan §4).
 *
 * One search costs two backend requests, and the tool layer re-searches the
 * same query within minutes ("Refine the query", follow-up turns, folded
 * multi-query runs). A hit therefore removes both the spend and the tail
 * latency of that turn.
 *
 * Only successful results with at least one source are stored: failures and
 * aborts never reach `set()`. The caller stores a degraded (single-lane) result
 * with a shorter TTL so "that lane was down" is not pinned for the full window.
 *
 * The insertion-ordered `Map` provides LRU for free: a hit re-inserts the entry
 * at the end, and eviction removes the oldest key first.
 */

/** Entries kept before the least recently used one is evicted (plan: 50). */
const DEFAULT_MAX_ENTRIES = 50

/** One in-memory result cache; the merged provider owns exactly one. */
export class ResultCache {
  /**
   * @param {number} [maxEntries] - entry cap; defaults to 50.
   */
  constructor(maxEntries = DEFAULT_MAX_ENTRIES) {
    this.max = maxEntries
    this.map = new Map()
  }

  /**
   * Read one entry. Expired entries are treated as a miss and dropped; live
   * entries are re-inserted so the iteration order stays least-recent-first.
   * @param {string} key - key built by {@link cacheKey}.
   * @param {number} [now] - clock, injectable for tests.
   * @returns {object | undefined} a defensive copy of the cached result.
   */
  get(key, now = Date.now()) {
    const hit = this.map.get(key)
    if (hit === undefined) return undefined
    if (hit.expiresAt <= now) {
      this.map.delete(key)
      return undefined
    }
    this.map.delete(key)
    this.map.set(key, hit)
    return cloneResult(hit.value)
  }

  /**
   * Store one result, evicting the least recently used entry above the cap.
   * A non-positive TTL or a source-less result is ignored.
   * @param {string} key - key built by {@link cacheKey}.
   * @param {object} value - the result to clone and keep.
   * @param {number} ttlMs - lifetime in milliseconds.
   * @param {number} [now] - clock, injectable for tests.
   * @returns {boolean} true when an entry was actually stored.
   */
  set(key, value, ttlMs, now = Date.now()) {
    if (ttlMs <= 0 || !value?.sources?.length) return false
    this.map.delete(key)
    this.map.set(key, { value: cloneResult(value), expiresAt: now + ttlMs })
    while (this.map.size > this.max) this.map.delete(this.map.keys().next().value)
    return true
  }

  /** Drop every entry. */
  clear() {
    this.map.clear()
  }
}

/**
 * Build the cache key: every setting that can change the merged output goes in,
 * so two requests only share an entry when they would return the same result.
 *
 * - `q` collapses whitespace, so `'  a   b '` and `'a b'` share an entry.
 * - `cap` is the request's `maxResults`; the tool layer's 8 vs 12 never mix.
 * - the endpoints (`serper.baseURL`, `deepseek.baseURL`) are editable live in the
 *   settings card: switching one must never serve results proxied by the old one.
 * - `autoLocale` changes the effective gl/hl for the same query, so it is part of
 *   the key even though the resolved locale is derived from `q`.
 * - `native` / `se` / `yb` switch a lane off: a two-lane answer must never be
 *   served to a request that would have used a different lane set.
 *
 * @param {string} query - the raw request query.
 * @param {object} options - the resolved options snapshot.
 * @param {number} [cap] - the requested result cap.
 * @returns {string} a stable JSON key.
 */
export function cacheKey(query, options, cap) {
  return JSON.stringify({
    q: String(query ?? '').trim().replace(/\s+/g, ' '),
    cap: cap ?? 0,
    primary: options.primary,
    ratio: options.ratio,
    maxPerHost: options.maxPerHost,
    demote: options.demoteSocial,
    sbase: options.serper?.baseURL,
    dbase: options.deepseek?.baseURL,
    gl: options.serper?.gl,
    hl: options.serper?.hl,
    autoLocale: options.serper?.autoLocale,
    num: options.serper?.num,
    native: options.deepseekEnabled,
    se: options.serperEnabled,
    dcount: options.deepseek?.count,
    smc: options.deepseek?.summaryMaxChars,
    auth: options.deepseek?.minAuthority,
    // v0.5.0: the Yuanbao lane and the resolved interleave pattern change the
    // output, so a cached two-lane answer must never be served to a three-lane
    // request (and vice versa).
    yb: options.yuanbaoEnabled,
    yep: options.yuanbao?.endpoint,
    ycnt: options.yuanbao?.count,
    pat: Array.isArray(options.pattern) ? options.pattern.join(',') : undefined,
    lanes: Array.isArray(options.lanes) ? options.lanes.join(',') : undefined,
  })
}

/** Copy a result so callers can mutate sources without touching the cache. */
function cloneResult(result) {
  return { ...result, sources: result.sources.map((source) => ({ ...source })) }
}
