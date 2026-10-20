/**
 * Unit tests for the P1-6 update check (plan §8).
 *
 * Covers the built-in semver comparator, the `dist-tags.latest` comparison
 * against the running version, the ten-minute in-process cache, single-flight
 * (concurrent clicks share one registry request), the bounded body read (1 MiB
 * stream cap, non-JSON answers are failures), clock-rollback handling, and
 * failure handling. The registry transport is injected, so nothing here
 * touches the network, and the cache is observed through a fake clock.
 *
 * Run with: `node --test "tests/**\/*.test.mjs"`
 */
import test from 'node:test'
import assert from 'node:assert/strict'

import {
  NPM_PACKAGE_URL,
  NPM_REGISTRY_URL,
  UPDATE_CACHE_TTL_MS,
  UPDATE_MAX_RESPONSE_BYTES,
  compareSemver,
  createUpdateChecker,
  registerRuntimeRoutes,
} from '../lib/routes.js'

const VERSION = '0.3.4'
const PREFIX = '/api/dsh-serper-search'

/** A registry document shaped like npm's. */
function registryDocument(latest) {
  return { name: 'dsh-serper-search', 'dist-tags': { latest }, versions: { [latest]: {} } }
}

/** A JSON response. */
function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

/** A fetch stub recording every call and replaying one scripted result. */
function stubFetch(handler) {
  const calls = []
  const impl = async (url, init) => {
    calls.push({ url, init })
    return await handler(url, init, calls.length)
  }
  impl.calls = calls
  return impl
}

// ── semver comparison ───────────────────────────────────────────────────────

test('compareSemver orders releases numerically, not lexically', () => {
  assert.equal(compareSemver('0.4.1', '0.4.0'), 1)
  assert.equal(compareSemver('0.4.0', '0.4.1'), -1)
  assert.equal(compareSemver('0.10.0', '0.9.9'), 1)
  assert.equal(compareSemver('1.0.0', '0.99.99'), 1)
  assert.equal(compareSemver('0.4.0', '0.4.0'), 0)
  assert.equal(compareSemver('v0.4.0', '0.4.0'), 0)
})

test('compareSemver ranks prereleases below their release', () => {
  assert.equal(compareSemver('0.4.0-beta.2', '0.4.0'), -1)
  assert.equal(compareSemver('0.4.0', '0.4.0-beta.2'), 1)
  assert.equal(compareSemver('0.4.0-beta.2', '0.4.0-beta.1'), 1)
  assert.equal(compareSemver('0.4.0-beta.1', '0.4.0-alpha.1'), 1)
  // Numeric identifiers sort below alphanumeric ones (semver §11).
  assert.equal(compareSemver('0.4.0-1', '0.4.0-alpha'), -1)
  // A shorter identifier list is lower when all preceding ones match.
  assert.equal(compareSemver('0.4.0-alpha', '0.4.0-alpha.1'), -1)
})

test('compareSemver rejects non-versions instead of guessing', () => {
  assert.throws(() => compareSemver('latest', '0.4.0'), TypeError)
  assert.throws(() => compareSemver('0.4.0', '0.4'), TypeError)
  assert.throws(() => compareSemver(undefined, '0.4.0'), TypeError)
})

// ── checker ────────────────────────────────────────────────────────────────

test('reports an update with the npm page URL when latest is newer', async () => {
  const fetchImpl = stubFetch(() => jsonResponse(registryDocument('0.4.0')))
  const checkUpdate = createUpdateChecker({ fetchImpl, now: () => 1_000 })

  const result = await checkUpdate(VERSION)

  assert.deepEqual(result, {
    ok: true,
    version: VERSION,
    latest: '0.4.0',
    hasUpdate: true,
    url: NPM_PACKAGE_URL,
  })
  assert.equal(fetchImpl.calls.length, 1)
  assert.equal(fetchImpl.calls[0].url, NPM_REGISTRY_URL)
  assert.equal(
    fetchImpl.calls[0].init.headers.accept,
    'application/vnd.npm.install-v1+json',
    'the small "corgi" install document is requested, not the full packument',
  )
  assert.equal(fetchImpl.calls[0].init.redirect, 'error', 'a registry redirect is a failure, not a hop to follow')
  assert.ok(fetchImpl.calls[0].init.signal instanceof AbortSignal, 'the registry request keeps its timeout budget')
})

