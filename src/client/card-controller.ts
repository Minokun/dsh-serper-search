/**
 * The search card's staged form over the `web-search-serper` settings namespace.
 *
 * One `SettingsForm` covers three independent search-source groups; this
 * controller owns the fields behind them, and — the part that cannot live in
 * the section — one credential box per group. A credential's literal never
 * rides a response, so each group learns only whether *its* reference is
 * configured, and writes through the credentials domain addressed by the
 * reference its group names (`apiKeyEnv` / `deepseekApiKeyEnv` /
 * `yuanbaoApiKeyEnv`). A changed reference refreshes only that group; a
 * `credentials/reference-updated` event refreshes only the matching group.
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

/** Credential reference the serper group resolves when the section names none. */
export const DEFAULT_API_KEY_REF = 'SERPER_API_KEY'

/** Credential reference the DeepSeek group resolves when the section names none. */
export const DEEPSEEK_API_KEY_REF = 'DEEPSEEK_API_KEY'

/** Credential reference the Yuanbao group resolves when the section names none. */
export const YUANBAO_API_KEY_REF = 'YUANBAO_API_KEY'

/** One credential state kept per group. */
interface CredentialState {
  ref: string
  configured: boolean
  writable: boolean
}

/** One search-source group's credential wiring. */
interface CredentialGroup {
  /** Group key; also the prefix of the state fields the card reads. */
  readonly kind: 'serper' | 'deepseek' | 'yuanbao'
  /** External (write-only) form field that stages this group's literal key. */
  readonly field: string
  /** Section field naming the credential reference this group addresses. */
  readonly refField: string
  /** Reference used when the section names none. */
  readonly fallback: string
}

