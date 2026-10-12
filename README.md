# dsh-serper-search

[serper.dev](https://serper.dev)（Google Search API）搜索增强插件，接入 DeepSeek Harness 的 web 能力缝（`ctx.web`）。安装后，DSH 内置的 `web_search` 工具每次搜索**并行查询 serper.dev 和 DeepSeek 原生搜索**，两边结果按 URL 去重合并（Google 排名在前，answerBox 直接答案置于内容区），让模型拿到更全的参考资料。

## 工作原理

- 注册一个 id 为 `serper` 的复合 `WebSearchProvider`，内部两路后端：
  - **serper.dev**：POST `${baseURL}/search`，请求头 `X-API-KEY`，body `{q, gl, hl, num}`，`organic[]` → 来源，`answerBox` → 直接答案
  - **DeepSeek 原生搜索**：复用 `@deepseek-ai/dsh-web-search-deepseek` 的 provider（Anthropic Messages + 服务端 `web_search` 工具），key 走现有的 `DEEPSEEK_API_KEY` credential
- **降级**：任何一路失败/未配 key，另一路照常回答；两路都失败才报错。`native: false` 可关掉原生半边，纯 serper
- bundle 补丁把 `web` seam 的 `searchProvider` 固定为 `serper`（保留 `fetchProvider: http`，不影响 `web_fetch`）
- API key 每次搜索时解析：literal 配置 → credentials 域（`~/.dsh/.credentials.yaml` 的 `refs:`）→ 启动环境变量

## 安装

1. 存 key（serper 三选一，推荐第一种；也可装好后再到 GUI 里填，见下）：
   - 在 `~/.dsh/.credentials.yaml` 的 `refs:` 下加一行 `SERPER_API_KEY: <你的key>`
   - 启动环境里 `export SERPER_API_KEY=<key>`
   - 在 profile 的 `cordis.patch.yml` 里给 `web-search-serper` 条目加 `config.apiKey`（明文，不推荐）
2. profile（如 `~/.dsh/profiles/web`）的 `package.json`：
   - `dsh.profile.bundles` 数组末尾加 `"dsh-serper-search"`
   - `dependencies` 加 `"dsh-serper-search": "link:<本仓库路径>"`
   - 在 profile 目录跑 `pnpm install`
3. 重启 `dsh web`（bundle 列表与模块代码变化都不会热加载），浏览器刷新页面

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

## 切回 DeepSeek 搜索

在 profile 自己的 `cordis.patch.yml` 末尾加：

```yaml
- id: web
  config:
    searchProvider: deepseek-official
    fetchProvider: http
```

或直接从 `bundles` 移除本包。
