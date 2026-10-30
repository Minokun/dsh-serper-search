/**
 * Host-side runtime routes for the settings card (P1-5, plan §7; update check
 * P1-6, plan §8): probe each search lane (two or three, depending on
 * `yuanbaoEnabled`), check for updates, and switch the `web.searchProvider` pin.
 *
 * The three routes are POST-only exact paths under `/api/dsh-serper-search`,
 * and every one of them passes DSH's own connection fence first
 * (`connection.requestRejection`), which covers both the Host/Origin check and
 * the login-token cookie — no hand-written guard. Registration happens inside
 * `ctx.inject(['webServer', 'connection', 'settings'], …)`, so a deployment
 * missing any of them simply has no routes: the card's requests fall through
 * (404, or the SPA fallback's 405) and it reports self-check as unsupported.
 *
 * Bodies are capped at 64 KiB. `/provider` accepts only
 * `{"action":"take"}` or `{"action":"release"}`; anything else (missing body,
 * unknown or misspelled action) answers 400 before a single settings write, so
 * a stray request can never silently pin serper. Probe and update-check run
 * single-flight (concurrent clicks and tabs share one request), and no response
 * ever carries a credential — only lane timings, counts, HTTP status codes, and
 * failure class.
 *
 * `/provider` writes the one-shot `takeOverProvider: false` marker first on
 * release (marker, then unset pin): a failure between the two leaves a pin the
 * next start respects, rather than a pin already deleted while the marker is
 * missing — which would let the takeover run again on the next start while the
 * card reported the release as failed. `take` keeps pin-then-marker, whose
 * worst case self-heals: a pinned `serper` is a user pin on the next start, so
 * startup writes the marker itself and never overrides the pin.
 *
 * `update-check` fetches the npm registry from the Host (the browser would hit
 * CORS) with the small "corgi" install-document media type, redirects treated
 * as errors and a 1 MiB stream cap, compares `dist-tags.latest` with this
 * package's version using the built-in semver comparator (no dependency), and
 * caches the answer for ten minutes. Concurrent checks share one lookup, and a
 * wall clock that moved backwards invalidates the cached age instead of
 * freezing a stale answer. There is no one-click upgrade on purpose:
 * auto-`add @latest` would break `link:` development installs.
 * @module dsh-serper-search/routes
 */

import { OWN_NS, SERPER_PROVIDER_ID } from './index.js'

/** Route prefix owned by this plugin. */
const PREFIX = '/api/dsh-serper-search'

/** Hard body limit for `/provider`, the one route that reads a body. */
export const MAX_BODY_BYTES = 64 * 1024

/** Outer probe budget; each lane's request timeout is temporarily this value. */
const PROBE_TIMEOUT_MS = 8000

/** The request body exceeded {@link MAX_BODY_BYTES}. */
export class BodyTooLargeError extends Error {}

/** The request body was not valid JSON. */
export class InvalidJsonError extends Error {}

/** The request carried a well-formed body this route does not accept. */
export class BadRequestError extends Error {}

/** npm registry document for this package (read on the Host, not in the browser). */
export const NPM_REGISTRY_URL = 'https://registry.npmjs.org/dsh-serper-search'

/** Human-facing npm page the card links to when an update exists. */
export const NPM_PACKAGE_URL = 'https://www.npmjs.com/package/dsh-serper-search'

/** How long one registry answer is reused (plan §8). */
export const UPDATE_CACHE_TTL_MS = 10 * 60 * 1000

/** Registry request budget; well below the card's own 15s request ceiling. */
const REGISTRY_TIMEOUT_MS = 8000

/**
 * Registry "corgi" media type (`application/vnd.npm.install-v1+json`): the
 * install document with `dist-tags` and version metadata but no READMEs, an
 * order of magnitude smaller than the full packument this check never needs.
 */
const REGISTRY_ACCEPT = 'application/vnd.npm.install-v1+json'

/**
 * Hard cap for the registry response body kept in memory (1 MiB). The check
 * needs one short string out of it; an answer over the cap is a failure, not a
 * reason to buffer an unbounded body.
 */
export const UPDATE_MAX_RESPONSE_BYTES = 1024 * 1024

/** One `major.minor.patch` triple with an optional prerelease tail. */
const SEMVER_RE = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/

/**
 * Parse a semver 2.0 string into its comparable parts.
 * @param {unknown} value - candidate version.
 * @returns {{numbers: number[], prerelease: string[] | null} | null} parsed form, or null.
 */
