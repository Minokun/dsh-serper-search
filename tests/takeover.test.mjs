/**
 * Unit tests for the v0.4.0 one-shot `web.searchProvider` takeover (P0-1).
 *
 * Run with: `node --test tests/`
 *
 * No real profile, loader, or settings service is involved: `settings` and
 * `web` are fakes, so the tests assert the behaviour matrix (user layer ×
 * `takeOverProvider` × resolved id), the marker retry, warning dedupe, and the
 * no-settings degradation without touching `~/.dsh`.
 */
import test from 'node:test'
import assert from 'node:assert/strict'

import { Config, apply, SERPER_PROVIDER_ID } from '../lib/index.js'

const OWN_NS = 'web-search-serper'

/** Apply() reads every field as a volatile ref; this builds them from defaults. */
function configRefs(overrides = {}) {
  const values = {
    apiKey: undefined,
    apiKeyEnv: 'SERPER_API_KEY',
    baseURL: undefined,
    gl: 'cn',
    hl: 'zh-cn',
    autoLocale: true,
    num: 10,
    serperTimeoutMs: 4500,
    deepseekApiKey: undefined,
    deepseekApiKeyEnv: 'DEEPSEEK_API_KEY',
    deepseekBaseURL: undefined,
    deepseekCount: 10,
    deepseekTimeoutMs: 4500,
    summaryMaxChars: 600,
    primary: 'deepseek',
    ratio: 2,
    minAuthority: -1,
    maxRetries: 1,
    maxPerHost: 2,
    demoteSocial: true,
    logLevel: 'summary',
    cacheMinutes: 5,
    native: true,
    nativeApiKey: undefined,
    nativeApiKeyEnv: 'DEEPSEEK_API_KEY',
    nativeBaseURL: undefined,
    nativeModel: 'deepseek-v4-flash',
    nativeMaxUses: 5,
    takeOverProvider: true,
    ...overrides,
  }
  return Object.fromEntries(Object.entries(values).map(([key, value]) => [key, { get: () => value }]))
}

/** Fake logger that records what the takeover path emitted. */
function makeLogger() {
  const logger = {
    infos: [],
    warnings: [],
    errors: [],
    info(message) {
      this.infos.push(message)
    },
    warn(message) {
      this.warnings.push(message)
    },
    error(message) {
      this.errors.push(message)
    },
  }
  return logger
}

/**
 * Fake settings service. `user` is the raw user patch layer exposed by
 * `describe()`; `base` is the inherited/deployment layer; `mutate` records
 * every call and can be made to fail per namespace.
 */
function makeSettings({ user, base, rows, failOn = new Set() } = {}) {
  const calls = []
  return {
    calls,
    describeCalls: 0,
    describe() {
      this.describeCalls += 1
      if (rows !== undefined) return rows
      return [{
        ns: 'web',
        autoGenerate: true,
        schema: {},
        value: {},
        revision: 1,
        ...(base === undefined ? {} : { base }),
        ...(user === undefined ? {} : { user }),
        applies: 'live',
      }]
    },
    async mutate(ns, ops) {
      calls.push({ ns, ops })
      if (failOn.has(ns)) throw new Error(`write refused for ${ns}`)
    },
  }
}

/**
 * Fake plugin context: `web` exposes the volatile ref the seam reads, `inject`
 * invokes the callback with a child context when `settings` is present, and
 * `get('settings')` mirrors whether the service exists. `env` fills the launch
 * environment snapshot (`DSH_WEB_SEARCH_PROVIDER`); `legacyProvider` mirrors a
 * very old `web.searchProviderId` attribute; `loader` stands in for the loader
 * service. `apply()` makes two injections (the settings-only takeover and the
 * P1-5 runtime routes, which need webServer/connection too); these tests own the
 * former and let the routes stay unregistered (covered by tests/routes.test.mjs).
 */
