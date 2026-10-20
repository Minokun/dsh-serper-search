/**
 * The settings card's runtime controls (P1-5, plan §7): test both search lanes,
 * check for updates, and switch this machine's `searchProvider` pin.
 *
 * Everything runs through the Host's own runtime routes
 * (`/api/dsh-serper-search/*`), so the browser never sees a credential and the
 * npm lookup needs no CORS. A deployment without those routes
 * answers 404, in which case the panel says self-check is unsupported instead
 * of reporting a provider failure.
 *
 * The plugin ships no client stylesheet and the DSH settings page is themed, so
 * the panel lays itself out with inline, colour-free styles, and every control
 * keeps its own live region mounted so screen readers announce the result.
 * @module dsh-serper-search/client/runtime-panel
 */

import { useState, type CSSProperties, type ReactNode } from 'react'
import type { SerperSearchLocaleKey } from './locale.ts'

/**
 * Route prefix owned by this plugin, in the document-relative form the browser
 * addresses (the Host registers `/api/dsh-serper-search`): DSH app routes are
 * document-relative so a deployment served under a sub-path keeps working.
 */
const PREFIX = 'api/dsh-serper-search'

/** Client-side ceiling per request; the Host probe itself is bounded at 8s. */
const CLIENT_TIMEOUT_MS = 15_000

/**
 * One control row: buttons and their hint on one wrapping line. Only spacing is
 * set — no colour and no font size — so the panel inherits the DSH theme.
 */
const ROW_STYLE: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  flexWrap: 'wrap',
  gap: 8,
  marginTop: 8,
}

/**
 * A control's result area: one grid row per result line. It is always mounted,
 * even while empty, so the live region exists before its text changes.
 */
const RESULT_STYLE: CSSProperties = {
  display: 'grid',
  gap: 4,
  margin: '8px 0 0',
}

/** One probed lane, as the Host's stable protocol reports it. */
export interface RuntimeLaneReport {
  readonly lane: 'deepseek' | 'serper'
  readonly ok: boolean
  readonly ms: number
  readonly sources: number
  readonly httpStatus: number | null
  readonly class: string | null
  readonly error: string | null
}

/** Shared progress phases for the three controls. */
type Phase = 'idle' | 'running' | 'done' | 'error'

/** Which failure the panel should describe. */
type Failure = 'unsupported' | 'failed'

/** Which pin the provider switch control asked the Host to apply. */
type ProviderAction = 'take' | 'release'

/** The panel's props. */
export interface RuntimePanelProps {
  /** Translate a dictionary key of this card's namespace. */
  readonly t: (key: SerperSearchLocaleKey) => string
}

/** A route this deployment does not register (the card says "unsupported"). */
class UnsupportedRouteError extends Error {
  constructor(path: string) {
    super(`runtime route unavailable: ${path}`)
    this.name = 'UnsupportedRouteError'
  }
}

/**
 * POST one runtime route with a bounded wait.
 * @param path - route suffix, e.g. `/probe`.
 * @param body - optional JSON body.
 * @returns the parsed JSON object.
 * @throws UnsupportedRouteError on 404, Error on any other failure.
 */
