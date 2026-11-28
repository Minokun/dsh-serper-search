# Changelog

本文件从 0.4.0 起记录；更早版本的改动见 `git log`（0.3.4 / 0.3.2 / 0.3.1 / 0.3.0）。

## [Unreleased]

## [0.5.2] - 2026-11-28

> 补丁版本：修一个从 v3.1 就存在的缺陷，不加功能。默认行为只在一种情况下与 0.5.1 不同：某个 query 的候选集中在少数域名、按 `maxPerHost` 凑不满 `maxResults` 时——以前结果会少于上限，现在补满。其余情况的输出与 0.5.1 逐条相同：同一份输入跑两版合并代码，普通样本的输出一致。

### Fixed（结果条数）

- **单域名上限不再把结果砍短。** `maxPerHost: 2` 的本意是不让一个网站占满名单；但候选集中在一两个域名时（`site:` 检索、小众主题、同一个文档站的多个页面），被它拦下的候选直接丢弃，且没有任何兜底。离线复现：两个域名各占一半的候选只返回 4 条，全部来自一个域名的只返回 2 条，而 `maxResults` 是 24。现在合并先按原规则取一遍（结果开头仍是分散的域名），没凑满时再把这些候选按名次补进去，直到凑满或候选用尽；候选本身不够时如实返回全部。
- **可见性**：兜底生效时，日志汇总行多一个 `capFill=N`（补了几条），例如 `merged=24 capFill=22`。这个计数只进日志，不进入搜索结果。
- **影响范围**：2026-10-21 至 2026-11-28 的 397 次真实调用里没有出现过它的特征（结果少于上限、且来自很少的域名）——宽泛的搜索词不会触发；它只影响「结果集中在少数网站」的检索。

### Tests

- 新增 6 条，改写 4 条写死了旧行为的断言：凑不满时补齐且开头保持分散、候选不足时全量返回、单域名 / 两域名样本从 2 / 4 条到 24 条、400 组随机样本下「结果长度恒为 min(maxResults, 去重后候选数)」且「只有上限本来凑不满时才有域名超限」、走完整搜索链路的端到端验证（含日志行）。

## [0.5.1] - 2026-11-28

> 补丁版本：只修缺陷，不加功能。默认行为不变——一次调用仍返回同样的条数，三路比例、缓存和降级规则都与 0.5.0 一致。下列数字来自 2026-11-27 对真实调用日志的复盘。

### Fixed（结果质量）

- **`publishedAt` 在三路上都是真实的日历日期。** 此前只有日期的字符串会倒退一天（`"Jun 23, 2026"` 在东八区变成 `2026-06-22T16:00:00.000Z`，真实来源里 23% 如此），相对时间（`3 days ago`、`7天前`）和作者名（`by N Sapunov`）被原样透传，DeepSeek 那一路干脆不做归一化。现在三路共用一个校验器：日历日期 → `YYYY-MM-DD`（任何时区结果相同），带偏移的时间戳原样保留，相对时间按当前时钟换算，其余丢弃。
- **同一页面的 http / https、带 / 不带 `www.` 不再各占一个名额。** 此前这两种写法算作两个来源（388 条真实结果里有 30 条成对出现）。去重时折叠为同一个键；来源保留原始 URL。
- **serper 返回的 `google.com/goto` 跳转链接不再作为来源。** 这种链接无法还原目标地址，此前却被当作可引用的结果（10-25 以来出现 86 次），还挤掉了一条可引用的结果。现在直接跳过；Google 的其他页面不受影响。
- **元宝的长段落默认截到 1000 字符。** 此前元宝 `passage` 不限长度地写进摘要（实测单条最长 6000 字符；超过 2000 字符的 3.4% 来源占了 23.9% 的摘要文本）。新增设置 `yuanbaoSnippetMaxChars`（默认 `1000`，`0` = 不截断），设置页里叫「摘要长度」。
- **摘要和段落在截断处不再切断 emoji。** 此前按 UTF-16 码元截断，切在表情中间会留下半个字符。

### Fixed（稳定性）

