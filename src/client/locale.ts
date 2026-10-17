/**
 * Locale bundles for the serper search provider's settings card.
 * @module dsh-serper-search/client/locale
 */

/** English copy. */
export const en = {
  title: 'Serper + DeepSeek search',
  description: 'Results merge DeepSeek Search API (primary) with serper.dev Google results (secondary). Advanced settings (ratio, summary length, timeouts) live in cordis.patch.yml.',
  apiKey: 'API key',
  apiKeyHint: 'Stored outside the settings file. Leave blank to keep the current key.',
  apiKeySet: 'A key is configured.',
  apiKeyUnset: 'No key is configured; searches will fail until one is saved.',
  baseUrl: 'Endpoint',
  baseUrlHint: 'Leave blank to use the provider default (https://google.serper.dev).',
  gl: 'Country (gl)',
  glHint: 'Google country code, e.g. cn or us. Leave blank for the provider default.',
  hl: 'Language (hl)',
  hlHint: 'Interface language, e.g. zh-cn or en. Leave blank for the provider default.',
  num: 'Results per search',
  numHint: 'Default number of organic results per search (1-100).',
  native: 'Merge DeepSeek Search API',
  nativeHint: 'true = every search also queries the DeepSeek Search API and interleaves its sources with Google 2:1 (wider coverage, ~0.005 CNY per search); false = serper only.',
  overridden: 'Overridden',
  reset: 'Reset to default',
  readOnly: 'This deployment stores settings read-only.',
  unavailable: 'This plugin is not loaded, so it cannot be configured right now.',
  save: 'Save',
  saving: 'Saving…',
  saveFailed: 'The deployment did not accept these values; they were left for you to correct.',
  invalidNumber: 'Enter a number, or leave blank to use the default.',
  invalidBoolean: 'Enter true or false, or leave blank to use the default.',
} as const

/** Simplified Chinese copy. */
export const zh: Record<keyof typeof en, string> = {
  title: 'Serper + DeepSeek 搜索',
  description: '结果由 DeepSeek 官方 Search API（主）与 serper.dev 的 Google 结果（补）按比例交错合并。高级项（比例、摘要长度、超时）在 cordis.patch.yml 中配置。',
  apiKey: 'API Key',
  apiKeyHint: '不写入设置文件。留空表示保持当前密钥。',
  apiKeySet: '已配置密钥。',
  apiKeyUnset: '未配置密钥；保存一个密钥后才能搜索。',
  baseUrl: '接口地址',
  baseUrlHint: '留空则使用提供方默认地址（https://google.serper.dev）。',
  gl: '国家/地区（gl）',
  glHint: 'Google 国家/地区码，如 cn 或 us。留空则使用提供方默认值。',
  hl: '语言（hl）',
  hlHint: '界面语言，如 zh-cn 或 en。留空则使用提供方默认值。',
  num: '每次搜索结果数',
  numHint: '每次搜索返回的自然结果条数（1-100）。',
  native: '合并 DeepSeek Search API',
  nativeHint: 'true = 每次搜索同时请求 DeepSeek 官方 Search API，并与 Google 结果 2:1 交错合并（覆盖更全，每次约 0.005 元）；false = 仅 serper。',
  overridden: '已覆盖',
  reset: '恢复默认',
  readOnly: '本部署的设置为只读。',
  unavailable: '该插件当前未加载，暂时无法配置。',
  save: '保存',
  saving: '保存中…',
  saveFailed: '本部署没有接受这些值，已保留供你修改。',
  invalidNumber: '请填数字；留空表示使用默认值。',
  invalidBoolean: '请填 true 或 false；留空表示使用默认值。',
}

/** Dictionary key union owned by this plugin. */
export type SerperSearchLocaleKey = keyof typeof en
