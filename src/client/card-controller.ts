/**
 * The serper search card's staged form over the `web-search-serper` settings
 * namespace.
 *
 * The key is the one control that does not live in the section: its literal
 * never rides a response, so the card learns only whether one is configured
 * and writes it through the credentials domain, addressed by the reference the
 * section names. It is still staged with the rest of the form, so one save
 * covers everything the card shows.
 *
 * Mirrors the official web-search card controller; spelled here rather than
 * imported because a client package must not depend on another feature's code.
 * @module dsh-serper-search/client/card-controller
 */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import {
  SettingsFormModel,
  settingsNumberField,
  settingsTextField,
  type SettingsFieldSpec,
  type SettingsFormScope,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { SerperSearchCardState } from './SerperSearchCard.tsx'

/**
 * Namespace of the serper search provider. Spelled here rather than imported:
 * a client package must not depend on a Host package.
 */
export const SERPER_SEARCH_NS = 'web-search-serper'

/** Credential reference the provider resolves when the section names none. */
export const DEFAULT_API_KEY_REF = 'SERPER_API_KEY'

/** Form field the credential control stages under. */
const API_KEY_FIELD = 'apiKey'

/** The credentials remote face this controller uses. */
interface CredentialsRemote {
  describe(refs: readonly string[]): Promise<{ ok: boolean; value?: Record<string, { configured?: boolean; writable?: boolean } | undefined> }>
  set(ref: string, value: string): Promise<unknown>
}

/** The remote event bus face this controller uses. */
interface RemoteEvents {
  $on(event: string, listener: (ref: string) => void): () => void
}

/** The client context face this controller reads (structural). */
export interface SerperCardContext {
  remote: { credentials: CredentialsRemote } & RemoteEvents
}

/** Bridges the `web-search-serper` scope and the credentials domain onto the card. */
export class SerperSearchCardController {
  private readonly scope: SettingsFormScope<Record<string, unknown>>
  private readonly ctx: SerperCardContext
  private readonly form: SettingsFormModel<Record<string, unknown>>
  readonly store: ReturnType<SettingsFormModel<Record<string, unknown>>['bind']>
  private readonly unsubscribe: () => void
  private credential = { ref: '', configured: false, writable: true }

  /**
   * @param scope - the bound settings scope for the `web-search-serper` namespace.
   * @param ctx - the card plugin's context, whose `remote.credentials` namespace
   * answers for the credential the section references.
   */
  constructor(scope: SettingsFormScope<Record<string, unknown>>, ctx: ClientContext) {
    this.scope = scope
    this.ctx = ctx as unknown as SerperCardContext
    this.form = new SettingsFormModel(scope, [
      settingsTextField('baseURL'),
      settingsTextField('gl'),
      settingsTextField('hl'),
      settingsNumberField('num'),
      settingsBooleanField('native'),
    ], [{
      field: API_KEY_FIELD,
      write: (text) => this.writeKey(text),
    }])
    this.store = this.form.bind(() => this.projection())
    this.unsubscribe = scope.subscribe(() => {
      void this.readCredential()
    })
    void this.readCredential()
  }

  private projection(): SerperSearchCardState {
    return {
      ...this.form.shell(),
      baseURL: this.form.field('baseURL'),
      gl: this.form.field('gl'),
      hl: this.form.field('hl'),
      num: this.form.field('num'),
      native: this.form.field('native'),
      apiKey: this.form.field(API_KEY_FIELD),
      apiKeyConfigured: this.credential.configured,
      apiKeyWritable: this.credential.writable,
    }
  }

  /**
   * Ask the credentials domain about the reference the section currently names.
   * The answer is stored with the reference it describes: `apiKeyEnv` can change
   * between the request and its response, and two reads can settle out of order,
   * so a response is published only while it still answers for the reference in force.
   */
  private async readCredential(): Promise<void> {
    const ref = refOf(this.scope.getSnapshot())
    if (ref !== this.credential.ref) {
      this.credential = { ref, configured: false, writable: true }
      this.store.set(this.projection())
    }
    const response = await this.ctx.remote.credentials.describe([ref])
    if (!response.ok || ref !== refOf(this.scope.getSnapshot())) return
    const view = response.value?.[ref]
    const next = { ref, configured: view?.configured ?? false, writable: view?.writable ?? true }
    if (next.configured === this.credential.configured && next.writable === this.credential.writable) return
    this.credential = next
    this.store.set(this.projection())
  }

  /**
   * Re-read after the Host reports a change to the reference this card watches.
   * @param ref - the reference the Host reports as changed.
   */
  refreshCredential(ref: string): void {
    if (ref !== this.credential.ref) return
    void this.readCredential()
  }

  /**
   * Build the face the card's slot registration injects.
   * @returns the card's snapshot hook and its form actions.
   */
  inject() {
    return {
      hooks: { serperSearchCard: this.store },
      ...this.form.actions(),
    }
  }

  /**
   * Write the staged key, then re-read whether the Host now holds one.
   * @param value - the staged credential literal.
   * @returns whether the Host reports a configured credential afterwards.
   */
  private async writeKey(value: string): Promise<boolean> {
    await this.ctx.remote.credentials.set(refOf(this.scope.getSnapshot()), value)
    await this.readCredential()
    return this.credential.configured
  }

  /** Release configuration subscriptions. */
  dispose(): void {
    this.unsubscribe()
    this.form.dispose()
  }
}

/**
 * A true/false field. An empty draft clears the field (re-inheriting the
 * composition layer); any draft other than `true`/`false` blocks the save.
 * @param field - field name inside the namespace section.
 * @returns the field's conversion spec.
 */
function settingsBooleanField(field: string): SettingsFieldSpec {
  return {
    field,
    format: (value) => (value === true ? 'true' : value === false ? 'false' : ''),
    parse: (text) => {
      const draft = text.trim().toLowerCase()
      if (draft === '') return { kind: 'clear' }
      if (draft === 'true') return { kind: 'set', value: true }
      if (draft === 'false') return { kind: 'set', value: false }
      return undefined
    },
  }
}

/**
 * The credential reference the section names, or the provider's default.
 * @param snapshot - the current scope snapshot.
 * @returns the reference to address.
 */
function refOf(snapshot: { value?: Record<string, unknown> }): string {
  const declared = snapshot.value?.apiKeyEnv
  return typeof declared === 'string' && declared.length > 0 ? declared : DEFAULT_API_KEY_REF
}
