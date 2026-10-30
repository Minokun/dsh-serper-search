window.__ModuleLoader__.load({
	id: "dsh-serper-search",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let _deepseek_ai_dsh_client_ui_primitives = require("@deepseek-ai/dsh-client-ui-primitives");
		let react = require("react");
		let react_jsx_runtime = require("react/jsx-runtime");
		//#region src/client/locale.ts
		/**
		* Locale bundles for the serper search provider's settings card.
		*
		* The card is organised as three independent search-source groups (DeepSeek
		* Search API, serper / Google, Yuanbao Search), each with its own enable switch,
		* credential box, and parameters; the runtime panel below them is shared.
		* @module dsh-serper-search/client/locale
		*/
		/** English copy. */
		const en = {
			title: "DeepSeek + serper + Yuanbao search",
			description: "Three independent search sources — DeepSeek Search API, serper.dev Google results, and (opt-in) Tencent Cloud Yuanbao Search — merged into one web_search provider. Each group below has its own enable switch, its own credential box, and its own parameters; one Save applies all of them.",
			groupDeepseekTitle: "DeepSeek Search (Search API)",
			groupDeepseekHint: "The primary lane: a direct call to the DeepSeek Search API with its own key and result settings.",
			groupSerperTitle: "serper / Google",
			groupSerperHint: "The secondary lane: Google results through serper.dev, with the answer box promoted to result content.",
			groupYuanbaoTitle: "Yuanbao Search (Tencent Cloud WSA)",
			groupYuanbaoHint: "The optional third lane: Tencent Cloud WSA SearchPro. Billed per call (standard edition 20 CNY / 1000 calls), 2000 free calls per month.",
			native: "Enable DeepSeek search",
			nativeHint: "true = merge the DeepSeek Search API lane; false = leave it out. Leave blank to inherit the upper configuration layer.",
			serperEnabled: "Enable serper (Google)",
			serperEnabledHint: "true = merge the serper.dev lane; false = leave it out (e.g. DeepSeek + Yuanbao only). Leave blank to inherit the upper configuration layer.",
			yuanbaoEnabled: "Enable Yuanbao search",
			yuanbaoEnabledHint: "true = add the Yuanbao lane (one extra paid request per search); false = keep the two established lanes. Leave blank to inherit the upper configuration layer.",
			serperKey: "serper API key",
			serperKeyHint: "Credential reference from the section (SERPER_API_KEY by default). Stored outside the settings file; leave blank to keep the current key.",
			deepseekKey: "DeepSeek API key",
			deepseekKeyHint: "Credential reference from the section (DEEPSEEK_API_KEY by default). A DeepSeek Account session also works inside a conversation.",
			yuanbaoKey: "Yuanbao API key",
			yuanbaoKeyHint: "Tencent Cloud WSA service API key, resolved through the section reference (YUANBAO_API_KEY by default).",
			deepseekKeyHelp: "No API key yet? Create one on the DeepSeek open platform (billing and usage live in the billing centre).",
			serperKeyHelp: "No API key yet? Sign up at serper.dev (free tier included).",
			yuanbaoKeyHelp: "No service API key yet? Enable “Web Search (WSA)” in the Tencent Cloud console and claim 2,000 free calls per month.",
			apiKeySet: "A key is configured.",
			apiKeyUnset: "No key is configured.",
			baseUrl: "Endpoint",
			baseUrlHint: "Leave blank for the serper default (https://google.serper.dev).",
			deepseekBaseUrl: "Endpoint",
			deepseekBaseUrlHint: "Leave blank for the DeepSeek default (https://api.deepseek.com/v1/tools).",
			yuanbaoEndpoint: "Endpoint",
			yuanbaoEndpointHint: "Leave blank for the Tencent Cloud default (https://api.wsa.cloud.tencent.com/SearchPro).",
			gl: "Country (gl)",
			glHint: "Google country code, e.g. cn or us. Leave blank for the provider default.",
			hl: "Language (hl)",
			hlHint: "Interface language, e.g. zh-cn or en. Leave blank for the provider default.",
			num: "Results per search",
			numHint: "Candidate pool size per serper request (1-100). Leave blank for the default.",
			deepseekCount: "Results per search",
			deepseekCountHint: "Candidate pool size per DeepSeek request (1-50). Leave blank for the default.",
			summaryMaxChars: "Summary length",
			summaryMaxCharsHint: "Characters of the Search API summary injected as the snippet (0 keeps the short snippet). Leave blank for the default.",
			deepseekTimeoutMs: "Timeout (ms)",
			deepseekTimeoutMsHint: "Hard deadline for the DeepSeek lane, retries included. Leave blank for the default.",
			serperTimeoutMs: "Timeout (ms)",
			serperTimeoutMsHint: "Timeout for one serper request. Leave blank for the default.",
			yuanbaoCnt: "Results per search (Cnt)",
			yuanbaoCntHint: "0 = derive from the tool cap and round up; the API only accepts 10/20/30/40/50. Leave blank for the default.",
			yuanbaoTimeoutMs: "Timeout (ms)",
			yuanbaoTimeoutMsHint: "Timeout for one Yuanbao request. Leave blank for the default.",
			overridden: "Overridden",
			reset: "Reset to default",
			readOnly: "This deployment stores settings read-only.",
			unavailable: "This plugin is not loaded, so it cannot be configured right now.",
			save: "Save",
			saving: "Saving…",
			saveFailed: "The deployment did not accept these values; they were left for you to correct.",
			invalidNumber: "Enter a number, or leave blank to use the default.",
			invalidBoolean: "Enter true or false, or leave blank to inherit.",
			probeRun: "Test backends",
			probing: "Testing…",
			probeOk: "Every enabled backend answered.",
			probeFailed: "The self-check did not run; try again in a moment.",
			probeCostHint: "Each test costs one search per enabled backend (a disabled lane costs nothing).",
			probeAccountOnly: "No API key detected; if you use a DeepSeek Account session in chat, search still works.",
			probeUnsupported: "This deployment does not expose the self-check routes, so it is unavailable here.",
			probeDisabled: "disabled in settings",
			laneDeepseek: "DeepSeek Search API",
			laneSerper: "serper.dev (Google)",
			laneYuanbao: "Yuanbao Search (Tencent WSA)",
			checkUpdate: "Check for updates",
			checking: "Checking…",
			upToDate: "Up to date",
			hasUpdate: "Update available",
			updateFailed: "Could not reach the npm registry.",
			updateHint: "The Host reads the npm registry, so no browser CORS is involved.",
			takeProvider: "Use as this machine’s default",
			releaseProvider: "Restore deployment default",
			providerTaken: "This machine now uses the plugin",
			providerReleased: "Restored the deployment default",
			providerSwitchFailed: "The provider setting was not accepted; try again."
		};
		/** Simplified Chinese copy. */
		const zh = {
			title: "DeepSeek + serper + 元宝搜索",
			description: "三个互相独立的搜索源——DeepSeek 官方 Search API、serper.dev 的 Google 结果、以及可选的腾讯云元宝搜索——合并成同一个 web_search provider。下面每组都有自己的开关、自己的凭据框和自己的参数；一次「保存」覆盖三组。",
			groupDeepseekTitle: "DeepSeek 搜索（Search API）",
			groupDeepseekHint: "主路：直连 DeepSeek 官方 Search API，自带 key 与结果参数。",
			groupSerperTitle: "serper / Google",
			groupSerperHint: "副路：经 serper.dev 取 Google 结果，answerBox 提升为结果级 content。",
			groupYuanbaoTitle: "元宝搜索（腾讯云 WSA）",
			groupYuanbaoHint: "可选第三路：腾讯云 WSA SearchPro，按调用计费（标准版 20 元/千次，每月 2000 次免费额度）。",
			native: "启用 DeepSeek 搜索",
			nativeHint: "true = 合并 DeepSeek Search API 这一路；false = 不启用。留空表示继承上层配置。",
			serperEnabled: "启用 serper（Google）",
			serperEnabledHint: "true = 合并 serper.dev 这一路；false = 不启用（例如只走 DeepSeek + 元宝）。留空表示继承上层配置。",
			yuanbaoEnabled: "启用元宝搜索",
			yuanbaoEnabledHint: "true = 加入元宝第三路（每次搜索多一次付费调用）；false = 保持原有两路。留空表示继承上层配置。",
			serperKey: "serper API Key",
			serperKeyHint: "凭据引用名取本组配置（默认 SERPER_API_KEY）。不写入设置文件；留空表示保持当前密钥。",
			deepseekKey: "DeepSeek API Key",
			deepseekKeyHint: "凭据引用名取本组配置（默认 DEEPSEEK_API_KEY）。对话内使用 DeepSeek 账号登录也可工作。",
			yuanbaoKey: "元宝 API Key",
			yuanbaoKeyHint: "腾讯云 WSA 服务 API Key，凭据引用名取本组配置（默认 YUANBAO_API_KEY）。",
			deepseekKeyHelp: "还没有 API Key？去 DeepSeek 开放平台创建（充值与用量在费用中心）。",
			serperKeyHelp: "还没有 API Key？去 serper.dev 注册（含免费额度）。",
			yuanbaoKeyHelp: "还没有服务 API Key？去腾讯云控制台开通「联网搜索 WSA」，可领每月 2000 次免费额度。",
			apiKeySet: "已配置密钥。",
			apiKeyUnset: "未配置密钥。",
			baseUrl: "接口地址",
			baseUrlHint: "留空则使用 serper 默认地址（https://google.serper.dev）。",
			deepseekBaseUrl: "接口地址",
			deepseekBaseUrlHint: "留空则使用 DeepSeek 默认地址（https://api.deepseek.com/v1/tools）。",
			yuanbaoEndpoint: "接口地址",
			yuanbaoEndpointHint: "留空则使用腾讯云默认地址（https://api.wsa.cloud.tencent.com/SearchPro）。",
			gl: "国家/地区（gl）",
			glHint: "Google 国家/地区码，如 cn 或 us。留空则使用默认值。",
			hl: "语言（hl）",
			hlHint: "界面语言，如 zh-cn 或 en。留空则使用默认值。",
			num: "每次搜索结果数",
			numHint: "serper 单次请求的候选条数（1-100）。留空则使用默认值。",
			deepseekCount: "每次搜索结果数",
			deepseekCountHint: "DeepSeek 单次请求的候选条数（1-50）。留空则使用默认值。",
			summaryMaxChars: "摘要长度",
			summaryMaxCharsHint: "官方 summary 注入 snippet 的最大字符数（0 = 用短 snippet）。留空则使用默认值。",
			deepseekTimeoutMs: "超时（ms）",
			deepseekTimeoutMsHint: "DeepSeek 这一路的硬 deadline（含重试）。留空则使用默认值。",
			serperTimeoutMs: "超时（ms）",
			serperTimeoutMsHint: "serper 单次请求超时。留空则使用默认值。",
			yuanbaoCnt: "每次搜索结果数（Cnt）",
			yuanbaoCntHint: "0 = 按工具层上限推导并向上取整；接口只接受 10/20/30/40/50。留空则使用默认值。",
			yuanbaoTimeoutMs: "超时（ms）",
			yuanbaoTimeoutMsHint: "元宝单次请求超时。留空则使用默认值。",
			overridden: "已覆盖",
			reset: "恢复默认",
			readOnly: "本部署的设置为只读。",
			unavailable: "该插件当前未加载，暂时无法配置。",
			save: "保存",
			saving: "保存中…",
			saveFailed: "本部署没有接受这些值，已保留供你修改。",
			invalidNumber: "请填数字；留空表示使用默认值。",
			invalidBoolean: "请填 true 或 false；留空表示继承上层配置。",
			probeRun: "测试各路",
			probing: "测试中…",
			probeOk: "所有启用的后端均正常。",
			probeFailed: "本次自检未能运行，请稍后重试。",
			probeCostHint: "每次测试每个启用的后端各消耗 1 次搜索（未启用的那一路不消耗）。",
			probeAccountOnly: "未检测到 API key；若你在对话内使用 DeepSeek 账号登录，搜索不受影响",
			probeUnsupported: "当前部署未提供自检接口，无法在此运行。",
			probeDisabled: "设置里未启用",
			laneDeepseek: "DeepSeek 官方搜索",
			laneSerper: "serper.dev（Google）",
			laneYuanbao: "元宝搜索（腾讯云 WSA）",
			checkUpdate: "检查更新",
			checking: "检查中…",
			upToDate: "已是最新",
			hasUpdate: "有新版本",
			updateFailed: "无法访问 npm registry。",
			updateHint: "由部署端查询 npm registry，不经过浏览器跨域。",
			takeProvider: "设为本机默认搜索",
			releaseProvider: "恢复部署默认",
			providerTaken: "已设为本机默认搜索",
			providerReleased: "已恢复部署默认",
			providerSwitchFailed: "provider 设置未被接受，请重试。"
		};
		//#endregion
		//#region src/client/runtime-panel.tsx
		/**
		* The settings card's runtime controls (P1-5, plan §7): test both search lanes,
		* check for updates, and switch this machine's `searchProvider` pin.
		*
		* Everything runs through the Host's own runtime routes
		* (`/api/dsh-serper-search/*`), so the browser never sees a credential and the
		* npm lookup needs no CORS. A deployment without those routes
		* answers 404, in which case the panel says self-check is unsupported instead
		* of reporting a provider failure.
		*
		* The plugin ships no client stylesheet and the DSH settings page is themed, so
		* the panel lays itself out with inline, colour-free styles, and every control
		* keeps its own live region mounted so screen readers announce the result.
		* @module dsh-serper-search/client/runtime-panel
		*/
		/**
		* Route prefix owned by this plugin, in the document-relative form the browser
		* addresses (the Host registers `/api/dsh-serper-search`): DSH app routes are
		* document-relative so a deployment served under a sub-path keeps working.
		*/
		const PREFIX = "api/dsh-serper-search";
		/** Client-side ceiling per request; the Host probe itself is bounded at 8s. */
		const CLIENT_TIMEOUT_MS = 15e3;
		/**
		* One control row: buttons and their hint on one wrapping line. Only spacing is
		* set — no colour and no font size — so the panel inherits the DSH theme.
		*/
		const ROW_STYLE = {
			display: "flex",
			alignItems: "center",
			flexWrap: "wrap",
			gap: 8,
			marginTop: 8
		};
		/**
		* A control's result area: one grid row per result line. It is always mounted,
		* even while empty, so the live region exists before its text changes.
		*/
		const RESULT_STYLE = {
			display: "grid",
			gap: 4,
			margin: "8px 0 0"
		};
		/** A route this deployment does not register (the card says "unsupported"). */
		var UnsupportedRouteError = class extends Error {
			constructor(path) {
				super(`runtime route unavailable: ${path}`);
				this.name = "UnsupportedRouteError";
			}
		};
		/**
		* POST one runtime route with a bounded wait.
		* @param path - route suffix, e.g. `/probe`.
		* @param body - optional JSON body.
		* @returns the parsed JSON object.
		* @throws UnsupportedRouteError on 404, Error on any other failure.
		*/
		async function post(path, body) {
			const controller = new AbortController();
			const timer = setTimeout(() => {
				controller.abort();
			}, CLIENT_TIMEOUT_MS);
			try {
				const response = await fetch(`${PREFIX}${path}`, {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify(body ?? {}),
					signal: controller.signal
				});
				if (response.status === 404 || response.status === 405) throw new UnsupportedRouteError(path);
				if (!response.ok) throw new Error(`runtime route ${path} answered HTTP ${response.status}`);
				const payload = await response.json();
				if (typeof payload !== "object" || payload === null) return {};
				return payload;
			} finally {
				clearTimeout(timer);
			}
		}
		/** Distinguish "not registered here" from a real failure. */
		function failureOf(error) {
			return error instanceof UnsupportedRouteError ? "unsupported" : "failed";
		}
		/**
		* Validate one lane record from the wire; unknown/partial payloads are dropped
		* rather than rendered.
		* @param value - one entry of the `lanes` array.
		* @returns the lane report, or undefined when it is not one.
		*/
		function laneOf(value) {
			if (typeof value !== "object" || value === null) return void 0;
			const lane = value;
			if (lane.lane !== "deepseek" && lane.lane !== "serper" && lane.lane !== "yuanbao") return void 0;
			return {
				lane: lane.lane,
				ok: lane.ok === true,
				ms: typeof lane.ms === "number" ? lane.ms : 0,
				sources: typeof lane.sources === "number" ? lane.sources : 0,
				httpStatus: typeof lane.httpStatus === "number" ? lane.httpStatus : null,
				class: typeof lane.class === "string" ? lane.class : null,
				error: typeof lane.error === "string" ? lane.error : null
			};
		}
		/**
		* Describe one probed lane in a single line for the panel's live region.
		* @param lane - the validated lane record.
		* @param t - the card's locale reader.
		* @returns the text for that lane.
		*/
		function laneLine(lane, t) {
			const label = t(lane.lane === "deepseek" ? "laneDeepseek" : lane.lane === "serper" ? "laneSerper" : "laneYuanbao");
			if (lane.ok) return `${label}: ${lane.ms}ms · ${lane.sources}`;
			if (lane.class === "account-only") return `${label}: ${t("probeAccountOnly")}`;
			if (lane.class === "disabled") return `${label}: ${t("probeDisabled")}`;
			const http = lane.httpStatus === null ? "" : ` (HTTP ${lane.httpStatus})`;
			const detail = lane.error === null ? "" : ` · ${lane.error}`;
			return `${label}: ${lane.class ?? "error"}${http}${detail}`;
		}
		/**
		* Render the card's self-check and provider controls.
		* @param props - the card's locale reader.
		* @returns the panel.
		*/
		function RuntimePanel({ t }) {
			const [probe, setProbe] = (0, react.useState)({ phase: "idle" });
			const [update, setUpdate] = (0, react.useState)({ phase: "idle" });
			const [switcher, setSwitcher] = (0, react.useState)({ phase: "idle" });
			const runProbe = async () => {
				setProbe({ phase: "running" });
				try {
					const payload = await post("/probe");
					const lanes = Array.isArray(payload.lanes) ? payload.lanes.map(laneOf).filter((lane) => lane !== void 0) : [];
					setProbe({
						phase: "done",
						lanes
					});
				} catch (error) {
					setProbe({
						phase: "error",
						failure: failureOf(error)
					});
				}
			};
			const runUpdate = async () => {
				setUpdate({ phase: "running" });
				try {
					const payload = await post("/update-check");
					const latest = typeof payload.latest === "string" ? payload.latest : void 0;
					if (latest === void 0) {
						setUpdate({
							phase: "error",
							failure: "failed"
						});
						return;
					}
					setUpdate({
						phase: "done",
						current: typeof payload.version === "string" ? payload.version : void 0,
						latest,
						hasUpdate: payload.hasUpdate === true,
						url: typeof payload.url === "string" && payload.url.startsWith("https://") ? payload.url : void 0
					});
				} catch (error) {
					setUpdate({
						phase: "error",
						failure: failureOf(error)
					});
				}
			};
			const switchProvider = async (action) => {
				setSwitcher({
					phase: "running",
					action
				});
				try {
					await post("/provider", { action });
					setSwitcher({
						phase: "done",
						action
					});
				} catch (error) {
					setSwitcher({
						phase: "error",
						action,
						failure: failureOf(error)
					});
				}
			};
			const probeRunning = probe.phase === "running";
			const updateRunning = update.phase === "running";
			const switchRunning = switcher.phase === "running";
			const lanes = probe.lanes ?? [];
			const attempted = lanes.filter((lane) => lane.class !== "disabled");
			const probeAllOk = attempted.length > 0 && attempted.every((lane) => lane.ok);
			const probeLines = probe.phase === "error" ? [probe.failure === "unsupported" ? t("probeUnsupported") : t("probeFailed")] : probe.phase === "done" ? lanes.length === 0 ? [t("probeFailed")] : [...probeAllOk ? [t("probeOk")] : [], ...lanes.map((lane) => laneLine(lane, t))] : [];
			const updateStatus = update.phase === "error" ? update.failure === "unsupported" ? t("probeUnsupported") : t("updateFailed") : update.phase === "done" && update.latest !== void 0 ? update.hasUpdate === true ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [`${t("hasUpdate")} ${update.current ?? ""} → ${update.latest}`, update.url === void 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [" · ", /* @__PURE__ */ (0, react_jsx_runtime.jsx)("a", {
				href: update.url,
				target: "_blank",
				rel: "noreferrer noopener",
				children: "npm"
			})] })] }) : t("upToDate") : null;
			const switcherStatus = switcher.phase === "error" ? switcher.failure === "unsupported" ? t("probeUnsupported") : t("providerSwitchFailed") : switcher.phase === "done" ? switcher.action === "take" ? t("providerTaken") : switcher.action === "release" ? t("providerReleased") : null : null;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [
				/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					style: ROW_STYLE,
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
						type: "button",
						disabled: probeRunning,
						"aria-busy": probeRunning ? true : void 0,
						onClick: () => void runProbe(),
						children: probeRunning ? t("probing") : t("probeRun")
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("probeCostHint") })]
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
					role: "status",
					"aria-live": "polite",
					style: RESULT_STYLE,
					children: probeLines.map((line, index) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: line }, index))
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					style: ROW_STYLE,
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
						type: "button",
						disabled: updateRunning,
						"aria-busy": updateRunning ? true : void 0,
						onClick: () => void runUpdate(),
						children: updateRunning ? t("checking") : t("checkUpdate")
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("updateHint") })]
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
					role: "status",
					"aria-live": "polite",
					style: RESULT_STYLE,
					children: updateStatus
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					style: ROW_STYLE,
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
						type: "button",
						disabled: switchRunning,
						"aria-busy": switchRunning ? true : void 0,
						onClick: () => void switchProvider("take"),
						children: t("takeProvider")
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
						type: "button",
						disabled: switchRunning,
						"aria-busy": switchRunning ? true : void 0,
						onClick: () => void switchProvider("release"),
						children: t("releaseProvider")
					})]
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
					role: "status",
					"aria-live": "polite",
					style: RESULT_STYLE,
					children: switcherStatus
				})
			] });
		}
		//#endregion
		//#region src/client/SerperSearchCard.tsx
		/** Spacing between the three search-source groups. */
		const GROUPS_STYLE = {
			display: "grid",
			gap: 22
		};
		/**
		* One search-source group's frame: a rule above the group, then its heading and
		* children. Colour-free so the DSH theme decides the palette.
		*/
		const GROUP_STYLE = {
			display: "grid",
			gap: 10,
			paddingTop: 14,
			borderTop: "1px solid rgba(127, 127, 127, 0.35)"
		};
		/** A group heading. */
		const GROUP_TITLE_STYLE = {
			margin: 0,
			fontSize: "1.05em",
			fontWeight: 600
		};
		/** A group's one-line description under its heading. */
		const GROUP_HINT_STYLE = {
			margin: 0,
			fontSize: "0.9em",
			opacity: .72
		};
		/**
		* Where to create or buy each provider's API key.
		*
		* Hard-coded on purpose: this is documentation, not configuration, so users are
		* not asked to maintain URLs. Checked on 2026-10-21 — serper answers 200, the
		* Tencent Cloud console redirects (302) to its login page, and the DeepSeek
		* endpoint answers but rate-limits scripted probes (path is correct).
		*/
		const KEY_URLS = {
			deepseek: "https://platform.deepseek.com/api_keys",
			serper: "https://serper.dev/dashboard",
			yuanbao: "https://console.cloud.tencent.com/wsapi"
		};
		/**
		* Style for the "get an API key" links: colour-free and inherited from the DSH
		* theme (the shells render a plain `<a>`, like the primitives' own `WebBlock`).
		*/
		const KEY_LINK_STYLE = {
			color: "inherit",
			textDecoration: "underline",
			opacity: .9,
			fontSize: "0.9em",
			width: "fit-content"
		};
		/**
		* The form frame's copy, read from this card's dictionary.
		* @param t - the card's locale reader.
		* @returns the labels the shared settings form renders.
		*/
		function formLabels(t) {
			return {
				unavailable: t("unavailable"),
				readOnly: t("readOnly"),
				saveFailed: t("saveFailed"),
				save: t("save"),
				saving: t("saving")
			};
		}
		/**
		* One text/number/boolean field bound to the staged form.
		* @param spec - the field's identity, copy, state, and the card's actions.
		* @returns the rendered field.
		*/
		function valueField(spec) {
			const { t } = spec.p;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.SettingsValueField, {
				id: spec.id,
				label: spec.label,
				hint: spec.hint,
				overriddenLabel: t("overridden"),
				resetLabel: t("reset"),
				invalidLabel: spec.numeric === true ? t("invalidNumber") : t("invalidBoolean"),
				...spec.numeric === true ? { numeric: true } : {},
				...spec.placeholder === void 0 ? {} : { placeholder: spec.placeholder },
				disabled: spec.disabled,
				...spec.state,
				onEdit: (text) => {
					spec.edit(spec.field, text);
				},
				onReset: () => {
					spec.reset(spec.field);
				}
			});
		}
		/**
		* One group's credential box: its own reference, its own configured badge, and
		* its own staged write through the credentials domain.
		* @param spec - the group's credential state and the card's actions.
		* @returns the rendered secret field.
		*/
		function credentialField(spec) {
			const { t } = spec.p;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.SettingsSecretField, {
				id: spec.id,
				label: spec.label,
				hint: spec.hint,
				disabled: !spec.writable,
				text: spec.state.text,
				configured: spec.configured,
				stateLabel: spec.configured ? t("apiKeySet") : t("apiKeyUnset"),
				onEdit: (text) => {
					spec.p.edit(spec.field, text);
				}
			});
		}
		/**
		* One group's "get an API key" external link, rendered directly under that
		* group's credential box. Colour-free inline styling; the URL is a constant.
		* @param spec - the link target and its localized label.
		* @returns the rendered anchor.
		*/
		function keyHelpLink(spec) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("a", {
				className: spec.className,
				href: spec.href,
				target: "_blank",
				rel: "noopener noreferrer",
				style: KEY_LINK_STYLE,
				children: spec.text
			});
		}
		/**
		* Render the provider's one-liner or its settings form.
		* @param props - the view asked for, locale copy, the form snapshot, and its actions.
		* @returns the one-liner, or the form.
		*/
		function SerperSearchCard(props) {
			const { t } = props;
			const state = props.useSerperSearchCard((snapshot) => snapshot);
			if (props.view === "summary") return t("description");
			const disabled = !state.writable;
			const field = (spec) => valueField({
				...spec,
				p: props,
				disabled,
				edit: props.edit,
				reset: props.resetField
			});
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(_deepseek_ai_dsh_client_ui_primitives.SettingsForm, {
				labels: formLabels(t),
				state,
				onSave: props.save,
				onDiscard: props.discard,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "plugin-config-serper-search-groups",
					style: GROUPS_STYLE,
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
							className: "plugin-config-serper-search-group plugin-config-serper-search-group-deepseek",
							style: GROUP_STYLE,
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", {
									style: GROUP_TITLE_STYLE,
									children: t("groupDeepseekTitle")
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
									style: GROUP_HINT_STYLE,
									children: t("groupDeepseekHint")
								}),
								field({
									id: "plugin-config-serper-search-deepseek-enabled",
									label: t("native"),
									hint: t("nativeHint"),
									field: "native",
									state: state.native,
									placeholder: "true"
								}),
								credentialField({
									id: "plugin-config-serper-search-deepseek-key",
									label: t("deepseekKey"),
									hint: t("deepseekKeyHint"),
									field: "deepseekApiKey",
									state: state.deepseekApiKey,
									configured: state.deepseekApiKeyConfigured,
									writable: state.deepseekApiKeyWritable,
									p: props
								}),
								keyHelpLink({
									className: "plugin-config-serper-search-deepseek-key-link",
									href: KEY_URLS.deepseek,
									text: t("deepseekKeyHelp")
								}),
								field({
									id: "plugin-config-serper-search-deepseek-endpoint",
									label: t("deepseekBaseUrl"),
									hint: t("deepseekBaseUrlHint"),
									field: "deepseekBaseURL",
									state: state.deepseekBaseURL
								}),
								field({
									id: "plugin-config-serper-search-deepseek-count",
									label: t("deepseekCount"),
									hint: t("deepseekCountHint"),
									field: "deepseekCount",
									state: state.deepseekCount,
									numeric: true
								}),
								field({
									id: "plugin-config-serper-search-deepseek-summary",
									label: t("summaryMaxChars"),
									hint: t("summaryMaxCharsHint"),
									field: "summaryMaxChars",
									state: state.summaryMaxChars,
									numeric: true
								}),
								field({
									id: "plugin-config-serper-search-deepseek-timeout",
									label: t("deepseekTimeoutMs"),
									hint: t("deepseekTimeoutMsHint"),
									field: "deepseekTimeoutMs",
									state: state.deepseekTimeoutMs,
									numeric: true
								})
							]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
							className: "plugin-config-serper-search-group plugin-config-serper-search-group-serper",
							style: GROUP_STYLE,
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", {
									style: GROUP_TITLE_STYLE,
									children: t("groupSerperTitle")
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
									style: GROUP_HINT_STYLE,
									children: t("groupSerperHint")
								}),
								field({
									id: "plugin-config-serper-search-serper-enabled",
									label: t("serperEnabled"),
									hint: t("serperEnabledHint"),
									field: "serperEnabled",
									state: state.serperEnabled,
									placeholder: "true"
								}),
								credentialField({
									id: "plugin-config-serper-search-serper-key",
									label: t("serperKey"),
									hint: t("serperKeyHint"),
									field: "serperApiKey",
									state: state.serperApiKey,
									configured: state.serperApiKeyConfigured,
									writable: state.serperApiKeyWritable,
									p: props
								}),
								keyHelpLink({
									className: "plugin-config-serper-search-serper-key-link",
									href: KEY_URLS.serper,
									text: t("serperKeyHelp")
								}),
								field({
									id: "plugin-config-serper-search-serper-endpoint",
									label: t("baseUrl"),
									hint: t("baseUrlHint"),
									field: "baseURL",
									state: state.baseURL
								}),
								field({
									id: "plugin-config-serper-search-serper-gl",
									label: t("gl"),
									hint: t("glHint"),
									field: "gl",
									state: state.gl
								}),
								field({
									id: "plugin-config-serper-search-serper-hl",
									label: t("hl"),
									hint: t("hlHint"),
									field: "hl",
									state: state.hl
								}),
								field({
									id: "plugin-config-serper-search-serper-num",
									label: t("num"),
									hint: t("numHint"),
									field: "num",
									state: state.num,
									numeric: true
								}),
								field({
									id: "plugin-config-serper-search-serper-timeout",
									label: t("serperTimeoutMs"),
									hint: t("serperTimeoutMsHint"),
									field: "serperTimeoutMs",
									state: state.serperTimeoutMs,
									numeric: true
								})
							]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
							className: "plugin-config-serper-search-group plugin-config-serper-search-group-yuanbao",
							style: GROUP_STYLE,
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", {
									style: GROUP_TITLE_STYLE,
									children: t("groupYuanbaoTitle")
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
									style: GROUP_HINT_STYLE,
									children: t("groupYuanbaoHint")
								}),
								field({
									id: "plugin-config-serper-search-yuanbao-enabled",
									label: t("yuanbaoEnabled"),
									hint: t("yuanbaoEnabledHint"),
									field: "yuanbaoEnabled",
									state: state.yuanbaoEnabled,
									placeholder: "false"
								}),
								credentialField({
									id: "plugin-config-serper-search-yuanbao-key",
									label: t("yuanbaoKey"),
									hint: t("yuanbaoKeyHint"),
									field: "yuanbaoApiKey",
									state: state.yuanbaoApiKey,
									configured: state.yuanbaoApiKeyConfigured,
									writable: state.yuanbaoApiKeyWritable,
									p: props
								}),
								keyHelpLink({
									className: "plugin-config-serper-search-yuanbao-key-link",
									href: KEY_URLS.yuanbao,
									text: t("yuanbaoKeyHelp")
								}),
								field({
									id: "plugin-config-serper-search-yuanbao-endpoint",
									label: t("yuanbaoEndpoint"),
									hint: t("yuanbaoEndpointHint"),
									field: "yuanbaoEndpoint",
									state: state.yuanbaoEndpoint
								}),
								field({
									id: "plugin-config-serper-search-yuanbao-cnt",
									label: t("yuanbaoCnt"),
									hint: t("yuanbaoCntHint"),
									field: "yuanbaoCnt",
									state: state.yuanbaoCnt,
									numeric: true
								}),
								field({
									id: "plugin-config-serper-search-yuanbao-timeout",
									label: t("yuanbaoTimeoutMs"),
									hint: t("yuanbaoTimeoutMsHint"),
									field: "yuanbaoTimeoutMs",
									state: state.yuanbaoTimeoutMs,
									numeric: true
								})
							]
						})
					]
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(RuntimePanel, { t })]
			});
		}
		//#endregion
		//#region src/client/card-controller.ts
		/**
		* Namespace of the serper search provider. Spelled here rather than imported:
		* a client package must not depend on a Host package.
		*/
		const SERPER_SEARCH_NS = "web-search-serper";
		/** Credential reference the serper group resolves when the section names none. */
		const DEFAULT_API_KEY_REF = "SERPER_API_KEY";
		/** The three credential boxes, in card order. */
		const CREDENTIAL_GROUPS = [
			{
				kind: "deepseek",
				field: "deepseekApiKey",
				refField: "deepseekApiKeyEnv",
				fallback: "DEEPSEEK_API_KEY"
			},
			{
				kind: "serper",
				field: "serperApiKey",
				refField: "apiKeyEnv",
				fallback: DEFAULT_API_KEY_REF
			},
			{
				kind: "yuanbao",
				field: "yuanbaoApiKey",
				refField: "yuanbaoApiKeyEnv",
				fallback: "YUANBAO_API_KEY"
			}
		];
		/** Bridges the `web-search-serper` scope and the credentials domain onto the card. */
		var SerperSearchCardController = class {
			scope;
			ctx;
			form;
			store;
			unsubscribe;
			/** One credential state per group, keyed by `kind`. */
			credentials = {
				deepseek: {
					ref: "",
					configured: false,
					writable: true
				},
				serper: {
					ref: "",
					configured: false,
					writable: true
				},
				yuanbao: {
					ref: "",
					configured: false,
					writable: true
				}
			};
			/**
			* @param scope - the bound settings scope for the `web-search-serper` namespace.
			* @param ctx - the card plugin's context, whose `remote.credentials` namespace
			* answers for the three references the section names.
			*/
			constructor(scope, ctx) {
				this.scope = scope;
				this.ctx = ctx;
				this.form = new _deepseek_ai_dsh_client_ui_primitives.SettingsFormModel(scope, [
					(0, _deepseek_ai_dsh_client_ui_primitives.settingsTextField)("deepseekBaseURL"),
					(0, _deepseek_ai_dsh_client_ui_primitives.settingsNumberField)("deepseekCount"),
					(0, _deepseek_ai_dsh_client_ui_primitives.settingsNumberField)("summaryMaxChars"),
					(0, _deepseek_ai_dsh_client_ui_primitives.settingsNumberField)("deepseekTimeoutMs"),
					(0, _deepseek_ai_dsh_client_ui_primitives.settingsTextField)("baseURL"),
					(0, _deepseek_ai_dsh_client_ui_primitives.settingsTextField)("gl"),
					(0, _deepseek_ai_dsh_client_ui_primitives.settingsTextField)("hl"),
					(0, _deepseek_ai_dsh_client_ui_primitives.settingsNumberField)("num"),
					(0, _deepseek_ai_dsh_client_ui_primitives.settingsNumberField)("serperTimeoutMs"),
					(0, _deepseek_ai_dsh_client_ui_primitives.settingsTextField)("yuanbaoEndpoint"),
					(0, _deepseek_ai_dsh_client_ui_primitives.settingsNumberField)("yuanbaoCnt"),
					(0, _deepseek_ai_dsh_client_ui_primitives.settingsNumberField)("yuanbaoTimeoutMs"),
					settingsBooleanField("native"),
					settingsBooleanField("serperEnabled"),
					settingsBooleanField("yuanbaoEnabled")
				], CREDENTIAL_GROUPS.map((group) => ({
					field: group.field,
					write: (text) => this.writeKey(group, text)
				})));
				this.store = this.form.bind(() => this.projection());
				this.unsubscribe = scope.subscribe(() => {
					this.syncCredentials();
				});
				this.syncCredentials();
			}
			projection() {
				return {
					...this.form.shell(),
					deepseekBaseURL: this.form.field("deepseekBaseURL"),
					deepseekCount: this.form.field("deepseekCount"),
					summaryMaxChars: this.form.field("summaryMaxChars"),
					deepseekTimeoutMs: this.form.field("deepseekTimeoutMs"),
					native: this.form.field("native"),
					deepseekApiKey: this.form.field("deepseekApiKey"),
					deepseekApiKeyConfigured: this.credentials.deepseek.configured,
					deepseekApiKeyWritable: this.credentials.deepseek.writable,
					deepseekApiKeyRef: this.credentials.deepseek.ref,
					baseURL: this.form.field("baseURL"),
					gl: this.form.field("gl"),
					hl: this.form.field("hl"),
					num: this.form.field("num"),
					serperTimeoutMs: this.form.field("serperTimeoutMs"),
					serperEnabled: this.form.field("serperEnabled"),
					serperApiKey: this.form.field("serperApiKey"),
					serperApiKeyConfigured: this.credentials.serper.configured,
					serperApiKeyWritable: this.credentials.serper.writable,
					serperApiKeyRef: this.credentials.serper.ref,
					yuanbaoEndpoint: this.form.field("yuanbaoEndpoint"),
					yuanbaoCnt: this.form.field("yuanbaoCnt"),
					yuanbaoTimeoutMs: this.form.field("yuanbaoTimeoutMs"),
					yuanbaoEnabled: this.form.field("yuanbaoEnabled"),
					yuanbaoApiKey: this.form.field("yuanbaoApiKey"),
					yuanbaoApiKeyConfigured: this.credentials.yuanbao.configured,
					yuanbaoApiKeyWritable: this.credentials.yuanbao.writable,
					yuanbaoApiKeyRef: this.credentials.yuanbao.ref
				};
			}
			/**
			* Re-read the credential references that changed since the last snapshot.
			* Only the groups whose reference moved are re-described, so renaming one
			* reference does not disturb the other two boxes.
			*/
			async syncCredentials() {
				for (const group of CREDENTIAL_GROUPS) if (refOf(this.scope.getSnapshot(), group) !== this.credentials[group.kind].ref) await this.readOne(group);
			}
			/**
			* Ask the credentials domain about one group's current reference. The answer
			* is stored with the reference it describes: `*ApiKeyEnv` can change between
			* the request and its response, and two reads can settle out of order, so a
			* response is published only while it still answers for the reference in force.
			* @param group - the credential group to refresh.
			*/
			async readOne(group) {
				const ref = refOf(this.scope.getSnapshot(), group);
				if (ref !== this.credentials[group.kind].ref) {
					this.credentials[group.kind] = {
						ref,
						configured: false,
						writable: true
					};
					this.store.set(this.projection());
				}
				const response = await this.ctx.remote.credentials.describe([ref]);
				if (!response.ok || ref !== refOf(this.scope.getSnapshot(), group)) return;
				const view = response.value?.[ref];
				const next = {
					ref,
					configured: view?.configured ?? false,
					writable: view?.writable ?? true
				};
				const previous = this.credentials[group.kind];
				if (previous.configured === next.configured && previous.writable === next.writable) return;
				this.credentials[group.kind] = next;
				this.store.set(this.projection());
			}
			/**
			* Re-read after the Host reports a change to a reference one group watches.
			* Only the group whose reference matches is refreshed.
			* @param ref - the reference the Host reports as changed.
			*/
			refreshCredential(ref) {
				for (const group of CREDENTIAL_GROUPS) {
					if (ref !== this.credentials[group.kind].ref) continue;
					this.readOne(group);
				}
			}
			/**
			* Build the face the card's slot registration injects.
			* @returns the card's snapshot hook and its form actions.
			*/
			inject() {
				return {
					hooks: { serperSearchCard: this.store },
					...this.form.actions()
				};
			}
			/**
			* Write one group's staged key, then re-read whether the Host now holds one.
			* @param group - the credential group being written.
			* @param value - the staged credential literal.
			* @returns whether the Host reports a configured credential afterwards.
			*/
			async writeKey(group, value) {
				await this.ctx.remote.credentials.set(refOf(this.scope.getSnapshot(), group), value);
				await this.readOne(group);
				return this.credentials[group.kind].configured;
			}
			/** Release configuration subscriptions. */
			dispose() {
				this.unsubscribe();
				this.form.dispose();
			}
		};
		/**
		* A true/false field. An empty draft clears the field (re-inheriting the
		* composition layer); any draft other than `true`/`false` blocks the save.
		* @param field - field name inside the namespace section.
		* @returns the field's conversion spec.
		*/
		function settingsBooleanField(field) {
			return {
				field,
				format: (value) => value === true ? "true" : value === false ? "false" : "",
				parse: (text) => {
					const draft = text.trim().toLowerCase();
					if (draft === "") return { kind: "clear" };
					if (draft === "true") return {
						kind: "set",
						value: true
					};
					if (draft === "false") return {
						kind: "set",
						value: false
					};
				}
			};
		}
		/**
		* The credential reference one group addresses, or that group's default.
		* @param snapshot - the current scope snapshot.
		* @param group - the credential group.
		* @returns the reference to address.
		*/
		function refOf(snapshot, group) {
			const declared = snapshot.value?.[group.refField];
			return typeof declared === "string" && declared.length > 0 ? declared : group.fallback;
		}
		//#endregion
		//#region src/client/index.ts
		/** Dictionary namespace owned by this plugin. */
		const NS = "settings.serperSearch";
		/** Required services (cordis fiber inject). */
		const inject = [
			"slots",
			"locale",
			"remote",
			"remote.credentials",
			"configForms"
		];
		/** The bundle package name the `plugins.bundle.config` key dispatches on. */
		const BUNDLE_KEY = "dsh-serper-search";
		/** The `<package>#<row id>` key the `plugins.row.config` slot dispatches on. */
		const ROW_KEY = "dsh-serper-search#web-search-serper";
		/**
		* Mount the serper search settings card while the Host serves its namespace.
		* @param ctx - the browser plugin context.
		*/
		function apply(ctx) {
			const locale = ctx.locale;
			ctx.effect(() => locale.register(NS, {
				zh,
				en
			}), "serper-search: dictionaries");
			const card = new SerperSearchCardController(ctx.configForms.get(SERPER_SEARCH_NS), ctx);
			ctx.effect(() => () => {
				card.dispose();
			}, "serper-search: form subscription");
			ctx.effect(() => ctx.remote.$on("credentials/reference-updated", (ref) => {
				card.refreshCredential(ref);
			}), "serper-search: credential invalidations");
			ctx.effect(() => ctx.configForms.whileServed([SERPER_SEARCH_NS], () => {
				const bundleOff = ctx.slots.inject("plugins.bundle.config", () => ctx.slots.register({
					name: "plugins.bundle.config",
					key: BUNDLE_KEY,
					locale: NS,
					inject: () => card.inject()
				}, SerperSearchCard));
				const rowOff = ctx.slots.inject("plugins.row.config", () => ctx.slots.register({
					name: "plugins.row.config",
					key: ROW_KEY,
					locale: NS,
					inject: () => card.inject()
				}, SerperSearchCard));
				return () => {
					bundleOff();
					rowOff();
				};
			}), "serper-search: page");
		}
		//#endregion
		exports.DEFAULT_API_KEY_REF = DEFAULT_API_KEY_REF;
		exports.NS = NS;
		exports.SERPER_SEARCH_NS = SERPER_SEARCH_NS;
		exports.SerperSearchCardController = SerperSearchCardController;
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map