- **带 `site:` 等操作符或引号的查询不再让 DeepSeek 这一路返回 400。** DeepSeek Search API 遇到 `site:`、`intitle:`、引号会直接拒绝，整次搜索因此丢掉主路（真实调用里出现过 2 次）。现在只对这一路改写查询：`site:` 保留其域名为关键词，`intitle:` / `inurl:` 保留参数，`filetype:` 去掉，引号去掉；其他两路仍收到原始查询。
- **在线的搜索源全部失败时，处于冷却中的那一路会被重试一次。** 此后被冷却的那一路即使已经恢复也不会被请求，整次搜索直接报错（5 次真实报错里有 3 次是这种形态）。有在线的搜索源成功时不会重试。
- **修改元宝端点后，旧的冷却状态会被清除。** 此前端点变了，旧端点攒下的冷却还在。
- **被单域名上限挡住的候选不再白占所在搜索源的名额。** 此前轮到某一路时，如果它的首个候选被上限挡住，这一轮就空着，名额之后落到别的路上，`1:1` 的比例因此失衡。现在该路改用下一个可用的候选。

### Changed

- **`scripts/sync-dsh-preset-cap.mjs` 的 `interrupt: true` 改为显式选项 `--interrupt`。** 默认只设置 `searchMaxResults`，不动 DSH 自己组装的其他行；要固定 `interrupt: true` 就加 `--interrupt`（会在生成的区块里注明），要显式不固定就加 `--no-interrupt`。已有配置钉了 `interrupt: true` 而没给选项时，脚本会拒绝运行并说明原因。
- 发布工作流只在推送 `main` 时触发一次（此前一次发版会跑两遍、抢着发布）。

### Docs

- README 跟上 DSH 0.2.2-rc.5：工具层默认条数为 10（更早为 8）；按真实调用的统计修正了 token 估算；配置表补 `yuanbaoSnippetMaxChars`；新增「多 query 调用的两个已知限制」。
- **README「安装」段新增「装完你会得到什么」三档表**：澄清市场一键安装拿到的是**默认 8 条两路**（6 官方 + 2 Google），不是 24 条三路；24 条需要 `searchMaxResults: 24` + `yuanbaoEnabled` + `YUANBAO_API_KEY` 三件事，缺件只降级不报错。同时写明市场索引由 `awesome-dsh-plugin` 每日 02:23 UTC 从 npm 重建，发版后最多滞后一天。
- **修正「来源条数上限」段的脚本可达性**：0.5.0 的 npm tarball 里**没有** `scripts/`（`files` 白名单不含它），所以市场用户照原文 `node scripts/sync-dsh-preset-cap.mjs` 会 `ENOENT`。现在给出两段命令——仓库内直接跑，市场/npm 安装的用一行 `curl` 取同一份脚本（纯文本生成器，不联网），并补上回退方法（删掉标记区即可）。
- English 段补同样的「默认 8 槽 / 24 槽三件事 / 脚本取法」说明。

### Packaging

- `package.json` 的 `files` 白名单加入 `scripts/sync-dsh-preset-cap.mjs`，下次发布后 npm 安装即可直接运行包内脚本，无需再 `curl`。

### Internal

- `npm run typecheck` 恢复可用：`@deepseek-ai/dsh-client-ui-primitives` 的发布物缺少设置表单的类型声明，仓库里补了一份本地声明。

## [0.5.0] - 2026-10-21

> 三路合并 + 三组独立设置版本：把腾讯云**元宝搜索（WSA SearchPro）**接成第三路，支持「三路各 8 条 = 合并后 24 条」；设置卡改成三个搜索源各自独立的一组（开关 / 凭据 / 参数），并新增 `serperEnabled` 让 serper 也能单独关闭。第三路默认关闭，老配置行为零变化；**184 项单测全绿**（新增 `tests/yuanbao.test.mjs` 14 项 + `tests/lane-toggles.test.mjs` 7 项）。

### Added