test('reports up to date for the same release, and for a newer prerelease of it', async () => {
  const same = createUpdateChecker({ fetchImpl: stubFetch(() => jsonResponse(registryDocument(VERSION))) })
  assert.equal((await same(VERSION)).hasUpdate, false)
  assert.equal((await same(VERSION)).latest, VERSION)

  const newerPrerelease = createUpdateChecker({
    fetchImpl: stubFetch(() => jsonResponse(registryDocument('0.3.4-rc.1'))),
    now: () => 0,
  })
  const result = await newerPrerelease(VERSION)
  assert.equal(result.latest, '0.3.4-rc.1')
  assert.equal(result.hasUpdate, false, 'a prerelease of the running release is not an update')
})

test('reuses one registry answer for ten minutes, then refetches', async () => {
  assert.equal(UPDATE_CACHE_TTL_MS, 10 * 60 * 1000)
  let clock = 0
  const fetchImpl = stubFetch((_url, _init, call) =>
    jsonResponse(registryDocument(call === 1 ? '0.4.0' : '0.4.1')))
  const checkUpdate = createUpdateChecker({ fetchImpl, now: () => clock })

  const first = await checkUpdate(VERSION)
  assert.equal(first.latest, '0.4.0')

  clock = 9 * 60 * 1000
  const second = await checkUpdate(VERSION)
  assert.equal(second.latest, '0.4.0', 'within the TTL the cached answer is reused')
  assert.equal(fetchImpl.calls.length, 1, 'a cache hit must not call the registry again')

  clock = 10 * 60 * 1000
  const third = await checkUpdate(VERSION)
  assert.equal(third.latest, '0.4.1')
  assert.equal(third.hasUpdate, true)
  assert.equal(fetchImpl.calls.length, 2, 'after the TTL the registry is read again')
})

test('a failed lookup is never cached, so the next click retries', async () => {
  const fetchImpl = stubFetch((_url, _init, call) => {
    if (call === 1) throw new TypeError('fetch failed')
    return jsonResponse(registryDocument('0.4.0'))
  })
  const checkUpdate = createUpdateChecker({ fetchImpl, now: () => 0 })

  await assert.rejects(checkUpdate(VERSION), /fetch failed/)
  const result = await checkUpdate(VERSION)
  assert.equal(result.latest, '0.4.0')
  assert.equal(fetchImpl.calls.length, 2)
})

test('leaves npm failures and malformed answers as errors', async () => {
  const notOk = createUpdateChecker({ fetchImpl: stubFetch(() => jsonResponse({}, 503)) })
  await assert.rejects(notOk(VERSION), /HTTP 503/)

  const noTags = createUpdateChecker({ fetchImpl: stubFetch(() => jsonResponse({ name: 'dsh-serper-search' })) })
  await assert.rejects(noTags(VERSION), /dist-tags/)

  const notSemver = createUpdateChecker({ fetchImpl: stubFetch(() => jsonResponse(registryDocument('latest'))) })
  await assert.rejects(notSemver(VERSION), /dist-tags/)
})

test('concurrent checks share one registry request (single-flight)', async () => {
  let calls = 0
  let release
  const gate = new Promise((resolve) => {
    release = resolve
  })
  const fetchImpl = stubFetch(async () => {
    calls += 1
    await gate
    return jsonResponse(registryDocument('0.4.0'))
  })
  const checkUpdate = createUpdateChecker({ fetchImpl, now: () => 0 })

  // A double click / two tabs: both callers are underway before the first answer.
  const first = checkUpdate(VERSION)
  const second = checkUpdate(VERSION)
  release()
  const [a, b] = await Promise.all([first, second])

  assert.equal(calls, 1, 'two concurrent clicks cost one registry request')
  assert.deepEqual(a, b)
  const third = await checkUpdate(VERSION)
  assert.equal(third.latest, '0.4.0')
  assert.equal(calls, 1, 'the shared answer is cached for the next click')
})

