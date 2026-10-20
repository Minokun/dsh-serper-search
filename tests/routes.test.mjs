/**
 * Unit tests for the P1-5 runtime routes and the merged provider's probe
 * (plan §7).
 *
 * Run with: `node --test "tests/**\/*.test.mjs"`
 *
 * The routes are exercised twice: through fake request/response objects (no
 * profile writes) for the registration, fence, probe, update-check and
 * provider contracts, and — in the "real HTTP integration" group below —
 * through an actual `node:http` server whose listener dispatches by exact
 * pathname exactly like `dsh-host-webserver` does, so the body limits, the
 * 401/405/413/400 statuses and the provider validation are observed over real
 * `IncomingMessage`/`ServerResponse` streams. The probe is exercised through
 * stub `fetchImpl` transports so its timeout override, clear-on-success and
 * never-write-on-failure rules are observable without touching a paid API.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer, request as createHttpRequest } from 'node:http'
import { Readable } from 'node:stream'

import { MergedSearchProvider, OWN_NS, SERPER_PROVIDER_ID, apply } from '../lib/index.js'
import {
  BadRequestError,
  BodyTooLargeError,
  MAX_BODY_BYTES,
  registerRuntimeRoutes,
} from '../lib/routes.js'

const PREFIX = '/api/dsh-serper-search'
const SIGNAL = new AbortController().signal
const A_URLS = Array.from({ length: 6 }, (_, index) => `https://a${index}.example/${index}`)
const B_URLS = Array.from({ length: 6 }, (_, index) => `https://b${index}.example/${index}`)

// ── fixtures ────────────────────────────────────────────────────────────────

/** DeepSeek Search API payload. */
function deepseekPayload(urls) {
  return {
    results: urls.map((url, index) => ({
      title: `A${index}`,
      url,
      snippet: `a-snippet-${index}`,
      date: '2026-01-02T00:00:00+00:00',
      authority: 3,
    })),
  }
}

/** serper.dev payload. */
function serperPayload(urls) {
  return {
    organic: urls.map((url, index) => ({
      title: `B${index}`,
      link: url,
      snippet: `b-snippet-${index}`,
      position: index + 1,
    })),
  }
}

/** A JSON response. */
function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json' } })
}

/** Stub fetch recording every call. */
function stubFetch(handler) {
  const calls = []
  const impl = async (url, init) => {
    calls.push({ url, init })
    return await handler(url, init, calls.length)
  }
  impl.calls = calls
  return impl
}

/** A fetch stub that only settles when its signal aborts. */
function hangingFetch() {
  const calls = []
  const impl = (url, init) => new Promise((resolve, reject) => {
    calls.push({ url, init })
    const onAbort = () => reject(new DOMException('aborted', 'AbortError'))
    if (init.signal?.aborted === true) onAbort()
    else init.signal?.addEventListener('abort', onAbort, { once: true })
  })
  impl.calls = calls
  return impl
}

/** Provider options with per-lane transports and the real defaults. */
function mergedOptions({ deepseekFetch, serperFetch, overrides = {} } = {}) {
  return {
    deepseekEnabled: true,
    primary: 'deepseek',
    ratio: 2,
    maxPerHost: 2,
    demoteSocial: true,
    logLevel: 'off',
    cacheMinutes: 0,
    deepseek: {
      apiKey: 'deepseek-test-key',
      apiKeyEnv: 'DEEPSEEK_API_KEY',
      baseURL: 'https://api.deepseek.com/v1/tools',
      count: 10,
      timeoutMs: 4500,
      summaryMaxChars: 600,
      minAuthority: -1,
      // Deliberately 1: probe must force 0 so one click costs one request.
      maxRetries: 1,
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
      timeoutMs: 4500,
      fetchImpl: serperFetch,
    },
    ...overrides,
  }
}

/** A response recorder with the pieces the routes touch. */
function makeResponse() {
  return {
    statusCode: 200,
    headers: {},
    body: '',
    headersSent: false,
    writableEnded: false,
    setHeader(name, value) {
      this.headers[name.toLowerCase()] = value
    },
    end(chunk) {
      if (chunk !== undefined) this.body += String(chunk)
      this.writableEnded = true
    },
  }
}