- **第三路：元宝搜索（默认关闭）**。新增 `lib/yuanbao.js`：`POST https://api.wsa.cloud.tencent.com/SearchPro`，`Authorization: Bearer <WSA 服务 key>`，body `{Query, Cnt, Site?}`；`Response.Pages` 是 JSON 字符串数组，逐条二次 `JSON.parse`；`title/url/passage/date` 映射为 `title/url/snippet/publishedAt`（用 `passage`，实测比拼 `content` 更准）。新配置项 `yuanbaoEnabled`（默认 `false`）、`yuanbaoApiKey` / `yuanbaoApiKeyEnv`（默认 `YUANBAO_API_KEY`）、`yuanbaoEndpoint`（默认 SearchPro 端点，可用 `YUANBAO_ENDPOINT` 覆盖）、`yuanbaoCnt`（0 = 按 `maxResults` 推导）、`yuanbaoTimeoutMs`。凭据走 DSH credentials / 启动环境，失败信息只提引用名、不含 key。
- **`Cnt` 取整护栏**：WSA 的 `Cnt` 只接受 10 的倍数（10~50），传 8/15/60 会返回 **HTTP 200 + `{"Response":{"Error":{"Code":"InvalidParameter","Message":"illegal Cnt"}}}` 且没有 `Pages`**——只看状态码会得到「永远搜不到东西」的工具。适配层按 `ceil(maxResults/10)*10` 取整并夹到 `[10,50]`，24 槽时元宝请求 30 条、客户端按席位截断；`yuanbaoCnt` 配了非法值也会被取整后再发。
- **N 路合并（`mergeLanes`）**：`lib/merge.js` 新增通用交错器，`lanes = [{name, sources}]` + `pattern`（槽位字母或 lane 名）+ `slotNames` 映射；保留 URL 归一化去重、本地化变体折叠、`maxPerHost`、社交降权与「耗尽一路由下一路补位」的老行为。新增三元比例键 `'1:1:1'`（8+8+8）与 `'2:1:1'`；`mergeSources` / `mergeResults` / `RATIO_PATTERNS` 的旧导出与语义保持不变（现有测试逐条通过）。
- **三元 `ratio`**：`ratio` 现在接受数字或 `'1:1:1'` / `'2:1:1'`；三路模式下填数字按 `'1:1:1'` 处理（否则数字模式会让第三路永远抢不到槽位）。
- **元宝进 probe / 设置卡**：`/probe` 返回三条 lane 报告；第三路**仅在 `yuanbaoEnabled` 时**才真的发一次 3 条请求（关闭时回 `class: 'disabled'`，不花钱），三路各自 single-flight、失败只标记不抛。卡片新增「合并元宝搜索」布尔项与「元宝搜索」状态行，`probeOk` 语义改为「所有**已启用**的后端都正常」。
- **`lib/http.js`**：把 `postJson` / `readJsonBody` / `withTimeout` / `drainBody` / `sleep` / `clampCount` / abort 错误工厂从 `lib/index.js` 抽出来共享（三路复用同一套超时与 abort 语义），`files` 白名单同步加入 `lib/http.js`、`lib/yuanbao.js`。
- **错误分类支持 `providerClass` 提示**：WSA 用 HTTP 200 回错误信封，`lib/failure.js` 现在优先采纳错误自带的 `providerClass`（auth / quota / rate-limit / server / invalid-response），信封错误因此能和状态码错误一样触发正确的冷却。
- 测试 `tests/yuanbao.test.mjs`（14 项）：`Cnt` 取整矩阵、Pages 二次解析与去重、信封错误分类、缺 key、24 槽 8/8/8 与三路请求体（DeepSeek `count=24` / serper `num=24` / 元宝 `Cnt=30`）、结构化 `Site`、一路/两路/全路失败降级与 `Note` 文案、`native:false` + 元宝、跨路 host 上限与去重回填、`cacheKey` 覆盖元宝字段。

### Added（第二轮：三组独立设置 + serper 开关）

