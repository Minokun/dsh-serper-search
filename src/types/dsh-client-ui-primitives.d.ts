/**
 * Local typing aid for the `@deepseek-ai/dsh-client-ui-primitives` platform module.
 *
 * The DSH shell seeds that module into its web bundle and does not ship it as an
 * installable package, so `tsc` cannot resolve it from `node_modules` — the
 * `scripts/link-harness.sh` link only works next to a deepseek-harness checkout.
 * Without it the card's form code type-checks in the dark (every import from the
 * module is `any`, or an unresolved-module error).
 *
 * This declares ONLY what this plugin imports. The shapes are read off the shipped
 * runtime implementation (DSH 0.2.2-rc.5 web frontend bundle, module-table entry
 * `@deepseek-ai/dsh-client-ui-primitives`), not invented:
 * - `settingsTextField` / `settingsNumberField` return `{ field, format, parse }`,
 *   where `parse` yields `{ kind: 'clear' }`, `{ kind: 'set', value }` or `undefined`;
 * - `new SettingsFormModel(scope, specs, secretSpecs = [])`, with `bind`, `shell`,
 *   `field`, `actions`, `save` and `dispose`;
 * - `shell()` → `{ available, writable, dirty, invalid, saving, failed }` and
 *   `field()` → `{ text, overridden, invalid }`;
 * - the prop names `SettingsForm`, `SettingsValueField` and `SettingsSecretField` read.
 *
 * When this plugin starts using another export of the module, extend this file from
 * the runtime the same way. Nothing here is emitted: it is types only.
 */

declare module '@deepseek-ai/dsh-client-ui-primitives' {
  import type { ReactNode } from 'react'

  /** What a field spec's `parse` returns: clear the override, set a value, or reject the draft (undefined). */
  export type SettingsFieldParse = { kind: 'clear' } | { kind: 'set'; value: unknown }

  /** One section field's text ↔ value conversion; `settingsTextField` / `settingsNumberField` build the standard ones. */
  export interface SettingsFieldSpec {
    field: string
    format(value: unknown): string
    parse(text: string): SettingsFieldParse | undefined
  }

  /** A write-only credential the card stages; its literal never becomes a section value. */
  export interface SettingsSecretSpec {
    field: string
    write(text: string): boolean | Promise<boolean>
  }

  /**
   * Snapshot of a bound settings scope. Mirrors the `ConfigFormSnapshot<T>` the settings
   * package hands out, which is what gets passed in: only `value` is typed, `base` and
   * `user` are opaque layers whose field PRESENCE marks an override.
   */
  export interface SettingsFormScopeSnapshot<T> {
    status: 'loading' | 'ready' | 'unavailable'
    value: T | undefined
    base: unknown
    user: unknown
    revision: number | undefined
    writable: boolean
  }

  /** A bound settings-namespace scope, as the settings cards receive it (`ConfigForm<T>`). */
  export interface SettingsFormScope<T> {
    getSnapshot(): SettingsFormScopeSnapshot<T>
    subscribe(listener: () => void): () => void
    mutate(ops: readonly unknown[], expectedRevision?: number): Promise<boolean>
  }

  /** Shared form state every settings card renders from. */
  export interface SettingsFormShell {
    available: boolean
    writable: boolean
    dirty: boolean
    invalid: boolean
    saving: boolean
    failed: boolean
  }

  /** One field's staged text and its badges. */
  export interface SettingsFieldState {
    text: string
    overridden: boolean
    invalid: boolean
  }

  /** The form actions the card's view binds. */
  export interface SettingsFormActions {
    edit(field: string, text: string): void
    resetField(field: string): void
    save(): void
    discard(): void
  }

  /** The writable snapshot store `SettingsFormModel.bind()` returns (the client-store `SnapshotStore`). */
  export interface SettingsFormStore<T> {
    getSnapshot(): T
    subscribe(listener: () => void): () => void
    update(mutator: (draft: T) => void): void
    set(next: T): void
  }

  /** Stages drafts for a settings scope and writes them in one save. */
  export class SettingsFormModel<T = Record<string, unknown>> {
    constructor(scope: SettingsFormScope<T>, specs: readonly SettingsFieldSpec[], secretSpecs?: readonly SettingsSecretSpec[])
    bind<S>(projection: () => S): SettingsFormStore<S>
    shell(): SettingsFormShell
    field(field: string): SettingsFieldState
    actions(): SettingsFormActions
    save(): Promise<void>
    dispose(): void
  }

  /** A free-text field. */
  export function settingsTextField(field: string): SettingsFieldSpec
  /** A whole/decimal number field. */
  export function settingsNumberField(field: string): SettingsFieldSpec

  /** Copy the shared form frame renders. */
  export interface SettingsFormLabels {
    unavailable: string
    readOnly: string
    saveFailed: string
    save: string
    saving: string
  }

  export interface SettingsFormProps {
    labels: SettingsFormLabels
    state: SettingsFormShell
    onSave(): void
    onDiscard(): void
    children?: ReactNode
  }

  export interface SettingsValueFieldProps {
    id: string
    label: ReactNode
    hint?: ReactNode
    help?: { label: string; content: ReactNode }
    overridden?: boolean
    overriddenLabel?: ReactNode
    resetLabel?: ReactNode
    invalid?: boolean
    invalidLabel?: ReactNode
    numeric?: boolean
    placeholder?: string
    text: string
    disabled?: boolean
    onEdit(text: string): void
    onReset?(): void
  }

  export interface SettingsSecretFieldProps {
    id: string
    label: ReactNode
    hint?: ReactNode
    configured?: boolean
    stateLabel?: ReactNode
    text: string
    disabled?: boolean
    onEdit(text: string): void
  }

  /** The settings form frame: children, then the read-only / failure notes and the Save button. */
  export function SettingsForm(props: SettingsFormProps): ReactNode
  /** One text or number input bound to a staged field. */
  export function SettingsValueField(props: SettingsValueFieldProps): ReactNode
  /** One write-only credential input with its configured badge. */
  export function SettingsSecretField(props: SettingsSecretFieldProps): ReactNode
}