/** A POST request whose body is a real readable stream. */
function makeRequest({ method = 'POST', body } = {}) {
  const chunks = body === undefined
    ? []
    : [Buffer.isBuffer(body) ? body : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body))]
  const req = Readable.from(chunks)
  req.method = method
  req.headers = {}
  return req
}

/**
 * Build a fake context whose `inject` resolves the three services immediately
 * (or never, when `services: false`, mimicking a deployment without them).
 * `checkUpdate` defaults to a local stub so no test touches the npm registry.
 */
function makeRuntime({ provider, version = '0.4.0', rejection, services = true, checkUpdate } = {}) {
  const routes = new Map()
  const mutations = []
  const injected = []
  const updateCalls = []
  const warnings = []
  const settings = {
    async mutate(ns, ops) {
      mutations.push({ ns, ops })
    },
  }
  const webServer = {
    register(route) {
      routes.set(route.path, route)
      return () => routes.delete(route.path)
    },
  }
  const connection = { requestRejection: () => rejection }
  const logger = {
    info() {},
    warn(message) {
      warnings.push(String(message))
    },
  }
  const probeProvider = provider ?? { probe: async () => [] }
  const registry = checkUpdate ?? (async (current) => {
    updateCalls.push(current)
    return { ok: true, version: current, latest: current, hasUpdate: false, url: 'https://www.npmjs.com/package/dsh-serper-search' }
  })
  const ctx = {
    inject(deps, callback) {
      injected.push(deps)
      if (!services) return
      callback({
        webServer,
        connection,
        settings,
        logger,
        effect: (factory) => factory(),
      })
    },
  }
  registerRuntimeRoutes(ctx, { provider: probeProvider, version, checkUpdate: registry })
  return { routes, mutations, injected, settings, connection, logger, warnings, provider: probeProvider, updateCalls }
}

/** Invoke one registered route and return the recorded response. */
async function callRoute(runtime, path, request) {
  const route = runtime.routes.get(path)
  assert.ok(route !== undefined, `route ${path} is registered`)
  const res = makeResponse()
  await route.handler(request, res)
  return res
}

/** Parse a recorded response body. */
function bodyOf(res) {
  return res.body === '' ? undefined : JSON.parse(res.body)
}

// ── registration & fence ────────────────────────────────────────────────────

test('registers the three exact POST routes behind webServer, connection, and settings', () => {
  const runtime = makeRuntime()
  assert.deepEqual(runtime.injected, [['webServer', 'connection', 'settings']])
  assert.deepEqual([...runtime.routes.keys()].sort(), [
    `${PREFIX}/probe`,
    `${PREFIX}/provider`,
    `${PREFIX}/update-check`,
  ])
  for (const route of runtime.routes.values()) assert.equal(route.kind, 'exact')
})

test('missing services register nothing, so the card can report "unsupported"', () => {
  const runtime = makeRuntime({ services: false })
  assert.equal(runtime.routes.size, 0)
})

test('apply() wires the runtime routes onto the registered provider', () => {
  const values = {
    apiKey: 'serper-key',
    apiKeyEnv: 'SERPER_API_KEY',
    baseURL: 'https://google.serper.dev',
    gl: 'cn',
    hl: 'zh-cn',
    autoLocale: true,
    num: 10,
    serperTimeoutMs: 4500,
    deepseekApiKey: 'deepseek-key',
    deepseekApiKeyEnv: 'DEEPSEEK_API_KEY',
    deepseekBaseURL: 'https://api.deepseek.com/v1/tools',
    deepseekCount: 10,
    deepseekTimeoutMs: 4500,
    summaryMaxChars: 600,
    primary: 'deepseek',
    ratio: 2,
    minAuthority: -1,
    maxRetries: 1,
    maxPerHost: 2,
    demoteSocial: true,
    logLevel: 'off',
    cacheMinutes: 5,
    native: true,
    nativeApiKey: '',
    nativeApiKeyEnv: 'DEEPSEEK_API_KEY',
    nativeBaseURL: '',
    nativeModel: 'deepseek-v4-flash',
    nativeMaxUses: 5,
    takeOverProvider: false,
  }
  const config = new Proxy({}, { get: (_target, key) => ({ get: () => values[key] }) })
  const registered = new Map()
  const settings = { describe: () => [], async mutate() {} }
  const ctx = {
    logger: { info() {}, warn() {} },
    get: (name) => (name === 'settings' ? settings : undefined),
    on: () => {},
    inject(deps, callback) {
      if (deps.length === 3) {
        callback({
          webServer: {
            register(route) {
              registered.set(route.path, route)
              return () => registered.delete(route.path)
            },
          },
          connection: { requestRejection: () => undefined },
          settings,
          effect: (factory) => factory(),
        })
      }
    },
    web: {
      config: { searchProvider: { get: () => undefined } },
      registerSearchProvider() {},
    },
  }

  apply(ctx, config)
  assert.deepEqual([...registered.keys()].sort(), [
    `${PREFIX}/probe`,
    `${PREFIX}/provider`,
    `${PREFIX}/update-check`,
  ])
})