- **设置卡按搜索源分成三组**：同一张 `SettingsForm`（一次 Save 覆盖全部），用 `<section>` + 标题 + 分隔线划分「DeepSeek 搜索（Search API）」/「serper / Google」/「元宝搜索（腾讯云 WSA）」三块（class 前缀 `plugin-config-serper-search-group-*`）。每组自带开关、独立凭据框和本组参数：DeepSeek 组 `native` + `deepseekApiKeyEnv` + `deepseekBaseURL/deepseekCount/summaryMaxChars/deepseekTimeoutMs`；serper 组 `serperEnabled` + `apiKeyEnv` + `baseURL/gl/hl/num/serperTimeoutMs`；元宝组 `yuanbaoEnabled` + `yuanbaoApiKeyEnv` + `yuanbaoEndpoint/yuanbaoCnt/yuanbaoTimeoutMs`。原先只在 patch 里的 `summaryMaxChars`、各 `*TimeoutMs`、两个 count 与端点也进了 GUI。
- **三个凭据框彼此独立**：`card-controller` 维护三份 `{ref, configured, writable}`，各自按本组引用名（`apiKeyEnv` / `deepseekApiKeyEnv` / `yuanbaoApiKeyEnv`）向 credentials 域 `describe`/`set`；改某组引用只刷新该组，`credentials/reference-updated` 只刷新引用匹配的那一组；每组有独立的已配置/未配置徽标。
- **`serperEnabled`（默认 `true`）**：Host 侧新增 lane 开关——`laneBackends()`、probe（关闭的那一路回 `class: 'disabled'` 且不发请求）、`cacheKey`（新增 `se`）、降级 Note 与错误文案都跟着变；`serperEnabled: false` + `native: false` + 元宝关时 `available()` 为 false，搜索抛一条明确错误（`no search lane is enabled (DeepSeek: off, serper: off, Yuanbao: off)`），不会静默返回 0 条。
- **`native` 语义在 UI 上正名**：字段名保留 `native`（老配置/老测试依赖），卡片文案改为「启用 DeepSeek 搜索」；三个开关的空 draft 都是 `clear`（继承上层），每组 hint 明说「留空表示继承上层配置」。
- **每组凭据框下的官方入口外链**：三组各自在凭据框正下方渲染一条「还没有 API Key？」的 `<a target="_blank" rel="noopener noreferrer">` 链接（无色、`color: inherit`，交给主题），URL 作为 client 侧常量 `KEY_URLS` 硬编码（不入配置项，注释记录 2026-10-21 的可用性核对）：DeepSeek `https://platform.deepseek.com/api_keys`、serper `https://serper.dev/dashboard`、腾讯云 WSA `https://console.cloud.tencent.com/wsapi`；文案走 locale（`deepseekKeyHelp` / `serperKeyHelp` / `yuanbaoKeyHelp`，中英各一套）。README 的 GUI 段与 English 段各补一张「凭据获取入口」小表。
- 测试 `tests/lane-toggles.test.mjs`（7 项）：`serperEnabled:false` 的 lane 组装与 12+12 交错、三路全开 8/8/8、全关明确报错且零上游请求、probe 三行（关闭项 `disabled`）、`cacheKey` 随三个开关变化、`primary: serper` 但 serper 关闭时的回退、serper 关闭且元宝失败时的单路降级。

### Changed

- **卡片结构与文案**：`SerperSearchCard` 由平铺字段改为三组分区渲染，新增 `groupDeepseekTitle` / `groupSerperTitle` / `groupYuanbaoTitle` 等中英文 key（旧的单一 `apiKey` 文案拆成三组的 `serperKey` / `deepseekKey` / `yuanbaoKey`）；`lib/client.js` 重新构建（29.65 kB → 42.83 kB）。
- **README 全面对齐 v0.5**：「来源条数上限」表补 **24 槽**一行（两路 16+8（`ratio: 2`）/ 12+12（`ratio: 1`），三路 8/8/8），并把默认值（8 槽两路）与推荐值（两路 12、三路 24）写清；「三路合并」小节补 `ratio: '1:1:1'` + `searchMaxResults: 24` 的完整示例、`Cnt` 24→30 的取整规则、结构化 `Site`、`passage` 优于 `content` 的实测数字；成本段写清两路 0.0122 → 三路 0.0322 元/次、**元宝每月 2000 次免费额度（个人用量约 2000 次/月，基本落在免费额度内，三路几乎不增加实际支出）**；GUI 段改成三组独立开关/凭据/参数的表格；配置表补 `serperEnabled`、订正 `native` 文案与缓存键清单；English 段同步。
- **降级语义从「两路都失败才报错」推广为「全部启用的路都失败才报错」**，错误信息逐路列出分类与原因；`clearHealth` / `coolingLanes` / `refreshCooldowns` / 探活协议都泛化到三路（全路同时冷却仍 fail-open）。
- **缓存键补元宝相关字段**：`yuanbaoEnabled` / `yuanbaoEndpoint` / `yuanbaoCnt` / 交错 `pattern` / 启用 lane 集合——两路缓存结果不会再被三路请求命中（反之亦然）。
- **`ratio` 文档与配置表**：README「来源条数上限」表补 24 槽（两路 17+7、三路 8/8/8）与 16 槽三路列；新增「三路合并（v0.5.0）」小节，写清 `Cnt` 必须是 10 的倍数、`Site` 用结构化参数（内联 `site:` 实测只有 30% 落域）、三路成本约 0.032 元/次（两路 0.0122 元/次，约 2.6 倍）。
- **旧文案订正**：去掉「8 条来源 = 6 官方 + 2 Google」这类只在默认 8 槽成立的表述；配置表、缓存键清单、English 段同步到 v0.5。
- `lib/client.js` 重新构建（含元宝开关与三路状态行；`check-client-id` 门禁通过）。

