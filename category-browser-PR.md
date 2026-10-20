# PR 素材：`dsh-serper-search` 分类 `tools` → `browser`

> 目标仓库：`awesome-dsh-plugin/awesome-dsh-plugin`
> 目标文件：`data/plugins/Minokun__dsh-serper-search.yml`（**只动这一条**）
> 状态：**待人工提交**。本文件只是可直接粘贴的 PR 标题/正文/改动行；不要自动提 PR。
> 依据：实施方案 §9（P1-7）。被拒/被改回都不阻塞发布。
>
> **提交时机**：等 0.4.0 发布到本仓库 `main` 之后再提这个 PR——市场评审会把描述逐条对代码核，先发布再提才不会被判为「描述不属实」。
>
> **唯一硬性改动是 `category`。** 描述更新（§9「顺带」）可单独摘掉，见第 3 节改动 B。

---

## 1. PR 标题（任选一条）

```
Move dsh-serper-search to the browser category
```

或更直白：

```
category: browser for Minokun/dsh-serper-search (it is a WebSearchProvider)
```

---

## 2. PR 正文（可直接粘贴）

````markdown
## What

Moves `data/plugins/Minokun__dsh-serper-search.yml` from `tools` to `browser`, and refreshes its one-line description for 0.4.0 (five-minute result cache, classified cooldowns with a degradation `Note`, settings self-check). Only this entry is touched; the READMEs stay generated.

## Why `browser`

`dsh-serper-search` is a `WebSearchProvider`: it registers one provider on the `ctx.web` seam so the built-in `web_search` returns DeepSeek Search API + serper.dev Google results merged at a fixed ratio. It is the same kind of plugin as `dsh-free-search`, `modsearch` and `dsh-web-search-pro`, which live under `browser`. `tools` mixes search providers with suites of callable tools, so "make `web_search` better" is something a reader looks for in the browser tab.

Category is a judgement call and maintainers are explicitly allowed to re-file it — a different slot is a one-line change and won't block anything on my side.

## Changes

`data/plugins/Minokun__dsh-serper-search.yml`:

```diff
-category: tools
+category: browser
```

and the description gains the 0.4.0 capabilities (cache / cooldown + `Note` / self-check). Every claim is verifiable against the repo: the 50-entry LRU with a 5-minute default lives in `lib/cache.js`, the cooldown table in `lib/failure.js`, and the settings probe/update-check/provider switch in `lib/routes.js` + `src/client/runtime-panel.tsx`. No numbers or API names are invented.

The full entry after the change is pasted in this PR thread; nothing else under `data/plugins/` is modified.

## Checklist

- [x] One file, one entry (updating an existing entry, so the 3-entry limit does not apply)
- [x] `dsh.bundle` manifest present in `package.json` (`bundle.patch: ./cordis.patch.yml`)
- [x] Repo older than one day (`created_at` 2026-10-12), actively maintained, `dsh-plugin` topic set
- [x] READMEs not edited by hand — data source only
- [ ] Screenshots: two PNGs live in the plugin repo (`assets/shot-settings.png`, `assets/shot-merged.png`) and are declared by the repo-root `screenshots.json`; the marketplace picks them up from the nightly build, so this PR does not touch `data/screenshots.json`
````

> 如果维护者只想收分类、不想动描述：把下方「改动 B」从提交里摘掉即可，改动 A 单独就是一个完整 PR。

---

## 3. 改动（对 `data/plugins/Minokun__dsh-serper-search.yml`）

### 改动 A（必需）：分类

```diff
-category: tools
+category: browser
```

### 改动 B（可选，§9「顺带更新描述」，与 A 同一个文件、同一条目）