function parseSemver(value) {
  if (typeof value !== 'string') return null
  const match = SEMVER_RE.exec(value.trim())
  if (match === null) return null
  return {
    numbers: [Number(match[1]), Number(match[2]), Number(match[3])],
    prerelease: match[4] === undefined ? null : match[4].split('.'),
  }
}

/**
 * Compare two semver versions, following semver 2.0 precedence: numeric
 * identifiers compare numerically, alphanumerics lexically, and any prerelease
 * sorts below the matching release (`0.4.0-beta < 0.4.0`).
 * @param {string} left - first version.
 * @param {string} right - second version.
 * @returns {number} -1, 0, or 1.
 * @throws {TypeError} when either side is not a valid version.
 */
export function compareSemver(left, right) {
  const a = parseSemver(left)
  const b = parseSemver(right)
  if (a === null) throw new TypeError(`not a semantic version: ${String(left)}`)
  if (b === null) throw new TypeError(`not a semantic version: ${String(right)}`)
  for (let index = 0; index < 3; index += 1) {
    if (a.numbers[index] !== b.numbers[index]) return a.numbers[index] > b.numbers[index] ? 1 : -1
  }
  if (a.prerelease === null && b.prerelease === null) return 0
  // A release outranks any prerelease of the same triple.
  if (a.prerelease === null) return 1
  if (b.prerelease === null) return -1
  const length = Math.min(a.prerelease.length, b.prerelease.length)
  for (let index = 0; index < length; index += 1) {
    const x = a.prerelease[index]
    const y = b.prerelease[index]
    if (x === y) continue
    const xNumeric = /^\d+$/.test(x)
    const yNumeric = /^\d+$/.test(y)
    if (xNumeric && yNumeric) return Number(x) > Number(y) ? 1 : -1
    // Numeric identifiers always have lower precedence than alphanumeric ones.
    if (xNumeric) return -1
    if (yNumeric) return 1
    return x > y ? 1 : -1
  }
  if (a.prerelease.length === b.prerelease.length) return 0
  return a.prerelease.length > b.prerelease.length ? 1 : -1
}

/**
 * Read at most `limitBytes` of a fetch response body and decode it as UTF-8
 * text. `response.json()` would parse an unbounded body, so the registry
 * answer is streamed and capped; an oversized body cancels the stream and is
 * reported as a failure (the checker never caches a failure).
 * @param {Response} response - a fetch response with a readable body.
 * @param {number} limitBytes - maximum accepted body size.
 * @returns {Promise<string>} the decoded body.
 * @throws {Error} when the response has no readable body or exceeds the cap.
 */
async function readCappedText(response, limitBytes) {
  const body = response.body
  if (body === null || body === undefined) throw new Error('npm registry returned an unreadable body')
  const reader = body.getReader()
  /** @type {Uint8Array[]} */
  const chunks = []
  let size = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done === true) break
      const chunk = value instanceof Uint8Array ? value : new Uint8Array(value)
      size += chunk.byteLength
      if (size > limitBytes) {
        // Drop the rest: the body is already rejected, so don't sit on a socket.
        await reader.cancel().catch(() => {})
        throw new Error(`npm registry response exceeds ${limitBytes} bytes`)
      }
      chunks.push(chunk)
    }
  } finally {
    try {
      reader.releaseLock()
    } catch {
      // A cancelled stream may still hold the lock for a tick; nothing is read
      // after this point, so the body is done either way.
    }
  }
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return new TextDecoder().decode(bytes)
}

/**
 * Build a cached npm registry checker. Tests inject both `fetchImpl` and
 * `now`; production uses the globals.
 *
 * The lookup is single-flight: concurrent callers (a double click, two tabs)
 * share one registry request, and a failure clears the flight so the next
 * click retries. A successful answer is cached for `ttlMs`; a negative cache
 * age (the wall clock moved backwards) is treated as a miss, because the age
 * of the entry can no longer be trusted.
 * @param {object} [options] - overrides.
 * @param {typeof fetch} [options.fetchImpl] - registry transport.
 * @param {() => number} [options.now] - clock, in milliseconds.
 * @param {number} [options.ttlMs] - cache lifetime.
 * @param {string} [options.registryUrl] - registry document URL.
 * @param {string} [options.packageUrl] - npm page linked from the card.
 * @returns {(current: string, hooks?: {log?: (line: string) => void}) => Promise<{ok: true, version: string, latest: string, hasUpdate: boolean, url: string}>} the checker.
 */