### Known

- `pnpm typecheck` 在本机会失败，且**改动前就是这样**：安装的 `@deepseek-ai/dsh-client-ui-primitives@0.1.7-rc.2` 发布物里 `lib/types` 缺少 `src/` 中已有的 settings-form 类型（`SettingsForm` / `SettingsFieldState` / …），`tsc` 因此报 15 条 `TS2305` + 1 条 `TS2339`。改动前后错误清单逐条一致（无新增），等 dsh 客户端包升级或本地 `pnpm install` 到类型完整的版本即可恢复；本版本的 CI 门禁仍是 build + `check-client-id`，见 0.4.0 的说明。

## [0.4.0] - 2026-10-20

> 本轮整改已完成，163 项单测全绿；`package.json` 已升 `0.4.0`。市场截图已随仓库提供（`assets/shot-settings.png` / `assets/shot-merged.png`，由根目录 `screenshots.json` 声明），`browser` 分类 PR 仍需人工提交，见文末「已知待办」。

### Added

- **结果缓存（P0-2）**：成功结果进 50 条 LRU，默认 TTL 5 分钟（`cacheMinutes`，0–5，`0` 关闭）。缓存键覆盖所有影响输出的设置（query / `maxResults` / `primary` / `ratio` / `maxPerHost` / `demoteSocial` / `gl` / `hl` / `autoLocale` / `num` / `native` / `deepseekCount` / `summaryMaxChars` / `minAuthority` / `serper.baseURL` / `deepseek.baseURL`），窗口内重复 query **0 上游请求**，日志 `cache=hit` / `cache=store`。降级结果只缓存 `max(60s, TTL/5)`；abort 与失败不入缓存。新增 `lib/cache.js`，`Config.cacheMinutes`。
- **失败分类 + 冷却 + 降级 Note（P0-3）**：新增 `lib/failure.js`。`auth`（401/403/凭据缺失）与 `quota`（402 / 429 含额度文案）冷却 10 分钟，`rate-limit` / `server` 60 秒，`timeout` / `network` 30 秒，`invalid-response` / `empty` 不冷却；两路同冷却时 fail-open 仍请求两路；降级时 `content` 顶部加一行模型可见的 `Note: serper auth failed (HTTP 401), using deepseek.`。冷却在成功、凭据指纹变化、`credentials/reference-updated` 事件（卡片改/补 key）、探测成功与到期时清除。
- **运行时接管 `searchProvider`（P0-1）**：`cordis.patch.yml` 删除静态 `- id: web` pin，改由插件在首次启动时判定——用户层未表态且当前为未设置/部署默认值时写入 `searchProvider: serper`，并在自身条目写一次性标记 `takeOverProvider: false`；用户层写了别的 id 时只 warn、不抢；写了 `serper` 时只补标记。新增 `Config.takeOverProvider`。
- **设置页运行时面板（P1-5）**：新增 `src/client/runtime-panel.tsx` 与 19 个中英文 locale key，卡片底部四个按钮——「测试双路」「检查更新」「设为本机默认搜索」「恢复部署默认」。Host 侧新增 `lib/routes.js`，注册三条 POST-only exact 路由 `/api/dsh-serper-search/{probe,update-check,provider}`，复用 DSH 自带 connection fence（Host/Origin + 登录 cookie），probe 单飞、两路各自的请求预算临时置为 8s（并行，最坏约 8s；没有独立外层 timer）、每路 3 条、失败不写冷却、成功清冷却，响应不含凭据。
- **检查更新（P1-6）**：`/update-check` 由 Host 读 `registry.npmjs.org`（浏览器无 CORS 问题），自带 semver 2.0 比较器（无新依赖），结果缓存 10 分钟且只缓存成功；有新版时卡片显示 `有新版本 0.3.4 → x.y.z · npm` 链接。不做一键升级。
- **`account-only` 分类**：仅用 DeepSeek 账号登录时，probe 的官方路不再误报 auth 失败，改为专属文案（账号登录态只在对话内生效）。
- **文档（P1-8 / P1-7）**：README 重写安装段（新增「给 AI 的一句话」与「环境变量」注意事项）、新增「卸载与恢复」「设置页四个按钮」、原手动 pin 教程 FAQ 化、配置表补 `cacheMinutes` / `takeOverProvider`、新增 star CTA；新增本 CHANGELOG 与 `category-browser-PR.md`（供人工提交市场分类 PR）。新增两张真实截图（设置页双路自检、一次真实搜索的 8 条来源）与根目录 `screenshots.json` 声明，市场夜间构建会自动抓取画廊。
- 测试：新增 `tests/takeover.test.mjs`、`tests/failure.test.mjs`、`tests/cooldown.test.mjs`、`tests/cache.test.mjs`、`tests/routes.test.mjs`、`tests/update-check.test.mjs`，合计 **163 项**。

