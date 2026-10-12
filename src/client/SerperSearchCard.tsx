/**
 * The serper search provider's settings card: renders its one-liner or its
 * settings form, as the Plugins page asks. Mirrors the official web-search
 * card's structure so the page composition treats both providers alike.
 * @module dsh-serper-search/client/SerperSearchCard
 */

import type { ReactNode } from 'react'
import {
  SettingsForm,
  SettingsSecretField,
  SettingsValueField,
  type SettingsFieldState,
  type SettingsFormActions,
  type SettingsFormShell,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { SerperSearchLocaleKey } from './locale.ts'

/** The card's snapshot: the shared form shell plus one state per control. */
export interface SerperSearchCardState extends SettingsFormShell {
  baseURL: SettingsFieldState
  gl: SettingsFieldState
  hl: SettingsFieldState
  num: SettingsFieldState
  native: SettingsFieldState
  apiKey: SettingsFieldState
  apiKeyConfigured: boolean
  apiKeyWritable: boolean
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

/**
 * Render the serper search provider's one-liner or its settings form.
 * @param props - the view asked for, locale copy, the form snapshot, and its actions.
 * @returns the one-liner, or the form.
 */
export function SerperSearchCard(props: SerperSearchCardProps): ReactNode {
  const { t } = props
  const state = props.useSerperSearchCard((snapshot) => snapshot)
  if (props.view === 'summary') return t('description')
  const disabled = !state.writable
  return (
    <SettingsForm labels={formLabels(t)} state={state} onSave={props.save} onDiscard={props.discard}>
      <SettingsSecretField
        id="plugin-config-serper-search-key"
        label={t('apiKey')}
        hint={t('apiKeyHint')}
        disabled={!state.apiKeyWritable}
        text={state.apiKey.text}
        configured={state.apiKeyConfigured}
        stateLabel={state.apiKeyConfigured ? t('apiKeySet') : t('apiKeyUnset')}
        onEdit={(text) => {
          props.edit('apiKey', text)
        }}
      />
      <SettingsValueField
        id="plugin-config-serper-search-endpoint"
        label={t('baseUrl')}
        hint={t('baseUrlHint')}
        overriddenLabel={t('overridden')}
        resetLabel={t('reset')}
        invalidLabel={t('invalidNumber')}
        disabled={disabled}
        {...state.baseURL}
        onEdit={(text) => {
          props.edit('baseURL', text)
        }}
        onReset={() => {
          props.resetField('baseURL')
        }}
      />
      <SettingsValueField
        id="plugin-config-serper-search-gl"
        label={t('gl')}
        hint={t('glHint')}
        overriddenLabel={t('overridden')}
        resetLabel={t('reset')}
        invalidLabel={t('invalidNumber')}
        disabled={disabled}
        {...state.gl}
        onEdit={(text) => {
          props.edit('gl', text)
        }}
        onReset={() => {
          props.resetField('gl')
        }}
      />
      <SettingsValueField
        id="plugin-config-serper-search-hl"
        label={t('hl')}
        hint={t('hlHint')}
        overriddenLabel={t('overridden')}
        resetLabel={t('reset')}
        invalidLabel={t('invalidNumber')}
        disabled={disabled}
        {...state.hl}
        onEdit={(text) => {
          props.edit('hl', text)
        }}
        onReset={() => {
          props.resetField('hl')
        }}
      />
      <SettingsValueField
        id="plugin-config-serper-search-num"
        label={t('num')}
        hint={t('numHint')}
        overriddenLabel={t('overridden')}
        resetLabel={t('reset')}
        invalidLabel={t('invalidNumber')}
        numeric
        disabled={disabled}
        {...state.num}
        onEdit={(text) => {
          props.edit('num', text)
        }}
        onReset={() => {
          props.resetField('num')
        }}
      />
      <SettingsValueField
        id="plugin-config-serper-search-native"
        label={t('native')}
        hint={t('nativeHint')}
        overriddenLabel={t('overridden')}
        resetLabel={t('reset')}
        invalidLabel={t('invalidNumber')}
        placeholder="true"
        disabled={disabled}
        {...state.native}
        onEdit={(text) => {
          props.edit('native', text)
        }}
        onReset={() => {
          props.resetField('native')
        }}
      />
    </SettingsForm>
  )
}
