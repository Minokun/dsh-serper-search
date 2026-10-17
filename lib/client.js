window.__ModuleLoader__.load({
	id: "dsh-serper-search",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let _deepseek_ai_dsh_client_ui_primitives = require("@deepseek-ai/dsh-client-ui-primitives");
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
			numHint: "Default number of organic results per search (1-100).",
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
			invalidBoolean: "Enter true or false, or leave blank to use the default."
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
			numHint: "每次搜索返回的自然结果条数（1-100）。",
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
			invalidBoolean: "请填 true 或 false；留空表示使用默认值。"
		};
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
					})
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