### Changed

- **npm 包内容改为显式白名单**：`package.json` 的 `files` 从整个 `lib` 目录改为六个运行时 JS（`index` / `client` / `merge` / `cache` / `failure` / `routes`）+ `cordis.patch.yml` + `README.md` + `CHANGELOG.md`，**44 KB 的 `lib/client.js.map` 不再发布**；以后新增随包发布的 lib 文件要同步加进 `files`。
- **CI 测试门禁评估后未启用（如实记录）**：计划在 `.github/workflows/publish.yml` 的 build 前跑 `pnpm test`，但 Host 端单测和 `lib/index.js` 依赖 DSH 宿主提供的 `@deepseek-ai/*` 运行时模块——这些模块在本机由 `scripts/link-harness.sh` 链接、并没有以 `0.2.1-rc.2` 的版本发布到 npm（registry 上是旧的 0.0.1-rc.x），CI 里缺失它们会让发布流程在测试步骤直接失败、反而阻断发版。因此测试门禁保持在**本地**（`pnpm test`，163 项全绿）；CI 仍为 install → build（含 client-id 门禁）→ publish。将来若给 CI 补上可安装的 harness 依赖或 link 步骤，再把 test 加回发布前。
- **接管判定更保守**：不再硬编码单一官方 id，改为用 `settings.describe()` 暴露的部署默认值比较（读不到时兜底 `deepseek-official`）；显式设置的 `$DSH_WEB_SEARCH_PROVIDER` 被视为运维已表态——`serper` 才继续接管，其它 id 只 warn 并写一次性标记，绝不静默改选路。
- **`/provider` 路由契约收紧**：只接受 `{"action":"take"}` / `{"action":"release"}`，缺 body 或未知 action 一律 400 且**不写任何设置**（避免误把 serper 钉上）；请求体超 64 KiB 回 413。`release` 的写入顺序改为**先写一次性标记、再清 pin**——两步之间失败也不会在下次启动被重新接管。
- **错误对象补充 `httpStatus` + 脱敏 `bodyExcerpt`**：两个后端的非 2xx 分支统一先读一次错误正文（≤300 字符、单行、脱敏 `Bearer` / `sk-*` / `api_key|token|secret|password=` / ≥32 位长 token），quota 判定与 probe 报错文案因此有据可依。
- **`test` 脚本**：`node --test tests/merged-search.test.mjs` → `node --test "tests/**/*.test.mjs"`（本机 Node 22 不接受目录位置参数，glob 覆盖 `tests/` 全部文件）。
- **README 安装流程**：不再要求手改 profile pin；旧版（<0.4.0）的静态 pin 说明降级为 FAQ 条目。
- **`lib/client.js`** 重新构建（含运行时面板；`check-client-id` 门禁通过）。

### Fixed