```diff
 description:
-  en: 'Complementary web-search provider: every web_search merges the DeepSeek Search API (primary) with serper.dev Google results (secondary) at a fixed 2:1 ratio. Both sides are direct HTTP retrievals with no auxiliary model turn: URL-deduped sources, long DeepSeek summaries clipped into snippets, per-backend timeouts and graceful degradation to whichever backend answers.'
-  zh: 互补式网页搜索 provider：每次 web_search 由 DeepSeek 官方 Search API（主）与 serper.dev 的 Google 结果（补）按固定 2:1 交错合并。两路均为直连检索、无辅助模型调用；来源按 URL 去重，官方长摘要截断注入，单路超时自动降级到另一路。
+  en: 'Complementary web-search provider: every web_search merges the DeepSeek Search API (primary) with serper.dev Google results (secondary) at a fixed 2:1 ratio; successful results are cached for five minutes, per-backend failures are classified into cooldowns with a one-line Note when a lane is dropped, and the settings card can probe both backends and switch the active search provider.'
+  zh: 互补式网页搜索 provider：每次 web_search 由 DeepSeek 官方 Search API（主）与 serper.dev 的 Google 结果（补）按固定 2:1 交错合并；成功结果缓存 5 分钟，单路失败按类型冷却并在降级时附一行 Note，设置卡片可探测双路并切换当前搜索 provider。
```

> 两条描述都加了引号：英文含 `: `（冒号+空格），contributing 明确要求此时必须引用，否则 YAML 会解析成嵌套键。

---

## 4. 改后的完整文件（供直接替换/校对）

```yaml
url: https://github.com/Minokun/dsh-serper-search
name: Minokun/dsh-serper-search
category: browser
description:
  en: 'Complementary web-search provider: every web_search merges the DeepSeek Search API (primary) with serper.dev Google results (secondary) at a fixed 2:1 ratio; successful results are cached for five minutes, per-backend failures are classified into cooldowns with a one-line Note when a lane is dropped, and the settings card can probe both backends and switch the active search provider.'
  zh: 互补式网页搜索 provider：每次 web_search 由 DeepSeek 官方 Search API（主）与 serper.dev 的 Google 结果（补）按固定 2:1 交错合并；成功结果缓存 5 分钟，单路失败按类型冷却并在降级时附一行 Note，设置卡片可探测双路并切换当前搜索 provider。
```

除 `category`（与可选的 `description`）外，`url` / `name` 均保持原值——`url` 必须与仓库完全一致，`name` 是列表里的链接文字。

---

## 5. 提交前检查清单（人工）

- [ ] 基于 `awesome-dsh-plugin/awesome-dsh-plugin` 的 `main` 新建分支，例如 `category/serper-search-browser`
- [ ] 只改 `data/plugins/Minokun__dsh-serper-search.yml`，**不要**跑 `scripts/generate-readme.mjs` 后提交 README（CI 会在合并后重新生成；手改 README 是 §评审第 6 条的常见事故）
- [ ] 不要往 `data/screenshots.json` 加键：截图声明在**插件仓库根**的 `screenshots.json`（两张 PNG 在 `assets/`），由夜间构建自动抓取，本 PR 不含 `data/screenshots.json` 的改动
- [ ] `git diff --stat` 应只有 1 个文件、1–3 行变化
- [ ] PR 正文里说明"只动自己这一条"，避免被 gate 判为动了无关条目
- [ ] 提交后等 CI（entry count → `dsh.bundle` → repo age → awesome-lint/站点构建）

## 6. 合并后的验证

1. 次日看夜间构建产物，条目变 `category: browser`，市场「浏览器」筛选可见：

   ```sh
   curl -s https://awesome-dsh-plugin.com/plugins.json | jq '.plugins[] | select(.name=="Minokun/dsh-serper-search") | {category, description, screenshots}'
   ```

2. 详情页描述为 0.4.0 能力；`screenshots[]` 会在合并后的夜间构建里从插件仓库的 `screenshots.json` 抓取 2 张（`assets/shot-settings.png`、`assets/shot-merged.png`）。
3. 若分类被维护者改回或 PR 被拒：不阻塞 0.4.0 发布，市场文案已说明它是 provider。

---

## 7. 备注（为什么分类是 `browser` 而不是 `tools`）

contributing 的规则是"选贴合插件实际做的事的分类，而不是你希望它出现在哪里"，且明确"分类不贴切由维护者直接改，不会打回"。本插件做的事只有一件：往 `ctx.web` 的 seam 上注册一个 `WebSearchProvider`。它不提供可调用工具集，所以 `tools` 是错位；`browser` 下已有同类（`dsh-free-search` / `modsearch` / `dsh-web-search-pro`）。分类体系本身也在演进（`browser` 就是从 `tools`/`ui` 里拆出来的），因此这个 PR 只是把已有的就近判断显式化。