/** The three credential boxes, in card order. */
const CREDENTIAL_GROUPS: readonly CredentialGroup[] = [
  { kind: 'deepseek', field: 'deepseekApiKey', refField: 'deepseekApiKeyEnv', fallback: DEEPSEEK_API_KEY_REF },
  { kind: 'serper', field: 'serperApiKey', refField: 'apiKeyEnv', fallback: DEFAULT_API_KEY_REF },
  { kind: 'yuanbao', field: 'yuanbaoApiKey', refField: 'yuanbaoApiKeyEnv', fallback: YUANBAO_API_KEY_REF },
]

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
  /** One credential state per group, keyed by `kind`. */
  private readonly credentials: Record<CredentialGroup['kind'], CredentialState> = {
    deepseek: { ref: '', configured: false, writable: true },
    serper: { ref: '', configured: false, writable: true },
    yuanbao: { ref: '', configured: false, writable: true },
  }

  /**
   * @param scope - the bound settings scope for the `web-search-serper` namespace.
   * @param ctx - the card plugin's context, whose `remote.credentials` namespace
   * answers for the three references the section names.
   */
  constructor(scope: SettingsFormScope<Record<string, unknown>>, ctx: ClientContext) {
    this.scope = scope
    this.ctx = ctx as unknown as SerperCardContext
    this.form = new SettingsFormModel(scope, [
      // DeepSeek Search API
      settingsTextField('deepseekBaseURL'),
      settingsNumberField('deepseekCount'),
      settingsNumberField('summaryMaxChars'),
      settingsNumberField('deepseekTimeoutMs'),
      // serper / Google
      settingsTextField('baseURL'),
      settingsTextField('gl'),
      settingsTextField('hl'),
      settingsNumberField('num'),
      settingsNumberField('serperTimeoutMs'),
      // Yuanbao Search
      settingsTextField('yuanbaoEndpoint'),
      settingsNumberField('yuanbaoCnt'),
      settingsNumberField('yuanbaoTimeoutMs'),
      // One enable switch per group (`native` keeps its v0.3 name on purpose).
      settingsBooleanField('native'),
      settingsBooleanField('serperEnabled'),
      settingsBooleanField('yuanbaoEnabled'),
    ], CREDENTIAL_GROUPS.map((group) => ({
      field: group.field,
      write: (text: string) => this.writeKey(group, text),
    })))
    this.store = this.form.bind(() => this.projection())
    this.unsubscribe = scope.subscribe(() => {
      void this.syncCredentials()
    })
    void this.syncCredentials()
  }

  private projection(): SerperSearchCardState {
    return {
      ...this.form.shell(),
      // DeepSeek Search API
      deepseekBaseURL: this.form.field('deepseekBaseURL'),
      deepseekCount: this.form.field('deepseekCount'),
      summaryMaxChars: this.form.field('summaryMaxChars'),
      deepseekTimeoutMs: this.form.field('deepseekTimeoutMs'),
      native: this.form.field('native'),
      deepseekApiKey: this.form.field('deepseekApiKey'),
      deepseekApiKeyConfigured: this.credentials.deepseek.configured,
      deepseekApiKeyWritable: this.credentials.deepseek.writable,
      deepseekApiKeyRef: this.credentials.deepseek.ref,
      // serper / Google
      baseURL: this.form.field('baseURL'),
      gl: this.form.field('gl'),
      hl: this.form.field('hl'),
      num: this.form.field('num'),
      serperTimeoutMs: this.form.field('serperTimeoutMs'),
      serperEnabled: this.form.field('serperEnabled'),
      serperApiKey: this.form.field('serperApiKey'),
      serperApiKeyConfigured: this.credentials.serper.configured,
      serperApiKeyWritable: this.credentials.serper.writable,
      serperApiKeyRef: this.credentials.serper.ref,
      // Yuanbao Search
      yuanbaoEndpoint: this.form.field('yuanbaoEndpoint'),
      yuanbaoCnt: this.form.field('yuanbaoCnt'),
      yuanbaoTimeoutMs: this.form.field('yuanbaoTimeoutMs'),
      yuanbaoEnabled: this.form.field('yuanbaoEnabled'),
      yuanbaoApiKey: this.form.field('yuanbaoApiKey'),
      yuanbaoApiKeyConfigured: this.credentials.yuanbao.configured,
      yuanbaoApiKeyWritable: this.credentials.yuanbao.writable,
      yuanbaoApiKeyRef: this.credentials.yuanbao.ref,
    }
  }

  /**
   * Re-read the credential references that changed since the last snapshot.
   * Only the groups whose reference moved are re-described, so renaming one
   * reference does not disturb the other two boxes.
   */
  private async syncCredentials(): Promise<void> {
    for (const group of CREDENTIAL_GROUPS) {
      const ref = refOf(this.scope.getSnapshot(), group)
      if (ref !== this.credentials[group.kind].ref) await this.readOne(group)
    }
  }

  /**
   * Ask the credentials domain about one group's current reference. The answer
   * is stored with the reference it describes: `*ApiKeyEnv` can change between
   * the request and its response, and two reads can settle out of order, so a
   * response is published only while it still answers for the reference in force.
   * @param group - the credential group to refresh.
   */
  private async readOne(group: CredentialGroup): Promise<void> {
    const ref = refOf(this.scope.getSnapshot(), group)
    if (ref !== this.credentials[group.kind].ref) {
      this.credentials[group.kind] = { ref, configured: false, writable: true }
      this.store.set(this.projection())
    }
    const response = await this.ctx.remote.credentials.describe([ref])
    if (!response.ok || ref !== refOf(this.scope.getSnapshot(), group)) return
    const view = response.value?.[ref]
    const next: CredentialState = { ref, configured: view?.configured ?? false, writable: view?.writable ?? true }
    const previous = this.credentials[group.kind]
    if (previous.configured === next.configured && previous.writable === next.writable) return
    this.credentials[group.kind] = next
    this.store.set(this.projection())
  }

  /**
   * Re-read after the Host reports a change to a reference one group watches.
   * Only the group whose reference matches is refreshed.
   * @param ref - the reference the Host reports as changed.
   */
  refreshCredential(ref: string): void {
    for (const group of CREDENTIAL_GROUPS) {
      if (ref !== this.credentials[group.kind].ref) continue
      void this.readOne(group)
    }
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
   * Write one group's staged key, then re-read whether the Host now holds one.
   * @param group - the credential group being written.
   * @param value - the staged credential literal.
   * @returns whether the Host reports a configured credential afterwards.
   */
  private async writeKey(group: CredentialGroup, value: string): Promise<boolean> {
    await this.ctx.remote.credentials.set(refOf(this.scope.getSnapshot(), group), value)
    await this.readOne(group)
    return this.credentials[group.kind].configured
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
 * The credential reference one group addresses, or that group's default.
 * @param snapshot - the current scope snapshot.
 * @param group - the credential group.
 * @returns the reference to address.
 */
function refOf(snapshot: { value?: Record<string, unknown> }, group: CredentialGroup): string {
  const declared = snapshot.value?.[group.refField]
  return typeof declared === 'string' && declared.length > 0 ? declared : group.fallback
}
