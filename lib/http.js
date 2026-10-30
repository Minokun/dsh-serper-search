/**
 * Shared HTTP plumbing for the direct search lanes (DeepSeek Search API,
 * serper.dev, and the Tencent Cloud WSA / Yuanbao Search API).
 *
 * Extracted from `lib/index.js` in v0.5.0 so a third lane can reuse the exact
 * same transport semantics instead of a copy: one per-request timeout that is
 * combined with (not replaced by) the caller's abort signal, a JSON body read
 * while that gate is still armed, `WEB_ABORTED` for caller cancellations, and
 * `WEB_PROVIDER_ERROR` carrying `httpStatus` / `failureKind` / `bodyExcerpt` so
 * `lib/failure.js` can classify it.
 *
 * Kept free of cordis context access: everything here takes plain options, so
 * `node --test` can exercise it (and the lanes) with a stub `fetchImpl`.
 * @module dsh-serper-search/http
 */

import { WebError } from '@deepseek-ai/dsh-web'
import { redactBodyExcerpt } from './failure.js'

/** Throw the provider's stable cancellation error when the caller already aborted. */
export function throwIfSearchAborted(signal) {
  if (signal?.aborted === true) throw searchAborted(signal)
}

/** Build the provider's stable cancellation error while retaining the caller's reason. */
export function searchAborted(signal, fallback) {
  return new WebError('Web search aborted', 'WEB_ABORTED', { cause: signal?.aborted === true ? signal.reason : fallback })
}

/**
 * Combine the caller's abort signal with an independent per-request timeout.
 * @param {AbortSignal} [parentSignal] - the caller's signal.
 * @param {number} timeoutMs - the timeout budget.
 * @returns {{ signal: AbortSignal, timedOut: () => boolean, cleanup: () => void }} the gate.
 */
export function withTimeout(parentSignal, timeoutMs) {
  const controller = new AbortController()
  const timer = setTimeout(() => {
    controller.abort(new DOMException(`Search timeout after ${timeoutMs}ms`, 'TimeoutError'))
  }, timeoutMs)
  const onAbort = () => controller.abort(parentSignal.reason)
  if (parentSignal !== undefined) {
    if (parentSignal.aborted === true) controller.abort(parentSignal.reason)
    else parentSignal.addEventListener('abort', onAbort, { once: true })
  }
  return {
    signal: controller.signal,
    timedOut: () => controller.signal.reason?.name === 'TimeoutError',
    cleanup: () => {
      clearTimeout(timer)
      parentSignal?.removeEventListener?.('abort', onAbort)
    },
  }
}

/**
 * Dispatch one JSON POST with a per-request timeout. Transport failures are
 * classified so callers can decide whether to retry.
 * @param {object} options - request description.
 * @param {string} options.endpoint - absolute URL.
 * @param {object} options.body - JSON body.
 * @param {Record<string, string>} options.headers - request headers.
 * @param {number} options.timeoutMs - budget for the whole exchange.
 * @param {AbortSignal} [options.signal] - caller cancellation.
 * @param {typeof fetch} [options.fetchImpl] - transport override (tests).
 * @param {string} options.subject - lane name used in error messages.
 * @param {string} options.guidance - remediation hint appended to errors.
 * @returns {Promise<{response: Response, gate: object}>} the response; the caller owns status handling.
 */
export async function postJson({ endpoint, body, headers, timeoutMs, signal, fetchImpl, subject, guidance }) {
  const gate = withTimeout(signal, timeoutMs)
  try {
    const response = await (fetchImpl ?? fetch)(endpoint, {
      method: 'POST',
      redirect: 'error',
      headers,
      body: JSON.stringify(body),
      signal: gate.signal,
    })
    return { response, gate }
  } catch (error) {
    gate.cleanup()
    if (signal?.aborted === true) throw searchAborted(signal, error)
    if (gate.timedOut()) {
      const timeoutError = new WebError(`${subject} request timed out after ${timeoutMs}ms. ${guidance}`, 'WEB_PROVIDER_ERROR', { cause: error })
      timeoutError.retryable = false
      timeoutError.failureKind = 'timeout'
      timeoutError.timeoutMs = timeoutMs
      throw timeoutError
    }
    const failure = new WebError(`${subject} request failed: ${String(error)}. ${guidance}`, 'WEB_PROVIDER_ERROR', { cause: error })
    failure.retryable = true
    failure.failureKind = 'network'
    throw failure
  }
}

/**
 * Read one response's JSON body while the request gate is still armed, so a
 * stalled body cannot outlive the per-backend timeout or the caller's signal
 * (a fetch that resolved its headers leaves the body stream abortable).
 * @param {{ response: Response, gate: { timedOut: () => boolean } }} opened - the dispatched request.
 * @param {{ subject: string, guidance: string, signal?: AbortSignal }} context - error context.
 * @returns {Promise<unknown>} the parsed body.
 */
export async function readJsonBody(opened, { subject, guidance, signal }) {
  try {
    return await opened.response.json()
  } catch (error) {
    if (signal?.aborted === true) throw searchAborted(signal, error)
    if (opened.gate.timedOut()) {
      const timeoutError = new WebError(`${subject} response body timed out after its request budget. ${guidance}`, 'WEB_PROVIDER_ERROR', { cause: error })
      timeoutError.retryable = false
      timeoutError.failureKind = 'timeout'
      throw timeoutError
    }
    const invalid = new WebError(`${subject} returned an unprocessable response body: ${String(error)}. ${guidance}`, 'WEB_PROVIDER_ERROR', { cause: error })
    invalid.failureKind = 'invalid-response'
    throw invalid
  }
}

/**
 * Consume a response body before a retry or an error return; abort wins over
 * drain failures. Returns the redacted excerpt kept on the thrown error.
 * @param {Response} response - the response whose body is drained.
 * @param {AbortSignal} [signal] - the caller's cancellation signal.
 * @returns {Promise<string>} the redacted body excerpt (at most 300 characters).
 */
export async function drainBody(response, signal) {
  let text = ''
  try {
    text = await response.text()
  } catch {
    // The retry/caller owns the outcome; a failed drain must not mask it.
  }
  if (signal?.aborted === true) throw searchAborted(signal)
  return redactBodyExcerpt(text)
}

/** Sleep that rejects with `WEB_ABORTED` when the search is cancelled. */
export function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted === true) {
      reject(searchAborted(signal))
      return
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener?.('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = () => {
      clearTimeout(timer)
      reject(searchAborted(signal))
    }
    signal?.addEventListener?.('abort', onAbort, { once: true })
  })
}

/** Clamp a requested result count into a backend's range. */
export function clampCount(value, min, max) {
  if (!Number.isFinite(value)) return min
  return Math.max(min, Math.min(max, Math.trunc(value)))
}