test('the connection fence answers 401/403 and never calls the handler', async () => {
  for (const rejection of [401, 403]) {
    let probed = 0
    const runtime = makeRuntime({
      rejection,
      provider: {
        async probe() {
          probed += 1
          return []
        },
      },
    })
    const res = await callRoute(runtime, `${PREFIX}/probe`, makeRequest())
    assert.equal(res.statusCode, rejection)
    assert.equal(res.body, '')
    assert.equal(probed, 0)
  }
})

test('non-POST requests answer 405 without calling the handler', async () => {
  let probed = 0
  const runtime = makeRuntime({
    provider: {
      async probe() {
        probed += 1
        return []
      },
    },
  })
  const res = await callRoute(runtime, `${PREFIX}/probe`, makeRequest({ method: 'GET' }))
  assert.equal(res.statusCode, 405)
  assert.deepEqual(bodyOf(res), { error: 'method not allowed' })
  assert.equal(probed, 0)
})

// ── probe route ─────────────────────────────────────────────────────────────

test('probe answers 200 with the version and the lane protocol', async () => {
  const lanes = [
    { lane: 'deepseek', ok: true, ms: 730, sources: 3, httpStatus: 200, class: null, error: null },
    { lane: 'serper', ok: false, ms: 8000, sources: 0, httpStatus: null, class: 'timeout', error: 'timed out after 8000ms' },
  ]
  const runtime = makeRuntime({ provider: { probe: async () => lanes }, version: '0.4.0' })
  const res = await callRoute(runtime, `${PREFIX}/probe`, makeRequest())
  assert.equal(res.statusCode, 200)
  assert.match(res.headers['content-type'], /application\/json/)
  assert.deepEqual(bodyOf(res), { ok: true, version: '0.4.0', lanes })
})

test('concurrent probe clicks share one run (single-flight)', async () => {
  let calls = 0
  let release
  const gate = new Promise((resolve) => {
    release = resolve
  })
  const runtime = makeRuntime({
    provider: {
      async probe() {
        calls += 1
        await gate
        return [{ lane: 'serper', ok: true, ms: 10, sources: 1, httpStatus: 200, class: null, error: null }]
      },
    },
  })
  const first = callRoute(runtime, `${PREFIX}/probe`, makeRequest())
  const second = callRoute(runtime, `${PREFIX}/probe`, makeRequest())
  release()
  const [a, b] = await Promise.all([first, second])
  assert.equal(calls, 1)
  assert.deepEqual(bodyOf(a), bodyOf(b))
})

test('a thrown probe answers 500 JSON, logs it, and never leaves the socket hanging', async () => {
  const runtime = makeRuntime({
    provider: {
      async probe() {
        throw new Error('boom')
      },
    },
  })
  const res = await callRoute(runtime, `${PREFIX}/probe`, makeRequest())
  assert.equal(res.statusCode, 500)
  assert.deepEqual(bodyOf(res), { ok: false, error: 'internal error' })
  assert.deepEqual(runtime.warnings, [`web-search-serper: ${PREFIX}/probe failed: boom`], 'an unexpected route failure is logged on the Host')
})

// ── update-check route (P1-6) ──────────────────────────────────────────────