export function createUpdateChecker({
  fetchImpl,
  now = Date.now,
  ttlMs = UPDATE_CACHE_TTL_MS,
  registryUrl = NPM_REGISTRY_URL,
  packageUrl = NPM_PACKAGE_URL,
} = {}) {
  /** @type {{latest: string, at: number} | null} */
  let cache = null
  /** @type {Promise<string> | null} */
  let inflight = null

  /** Read `dist-tags.latest` from the registry. */
  const fetchLatest = async (current) => {
    const doFetch = fetchImpl ?? globalThis.fetch
    const response = await doFetch(registryUrl, {
      headers: {
        // Small install document: dist-tags only, no README/tarball metadata.
        accept: REGISTRY_ACCEPT,
        'user-agent': `dsh-serper-search/${current}`,
      },
      // A registry answer that redirects is not the document this check reads;
      // following it would let a hostile hop pick the content.
      redirect: 'error',
      signal: AbortSignal.timeout(REGISTRY_TIMEOUT_MS),
    })
    if (response.ok !== true) throw new Error(`npm registry answered HTTP ${response.status}`)
    const text = await readCappedText(response, UPDATE_MAX_RESPONSE_BYTES)
    let payload
    try {
      payload = JSON.parse(text)
    } catch {
      throw new Error('npm registry returned invalid JSON')
    }
    const latest = payload?.['dist-tags']?.latest
    if (parseSemver(latest) === null) throw new Error('npm registry returned no usable dist-tags.latest')
    return latest
  }

  return async function checkUpdate(current, { log } = {}) {
    const at = now()
    if (cache !== null) {
      const age = at - cache.at
      // `age < 0` means the clock stepped backwards; treat the entry as a miss
      // rather than keeping a stale answer for the whole remaining TTL.
      if (age >= 0 && age < ttlMs) {
        log?.('web-search-serper: update-check cache=hit')
        return {
          ok: true,
          version: current,
          latest: cache.latest,
          hasUpdate: compareSemver(cache.latest, current) > 0,
          url: packageUrl,
        }
      }
    }
    log?.('web-search-serper: update-check cache=miss')
    if (inflight === null) {
      inflight = fetchLatest(current)
        .then((latest) => {
          cache = { latest, at }
          return latest
        })
        .finally(() => {
          inflight = null
        })
    }
    const latest = await inflight
    return {
      ok: true,
      version: current,
      latest,
      hasUpdate: compareSemver(latest, current) > 0,
      url: packageUrl,
    }
  }
}

/** Process-wide checker: one registry lookup per ten minutes for the deployment. */
const defaultCheckUpdate = createUpdateChecker()

/**
 * Register the three runtime routes once the required services exist.
 * @param {import('@deepseek-ai/cordis').Context} ctx - plugin context.
 * @param {{provider: object, version: string, checkUpdate?: Function}} options - the merged
 *   provider, package version, and (for tests) a registry checker override.
 * @returns {void}
 */
export function registerRuntimeRoutes(ctx, { provider, version, checkUpdate = defaultCheckUpdate }) {
  ctx.inject(['webServer', 'connection', 'settings'], (sctx) => {
    /** Single-flight: concurrent clicks share one probe (and one pair of paid requests). */
    let inflight = null
    const probeOnce = () => {
      if (inflight === null) {
        inflight = Promise.resolve()
          .then(() => provider.probe({ timeoutMs: PROBE_TIMEOUT_MS }))
          .finally(() => {
            inflight = null
          })
      }
      return inflight
    }

    sctx.effect(() => sctx.webServer.register({
      kind: 'exact',
      path: `${PREFIX}/probe`,
      handler: fence(sctx, `${PREFIX}/probe`, async (req, res) => {
        const lanes = await probeOnce()
        writeJson(res, 200, { ok: true, version, lanes })
      }),
    }))

    sctx.effect(() => sctx.webServer.register({
      kind: 'exact',
      path: `${PREFIX}/update-check`,
      handler: fence(sctx, `${PREFIX}/update-check`, async (req, res) => {
        const payload = await checkUpdate(version, {
          log: (line) => sctx.logger?.info?.(line),
        })
        writeJson(res, 200, payload)
      }),
    }))

    sctx.effect(() => sctx.webServer.register({
      kind: 'exact',
      path: `${PREFIX}/provider`,
      handler: fence(sctx, `${PREFIX}/provider`, async (req, res) => {
        const body = await readJson(req)
        // Only the two documented actions are accepted: an empty body, a typo
        // or an unknown action must not be coerced into pinning serper.
        const action = body?.action
        if (action !== 'take' && action !== 'release') {
          throw new BadRequestError('body.action must be "take" or "release"')
        }
        /** One-shot marker: written on both actions so a release is not re-taken over either. */
        const marker = [{ op: 'set', path: ['takeOverProvider'], value: false }]
        if (action === 'release') {
          // Marker first: if the unset then fails, the pin survives (the card
          // reports the failure and the click can be retried) but the marker
          // already forbids a re-takeover. The opposite order could delete the
          // pin and then fail to write the marker, so the next start would
          // silently take over again while the UI said the release failed.
          await sctx.settings.mutate(OWN_NS, marker)
          await sctx.settings.mutate('web', [{ op: 'unset', path: ['searchProvider'] }])
        } else {
          await sctx.settings.mutate('web', [{ op: 'set', path: ['searchProvider'], value: SERPER_PROVIDER_ID }])
          // Worst case this marker write fails: the next start sees a user pin
          // of serper, writes the marker itself, and never overrides the pin.
          await sctx.settings.mutate(OWN_NS, marker)
        }
        writeJson(res, 200, { ok: true, action })
      }),
    }))
  })
}