- **搜索路径上游错误正文脱敏**：探活之外，真实搜索失败时的上游正文（serper 错误 `error` 字段、DeepSeek 错误 body 摘录、降级日志的失败详情）都在进入错误消息/日志前脱敏，避免上游回显的 key 泄漏到界面或日志；模型可见的 `Note:` 仍只含分类标签与 HTTP 状态码。
- **冷却清除时失效结果缓存**：改 key（`credentials/reference-updated`）、凭据指纹变化、探测成功等任何「用户已经修好」的动作，在清冷却的同时清空结果缓存——否则 5 分钟缓存里那条带旧 `Note` 的降级答案会继续命中，修复看起来没生效。
- **缓存键补端点与 locale**：`cacheKey` 增加 `serper.baseURL` / `deepseek.baseURL` / `autoLocale`，在卡片里改接口地址或切换自动 locale 后不会再命中旧端点/旧 `gl/hl` 的结果。
- **`update-check` 防重复与体积上限**：并发点击/多个标签共享同一次 registry 查询（单飞）；registry 响应改为流式读取并限制 1 MiB（超限即失败、不进缓存），redirect 视为错误，机器时钟回拨时按 miss 处理而不是把旧答案当成新鲜。
- **接管一次性标记写入失败改 error 级日志**：标记写不进去时用 `logger.error`（没有 error 通道的部署降级为 warn），日志明确提示「之后点恢复部署默认可能被重新接管」以及检查 profile patch 可写性，不再只是一行容易被忽略的 warn。
- **设置页运行时面板的布局与可访问性**：面板改用内联、免配色的样式与可换行的按钮行（窄卡片不再溢出）；每个结果区常驻 `role="status" aria-live="polite"`，运行中带 `aria-busy`，读屏能播报「测试双路 / 检查更新 / 切换」的结果；账号态、错误态与成功文案统一，避免歧义。
- **文档事实订正**：README / CHANGELOG / `cordis.patch.yml` / `category-browser-PR.md` 逐条对齐代码——只有 `/provider` 读请求体（64 KiB）、probe 明确写成「两路各自的请求预算临时置 8s（并行，最坏约 8s）」且无独立外层 timer、`deepseekTimeoutMs` 写明是含重试与退避的硬 deadline（总耗时 ≤ timeoutMs）、冷却时长按分类列全（auth/quota 10 分钟、rate-limit/server 60 秒、timeout/network 30 秒）、缓存键补 `serper.baseURL` / `deepseek.baseURL` / `autoLocale`、去掉指向仓库外的 `../research/03-bench.md` 死链与不随包发布的 `category-browser-PR.md` 链接、`cordis.patch.yml` 注释改成正确恢复顺序（先「恢复部署默认」或手删 pin，再删 bundle）。
- **市场截图补齐**：`assets/shot-settings.png`（设置页 + 一次「测试双路」结果）与 `assets/shot-merged.png`（一次真实搜索的 8 条来源）已随仓库提供，根目录 `screenshots.json` 按市场规范声明两个路径；README 用 GitHub raw 绝对 URL 展示（npm 页面也能显示），不再有占位符或内部待办。
- 429 / 5xx / 超时 / 坏 JSON 失败不再只靠 message 文本猜测，改由 `failureKind` + 分类表稳定判定（表外 4xx 归 `invalid-response`，不冷却付费后端）。
- probe 的 lane `error` 在进入响应前脱敏并折叠为单句，避免上游错误正文回显 key（单测实测抓到过这条泄漏）。
- 卡片请求遇到未注册路由时同时识别 404 与 SPA fallback 的 405，缺服务的部署不再误报"自检失败"。

### Known / upgrade notes

- 接管会写进你**自己的** `~/.dsh/profiles/<p>/cordis.patch.yml`，并把当时的整个 `web` config（含 `fetchProvider: http`，值不变）一并冻结；卸载后残留 pin 属已知状态，恢复步骤见 README「卸载与恢复」。
- 0.3.x 手动 pin 过 `serper` 的 profile：升级后只补写 `takeOverProvider: false`，不动 pin——代价是之后删掉 pin 不会被重新接管（设计如此）。
- `npm view` / 市场条目的版本与画廊要等发布推上 `main` 后生效（画廊由夜间构建抓取 `screenshots.json`）；`browser` 分类 PR 待人工提交。

## 已知待办（发布阶段，不在本条目内）

- [ ] `package.json` 升 `0.4.0`（description 已按 0.4.0 增补），`sh scripts/release.sh minor`
- [ ] 向 awesome-dsh-plugin 提交 `category: tools → browser` PR（见 `category-browser-PR.md`）
- [ ] 干净 profile 安装验收、live 验证（降级 + Note / 改 key 清冷却 / cache=hit；`node scripts/verify-live.mjs` 的离线断言 + 两个 key 的真实冒烟）
- [ ] 发布后新 profile `dsh plugin add dsh-serper-search` 验证 npm 包可装：包内无 `lib/client.js.map`、含 `README.md` / `CHANGELOG.md` / `cordis.patch.yml`
- [ ] 发布后次日确认市场画廊出现 2 张截图（`screenshots.json` 已在仓库）