test('update-check asks the injected registry checker and returns its contract', async () => {
  const runtime = makeRuntime({ version: '0.4.0' })
  const res = await callRoute(runtime, `${PREFIX}/update-check`, makeRequest())
  assert.equal(res.statusCode, 200)
  assert.deepEqual(bodyOf(res), {
    ok: true,
    version: '0.4.0',
    latest: '0.4.0',
    hasUpdate: false,
    url: 'https://www.npmjs.com/package/dsh-serper-search',
  })
  assert.deepEqual(runtime.updateCalls, ['0.4.0'])
})

test('a registry failure answers 500 JSON so the card can show its message', async () => {
  const runtime = makeRuntime({
    checkUpdate: async () => {
      throw new Error('offline')
    },
  })
  const res = await callRoute(runtime, `${PREFIX}/update-check`, makeRequest())
  assert.equal(res.statusCode, 500)
  assert.deepEqual(bodyOf(res), { ok: false, error: 'internal error' })
})

// ── provider route ──────────────────────────────────────────────────────────

test('take pins serper, then always writes the one-shot marker', async () => {
  const runtime = makeRuntime()
  const res = await callRoute(runtime, `${PREFIX}/provider`, makeRequest({ body: { action: 'take' } }))
  assert.equal(res.statusCode, 200)
  assert.deepEqual(bodyOf(res), { ok: true, action: 'take' })
  assert.deepEqual(runtime.mutations, [
    { ns: 'web', ops: [{ op: 'set', path: ['searchProvider'], value: SERPER_PROVIDER_ID }] },
    { ns: OWN_NS, ops: [{ op: 'set', path: ['takeOverProvider'], value: false }] },
  ])
})

test('release writes the one-shot marker first, then unsets the pin', async () => {
  const runtime = makeRuntime()
  const res = await callRoute(runtime, `${PREFIX}/provider`, makeRequest({ body: { action: 'release' } }))
  assert.equal(res.statusCode, 200)
  assert.deepEqual(bodyOf(res), { ok: true, action: 'release' })
  assert.deepEqual(runtime.mutations, [
    { ns: OWN_NS, ops: [{ op: 'set', path: ['takeOverProvider'], value: false }] },
    { ns: 'web', ops: [{ op: 'unset', path: ['searchProvider'] }] },
  ], 'marker before unset: a crash between them must not allow a re-takeover')
})

test('a release whose unset fails still leaves the marker written', async () => {
  const runtime = makeRuntime()
  const record = runtime.settings.mutate
  runtime.settings.mutate = async (ns, ops) => {
    if (ns === 'web') throw new Error('settings write failed')
    await record(ns, ops)
  }
  const res = await callRoute(runtime, `${PREFIX}/provider`, makeRequest({ body: { action: 'release' } }))
  assert.equal(res.statusCode, 500)
  assert.deepEqual(bodyOf(res), { ok: false, error: 'internal error' })
  assert.deepEqual(runtime.mutations, [
    { ns: OWN_NS, ops: [{ op: 'set', path: ['takeOverProvider'], value: false }] },
  ], 'the marker was already written, so the next start cannot take over again')
  assert.deepEqual(runtime.warnings, [`web-search-serper: ${PREFIX}/provider failed: settings write failed`])
})

test('a release that cannot even write the marker answers 500 and leaves the pin alone', async () => {
  const runtime = makeRuntime()
  runtime.settings.mutate = async () => {
    throw new Error('settings read-only')
  }
  const res = await callRoute(runtime, `${PREFIX}/provider`, makeRequest({ body: { action: 'release' } }))
  assert.equal(res.statusCode, 500)
  assert.deepEqual(runtime.mutations, [], 'no mutation completed, so the pin survives intact')
})

test('missing, malformed and unknown actions answer 400 and never write settings', async () => {
  const bodies = [
    undefined, // empty body
    {}, // no action at all
    { action: 'take-over' }, // old misspelling
    { action: 'TAKE' }, // wrong case
    { action: null },
    { action: 1 },
    [], // JSON array
  ]
  for (const body of bodies) {
    const runtime = makeRuntime()
    const res = await callRoute(runtime, `${PREFIX}/provider`, makeRequest({ body }))
    assert.equal(res.statusCode, 400, `body ${JSON.stringify(body)} must be rejected, not coerced into take`)
    assert.deepEqual(bodyOf(res), {
      ok: false,
      error: 'body.action must be "take" or "release"',
    })
    assert.deepEqual(runtime.mutations, [], `body ${JSON.stringify(body)} wrote no settings`)
  }
})

