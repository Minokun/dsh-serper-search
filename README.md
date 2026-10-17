# dsh-serper-search

DeepSeek **Search API**（官方自研搜索引擎）+ [serper.dev](https://serper.dev)（Google 搜索）双擎互补的搜索插件，接入 DeepSeek Harness 的 web 能力缝（`ctx.web`）。安装后，DSH 内置的 `web_search` 每次只发两次直连检索请求（`native:true` 且两路可用时；单路缺 key 或 `native:false` 时只发一次，无辅助模型调用），结果按 URL 去重后以 **固定比例交错**（默认 2:1）合并，让模型同时拿到 DeepSeek 自有索引与 Google 索引。

> 为什么互补：实测同一组 query 下，DeepSeek Search API 与 Google 的结果 URL 重叠仅 **1.3%**（同后端重复调用噪声地板 43%–100%，故为真实索引差异）。DeepSeek 侧更快、更贴中文，Google 侧覆盖面更广，两者互补而不互相替代。
>
> v3 不再调用 DeepSeek 原生 Messages 搜索（旧版那一半每次要一整轮模型调用 5.3s / 0.019 元，且返回的是无摘要裸链接）。

## 工作原理

- 注册一个 id 为 `serper` 的复合 `WebSearchProvider`（id 保持兼容，现有 profile 无需改配置），内部两路**直连 HTTP**后端并行：
  - **DeepSeek Search API（主路）**：`POST ${deepseekBaseURL}/search`（默认 `https://api.deepseek.com/v1/tools/search`），鉴权为 `Authorization: Bearer <DEEPSEEK_API_KEY>`；若是 DeepSeek Account 路由会话则改发 `x-dsh-auth-token`（与 DSH 内置 provider 一致）；
  - **serper.dev（副路）**：`POST ${baseURL}/search`，请求头 `X-API-KEY`，body `{q, gl, hl, num}`；`answerBox` 直接答案映射为结果级 `content`。
- 映射增强：
  - 官方 `summary`（实测均长 1893 字符）折叠空白后截断到 `summaryMaxChars`（默认 600）写入 `snippet`，把官方内置插件丢弃的长摘要捡回来；设 `0` 则回退原始短 snippet（231 字符）；
  - 官方 `date` → `publishedAt`；serper 中文日期（`2026年8月13日`）→ ISO；
  - 官方 `authority` 支持 `minAuthority` 过滤（保留 `-1` 未知站点）；
  - 纯英文/代码 query（`autoLocale` 默认开启、`gl=cn` 时）自动切到 `gl=us, hl=en`：实测英文 query 延迟从 3.6–10.5s 降到 1.0–1.7s。
- 合并：按归一化 URL 去重（去 fragment / `utm_*` / `spm_*` / 百度百科等追踪参数；`chapter`、`channel`、`from=20` 等业务参数不误删）→ 按固定比例模式交错 → 截到 `maxResults`（工具层默认 8）→ 返回 `truncated: false`（单 query 时避免工具给模型追加 "Refine the query for more" 诱导重搜的尾注；多 query 时工具层轮转仍可能自行追加，插件无法控制）。
- 降级：任一路失败/超时/缺 key，另一路独立成答；两路都失败才报错。每路独立超时（官方 5000ms / serper 4500ms），官方 429/5xx 有 1s→2s 指数退避重试。
- 比例档位（8 槽位最终构成）：`4 → 7主+1补`、`3 → 6+2`、`2 → 6+2`（默认）、`1.5 → 5+3`、`1 → 4+4`，可在 patch 里配置。

## 安装

```sh
dsh plugin --profile web add dsh-serper-search
```

或打开 **设置 → 插件市场**，搜索 `dsh-serper-search` 一键安装。

1. 配置两个 key（推荐 credentials 域，GUI 卡片也可填 serper key）：
   - `~/.dsh/.credentials.yaml` 的 `refs:` 下加 `SERPER_API_KEY: <serper key>` 与 `DEEPSEEK_API_KEY: <deepseek key>`（后者通常已有）；
   - 或启动环境变量 `SERPER_API_KEY` / `DEEPSEEK_API_KEY`。
2. 重启 `dsh web`，浏览器刷新页面即可生效。

## GUI 设置页

**Plugins → dsh-serper-search** bundle 详情页提供基础配置：serper API key（写入 credentials 域，不落设置文件）、接口地址、`gl`、`hl`、每次结果数、是否合并 DeepSeek Search API（`native`）。

`ratio`、`primary`、`summaryMaxChars`、`*TimeoutMs`、`autoLocale`、`minAuthority`、`maxRetries` 等**高级项不进 GUI**，通过 profile 的 `cordis.patch.yml` 覆盖：

```yaml
- id: web-search-serper
  config:
    ratio: 1.5            # 5 主 + 3 补（默认 2 = 6 主 + 2 补）
    summaryMaxChars: 800  # 官方长摘要注入 budget；0 = 关闭
    autoLocale: true      # 纯英文 query 自动 gl=us/hl=en
    primary: deepseek     # 或 serper
    serperTimeoutMs: 4500
```

## 配置项（settings 命名空间 `web-search-serper`）

| 字段 | 默认 | 说明 |
|---|---|---|
| `apiKey` | — | serper 明文 key（volatile，优先于 credentials） |
| `apiKeyEnv` | `SERPER_API_KEY` | serper key 的 credentials 引用名 |
| `baseURL` | `https://google.serper.dev` | 也可用环境变量 `SERPER_BASE_URL` |
| `gl` / `hl` | `cn` / `zh-cn` | Google 国家/地区与界面语言 |
| `autoLocale` | `true` | 纯英文 query 自动切 `gl=us, hl=en` |
| `num` | `10` | serper 每次请求条数下限（1–100） |
| `serperTimeoutMs` | `4500` | serper 单路超时（冷态折中值） |
| `deepseekApiKey` / `deepseekApiKeyEnv` | — / `DEEPSEEK_API_KEY` | 官方 API key 或凭据引用 |
| `deepseekBaseURL` | `https://api.deepseek.com/v1/tools` | 可用 `DEEPSEEK_SEARCH_API_BASE_URL` 覆盖 |
| `deepseekCount` | `10` | 官方每次请求条数下限（1–50） |
| `deepseekTimeoutMs` | `4500` | 官方单路超时；重试共享同一预算，最坏尾部 ≈ timeout + 少量退避 |
| `summaryMaxChars` | `600` | 官方 `summary` 注入 `snippet` 的最大字符数；`0` 关闭 |
| `primary` | `deepseek` | 主导路（决定交错前排与去重保留优先级） |
| `ratio` | `2` | 槽位比例，五档白名单 `1 / 1.5 / 2 / 3 / 4` |
| `minAuthority` | `-1` | 官方结果 authority 下限（`-1` 不过滤） |
| `maxRetries` | `1` | 官方 429/5xx 重试次数 |
| `logLevel` | `summary` | `off` / `summary` / `verbose` |
| `native` | `true` | 兼容字段：v3 中含义为「是否合并 DeepSeek Search API」；`false` = 纯 serper |
| `nativeApiKey` / `nativeApiKeyEnv` / `nativeBaseURL` / `nativeModel` / `nativeMaxUses` | — | v0.2.x 兼容保留：新字段未配置时 key 作为 fallback，其余运行时忽略 |

## 与 DSH 内置官方 provider 的关系

DSH 0.2.1+ 自带 `deepseek-search-api`（官方 Search API 单飞）与 `deepseek-fetch-api`。**不需要 Google 源时直接用内置 provider 更省事**：

```yaml
- id: web
  config:
    searchProvider: deepseek-search-api
    fetchProvider: http
```

本插件的价值仅在「**官方 + Google 双索引互补**」：默认 8 条来源中 6 条来自官方、2 条来自 Google，质量抽样与纯官方持平（1.792 vs 1.792，见 `../research/03-bench.md`），但多出 2 个 Google 独家源。若把本插件从 profile 移除，记得删掉指向 `serper` 的 `searchProvider` 覆盖。

## 成本与延迟（实测，2026-10-17）

| 方案 | 每次搜索 | 延迟 p50 | 说明 |
|---|---|---|---|
| **本插件 v3（官方主 + serper 补）** | **0.0122 元**（官方 0.005 + serper 0.0072） | 1.8–2.9s（serper 决定；英文 query ~1.5s） | 8 条 = 6 官方 + 2 Google |
| 官方 Search API 单飞（内置 provider） | 0.005 元 | 0.34s | 8 条全官方，无 Google 源 |
| 纯 serper（`native: false`） | 0.0072 元 | 1.9–2.9s | 8 条全 Google |
| v0.2.2（serper + 原生 Messages） | 0.0263 元 | 5.3s | 8 条里 2 条裸链接 |

- 官方 Search API 计费：5 元 / 1000 次成功请求（失败/空结果/429 不计费），QPS 5/账号；
- **本机 serper 延迟方差极大**（实测 1.6–11s）：`serperTimeoutMs` 默认 4500ms 下，慢网/冷启动时 serper 会超时降级为纯官方（结果仍可用，但拿不到 2 条 Google 源）；需要更高 Google 源命中率可调到 6000–8000ms，代价是尾部延迟同比例上升；
- **2026-11-01 起**：用 DeepSeek 模型 API 时「服务端代调 Search/Fetch」的隐形免费链路也开始按次收费；本插件走直连接口，成本从第一天起可精确预算。

## 搜索纪律（建议写进全局 `~/.dsh/AGENTS.md`）

每次 `web_search` 都会真实消耗官方 API 额度与 serper credit（成本 = 查询词数 × 0.0122 元）：

1. **一次调用承载一个调研角度**：把该角度的查询词合并进一次调用（最多 4 个），不要为同义改写拆成多次调用。
2. **查询词之间必须有实质差异**（不同语言/平台/技术栈/子问题）；同义改写的 Google 结果重叠率不足 7%，属于纯浪费。
3. **先规划后搜索**：动手前想清楚需要哪几个角度，简单事实类问题只搜 1 次；只有明确「调研」时才多角度多轮搜索。
4. **够答就停**：来源足够时不再追加搜索，不要因为「再确认一下」重复检索。

## 开发

```sh
pnpm install
pnpm link-harness   # 把类型/依赖对齐到本机已安装的 dsh
pnpm build          # 构建 client（含 client-id 一致性门禁）
pnpm typecheck
pnpm test           # node --test（纯函数 + 合并/降级/重试/abort 单测）

# 真实 API 冒烟（需要两个 key，会产生少量费用）
set -a; . /tmp/keys.env; set +a
node scripts/verify-live.mjs
```

> Host 端 `lib/index.js` 与 `lib/merge.js` 是手写纯 ESM，**不经 `tsdown` 编译**；`tsdown`/`tsc` 只处理浏览器端 `src/client/* → lib/client.js`。改 Host 逻辑后跑 `node --check lib/index.js` + `pnpm test`。

## 从 v0.2.x 升级

- provider id、`cordis.patch.yml` 的 `searchProvider: serper` 均不变，**原地升级、无需改 profile**；
- `native` 语义变为「是否合并 DeepSeek Search API」（`false` = 纯 serper，行为等同于旧版 `native: false`）；
- 旧 `nativeApiKey` / `nativeApiKeyEnv` 在新 `deepseekApiKey*` 未配置时作为 fallback；
- `nativeBaseURL`（旧版指向 `/anthropic/v1`）不再使用，官方端点默认 `https://api.deepseek.com/v1/tools`；
- 不再需要 `nativeModel` / `nativeMaxUses`（v3 不调用模型）。

## English

**Merged web search for DeepSeek Harness, v3**: one `ctx.web` provider (`serper`) runs two direct HTTP retrievals in parallel — the DeepSeek Search API (`/v1/tools/search`, primary) and serper.dev Google results (secondary) — dedupes by normalized URL, interleaves by a fixed ratio (default 2:1 → six DeepSeek + two Google sources in the tool layer's eight slots), and truncates to `maxResults` with `truncated: false`. No auxiliary model turn: one request per backend, per search.

Field upgrades: the Search API `summary` (measured 1893 chars) is folded and clipped into `snippet` (`summaryMaxChars`, default 600; `0` disables); `date` → `publishedAt`; `authority` can gate results via `minAuthority`; pure-English queries auto-switch serper to `gl=us, hl=en` (measured 3.6–10.5 s → 1.0–1.7 s). Either backend may fail, time out (5 s DeepSeek / 4.5 s serper), or lack a key — the other answers; only a double failure throws. Ratio tiers: `4 → 7+1`, `3 → 6+2`, `2 → 6+2` (default), `1.5 → 5+3`, `1 → 4+4`.

Install: `dsh plugin --profile web add dsh-serper-search`, add `SERPER_API_KEY` and `DEEPSEEK_API_KEY` under `refs:` in `~/.dsh/.credentials.yaml` (or set them in the launch environment), restart `dsh web`. The GUI card keeps the six basic controls; advanced settings (`ratio`, `primary`, `summaryMaxChars`, timeouts, `autoLocale`, `minAuthority`, `maxRetries`) are patched through `cordis.patch.yml`.

Cost: 0.0122 CNY per search (DeepSeek 0.005 + serper ~0.0072), latency dominated by serper (1.8–2.9 s). If Google coverage is not needed, the built-in `deepseek-search-api` provider is faster (0.34 s) and cheaper; use this plugin only when you want the two indexes merged.

Dev: `pnpm build`, `pnpm typecheck`, `pnpm test` (node --test), and `scripts/verify-live.mjs` for a real-API smoke check. Host files `lib/index.js` and `lib/merge.js` are hand-written ESM (not built by tsdown); run `node --check` plus the unit tests after editing them.