/**
 * Wrap one route handler with the connection fence, the POST-only rule, and a
 * last-resort JSON error so a thrown handler cannot leave the socket hanging.
 * @param {object} sctx - context that injected the three services.
 * @param {string} routePath - the path being served, for the Host log line.
 * @param {(req: object, res: object) => Promise<void>} handler - the route body.
 * @returns {(req: object, res: object) => Promise<void>} the guarded handler.
 */
function fence(sctx, routePath, handler) {
  return async (req, res) => {
    const rejection = sctx.connection.requestRejection(req)
    if (rejection !== undefined) {
      res.statusCode = rejection
      res.end()
      return
    }
    if (req.method !== 'POST') {
      writeJson(res, 405, { error: 'method not allowed' })
      return
    }
    try {
      await handler(req, res)
    } catch (error) {
      if (res.headersSent === true || res.writableEnded === true) {
        res.end?.()
        return
      }
      if (error instanceof BodyTooLargeError) {
        writeJson(res, 413, { ok: false, error: 'request body too large' })
      } else if (error instanceof InvalidJsonError) {
        writeJson(res, 400, { ok: false, error: 'invalid JSON body' })
      } else if (error instanceof BadRequestError) {
        writeJson(res, 400, { ok: false, error: error.message })
      } else {
        // No Host-side logging existed here (review m10): an unexpected route
        // failure must leave a line in the deployment log instead of only a
        // 500 the card renders as "try again".
        const detail = error instanceof Error ? error.message : String(error)
        sctx.logger?.warn?.(`web-search-serper: ${routePath} failed: ${detail}`)
        writeJson(res, 500, { ok: false, error: 'internal error' })
      }
    }
  }
}

/**
 * Read and parse one bounded JSON request body.
 * @param {object} req - the Node request stream.
 * @returns {Promise<unknown | undefined>} the parsed body, or undefined when empty.
 */
async function readJson(req) {
  const body = await readBody(req)
  if (body.length === 0) return undefined
  try {
    return JSON.parse(body.toString('utf8'))
  } catch {
    throw new InvalidJsonError('request body is not valid JSON')
  }
}

/**
 * Read at most {@link MAX_BODY_BYTES}; a larger body is drained and rejected
 * without buffering the rest.
 * @param {object} req - the Node request stream.
 * @returns {Promise<Buffer>} the raw body.
 */
function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    let settled = false
    const cleanup = () => {
      // Keep the `error` listener: removing it would let a late stream error
      // (a client abort while the body is draining) surface as an unhandled
      // 'error' event and take the process down.
      req.off?.('data', onData)
      req.off?.('end', onEnd)
    }
    const finish = (callback, value) => {
      if (settled) return
      settled = true
      cleanup()
      callback(value)
    }
    const onData = (chunk) => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      size += buffer.length
      if (size > MAX_BODY_BYTES) {
        // Keep consuming so the client sees the 413 instead of a reset socket.
        req.resume?.()
        finish(reject, new BodyTooLargeError(`request body exceeds ${MAX_BODY_BYTES} bytes`))
        return
      }
      chunks.push(buffer)
    }
    const onEnd = () => {
      finish(resolve, Buffer.concat(chunks))
    }
    const onError = (error) => {
      finish(reject, error)
    }
    req.on('data', onData)
    req.on('end', onEnd)
    req.on('error', onError)
  })
}

/**
 * Send one JSON response.
 * @param {object} res - the Node response.
 * @param {number} status - HTTP status code.
 * @param {unknown} payload - JSON-serializable body.
 * @returns {void}
 */
function writeJson(res, status, payload) {
  if (res.writableEnded === true) return
  res.statusCode = status
  res.setHeader?.('content-type', 'application/json; charset=utf-8')
  res.setHeader?.('cache-control', 'no-store')
  res.end(JSON.stringify(payload))
}