test('a body over 64 KiB answers 413 without writing settings', async () => {
  const runtime = makeRuntime()
  const oversized = Buffer.from(JSON.stringify({
    action: 'release',
    pad: 'x'.repeat(MAX_BODY_BYTES),
  }))
  assert.ok(oversized.length > MAX_BODY_BYTES)
  const res = await callRoute(runtime, `${PREFIX}/provider`, makeRequest({ body: oversized }))
  assert.equal(res.statusCode, 413)
  assert.deepEqual(bodyOf(res), { ok: false, error: 'request body too large' })
  assert.deepEqual(runtime.mutations, [])
})

test('an invalid JSON body answers 400 without writing settings', async () => {
  const runtime = makeRuntime()
  const res = await callRoute(runtime, `${PREFIX}/provider`, makeRequest({ body: 'not json' }))
  assert.equal(res.statusCode, 400)
  assert.deepEqual(bodyOf(res), { ok: false, error: 'invalid JSON body' })
  assert.deepEqual(runtime.mutations, [])
})

test('MAX_BODY_BYTES is exactly 64 KiB and the error classes are exported', () => {
  assert.equal(MAX_BODY_BYTES, 64 * 1024)
  assert.ok(new BodyTooLargeError('x') instanceof Error)
  assert.ok(new BadRequestError('x') instanceof Error)
})

// ── real HTTP integration (F12: security acceptance over real streams) ──────
//
// These tests start an actual `node:http` server whose listener mirrors DSH's
// own webServer dispatch (`dsh-host-webserver`): exact pathname match, `await
// route.handler(req, res)`, 404 otherwise. The requests are real HTTP with
// chunked transfer-encoding, so the fence and the body cap run against real
// IncomingMessage/ServerResponse streams instead of fakes.

/** Split one body into `parts` chunks so the request is sent chunked, not buffered. */
function chunked(buffer, parts = 3) {
  const size = Math.ceil(buffer.length / parts)
  const chunks = []
  for (let offset = 0; offset < buffer.length; offset += size) {
    chunks.push(buffer.subarray(offset, offset + size))
  }
  return chunks
}

/** A valid `take` JSON body padded to exactly `size` bytes. */
function takeBodyOfSize(size) {
  const head = '{"action":"take","pad":"'
  const tail = '"}'
  const body = Buffer.from(head + 'x'.repeat(size - Buffer.byteLength(head) - Buffer.byteLength(tail)) + tail)
  assert.equal(body.length, size)
  return body
}

/**
 * Start a real HTTP server dispatching exact pathnames to the runtime routes,
 * exactly as `dsh-host-webserver` does. Every received request is recorded so
 * a test can assert the wire shape (e.g. chunked framing) it exercised.
 * @param {object} runtime - result of {@link makeRuntime}.
 * @returns {Promise<{port: number, requests: object[], close: () => Promise<void>}>}
 */