test('a failed single-flight lookup clears the flight, so the next click retries', async () => {
  let calls = 0
  let release
  const gate = new Promise((resolve) => {
    release = resolve
  })
  const fetchImpl = stubFetch(async () => {
    calls += 1
    await gate
    if (calls === 1) throw new TypeError('fetch failed')
    return jsonResponse(registryDocument('0.4.0'))
  })
  const checkUpdate = createUpdateChecker({ fetchImpl, now: () => 0 })

  const first = checkUpdate(VERSION)
  const second = checkUpdate(VERSION)
  release()
  await assert.rejects(first, /fetch failed/)
  await assert.rejects(second, /fetch failed/)
  assert.equal(calls, 1, 'the concurrent callers shared the failed request')
  const retry = await checkUpdate(VERSION)
  assert.equal(retry.latest, '0.4.0')
  assert.equal(calls, 2, 'the failure did not poison the flight')
})

test('an oversized registry body is rejected and never cached', async () => {
  assert.equal(UPDATE_MAX_RESPONSE_BYTES, 1024 * 1024)
  const oversized = JSON.stringify(registryDocument('0.4.0')) + ' '.repeat(UPDATE_MAX_RESPONSE_BYTES)
  const fetchImpl = stubFetch((_url, _init, call) => call === 1
    ? new Response(oversized, { status: 200, headers: { 'content-type': 'application/json' } })
    : jsonResponse(registryDocument('0.4.1')))
  const checkUpdate = createUpdateChecker({ fetchImpl, now: () => 0 })

  await assert.rejects(checkUpdate(VERSION), /exceeds 1048576 bytes/)
  const result = await checkUpdate(VERSION)
  assert.equal(result.latest, '0.4.1', 'the rejected answer was not cached')
  assert.equal(fetchImpl.calls.length, 2)
})

test('a non-JSON registry body is a failure, not a cached answer', async () => {
  const fetchImpl = stubFetch((_url, _init, call) => call === 1
    ? new Response('<html>not a packument</html>', { status: 200 })
    : jsonResponse(registryDocument('0.4.0')))
  const checkUpdate = createUpdateChecker({ fetchImpl, now: () => 0 })

  await assert.rejects(checkUpdate(VERSION), /invalid JSON/)
  const result = await checkUpdate(VERSION)
  assert.equal(result.latest, '0.4.0')
  assert.equal(fetchImpl.calls.length, 2)
})

test('a clock that moves backwards treats the cache as a miss', async () => {
  let clock = 10 * 60 * 1000
  const fetchImpl = stubFetch((_url, _init, call) =>
    jsonResponse(registryDocument(call === 1 ? '0.4.0' : '0.4.1')))
  const checkUpdate = createUpdateChecker({ fetchImpl, now: () => clock })

  assert.equal((await checkUpdate(VERSION)).latest, '0.4.0')
  clock = 0 // NTP step / VM resume: `at - cache.at` is negative now
  assert.equal((await checkUpdate(VERSION)).latest, '0.4.1', 'a negative age must not count as a cache hit')
  assert.equal(fetchImpl.calls.length, 2)
})

// ── route wiring ───────────────────────────────────────────────────────────

test('the update-check route serves the checker result behind the fence', async () => {
  const routes = new Map()
  const checkUpdate = createUpdateChecker({
    fetchImpl: stubFetch(() => jsonResponse(registryDocument('0.4.0'))),
    now: () => 0,
  })
  const ctx = {
    inject: (deps, callback) => callback({
      webServer: {
        register(route) {
          routes.set(route.path, route)
          return () => routes.delete(route.path)
        },
      },
      connection: { requestRejection: () => undefined },
      settings: { async mutate() {} },
      effect: (factory) => factory(),
    }),
  }
  registerRuntimeRoutes(ctx, { provider: { probe: async () => [] }, version: VERSION, checkUpdate })

  const route = routes.get(`${PREFIX}/update-check`)
  assert.ok(route !== undefined)
  const res = {
    statusCode: 200,
    headers: {},
    body: '',
    setHeader(name, value) {
      this.headers[name] = value
    },
    end(chunk) {
      if (chunk !== undefined) this.body += String(chunk)
    },
  }
  await route.handler({ method: 'POST', headers: {} }, res)

  assert.equal(res.statusCode, 200)
  assert.deepEqual(JSON.parse(res.body), {
    ok: true,
    version: VERSION,
    latest: '0.4.0',
    hasUpdate: true,
    url: NPM_PACKAGE_URL,
  })
})
