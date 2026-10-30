/**
 * The search provider's settings card: renders its one-liner or its settings
 * form, as the Plugins page asks.
 *
 * The form is one `SettingsForm` (one Save/Discard for everything) laid out as
 * three visually separate search-source groups — DeepSeek Search API, serper /
 * Google, and Yuanbao Search — because the primitives ship no section component.
 * Each group carries its own enable switch, its own credential box (independent
 * reference, independent configured badge), and its own parameters. Grouping is
 * plain markup with `plugin-config-serper-search-*` class names plus inline,
 * colour-free spacing/rule styles, so the DSH page themes it like the rest.
 * @module dsh-serper-search/client/SerperSearchCard
 */

import type { CSSProperties, ReactNode } from 'react'
import {
  SettingsForm,
  SettingsSecretField,
  SettingsValueField,
  type SettingsFieldState,
  type SettingsFormActions,
  type SettingsFormShell,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { SerperSearchLocaleKey } from './locale.ts'
import { RuntimePanel } from './runtime-panel.tsx'

/** The card's snapshot: the shared form shell plus one state per control. */
export interface SerperSearchCardState extends SettingsFormShell {
  // DeepSeek Search API group
  native: SettingsFieldState
  deepseekBaseURL: SettingsFieldState
  deepseekCount: SettingsFieldState
  summaryMaxChars: SettingsFieldState
  deepseekTimeoutMs: SettingsFieldState
  deepseekApiKey: SettingsFieldState
  deepseekApiKeyConfigured: boolean
  deepseekApiKeyWritable: boolean
  deepseekApiKeyRef: string
  // serper / Google group
  serperEnabled: SettingsFieldState
  baseURL: SettingsFieldState
  gl: SettingsFieldState
  hl: SettingsFieldState
  num: SettingsFieldState
  serperTimeoutMs: SettingsFieldState
  serperApiKey: SettingsFieldState
  serperApiKeyConfigured: boolean
  serperApiKeyWritable: boolean
  serperApiKeyRef: string
  // Yuanbao Search group
  yuanbaoEnabled: SettingsFieldState
  yuanbaoEndpoint: SettingsFieldState
  yuanbaoCnt: SettingsFieldState
  yuanbaoTimeoutMs: SettingsFieldState
  yuanbaoApiKey: SettingsFieldState
  yuanbaoApiKeyConfigured: boolean
  yuanbaoApiKeyWritable: boolean
  yuanbaoApiKeyRef: string
}

/** What the slot registration injects into the card. */
export interface SerperSearchCardFace extends SettingsFormActions {
}

/** The card's composed props (structural: the slots framework composes them). */
export interface SerperSearchCardProps {
  /** The view the Plugins page asks for. */
  readonly view: 'summary' | 'page'
  /** Translate a dictionary key of this card's namespace. */
  readonly t: (key: SerperSearchLocaleKey) => string
  /** Snapshot-selector hook bound to the card's store. */
  readonly useSerperSearchCard: <S>(selector: (snapshot: SerperSearchCardState) => S) => S
  /** Stage draft text for one field. */
  readonly edit: (field: string, text: string) => void
  /** Stage a clear, so saving lets the field re-inherit the composition layer. */
  readonly resetField: (field: string) => void
  /** Write every staged edit. */
  readonly save: () => void
  /** Drop every staged edit. */
  readonly discard: () => void
}

/** Spacing between the three search-source groups. */
const GROUPS_STYLE: CSSProperties = {
  display: 'grid',
  gap: 22,
}

/**
 * One search-source group's frame: a rule above the group, then its heading and
 * children. Colour-free so the DSH theme decides the palette.
 */
const GROUP_STYLE: CSSProperties = {
  display: 'grid',
  gap: 10,
  paddingTop: 14,
  borderTop: '1px solid rgba(127, 127, 127, 0.35)',
}

/** A group heading. */
const GROUP_TITLE_STYLE: CSSProperties = {
  margin: 0,
  fontSize: '1.05em',
  fontWeight: 600,
}

/** A group's one-line description under its heading. */
const GROUP_HINT_STYLE: CSSProperties = {
  margin: 0,
  fontSize: '0.9em',
  opacity: 0.72,
}

/**
 * Where to create or buy each provider's API key.
 *
 * Hard-coded on purpose: this is documentation, not configuration, so users are
 * not asked to maintain URLs. Checked on 2026-10-21 — serper answers 200, the
 * Tencent Cloud console redirects (302) to its login page, and the DeepSeek
 * endpoint answers but rate-limits scripted probes (path is correct).
 */
const KEY_URLS = {
  deepseek: 'https://platform.deepseek.com/api_keys',
  serper: 'https://serper.dev/dashboard',
  yuanbao: 'https://console.cloud.tencent.com/wsapi',
} as const

/**
 * Style for the "get an API key" links: colour-free and inherited from the DSH
 * theme (the shells render a plain `<a>`, like the primitives' own `WebBlock`).
 */
const KEY_LINK_STYLE: CSSProperties = {
  color: 'inherit',
  textDecoration: 'underline',
  opacity: 0.9,
  fontSize: '0.9em',
  width: 'fit-content',
}

/**
 * The form frame's copy, read from this card's dictionary.
 * @param t - the card's locale reader.
 * @returns the labels the shared settings form renders.
 */
function formLabels(t: SerperSearchCardProps['t']) {
  return {
    unavailable: t('unavailable'),
    readOnly: t('readOnly'),
    saveFailed: t('saveFailed'),
    save: t('save'),
    saving: t('saving'),
  }
}

/** Props for one `SettingsValueField`, minus the state spread. */
interface FieldSpec {
  readonly id: string
  readonly label: string
  readonly hint: string
  readonly field: string
  readonly state: SettingsFieldState
  readonly disabled: boolean
  readonly edit: SerperSearchCardProps['edit']
  readonly reset: SerperSearchCardProps['resetField']
  readonly p: SerperSearchCardProps
  readonly numeric?: boolean
  readonly placeholder?: string
}

/**
 * One text/number/boolean field bound to the staged form.
 * @param spec - the field's identity, copy, state, and the card's actions.
 * @returns the rendered field.
 */
function valueField(spec: FieldSpec): ReactNode {
  const { t } = spec.p
  return (
    <SettingsValueField
      id={spec.id}
      label={spec.label}
      hint={spec.hint}
      overriddenLabel={t('overridden')}
      resetLabel={t('reset')}
      invalidLabel={spec.numeric === true ? t('invalidNumber') : t('invalidBoolean')}
      {...(spec.numeric === true ? { numeric: true } : {})}
      {...(spec.placeholder === undefined ? {} : { placeholder: spec.placeholder })}
      disabled={spec.disabled}
      {...spec.state}
      onEdit={(text: string) => {
        spec.edit(spec.field, text)
      }}
      onReset={() => {
        spec.reset(spec.field)
      }}
    />
  )
}

/**
 * One group's credential box: its own reference, its own configured badge, and
 * its own staged write through the credentials domain.
 * @param spec - the group's credential state and the card's actions.
 * @returns the rendered secret field.
 */
function credentialField(spec: {
  readonly id: string
  readonly label: string
  readonly hint: string
  readonly field: string
  readonly state: SettingsFieldState
  readonly configured: boolean
  readonly writable: boolean
  readonly p: SerperSearchCardProps
}): ReactNode {
  const { t } = spec.p
  return (
    <SettingsSecretField
      id={spec.id}
      label={spec.label}
      hint={spec.hint}
      disabled={!spec.writable}
      text={spec.state.text}
      configured={spec.configured}
      stateLabel={spec.configured ? t('apiKeySet') : t('apiKeyUnset')}
      onEdit={(text: string) => {
        spec.p.edit(spec.field, text)
      }}
    />
  )
}

/**
 * One group's "get an API key" external link, rendered directly under that
 * group's credential box. Colour-free inline styling; the URL is a constant.
 * @param spec - the link target and its localized label.
 * @returns the rendered anchor.
 */
function keyHelpLink(spec: { readonly className: string; readonly href: string; readonly text: string }): ReactNode {
  return (
    <a
      className={spec.className}
      href={spec.href}
      target="_blank"
      rel="noopener noreferrer"
      style={KEY_LINK_STYLE}
    >
      {spec.text}
    </a>
  )
}

/**
 * Render the provider's one-liner or its settings form.
 * @param props - the view asked for, locale copy, the form snapshot, and its actions.
 * @returns the one-liner, or the form.
 */
export function SerperSearchCard(props: SerperSearchCardProps): ReactNode {
  const { t } = props
  const state = props.useSerperSearchCard((snapshot) => snapshot)
  if (props.view === 'summary') return t('description')
  const disabled = !state.writable
  const field = (spec: Omit<FieldSpec, 'p' | 'disabled' | 'edit' | 'reset'>): ReactNode => valueField({
    ...spec,
    p: props,
    disabled,
    edit: props.edit,
    reset: props.resetField,
  })
  return (
    <SettingsForm labels={formLabels(t)} state={state} onSave={props.save} onDiscard={props.discard}>
      <div className="plugin-config-serper-search-groups" style={GROUPS_STYLE}>
        <section className="plugin-config-serper-search-group plugin-config-serper-search-group-deepseek" style={GROUP_STYLE}>
          <h3 style={GROUP_TITLE_STYLE}>{t('groupDeepseekTitle')}</h3>
          <p style={GROUP_HINT_STYLE}>{t('groupDeepseekHint')}</p>
          {field({ id: 'plugin-config-serper-search-deepseek-enabled', label: t('native'), hint: t('nativeHint'), field: 'native', state: state.native, placeholder: 'true' })}
          {credentialField({
            id: 'plugin-config-serper-search-deepseek-key',
            label: t('deepseekKey'),
            hint: t('deepseekKeyHint'),
            field: 'deepseekApiKey',
            state: state.deepseekApiKey,
            configured: state.deepseekApiKeyConfigured,
            writable: state.deepseekApiKeyWritable,
            p: props,
          })}
          {keyHelpLink({
            className: 'plugin-config-serper-search-deepseek-key-link',
            href: KEY_URLS.deepseek,
            text: t('deepseekKeyHelp'),
          })}
          {field({ id: 'plugin-config-serper-search-deepseek-endpoint', label: t('deepseekBaseUrl'), hint: t('deepseekBaseUrlHint'), field: 'deepseekBaseURL', state: state.deepseekBaseURL })}
          {field({ id: 'plugin-config-serper-search-deepseek-count', label: t('deepseekCount'), hint: t('deepseekCountHint'), field: 'deepseekCount', state: state.deepseekCount, numeric: true })}
          {field({ id: 'plugin-config-serper-search-deepseek-summary', label: t('summaryMaxChars'), hint: t('summaryMaxCharsHint'), field: 'summaryMaxChars', state: state.summaryMaxChars, numeric: true })}
          {field({ id: 'plugin-config-serper-search-deepseek-timeout', label: t('deepseekTimeoutMs'), hint: t('deepseekTimeoutMsHint'), field: 'deepseekTimeoutMs', state: state.deepseekTimeoutMs, numeric: true })}
        </section>

        <section className="plugin-config-serper-search-group plugin-config-serper-search-group-serper" style={GROUP_STYLE}>
          <h3 style={GROUP_TITLE_STYLE}>{t('groupSerperTitle')}</h3>
          <p style={GROUP_HINT_STYLE}>{t('groupSerperHint')}</p>
          {field({ id: 'plugin-config-serper-search-serper-enabled', label: t('serperEnabled'), hint: t('serperEnabledHint'), field: 'serperEnabled', state: state.serperEnabled, placeholder: 'true' })}
          {credentialField({
            id: 'plugin-config-serper-search-serper-key',
            label: t('serperKey'),
            hint: t('serperKeyHint'),
            field: 'serperApiKey',
            state: state.serperApiKey,
            configured: state.serperApiKeyConfigured,
            writable: state.serperApiKeyWritable,
            p: props,
          })}
          {keyHelpLink({
            className: 'plugin-config-serper-search-serper-key-link',
            href: KEY_URLS.serper,
            text: t('serperKeyHelp'),
          })}
          {field({ id: 'plugin-config-serper-search-serper-endpoint', label: t('baseUrl'), hint: t('baseUrlHint'), field: 'baseURL', state: state.baseURL })}
          {field({ id: 'plugin-config-serper-search-serper-gl', label: t('gl'), hint: t('glHint'), field: 'gl', state: state.gl })}
          {field({ id: 'plugin-config-serper-search-serper-hl', label: t('hl'), hint: t('hlHint'), field: 'hl', state: state.hl })}
          {field({ id: 'plugin-config-serper-search-serper-num', label: t('num'), hint: t('numHint'), field: 'num', state: state.num, numeric: true })}
          {field({ id: 'plugin-config-serper-search-serper-timeout', label: t('serperTimeoutMs'), hint: t('serperTimeoutMsHint'), field: 'serperTimeoutMs', state: state.serperTimeoutMs, numeric: true })}
        </section>

        <section className="plugin-config-serper-search-group plugin-config-serper-search-group-yuanbao" style={GROUP_STYLE}>
          <h3 style={GROUP_TITLE_STYLE}>{t('groupYuanbaoTitle')}</h3>
          <p style={GROUP_HINT_STYLE}>{t('groupYuanbaoHint')}</p>
          {field({ id: 'plugin-config-serper-search-yuanbao-enabled', label: t('yuanbaoEnabled'), hint: t('yuanbaoEnabledHint'), field: 'yuanbaoEnabled', state: state.yuanbaoEnabled, placeholder: 'false' })}
          {credentialField({
            id: 'plugin-config-serper-search-yuanbao-key',
            label: t('yuanbaoKey'),
            hint: t('yuanbaoKeyHint'),
            field: 'yuanbaoApiKey',
            state: state.yuanbaoApiKey,
            configured: state.yuanbaoApiKeyConfigured,
            writable: state.yuanbaoApiKeyWritable,
            p: props,
          })}
          {keyHelpLink({
            className: 'plugin-config-serper-search-yuanbao-key-link',
            href: KEY_URLS.yuanbao,
            text: t('yuanbaoKeyHelp'),
          })}
          {field({ id: 'plugin-config-serper-search-yuanbao-endpoint', label: t('yuanbaoEndpoint'), hint: t('yuanbaoEndpointHint'), field: 'yuanbaoEndpoint', state: state.yuanbaoEndpoint })}
          {field({ id: 'plugin-config-serper-search-yuanbao-cnt', label: t('yuanbaoCnt'), hint: t('yuanbaoCntHint'), field: 'yuanbaoCnt', state: state.yuanbaoCnt, numeric: true })}
          {field({ id: 'plugin-config-serper-search-yuanbao-timeout', label: t('yuanbaoTimeoutMs'), hint: t('yuanbaoTimeoutMsHint'), field: 'yuanbaoTimeoutMs', state: state.yuanbaoTimeoutMs, numeric: true })}
        </section>
      </div>
      <RuntimePanel t={t} />
    </SettingsForm>
  )
}