async function startRouteServer(runtime) {
  /** @type {object[]} */
  const requests = []
  const server = createServer((req, res) => {
    requests.push({ method: req.method, url: req.url, headers: req.headers })
    const pathname = new URL(req.url ?? '/', 'http://localhost').pathname
    const route = runtime.routes.get(pathname)
    if (route === undefined) {
      res.statusCode = 404
      res.end()
      return
    }
    Promise.resolve()
      .then(() => route.handler(req, res))
      .catch(() => {
        if (res.writableEnded !== true) {
          res.statusCode = 500
          res.end()
        }
      })
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address()
  return {
    port,
    requests,
    close: () => new Promise((resolve) => {
      server.closeAllConnections?.()
      server.close(() => resolve())
    }),
  }
}

/**
 * Send one real HTTP request. A `chunks` array writes the body piecewise with
 * no content-length, so Node frames it as `transfer-encoding: chunked`.
 * @param {number} port - the listening server port.
 * @param {string} path - request path.
 * @param {{method?: string, chunks?: Buffer[], body?: Buffer}} [options] - request shape.
 * @returns {Promise<{status: number, headers: object, body: string}>}
 */
function realRequest(port, path, { method = 'POST', chunks, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = createHttpRequest({
      host: '127.0.0.1',
      port,
      path,
      method,
      agent: false,
      headers: { 'content-type': 'application/json' },
    }, (res) => {
      const collected = []
      res.on('data', (chunk) => collected.push(chunk))
      res.on('end', () => {
        resolve({
          status: res.statusCode,
          headers: res.headers,
          body: Buffer.concat(collected).toString('utf8'),
        })
      })
      res.on('error', reject)
    })
    req.on('error', reject)
    if (chunks !== undefined) {
      for (const chunk of chunks) req.write(chunk)
      req.end()
    } else if (body !== undefined) {
      req.end(body)
    } else {
      req.end()
    }
  })
}

test('real HTTP: an unauthenticated request answers 401 and never runs the handler', async () => {
  let probed = 0
  const runtime = makeRuntime({
    rejection: 401,
    provider: {
      async probe() {
        probed += 1
        return []
      },
    },
  })
  const server = await startRouteServer(runtime)
  try {
    const res = await realRequest(server.port, `${PREFIX}/probe`, { chunks: [Buffer.from('{}')] })
    assert.equal(res.status, 401)
    assert.equal(res.body, '')
    assert.equal(probed, 0, 'the fence answers before the handler')
  } finally {
    await server.close()
  }
})

test('real HTTP: a non-POST request answers 405 without reaching the handler', async () => {
  const runtime = makeRuntime()
  const server = await startRouteServer(runtime)
  try {
    const res = await realRequest(server.port, `${PREFIX}/update-check`, { method: 'GET' })
    assert.equal(res.status, 405)
    assert.deepEqual(JSON.parse(res.body), { error: 'method not allowed' })
    assert.deepEqual(runtime.updateCalls, [], 'the registry check was not reached')
  } finally {
    await server.close()
  }
})

test('real HTTP: a chunked body of exactly 64 KiB is accepted', async () => {
  const runtime = makeRuntime()
  const server = await startRouteServer(runtime)
  try {
    const res = await realRequest(server.port, `${PREFIX}/provider`, {
      chunks: chunked(takeBodyOfSize(MAX_BODY_BYTES)),
    })
    assert.equal(res.status, 200)
    assert.deepEqual(JSON.parse(res.body), { ok: true, action: 'take' })
    assert.deepEqual(runtime.mutations.map((entry) => entry.ns), ['web', OWN_NS])
    assert.equal(server.requests.length, 1, 'the request really reached the node:http server')
    assert.equal(server.requests[0].headers['transfer-encoding'], 'chunked', 'the body was chunked, not content-length framed')
    assert.equal(server.requests[0].headers['content-length'], undefined)
  } finally {
    await server.close()
  }
})

test('real HTTP: a chunked body one byte over 64 KiB answers 413 without writing settings', async () => {
  const runtime = makeRuntime()
  const server = await startRouteServer(runtime)
  try {
    const res = await realRequest(server.port, `${PREFIX}/provider`, {
      chunks: chunked(takeBodyOfSize(MAX_BODY_BYTES + 1)),
    })
    assert.equal(res.status, 413)
    assert.deepEqual(JSON.parse(res.body), { ok: false, error: 'request body too large' })
    assert.deepEqual(runtime.mutations, [])
  } finally {
    await server.close()
  }
})

test('real HTTP: a 200 KiB body answers 413 without writing settings', async () => {
  const runtime = makeRuntime()
  const server = await startRouteServer(runtime)
  try {
    const res = await realRequest(server.port, `${PREFIX}/provider`, {
      chunks: chunked(Buffer.alloc(200 * 1024, 0x78), 4),
    })
    assert.equal(res.status, 413)
    assert.deepEqual(JSON.parse(res.body), { ok: false, error: 'request body too large' })
    assert.deepEqual(runtime.mutations, [])
  } finally {
    await server.close()
  }
})

test('real HTTP: invalid JSON answers 400 without writing settings', async () => {
  const runtime = makeRuntime()
  const server = await startRouteServer(runtime)
  try {
    const res = await realRequest(server.port, `${PREFIX}/provider`, {
      chunks: [Buffer.from('not json')],
    })
    assert.equal(res.status, 400)
    assert.deepEqual(JSON.parse(res.body), { ok: false, error: 'invalid JSON body' })
    assert.deepEqual(runtime.mutations, [])
  } finally {
    await server.close()
  }
})

test('real HTTP: unknown and missing provider actions answer 400 and never touch settings', async () => {
  const runtime = makeRuntime()
  const server = await startRouteServer(runtime)
  try {
    for (const body of ['{"action":"release-all"}', '{"action":"take "}', '{}', 'null', '']) {
      const res = await realRequest(server.port, `${PREFIX}/provider`, {
        chunks: body === '' ? [] : [Buffer.from(body)],
      })
      assert.equal(res.status, 400, `body ${JSON.stringify(body)} is rejected`)
      assert.deepEqual(JSON.parse(res.body), {
        ok: false,
        error: 'body.action must be "take" or "release"',
      })
    }
    assert.deepEqual(runtime.mutations, [], 'no rejected action wrote settings')
  } finally {
    await server.close()
  }
})

// ── provider.probe() ────────────────────────────────────────────────────────
test('probe clears a successful lane and leaves a failing lane’s cooldown untouched', async () => {
  const deepseekFetch = stubFetch(() => jsonResponse(deepseekPayload(A_URLS)))
  const serperFetch = stubFetch(() => jsonResponse({ message: 'bad key' }, 401))
  const provider = new MergedSearchProvider(() => mergedOptions({ deepseekFetch, serperFetch }))
  const future = Date.now() + 600_000
  provider.health.deepseek = { until: future, cls: 'server', detail: 'stale', fingerprint: 'aaaaaaaaaaaa' }
  provider.health.serper = { until: future, cls: 'auth', detail: 'stale', fingerprint: 'bbbbbbbbbbbb' }

  const lanes = await provider.probe({ timeoutMs: 2000 })

  assert.equal(lanes[0].lane, 'deepseek')
  assert.equal(lanes[0].ok, true)
  assert.equal(lanes[0].sources, A_URLS.length)
  assert.equal(lanes[0].httpStatus, 200)
  assert.equal(lanes[0].class, null)
  assert.equal(provider.health.deepseek.until, 0, 'a successful probe clears that lane\'s cooldown')

  assert.equal(lanes[1].lane, 'serper')
  assert.equal(lanes[1].ok, false)
  assert.equal(lanes[1].class, 'auth')
  assert.equal(lanes[1].httpStatus, 401)
  assert.equal(provider.health.serper.until, future, 'a failed probe writes no cooldown')
  assert.equal(provider.health.serper.cls, 'auth')
})

test('probe reports account-only (not auth) when a DeepSeek Account service is mounted', async () => {
  const deepseekFetch = stubFetch(() => jsonResponse(deepseekPayload(A_URLS)))
  const serperFetch = stubFetch(() => jsonResponse(serperPayload(B_URLS)))
  const provider = new MergedSearchProvider(() => {
    const base = mergedOptions({ deepseekFetch, serperFetch })
    return {
      ...base,
      deepseek: { ...base.deepseek, apiKey: undefined, hasAccountService: () => true },
    }
  })

  const lanes = await provider.probe({ timeoutMs: 2000 })

  assert.equal(lanes[0].class, 'account-only')
  assert.equal(lanes[0].ok, false)
  assert.equal(lanes[0].sources, 0)
  assert.match(lanes[0].error, /account/i)
  assert.equal(deepseekFetch.calls.length, 0, 'no request is spent without any credential')
  assert.equal(provider.health.deepseek.until, 0)
})

test('without a DeepSeek Account service the same missing key stays a plain auth failure', async () => {
  const deepseekFetch = stubFetch(() => jsonResponse(deepseekPayload(A_URLS)))
  const serperFetch = stubFetch(() => jsonResponse(serperPayload(B_URLS)))
  const provider = new MergedSearchProvider(() => {
    const base = mergedOptions({ deepseekFetch, serperFetch })
    return {
      ...base,
      deepseek: { ...base.deepseek, apiKey: undefined, hasAccountService: () => false },
    }
  })

  const lanes = await provider.probe({ timeoutMs: 2000 })
  assert.equal(lanes[0].class, 'auth')
  assert.doesNotMatch(lanes[0].error, /account-only/i)
})

test('probe overrides both lane timeouts and spends exactly one request per lane', async () => {
  const deepseekFetch = stubFetch(() => jsonResponse({ error: 'boom' }, 500))
  const serperFetch = stubFetch(() => jsonResponse({ message: 'bad key' }, 401))
  const provider = new MergedSearchProvider(() => mergedOptions({ deepseekFetch, serperFetch }))

  const lanes = await provider.probe({ timeoutMs: 500 })

  // maxRetries is 1 in the options; probe forces 0, so a 500 is not retried.
  assert.equal(deepseekFetch.calls.length, 1)
  assert.equal(serperFetch.calls.length, 1)
  assert.deepEqual(lanes.map((lane) => lane.lane), ['deepseek', 'serper'])
  assert.equal(lanes[0].class, 'server')
  assert.equal(lanes[1].class, 'auth')
})

test('probe asks each lane for exactly three results on the wire', async () => {
  const deepseekFetch = stubFetch(() => jsonResponse(deepseekPayload(A_URLS.slice(0, 3))))
  const serperFetch = stubFetch(() => jsonResponse(serperPayload(B_URLS.slice(0, 3))))
  const provider = new MergedSearchProvider(() => mergedOptions({ deepseekFetch, serperFetch }))

  const lanes = await provider.probe({ timeoutMs: 2000 })

  assert.equal(lanes[0].ok, true)
  assert.equal(lanes[1].ok, true)
  // The configured counts are 10 per lane; a probe still asks for PROBE_RESULTS.
  assert.equal(JSON.parse(deepseekFetch.calls[0].init.body).count, 3, 'probe pins the DeepSeek result count')
  assert.equal(JSON.parse(serperFetch.calls[0].init.body).num, 3, 'probe pins the serper result count')
})

test('probe timeout is the outer budget (clamped to 1000ms), not each lane\'s default', async () => {
  const deepseekFetch = hangingFetch()
  const serperFetch = hangingFetch()
  const provider = new MergedSearchProvider(() => mergedOptions({ deepseekFetch, serperFetch }))

  const started = Date.now()
  const lanes = await provider.probe({ timeoutMs: 500 })
  const elapsed = Date.now() - started

  assert.ok(elapsed >= 900 && elapsed < 3000, `probe took ${elapsed}ms`)
  assert.deepEqual(lanes.map((lane) => lane.class), ['timeout', 'timeout'])
  assert.match(lanes[0].error, /1000ms/)
  assert.match(lanes[1].error, /1000ms/)
  assert.equal(deepseekFetch.calls.length, 1)
  assert.equal(serperFetch.calls.length, 1)
  assert.equal(provider.health.deepseek.until, 0)
  assert.equal(provider.health.serper.until, 0)
})

test('probe responses carry no credential material', async () => {
  const secret = 'sk-routes-secret-value'
  const deepseekFetch = stubFetch(() => jsonResponse({ results: [] }))
  const serperFetch = stubFetch(() => new Response(`{"message":"bad key ${secret}"}`, {
    status: 401,
    headers: { 'content-type': 'application/json' },
  }))
  const provider = new MergedSearchProvider(() => {
    const base = mergedOptions({ deepseekFetch, serperFetch })
    return {
      ...base,
      deepseek: { ...base.deepseek, apiKey: secret },
      serper: { ...base.serper, apiKey: secret },
    }
  })

  const runtime = makeRuntime({ provider })
  const res = await callRoute(runtime, `${PREFIX}/probe`, makeRequest())
  assert.equal(res.statusCode, 200)
  assert.doesNotMatch(res.body, /sk-routes-secret-value/)
  const payload = bodyOf(res)
  assert.equal(payload.lanes[1].class, 'auth')
  assert.equal(payload.lanes[1].httpStatus, 401)
})
