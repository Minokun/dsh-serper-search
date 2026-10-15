# dsh-serper-search

[serper.dev](https://serper.dev)（Google Search API）搜索增强插件，接入 DeepSeek Harness 的 web 能力缝（`ctx.web`）。安装后，DSH 内置的 `web_search` 工具每次搜索**并行查询 serper.dev 和 DeepSeek 原生搜索**，两边结果按 URL 去重后 **2:1 交错合并**（serper 的 Google 排名占前两位、原生独源占第三位，依此类推；answerBox 直接答案置于内容区），让模型拿到更全的参考资料。

> 为什么交错而不是 serper 在前拼接：`web_search` 工具层每次调用只保留 8 条来源，实测（两个真实调研会话）拼接模式下原生来源被截断到 40 条里只剩 2 条；2:1 交错保证原生来源在截断后仍占约 1/3 席位。

## 工作原理

- 注册一个 id 为 `serper` 的复合 `WebSearchProvider`，内部两路后端：
  - **serper.dev**：POST `${baseURL}/search`，请求头 `X-API-KEY`，body `{q, gl, hl, num}`，`organic[]` → 来源，`answerBox` → 直接答案
  - **DeepSeek 原生搜索**：复用 `@deepseek-ai/dsh-web-search-deepseek` 的 provider（Anthropic Messages + 服务端 `web_search` 工具），key 走现有的 `DEEPSEEK_API_KEY` credential
- **降级**：任何一路失败/未配 key，另一路照常回答；两路都失败才报错。`native: false` 可关掉原生半边，纯 serper
- bundle 补丁把 `web` seam 的 `searchProvider` 固定为 `serper`（保留 `fetchProvider: http`，不影响 `web_fetch`）
- API key 每次搜索时解析：literal 配置 → credentials 域（`~/.dsh/.credentials.yaml` 的 `refs:`）→ 启动环境变量

## 安装

```sh
dsh plugin --profile web add dsh-serper-search
```

或打开 **设置 → 插件市场**，搜索 `dsh-serper-search` 一键安装。

1. 配置 serper API key（三选一，推荐第一种或装好后在 GUI 设置卡片里直接填）：
   - 在 `~/.dsh/.credentials.yaml` 的 `refs:` 下加一行 `SERPER_API_KEY: <你的key>`
   - 启动环境里 `export SERPER_API_KEY=<key>`
   - 在 profile 的 `cordis.patch.yml` 里给 `web-search-serper` 条目加 `config.apiKey`（明文，不推荐）
2. 重启 `dsh web`，浏览器刷新页面即可生效。

## GUI 设置页

重启后打开 **Plugins → dsh-serper-search** bundle 详情页：页面正文中就是设置表单（`plugins.bundle.config`），行条目 `web-search-serper` 上也有"配置"入口（`plugins.row.config`）。字段：API key（写入 credentials 域，不落设置文件）、接口地址、gl、hl、每次搜索结果数、是否合并 DeepSeek 原生搜索。保存即生效（volatile 配置，不重启）。

## 配置项（settings 命名空间 `web-search-serper`）

| 字段 | 默认 | 说明 |
|---|---|---|
| `apiKey` | — | serper 明文 key（volatile secret，优先于 credentials） |
| `apiKeyEnv` | `SERPER_API_KEY` | serper key 的 credentials 引用名 |
| `baseURL` | `https://google.serper.dev` | 也可用环境变量 `SERPER_BASE_URL` 覆盖 |
| `gl` | `cn` | Google 国家/地区码 |
| `hl` | `zh-cn` | 界面语言 |
| `num` | `10` | serper 每次搜索默认结果数（1–100；工具层的 `maxResults` 优先） |
| `native` | `true` | 是否合并 DeepSeek 原生搜索结果（GUI 里填 `true`/`false`） |
| `nativeApiKey` / `nativeApiKeyEnv` | — / `DEEPSEEK_API_KEY` | 原生搜索的 key（一般用现有的 DEEPSEEK_API_KEY 即可） |
| `nativeBaseURL` | `https://api.deepseek.com/anthropic/v1` | 也可用 `DEEPSEEK_SEARCH_BASE_URL` 覆盖 |
| `nativeModel` | `deepseek-v4-flash` | 原生搜索用的模型 |
| `nativeMaxUses` | `5` | 原生搜索单次请求最多检索次数 |

## 两种搜索后端对比

| | DeepSeek 原生搜索 | serper.dev |
|---|---|---|
| 原理 | 一轮完整模型调用 + 服务端 web_search 工具 | Google SERP 的结构化 API 代理 |
| 速度 | 慢（5–15s，一次模型往返） | 快（1–3s，纯检索） |
| 成本 | 模型 token（输入+输出） | 按次（注册送 2500 次，之后约 $1/1000 次） |
| 查询能力 | 模型自主改写/分解问题、多次检索（maxUses） | 单次单查询 |
| 结果形态 | 引用带贴近问题的摘录（cited_text）、page_age | Google 排名 + snippet + answerBox 直接答案 |
| 可控性 | 黑盒（检索源和排序不可调） | gl/hl/num 等参数明确 |

合并模式取两者之长：serper 提供快速、排名好的 Google 结果和直接答案，原生搜索补充模型视角的多轮检索与贴题摘录。代价是每次 `web_search` 同时消耗 serper 次数和 DeepSeek token，延迟取两者较大值（≈原生搜索的延迟）。想省成本就把 `native` 关掉。

## 费用与搜索纪律（重要，建议配合）

每一次 `web_search` 调用都真实消耗 serper 额度（和开启合并时的模型 token）。消耗量 = **工具调用次数 × 每次的查询词数**——一次多角度调研轻松达到 15–20 次。两个真实调研会话的实测数据：

- 查询词之间的 Google 结果重复率仅 3–7%（同义改写也几乎不重叠），所以**减少调用次数**才是省钱关键，而非去重
- 每条查询 serper 固定 1 次额度（≈$0.0003–0.001）；原生半边每次是一整轮模型调用，token 成本远高于 serper

推荐把下面的搜索纪律写进你的**全局** `~/.dsh/AGENTS.md`（对所有项目生效，不用每个项目重复写；项目级 `AGENTS.md` 是叠加层，放项目专属规则）：

```markdown
## 联网搜索（web_search）使用纪律

每次 `web_search` 调用都会真实消耗外部 API 额度与模型 token，遵循以下约束：

1. **一次调用尽量承载一个调研角度**：把该角度的查询词合并进一次调用（最多 4 个），不要为同义词改写拆成多次调用。
2. **查询词之间必须有实质差异**（不同语言、不同平台、不同技术栈、不同子问题），禁止同一意思换措辞重发——实测同义改写的 Google 结果集重叠率不足 7%，属于纯浪费。
3. **先规划后搜索**：动手前先想清楚需要哪几个角度，简单事实类问题只搜 1 次；只有用户明确要求"调研/深入研究"时才多角度多轮搜索。
4. **够答就停**：已有来源足够回答时不再追加搜索；不要因为"再确认一下"而重复检索已覆盖的内容。
```

实测效果（写入前后各一次调研会话对比）：并行批量搜索（多角度同秒齐发）、每次调用查询词打满差异化上限，调研墙钟时间从 ~2.5 分钟降到 ~40 秒。

## English

**Merged web search for DeepSeek Harness**: one `ctx.web` provider that runs every `web_search` against serper.dev (Google SERP + answer box) and DeepSeek native web_search in parallel, interleaving the URL-deduped sources 2:1 so both backends survive the tool layer's 8-source cap. Degrades to whichever backend answers; `native: false` for serper-only. Settings card on the Plugins page (API key stored in the credentials domain, endpoint, gl/hl, result count, native-merge toggle).

Install: `dsh plugin --profile web add dsh-serper-search`, add `SERPER_API_KEY` under `refs:` in `~/.dsh/.credentials.yaml` (or paste it into the Plugins-page card), restart `dsh web`.

Cost discipline: every `web_search` call spends real serper credits (and model tokens when merging). One research session easily issues 15–20 queries (calls × queries per call). Measured result overlap between queries is only 3–7%, so the saving lever is FEWER queries, not dedup. Recommended global `~/.dsh/AGENTS.md` rule (applies to every project):

```markdown
## Web search (web_search) discipline

Every web_search call spends real API credits and model tokens:

1. One call per research angle — batch up to 4 queries into a single call; never split synonymous rephrasings into separate calls.
2. Queries within one call must differ materially (language, platform, stack, sub-question); rephrasing the same question is pure waste (measured <7% Google result overlap).
3. Plan before searching: one call for simple factual questions; multi-round searching only when the user asks for research.
4. Stop when the sources suffice; never re-search just to "double-check".
```

## 切回 DeepSeek 搜索

在 profile 自己的 `cordis.patch.yml` 末尾加：

```yaml
- id: web
  config:
    searchProvider: deepseek-official
    fetchProvider: http
```

或直接从 `bundles` 移除本包。

## 开发

```sh
pnpm install
pnpm link-harness # 把类型/依赖对齐到本机已安装的 dsh
pnpm build        # 构建 client，含 client-id 一致性门禁
pnpm typecheck
```

