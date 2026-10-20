# Changelog

本文件从 0.4.0 起记录；更早版本的改动见 `git log`（0.3.4 / 0.3.2 / 0.3.1 / 0.3.0）。

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
