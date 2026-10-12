/**
 * The serper search provider's settings card, browser half: the key, the
 * endpoint, the region/language, and the per-search result count over the
 * `web-search-serper` namespace the Host plugin registers. The card registers
 * into the Plugins page's `plugins.bundle.config` and `plugins.row.config`
 * slots while the Host serves that namespace, so a deployment without the
 * provider shows no trace of it.
 * @module dsh-serper-search/client
 */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
// Type-only: `ctx.slots` itself (ui-renderer is the package that provides it).
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
// Type-only: the `plugins.bundle.config` / `plugins.row.config` slot contract.
import type {} from '@deepseek-ai/dsh-client-ui-plugin-manager/client'
// Type-only: `ctx.configForms` (ui-settings is the providing package).
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import { en, zh, type SerperSearchLocaleKey } from './locale.ts'
import { SerperSearchCard } from './SerperSearchCard.tsx'
import { DEFAULT_API_KEY_REF, SERPER_SEARCH_NS, SerperSearchCardController } from './card-controller.ts'

export { DEFAULT_API_KEY_REF, SERPER_SEARCH_NS, SerperSearchCardController }
export type { SerperSearchLocaleKey }

/** Dictionary namespace owned by this plugin. */
export const NS = 'settings.serperSearch'

/** Required services (cordis fiber inject). */
export const inject = ['slots', 'locale', 'remote', 'remote.credentials', 'configForms']

/** The bundle package name the `plugins.bundle.config` key dispatches on. */
const BUNDLE_KEY = 'dsh-serper-search'

/** The `<package>#<row id>` key the `plugins.row.config` slot dispatches on. */
const ROW_KEY = 'dsh-serper-search#web-search-serper'

/** The locale service face this card reads (structural). */
interface LocaleLike {
  bind(namespace: string): (key: string) => string
  register(namespace: string, dictionaries: Record<string, unknown>): () => void
  subscribe(listener: () => void): () => void
}

/**
 * Mount the serper search settings card while the Host serves its namespace.
 * @param ctx - the browser plugin context.
 */
export function apply(ctx: ClientContext): void {
  const locale = (ctx as unknown as { locale: LocaleLike }).locale
  ctx.effect(() => locale.register(NS, { zh, en }), 'serper-search: dictionaries')
  const card = new SerperSearchCardController(ctx.configForms.get(SERPER_SEARCH_NS), ctx)
  ctx.effect(() => () => {
    card.dispose()
  }, 'serper-search: form subscription')
  ctx.effect(
    () =>
      ctx.remote.$on('credentials/reference-updated', (ref: string) => {
        card.refreshCredential(ref)
      }),
    'serper-search: credential invalidations',
  )
  ctx.effect(
    () =>
      ctx.configForms.whileServed([SERPER_SEARCH_NS], () => {
        const bundleOff = ctx.slots.inject(
          'plugins.bundle.config',
          () =>
            ctx.slots.register(
              {
                name: 'plugins.bundle.config',
                key: BUNDLE_KEY,
                locale: NS,
                inject: () => card.inject(),
              },
              SerperSearchCard,
            ),
        )
        const rowOff = ctx.slots.inject(
          'plugins.row.config',
          () =>
            ctx.slots.register(
              {
                name: 'plugins.row.config',
                key: ROW_KEY,
                locale: NS,
                inject: () => card.inject(),
              },
              SerperSearchCard,
            ),
        )
        return () => {
          bundleOff()
          rowOff()
        }
      }),
    'serper-search: page',
  )
}