function makeContext({ settings, currentProvider, withSettings = true, env = {}, legacyProvider, loader } = {}) {
  const logger = makeLogger()
  const injected = []
  const web = {
    config: { searchProvider: { get: () => currentProvider } },
    registerSearchProvider() {},
  }
  if (legacyProvider !== undefined) web.searchProviderId = legacyProvider
  const ctx = {
    logger,
    web,
    get(name) {
      if (name === 'settings') return withSettings ? settings : undefined
      if (name === 'loader') return loader
      if (name === 'launchEnvironment') {
        return {
          get: (key) => (Object.hasOwn(env, key) ? { value: env[key], source: 'process' } : undefined),
        }
      }
      return undefined
    },
    on() {},
    inject(deps, callback) {
      injected.push(deps)
      if (withSettings && deps.length === 1 && deps[0] === 'settings') callback({ settings })
    },
  }
  return { ctx, logger, injected }
}

/** Let the two serialized mutate promises settle. */
function flush() {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

test('takeOverProvider: false is a no-op (already taken over or disabled)', async () => {
  const settings = makeSettings({ user: undefined })
  const { ctx, injected } = makeContext({ settings, currentProvider: undefined })

  apply(ctx, configRefs({ takeOverProvider: false }))
  await flush()

  assert.equal(injected.filter((deps) => deps.length === 1).length, 0)
  assert.equal(settings.describeCalls, 0)
  assert.deepEqual(settings.calls, [])
})

test('user layer unset + resolved unset: takes over once, then writes the marker', async () => {
  const settings = makeSettings({ user: undefined })
  const { ctx, logger } = makeContext({ settings, currentProvider: undefined })

  apply(ctx, configRefs())
  await flush()

  // Pin first, marker second: the two writes target different entries and are serialized.
  assert.equal(settings.calls.length, 2)
  assert.deepEqual(settings.calls[0], {
    ns: 'web',
    ops: [{ op: 'set', path: ['searchProvider'], value: SERPER_PROVIDER_ID }],
  })
  assert.deepEqual(settings.calls[1], {
    ns: OWN_NS,
    ops: [{ op: 'set', path: ['takeOverProvider'], value: false }],
  })
  assert.match(logger.infos.join('\n'), /took over searchProvider \(unset → serper\)/)
  assert.deepEqual(logger.warnings, [])
})

test('user layer unset + resolved deployment default: takes over', async () => {
  const settings = makeSettings({ user: undefined })
  const { ctx, logger } = makeContext({ settings, currentProvider: 'deepseek-official' })

  apply(ctx, configRefs())
  await flush()

  assert.equal(settings.calls.length, 2)
  assert.deepEqual(settings.calls[0], {
    ns: 'web',
    ops: [{ op: 'set', path: ['searchProvider'], value: SERPER_PROVIDER_ID }],
  })
  assert.deepEqual(settings.calls[1].ns, OWN_NS)
  assert.match(logger.infos.join('\n'), /took over searchProvider \(deepseek-official → serper\)/)
})

test('user layer unset + another bundle pin: warn only, no marker, warning deduped', async () => {
  const settings = makeSettings({ user: undefined })
  const { ctx, logger } = makeContext({ settings, currentProvider: 'other-bundle-search' })

  apply(ctx, configRefs())
  await flush()
  apply(ctx, configRefs())
  await flush()

  assert.deepEqual(settings.calls, [])
  assert.equal(logger.warnings.length, 1)
  assert.match(logger.warnings[0], /pinned to "other-bundle-search"/)
  assert.match(logger.warnings[0], /searchProvider: serper/)
})

test('user layer already serper: pin untouched, marker written, no warning', async () => {
  const settings = makeSettings({ user: { searchProvider: SERPER_PROVIDER_ID } })
  const { ctx, logger } = makeContext({ settings, currentProvider: SERPER_PROVIDER_ID })

  apply(ctx, configRefs())
  await flush()

  assert.equal(settings.calls.length, 1)
  assert.deepEqual(settings.calls[0], {
    ns: OWN_NS,
    ops: [{ op: 'set', path: ['takeOverProvider'], value: false }],
  })
  assert.deepEqual(logger.warnings, [])
})

test('user layer pins another id: respected with a warning, and marked as decided', async () => {
  const settings = makeSettings({ user: { searchProvider: 'deepseek-search-api' } })
  const { ctx, logger } = makeContext({ settings, currentProvider: 'deepseek-search-api' })

  apply(ctx, configRefs())
  await flush()

  assert.equal(settings.calls.length, 1)
  assert.deepEqual(settings.calls[0], {
    ns: OWN_NS,
    ops: [{ op: 'set', path: ['takeOverProvider'], value: false }],
  })
  assert.equal(logger.warnings.length, 1)
  assert.match(logger.warnings[0], /set to "deepseek-search-api"/)
})

test('marker write failure is logged as an error, and the next start retries it', async () => {
  const failing = makeSettings({ user: undefined, failOn: new Set([OWN_NS]) })
  const first = makeContext({ settings: failing, currentProvider: undefined })

  apply(first.ctx, configRefs())
  await flush()

  // Pin succeeded, marker failed: one error-level log, no throw.
  assert.equal(failing.calls.length, 2)
  assert.equal(first.logger.errors.length, 1)
  assert.match(first.logger.errors[0], /could not persist the one-shot takeover marker/)
  assert.match(first.logger.errors[0], /restore deployment default/)
  assert.equal(first.logger.warnings.length, 0)

  // Next start: pin is already serper (set is idempotent), marker is retried.
  const retry = makeSettings({ user: { searchProvider: SERPER_PROVIDER_ID } })
  const second = makeContext({ settings: retry, currentProvider: SERPER_PROVIDER_ID })

  apply(second.ctx, configRefs())
  await flush()

  assert.deepEqual(retry.calls, [{
    ns: OWN_NS,
    ops: [{ op: 'set', path: ['takeOverProvider'], value: false }],
  }])
})

test('the persisted marker disables takeover on the next boot (real Config + user reset)', async () => {
  // Boot 1 wrote `takeOverProvider: false` into the plugin's own entry; the
  // next boot parses the profile patch through the real Config schema.
  const persisted = Config({ takeOverProvider: false })
  // The user reset the built-in settings page (user layer empty again) and the
  // seam fell back to the deployment default.
  const settings = makeSettings({ user: undefined, base: { searchProvider: 'deepseek-official' } })
  const { ctx } = makeContext({ settings, currentProvider: 'deepseek-official' })

  apply(ctx, persisted)
  await flush()

  assert.equal(settings.describeCalls, 0)
  assert.deepEqual(settings.calls, [])
})

test('Config defaults are the shipped ones: cache on for five minutes, takeover enabled', () => {
  const defaults = Config({})
  assert.equal(defaults.cacheMinutes.get(), 5)
  assert.equal(defaults.takeOverProvider.get(), true)
})

test('an operator-set DSH_WEB_SEARCH_PROVIDER is respected: no pin, marker only', async () => {
  const settings = makeSettings({ user: undefined, base: { searchProvider: 'deepseek-official' } })
  const { ctx, logger } = makeContext({
    settings,
    currentProvider: 'deepseek-official',
    env: { DSH_WEB_SEARCH_PROVIDER: 'deepseek-search-api' },
  })

  apply(ctx, configRefs())
  await flush()

  assert.deepEqual(settings.calls, [{
    ns: OWN_NS,
    ops: [{ op: 'set', path: ['takeOverProvider'], value: false }],
  }])
  assert.equal(logger.warnings.length, 1)
  assert.match(logger.warnings[0], /DSH_WEB_SEARCH_PROVIDER/)
  assert.match(logger.warnings[0], /"deepseek-search-api"/)
})

test('an operator-set DSH_WEB_SEARCH_PROVIDER=serper still needs the pin', async () => {
  const settings = makeSettings({ user: undefined, base: { searchProvider: 'deepseek-official' } })
  const { ctx, logger } = makeContext({
    settings,
    currentProvider: 'deepseek-official',
    env: { DSH_WEB_SEARCH_PROVIDER: SERPER_PROVIDER_ID },
  })

  apply(ctx, configRefs())
  await flush()

  // Config beats the environment fallback, so the pin is what makes serper win.
  assert.equal(settings.calls.length, 2)
  assert.deepEqual(settings.calls[0].ops, [{ op: 'set', path: ['searchProvider'], value: SERPER_PROVIDER_ID }])
  assert.deepEqual(settings.calls[1].ns, OWN_NS)
  assert.deepEqual(logger.warnings, [])
})

test('a deployment default other than deepseek-official is still replaceable', async () => {
  const settings = makeSettings({
    user: undefined,
    base: { searchProvider: 'deepseek-search-api' },
  })
  const { ctx, logger } = makeContext({ settings, currentProvider: 'deepseek-search-api' })

  apply(ctx, configRefs())
  await flush()

  assert.equal(settings.calls.length, 2)
  assert.deepEqual(settings.calls[0].ops, [{ op: 'set', path: ['searchProvider'], value: SERPER_PROVIDER_ID }])
  assert.match(logger.infos[0], /deepseek-search-api → serper/)
  assert.deepEqual(logger.warnings, [])
})

test('an already-resolved serper needs only the marker, never a redundant pin', async () => {
  const settings = makeSettings({ user: undefined })
  const { ctx, logger } = makeContext({ settings, currentProvider: SERPER_PROVIDER_ID })

  apply(ctx, configRefs())
  await flush()

  assert.deepEqual(settings.calls, [{
    ns: OWN_NS,
    ops: [{ op: 'set', path: ['takeOverProvider'], value: false }],
  }])
  assert.deepEqual(logger.warnings, [])
  assert.deepEqual(logger.infos, [])
})

test('a very old build without the volatile ref falls back to web.searchProviderId', async () => {
  const settings = makeSettings({ user: undefined })
  const { ctx, logger } = makeContext({ settings, currentProvider: undefined })
  // Model the pre-volatile seam: no `config.searchProvider` ref at all.
  ctx.web = { searchProviderId: 'legacy-bundle-search', registerSearchProvider() {} }

  apply(ctx, configRefs())
  await flush()

  assert.deepEqual(settings.calls, [])
  assert.equal(logger.warnings.length, 1)
  assert.match(logger.warnings[0], /pinned to "legacy-bundle-search"/)
})

test('an unconfigurable web entry warns once instead of silently skipping', async () => {
  const settings = makeSettings({ user: undefined, rows: [] })
  const { ctx, logger } = makeContext({ settings, currentProvider: undefined })

  apply(ctx, configRefs())
  await flush()
  apply(ctx, configRefs())
  await flush()

  assert.deepEqual(settings.calls, [])
  assert.equal(logger.warnings.length, 1)
  assert.match(logger.warnings[0], /"web" settings entry is not configurable/)
})

test('no settings service: no takeover, no throw, one actionable warning', async () => {
  const settings = makeSettings({ user: undefined })
  const { ctx, logger, injected } = makeContext({ settings, currentProvider: undefined, withSettings: false })

  apply(ctx, configRefs())
  await flush()

  // inject is still registered (a late service would still be picked up), but
  // this context never resolves it.
  assert.deepEqual(injected.filter((deps) => deps.length === 1), [['settings']])
  assert.deepEqual(settings.calls, [])
  assert.equal(logger.warnings.length, 1)
  assert.match(logger.warnings[0], /settings service is unavailable/)

  // A second apply (e.g. config reload) does not repeat the warning.
  apply(ctx, configRefs())
  await flush()
  assert.equal(logger.warnings.length, 1)
})

test('settings that load after this plugin during boot is not reported as missing', async () => {
  const settings = makeSettings({ user: undefined })
  const logger = makeLogger()
  let settingsLive = false
  let releaseLoader
  const loaderSettled = new Promise((resolve) => {
    releaseLoader = resolve
  })
  const pending = []
  const ctx = {
    logger,
    web: {
      config: { searchProvider: { get: () => undefined } },
      registerSearchProvider() {},
    },
    get(name) {
      if (name === 'settings') return settingsLive ? settings : undefined
      if (name === 'loader') return { await: () => loaderSettled }
      return undefined
    },
    on() {},
    inject(deps, callback) {
      // Only the settings-only takeover injection is exercised here; the P1-5
      // routes injection needs webServer/connection and lives in routes.test.mjs.
      if (deps.length === 1 && deps[0] === 'settings') pending.push(callback)
    },
  }

  apply(ctx, configRefs())

  // The service shows up later in the same boot, before the loader settles.
  settingsLive = true
  pending[0]({ settings })
  // The decision is deferred until the loader settles: nothing is written yet.
  await flush()
  assert.equal(settings.calls.length, 0)
  releaseLoader()
  await flush()

  assert.deepEqual(logger.warnings, [])
  assert.equal(settings.calls.length, 2)
})