async function post(path: string, body?: Record<string, unknown>): Promise<Record<string, unknown>> {
  const controller = new AbortController()
  const timer = setTimeout(() => {
    controller.abort()
  }, CLIENT_TIMEOUT_MS)
  try {
    const response = await fetch(`${PREFIX}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body ?? {}),
      signal: controller.signal,
    })
    // Without webServer/connection/settings this plugin registers nothing, so
    // the request falls through to the SPA fallback, which answers a non-GET
    // with 405 (or 404 when no fallback seat is taken). Either way the feature
    // is simply unavailable in this deployment.
    if (response.status === 404 || response.status === 405) throw new UnsupportedRouteError(path)
    if (!response.ok) throw new Error(`runtime route ${path} answered HTTP ${response.status}`)
    const payload: unknown = await response.json()
    if (typeof payload !== 'object' || payload === null) return {}
    return payload as Record<string, unknown>
  } finally {
    clearTimeout(timer)
  }
}

/** Distinguish "not registered here" from a real failure. */
function failureOf(error: unknown): Failure {
  return error instanceof UnsupportedRouteError ? 'unsupported' : 'failed'
}

/**
 * Validate one lane record from the wire; unknown/partial payloads are dropped
 * rather than rendered.
 * @param value - one entry of the `lanes` array.
 * @returns the lane report, or undefined when it is not one.
 */
function laneOf(value: unknown): RuntimeLaneReport | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const lane = value as Record<string, unknown>
  if (lane.lane !== 'deepseek' && lane.lane !== 'serper') return undefined
  return {
    lane: lane.lane,
    ok: lane.ok === true,
    ms: typeof lane.ms === 'number' ? lane.ms : 0,
    sources: typeof lane.sources === 'number' ? lane.sources : 0,
    httpStatus: typeof lane.httpStatus === 'number' ? lane.httpStatus : null,
    class: typeof lane.class === 'string' ? lane.class : null,
    error: typeof lane.error === 'string' ? lane.error : null,
  }
}

/**
 * Describe one probed lane in a single line for the panel's live region.
 * @param lane - the validated lane record.
 * @param t - the card's locale reader.
 * @returns the text for that lane.
 */
function laneLine(lane: RuntimeLaneReport, t: RuntimePanelProps['t']): string {
  const label = t(lane.lane === 'deepseek' ? 'laneDeepseek' : 'laneSerper')
  if (lane.ok) return `${label}: ${lane.ms}ms · ${lane.sources}`
  // The Host answers `account-only` when the DeepSeek Account service is
  // mounted without an API key; it cannot tell a chat session from a missing
  // sign-in, so the copy is conditional rather than asserting a login.
  if (lane.class === 'account-only') return `${label}: ${t('probeAccountOnly')}`
  const http = lane.httpStatus === null ? '' : ` (HTTP ${lane.httpStatus})`
  const detail = lane.error === null ? '' : ` · ${lane.error}`
  return `${label}: ${lane.class ?? 'error'}${http}${detail}`
}

/**
 * Render the card's self-check and provider controls.
 * @param props - the card's locale reader.
 * @returns the panel.
 */
export function RuntimePanel({ t }: RuntimePanelProps): ReactNode {
  const [probe, setProbe] = useState<{ phase: Phase; lanes?: RuntimeLaneReport[]; failure?: Failure }>({ phase: 'idle' })
  const [update, setUpdate] = useState<{
    phase: Phase
    current?: string
    latest?: string
    hasUpdate?: boolean
    url?: string
    failure?: Failure
  }>({ phase: 'idle' })
  const [switcher, setSwitcher] = useState<{ phase: Phase; action?: ProviderAction; failure?: Failure }>({ phase: 'idle' })

  const runProbe = async (): Promise<void> => {
    setProbe({ phase: 'running' })
    try {
      const payload = await post('/probe')
      const lanes = Array.isArray(payload.lanes) ? payload.lanes.map(laneOf).filter((lane) => lane !== undefined) : []
      setProbe({ phase: 'done', lanes })
    } catch (error) {
      setProbe({ phase: 'error', failure: failureOf(error) })
    }
  }

  const runUpdate = async (): Promise<void> => {
    setUpdate({ phase: 'running' })
    try {
      const payload = await post('/update-check')
      const latest = typeof payload.latest === 'string' ? payload.latest : undefined
      // The Host either answers with a registry version or fails outright; a
      // body without one is treated as a failed check rather than "up to date".
      if (latest === undefined) {
        setUpdate({ phase: 'error', failure: 'failed' })
        return
      }
      setUpdate({
        phase: 'done',
        current: typeof payload.version === 'string' ? payload.version : undefined,
        latest,
        hasUpdate: payload.hasUpdate === true,
        // Only an https URL is rendered as a link.
        url: typeof payload.url === 'string' && payload.url.startsWith('https://') ? payload.url : undefined,
      })
    } catch (error) {
      setUpdate({ phase: 'error', failure: failureOf(error) })
    }
  }

  const switchProvider = async (action: ProviderAction): Promise<void> => {
    setSwitcher({ phase: 'running', action })
    try {
      await post('/provider', { action })
      setSwitcher({ phase: 'done', action })
    } catch (error) {
      setSwitcher({ phase: 'error', action, failure: failureOf(error) })
    }
  }

  const probeRunning = probe.phase === 'running'
  const updateRunning = update.phase === 'running'
  const switchRunning = switcher.phase === 'running'

  // The three result regions below stay mounted even when empty: a live region
  // that appears only together with its text is not announced reliably.
  const lanes = probe.lanes ?? []
  const probeAllOk =
    lanes.some((lane) => lane.lane === 'deepseek' && lane.ok) &&
    lanes.some((lane) => lane.lane === 'serper' && lane.ok)
  const probeLines: string[] =
    probe.phase === 'error'
      ? [probe.failure === 'unsupported' ? t('probeUnsupported') : t('probeFailed')]
      : probe.phase === 'done'
        ? lanes.length === 0
          ? // A 200 without lanes is a failed check, not a silent success.
            [t('probeFailed')]
          : [...(probeAllOk ? [t('probeOk')] : []), ...lanes.map((lane) => laneLine(lane, t))]
        : []

  const updateStatus: ReactNode =
    update.phase === 'error' ? (
      update.failure === 'unsupported' ? t('probeUnsupported') : t('updateFailed')
    ) : update.phase === 'done' && update.latest !== undefined ? (
      update.hasUpdate === true ? (
        <>
          {`${t('hasUpdate')} ${update.current ?? ''} → ${update.latest}`}
          {update.url === undefined ? null : (
            <>
              {' · '}
              <a href={update.url} target="_blank" rel="noreferrer noopener">
                npm
              </a>
            </>
          )}
        </>
      ) : (
        t('upToDate')
      )
    ) : null

  const switcherStatus: ReactNode =
    switcher.phase === 'error' ? (
      switcher.failure === 'unsupported' ? t('probeUnsupported') : t('providerSwitchFailed')
    ) : switcher.phase === 'done' ? (
      switcher.action === 'take' ? (
        t('providerTaken')
      ) : switcher.action === 'release' ? (
        t('providerReleased')
      ) : null
    ) : null

  return (
    <div>
      <div style={ROW_STYLE}>
        <button
          type="button"
          disabled={probeRunning}
          aria-busy={probeRunning ? true : undefined}
          onClick={() => void runProbe()}
        >
          {probeRunning ? t('probing') : t('probeRun')}
        </button>
        <span>{t('probeCostHint')}</span>
      </div>
      <p role="status" aria-live="polite" style={RESULT_STYLE}>
        {probeLines.map((line, index) => (
          <span key={index}>{line}</span>
        ))}
      </p>

      <div style={ROW_STYLE}>
        <button
          type="button"
          disabled={updateRunning}
          aria-busy={updateRunning ? true : undefined}
          onClick={() => void runUpdate()}
        >
          {updateRunning ? t('checking') : t('checkUpdate')}
        </button>
        <span>{t('updateHint')}</span>
      </div>
      <p role="status" aria-live="polite" style={RESULT_STYLE}>
        {updateStatus}
      </p>

      <div style={ROW_STYLE}>
        <button
          type="button"
          disabled={switchRunning}
          aria-busy={switchRunning ? true : undefined}
          onClick={() => void switchProvider('take')}
        >
          {t('takeProvider')}
        </button>
        <button
          type="button"
          disabled={switchRunning}
          aria-busy={switchRunning ? true : undefined}
          onClick={() => void switchProvider('release')}
        >
          {t('releaseProvider')}
        </button>
      </div>
      <p role="status" aria-live="polite" style={RESULT_STYLE}>
        {switcherStatus}
      </p>
    </div>
  )
}
