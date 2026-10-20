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
		* @module dsh-serper-search/client/locale
		*/
		/** English copy. */
		const en = {
			title: "Serper + DeepSeek search",
			description: "Results merge DeepSeek Search API (primary) with serper.dev Google results (secondary). Advanced settings (ratio, summary length, timeouts) live in cordis.patch.yml.",
			apiKey: "API key",
			apiKeyHint: "Stored outside the settings file. Leave blank to keep the current key.",
			apiKeySet: "A key is configured.",
			apiKeyUnset: "No key is configured; searches will fail until one is saved.",
			baseUrl: "Endpoint",
			baseUrlHint: "Leave blank to use the provider default (https://google.serper.dev).",
			gl: "Country (gl)",
			glHint: "Google country code, e.g. cn or us. Leave blank for the provider default.",
			hl: "Language (hl)",
			hlHint: "Interface language, e.g. zh-cn or en. Leave blank for the provider default.",
			num: "Results per search",
			numHint: "Candidate pool size per search (1-100); the model still sees at most the tool layer result cap (8 by default).",
			native: "Merge DeepSeek Search API",
			nativeHint: "true = every search also queries the DeepSeek Search API and interleaves its sources with Google 2:1 (wider coverage, ~0.005 CNY per search); false = serper only.",
			overridden: "Overridden",
			reset: "Reset to default",
			readOnly: "This deployment stores settings read-only.",
			unavailable: "This plugin is not loaded, so it cannot be configured right now.",
			save: "Save",
			saving: "Saving…",
			saveFailed: "The deployment did not accept these values; they were left for you to correct.",
			invalidNumber: "Enter a number, or leave blank to use the default.",
			invalidBoolean: "Enter true or false, or leave blank to use the default.",
			probeRun: "Test both backends",
			probing: "Testing…",
			probeOk: "Both backends answered.",
			probeFailed: "The self-check did not run; try again in a moment.",
			probeCostHint: "Each test costs one serper and one DeepSeek search.",
			probeAccountOnly: "No API key detected; if you use a DeepSeek Account session in chat, search still works.",
			probeUnsupported: "This deployment does not expose the self-check routes, so it is unavailable here.",
			laneDeepseek: "DeepSeek Search API",
			laneSerper: "serper.dev (Google)",
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
			title: "Serper + DeepSeek 搜索",
			description: "结果由 DeepSeek 官方 Search API（主）与 serper.dev 的 Google 结果（补）按比例交错合并。高级项（比例、摘要长度、超时）在 cordis.patch.yml 中配置。",
			apiKey: "API Key",
			apiKeyHint: "不写入设置文件。留空表示保持当前密钥。",
			apiKeySet: "已配置密钥。",
			apiKeyUnset: "未配置密钥；保存一个密钥后才能搜索。",
			baseUrl: "接口地址",
			baseUrlHint: "留空则使用提供方默认地址（https://google.serper.dev）。",
			gl: "国家/地区（gl）",
			glHint: "Google 国家/地区码，如 cn 或 us。留空则使用提供方默认值。",
			hl: "语言（hl）",
			hlHint: "界面语言，如 zh-cn 或 en。留空则使用提供方默认值。",
			num: "每次搜索结果数",
			numHint: "候选条数下限（1-100）；模型最终看到的条数仍受工具层上限约束（默认 8）。",
			native: "合并 DeepSeek Search API",
			nativeHint: "true = 每次搜索同时请求 DeepSeek 官方 Search API，并与 Google 结果 2:1 交错合并（覆盖更全，每次约 0.005 元）；false = 仅 serper。",
			overridden: "已覆盖",
			reset: "恢复默认",
			readOnly: "本部署的设置为只读。",
			unavailable: "该插件当前未加载，暂时无法配置。",
			save: "保存",
			saving: "保存中…",
			saveFailed: "本部署没有接受这些值，已保留供你修改。",
			invalidNumber: "请填数字；留空表示使用默认值。",
			invalidBoolean: "请填 true 或 false；留空表示使用默认值。",
			probeRun: "测试双路",
			probing: "测试中…",
			probeOk: "两路均正常。",
			probeFailed: "本次自检未能运行，请稍后重试。",
			probeCostHint: "每次测试消耗 1 次 serper + 1 次 DeepSeek 搜索。",
			probeAccountOnly: "未检测到 API key；若你在对话内使用 DeepSeek 账号登录，搜索不受影响",
			probeUnsupported: "当前部署未提供自检接口，无法在此运行。",
			laneDeepseek: "DeepSeek 官方搜索",
			laneSerper: "serper.dev（Google）",
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
			if (lane.lane !== "deepseek" && lane.lane !== "serper") return void 0;
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
			const label = t(lane.lane === "deepseek" ? "laneDeepseek" : "laneSerper");
			if (lane.ok) return `${label}: ${lane.ms}ms · ${lane.sources}`;
			if (lane.class === "account-only") return `${label}: ${t("probeAccountOnly")}`;
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
			const probeAllOk = lanes.some((lane) => lane.lane === "deepseek" && lane.ok) && lanes.some((lane) => lane.lane === "serper" && lane.ok);
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
		* Render the serper search provider's one-liner or its settings form.
		* @param props - the view asked for, locale copy, the form snapshot, and its actions.
		* @returns the one-liner, or the form.
		*/
		function SerperSearchCard(props) {
			const { t } = props;
			const state = props.useSerperSearchCard((snapshot) => snapshot);
			if (props.view === "summary") return t("description");
			const disabled = !state.writable;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(_deepseek_ai_dsh_client_ui_primitives.SettingsForm, {
				labels: formLabels(t),
				state,
				onSave: props.save,
				onDiscard: props.discard,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.SettingsSecretField, {
						id: "plugin-config-serper-search-key",
						label: t("apiKey"),
						hint: t("apiKeyHint"),
						disabled: !state.apiKeyWritable,
						text: state.apiKey.text,
						configured: state.apiKeyConfigured,
						stateLabel: state.apiKeyConfigured ? t("apiKeySet") : t("apiKeyUnset"),
						onEdit: (text) => {
							props.edit("apiKey", text);
						}
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.SettingsValueField, {
						id: "plugin-config-serper-search-endpoint",
						label: t("baseUrl"),
						hint: t("baseUrlHint"),
						overriddenLabel: t("overridden"),
						resetLabel: t("reset"),
						invalidLabel: t("invalidNumber"),
						disabled,
						...state.baseURL,
						onEdit: (text) => {
							props.edit("baseURL", text);
						},
						onReset: () => {
							props.resetField("baseURL");
						}
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.SettingsValueField, {
						id: "plugin-config-serper-search-gl",
						label: t("gl"),
						hint: t("glHint"),
						overriddenLabel: t("overridden"),
						resetLabel: t("reset"),
						invalidLabel: t("invalidNumber"),
						disabled,
						...state.gl,
						onEdit: (text) => {
							props.edit("gl", text);
						},
						onReset: () => {
							props.resetField("gl");
						}
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.SettingsValueField, {
						id: "plugin-config-serper-search-hl",
						label: t("hl"),
						hint: t("hlHint"),
						overriddenLabel: t("overridden"),
						resetLabel: t("reset"),
						invalidLabel: t("invalidNumber"),
						disabled,
						...state.hl,
						onEdit: (text) => {
							props.edit("hl", text);
						},
						onReset: () => {
							props.resetField("hl");
						}
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.SettingsValueField, {
						id: "plugin-config-serper-search-num",
						label: t("num"),
						hint: t("numHint"),
						overriddenLabel: t("overridden"),
						resetLabel: t("reset"),
						invalidLabel: t("invalidNumber"),
						numeric: true,
						disabled,
						...state.num,
						onEdit: (text) => {
							props.edit("num", text);
						},
						onReset: () => {
							props.resetField("num");
						}
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.SettingsValueField, {
						id: "plugin-config-serper-search-native",
						label: t("native"),
						hint: t("nativeHint"),
						overriddenLabel: t("overridden"),
						resetLabel: t("reset"),
						invalidLabel: t("invalidBoolean"),
						placeholder: "true",
						disabled,
						...state.native,
						onEdit: (text) => {
							props.edit("native", text);
						},
						onReset: () => {
							props.resetField("native");
						}
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(RuntimePanel, { t })
				]
			});
		}
		//#endregion
		//#region src/client/card-controller.ts
		/**
		* Namespace of the serper search provider. Spelled here rather than imported:
		* a client package must not depend on a Host package.
		*/
		const SERPER_SEARCH_NS = "web-search-serper";
		/** Credential reference the provider resolves when the section names none. */
		const DEFAULT_API_KEY_REF = "SERPER_API_KEY";
		/** Form field the credential control stages under. */
		const API_KEY_FIELD = "apiKey";
		/** Bridges the `web-search-serper` scope and the credentials domain onto the card. */
		var SerperSearchCardController = class {
			scope;
			ctx;
			form;
			store;
			unsubscribe;
			credential = {
				ref: "",
				configured: false,
				writable: true
			};
			/**
			* @param scope - the bound settings scope for the `web-search-serper` namespace.
			* @param ctx - the card plugin's context, whose `remote.credentials` namespace
			* answers for the credential the section references.
			*/
			constructor(scope, ctx) {
				this.scope = scope;
				this.ctx = ctx;
				this.form = new _deepseek_ai_dsh_client_ui_primitives.SettingsFormModel(scope, [
					(0, _deepseek_ai_dsh_client_ui_primitives.settingsTextField)("baseURL"),
					(0, _deepseek_ai_dsh_client_ui_primitives.settingsTextField)("gl"),
					(0, _deepseek_ai_dsh_client_ui_primitives.settingsTextField)("hl"),
					(0, _deepseek_ai_dsh_client_ui_primitives.settingsNumberField)("num"),
					settingsBooleanField("native")
				], [{
					field: API_KEY_FIELD,
					write: (text) => this.writeKey(text)
				}]);
				this.store = this.form.bind(() => this.projection());
				this.unsubscribe = scope.subscribe(() => {
					this.readCredential();
				});
				this.readCredential();
			}
			projection() {
				return {
					...this.form.shell(),
					baseURL: this.form.field("baseURL"),
					gl: this.form.field("gl"),
					hl: this.form.field("hl"),
					num: this.form.field("num"),
					native: this.form.field("native"),
					apiKey: this.form.field(API_KEY_FIELD),
					apiKeyConfigured: this.credential.configured,
					apiKeyWritable: this.credential.writable
				};
			}
			/**
			* Ask the credentials domain about the reference the section currently names.
			* The answer is stored with the reference it describes: `apiKeyEnv` can change
			* between the request and its response, and two reads can settle out of order,
			* so a response is published only while it still answers for the reference in force.
			*/
			async readCredential() {
				const ref = refOf(this.scope.getSnapshot());
				if (ref !== this.credential.ref) {
					this.credential = {
						ref,
						configured: false,
						writable: true
					};
					this.store.set(this.projection());
				}
				const response = await this.ctx.remote.credentials.describe([ref]);
				if (!response.ok || ref !== refOf(this.scope.getSnapshot())) return;
				const view = response.value?.[ref];
				const next = {
					ref,
					configured: view?.configured ?? false,
					writable: view?.writable ?? true
				};
				if (next.configured === this.credential.configured && next.writable === this.credential.writable) return;
				this.credential = next;
				this.store.set(this.projection());
			}
			/**
			* Re-read after the Host reports a change to the reference this card watches.
			* @param ref - the reference the Host reports as changed.
			*/
			refreshCredential(ref) {
				if (ref !== this.credential.ref) return;
				this.readCredential();
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
			* Write the staged key, then re-read whether the Host now holds one.
			* @param value - the staged credential literal.
			* @returns whether the Host reports a configured credential afterwards.
			*/
			async writeKey(value) {
				await this.ctx.remote.credentials.set(refOf(this.scope.getSnapshot()), value);
				await this.readCredential();
				return this.credential.configured;
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
		* The credential reference the section names, or the provider's default.
		* @param snapshot - the current scope snapshot.
		* @returns the reference to address.
		*/
		function refOf(snapshot) {
			const declared = snapshot.value?.apiKeyEnv;
			return typeof declared === "string" && declared.length > 0 ? declared : DEFAULT_API_KEY_REF;
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