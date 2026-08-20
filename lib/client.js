window.__ModuleLoader__.load({
	id: "@deepseek-ai/dsh-updater",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		let react_jsx_runtime = require("react/jsx-runtime");
		let prim = require("@deepseek-ai/dsh-client-ui-primitives");
		let runtime = require("@deepseek-ai/dsh-client-runtime/client");

		// #region 样式（内联注入，模仿现有插件的注入方式）
		const css = ".du_badge{display:inline-flex;align-items:center;gap:6px;height:30px;padding:0 12px;border:1px solid var(--dsw-alias-border-l2);border-radius:16px;background:var(--dsw-surface-2);color:var(--dsw-alias-label-primary);font-size:12px;line-height:1;cursor:pointer;font-family:var(--dsw-font-family);transition:background .15s ease,border-color .15s ease;white-space:nowrap}.du_badge:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}.du_badge:disabled{opacity:.55;cursor:default;pointer-events:none}.du_badge.du_update{border-color:var(--dsw-accent);color:var(--dsw-accent)}.du_badge.du_update:disabled{opacity:1;pointer-events:auto}.du_dot{width:6px;height:6px;border-radius:50%;background:currentColor;display:inline-block;flex:none;animation:du_pulse 2s ease-in-out infinite}@keyframes du_pulse{0%,100%{opacity:1}50%{opacity:.4}}@keyframes du_spin{to{transform:rotate(1turn)}}.du_spinner{width:12px;height:12px;border:2px solid currentColor;border-right-color:transparent;border-radius:50%;display:inline-block;flex:none;animation:du_spin .8s linear infinite}";
		const tagId = "@deepseek-ai/dsh-updater/updater.module.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "@deepseek-ai/dsh-updater";
			tag.dataset.pluginCss = tagId;
			tag.textContent = css;
			document.head.appendChild(tag);
		}
		const cssMap = { badge: "du_badge", update: "du_update", dot: "du_dot", spinner: "du_spinner" };
		// #endregion

		// #region 文案
		const NS = "dsh-updater";
		const zh = {
			"upgrade": "升级",
			"checking": "检查更新",
			"currentVersion": "当前版本",
			"newVersion": "发现新版本",
			"upToDate": "当前已是最新版本",
			"available": "有新版本可用，是否立即升级？",
			"upgradeNow": "立即升级",
			"later": "稍后再说",
			"close": "关闭",
			"upgrading": "正在升级，服务即将重启",
			"upgradeDone": "升级成功，页面即将刷新",
			"upgradeFailed": "升级失败",
			"installing": "正在安装新版本…"
		};
		const en = {
			"upgrade": "Upgrade",
			"checking": "Checking",
			"currentVersion": "Current version",
			"newVersion": "New version available",
			"upToDate": "You are up to date",
			"available": "A newer version is available. Upgrade now?",
			"upgradeNow": "Upgrade now",
			"later": "Later",
			"close": "Close",
			"upgrading": "Upgrading… the server will restart soon",
			"upgradeDone": "Upgrade complete. Refreshing…",
			"upgradeFailed": "Upgrade failed",
			"installing": "Installing the new version…"
		};
		// #endregion

		// #region 状态存储（跨渲染共享，供按钮与对话框同步） + 网络
		const INITIAL = {
			status: null,
			dialog: "closed", // closed | prompt | upgrading | done
			error: null,
			checking: false
		};
		const store = runtime.createSnapshotStore(INITIAL);
		const DISMISS_KEY = "dsh-updater.dismissed";

		function useStore() {
			return react.useSyncExternalStore(store.subscribe, store.getSnapshot);
		}

		async function fetchStatus() {
			const res = await fetch("/upgrade/status", {
				headers: { "x-requested-with": "dsh-updater" }
			});
			if (!res.ok) throw new Error("HTTP " + res.status);
			const body = await res.json();
			if (!body.ok) throw new Error(body.error || "bad response");
			return body;
		}

		function refresh() {
			store.update((s) => { s.checking = true; });
			return fetchStatus().then((status) => {
				store.update((s) => { s.status = status; s.checking = false; });
				return status;
			}).catch((error) => {
				store.update((s) => { s.checking = false; s.error = String(error?.message || error); });
				return null;
			});
		}

		function dismissedVersion() {
			try { return localStorage.getItem(DISMISS_KEY) || ""; } catch { return ""; }
		}
		function setDismissed(version) {
			try { localStorage.setItem(DISMISS_KEY, version || ""); } catch { /* 私有模式忽略 */ }
		}
		function openDialog(mode) { store.update((s) => { s.dialog = mode || "prompt"; }); }
		function closeDialog() { store.update((s) => { s.dialog = "closed"; }); }

		async function runUpgrade() {
			store.update((s) => { s.dialog = "upgrading"; s.error = null; });
			try {
				const res = await fetch("/upgrade/run", {
					method: "POST",
					headers: { "x-requested-with": "dsh-updater" }
				});
				const body = await res.json().catch(() => ({}));
				if (!res.ok) throw new Error(body.error || ("HTTP " + res.status));
				const delay = typeof body.restartDelayMs === "number" ? body.restartDelayMs : 3000;
				setTimeout(() => {
					location.reload();
				}, Math.max(1500, delay + 2500));
				store.update((s) => { s.dialog = "done"; s.error = null; });
			} catch (error) {
				store.update((s) => { s.dialog = "prompt"; s.error = String(error?.message || error); });
			}
		}

		// 轮询：每 5 分钟一次；发现新版本且未被忽略则自动弹出提示。
		const pollId = setInterval(() => {
			refresh().then((status) => {
				const current = store.getSnapshot();
				if (status?.updateAvailable && current.dialog === "closed" && dismissedVersion() !== status.latest) {
					openDialog("prompt");
				}
			});
		}, 5 * 60 * 1000);

		// 页面重新可见时也刷新一次。
		document.addEventListener("visibilitychange", () => {
			if (!document.hidden) refresh();
		});

		// #region 组件
		function UpgradeBadge(props) {
			const { t } = props;
			const state = useStore();
			const status = state.status;
			const updateAvailable = status?.updateAvailable === true;
			const checking = state.checking;
			const loaded = status !== null;
			const version = status?.installed ? "v" + status.installed : "v…";
			// 有更新才可点击；未加载/检查中/已是最新 → 禁用。
			const disabled = !updateAvailable || checking || !loaded;
			const label = updateAvailable ? t("upgrade") : version;
			return react_jsx_runtime.jsxs("button", {
				type: "button",
				className: cssMap.badge + (updateAvailable ? " " + cssMap.update : ""),
				disabled,
				title: updateAvailable
					? t("newVersion") + " " + (status?.latest ? "v" + status.latest : "")
					: t("upToDate") + " " + version,
				onClick: () => {
					if (disabled) return;
					refresh().then(() => openDialog("prompt"));
				},
				children: [
					updateAvailable
						? react_jsx_runtime.jsx("span", { className: cssMap.dot })
						: checking
							? react_jsx_runtime.jsx("span", { className: cssMap.spinner })
							: null,
					react_jsx_runtime.jsx("span", { children: label }),
					updateAvailable && status?.latest
						? react_jsx_runtime.jsx("span", { children: "v" + status.latest })
						: null
				]
			});
		}

		function UpgradeDialog(props) {
			const { t } = props;
			const state = useStore();
			const status = state.status;
			const open = state.dialog !== "closed";
			const upgrading = state.dialog === "upgrading" || state.dialog === "done";
			const title = upgrading
				? (state.dialog === "done" ? t("upgradeDone") : t("upgrading"))
				: status?.updateAvailable
					? t("newVersion")
					: t("upToDate");
			const description = upgrading
				? (state.dialog === "done" ? t("upgradeDone") : t("installing"))
				: status?.updateAvailable
					? t("available") + " " + (status.latest ? "v" + status.latest : "")
					: t("upToDate") + " " + (status?.installed ? "v" + status.installed : "");
			const footer = state.dialog === "prompt"
				? react_jsx_runtime.jsxs(react_jsx_runtime.Fragment, {
					children: [
						react_jsx_runtime.jsx(prim.Button, {
							variant: "default",
							onClick: () => {
								closeDialog();
								setDismissed(status?.latest || "");
							},
							children: t("later")
						}),
						react_jsx_runtime.jsx(prim.Button, {
							variant: "primary",
							onClick: () => {
								setDismissed("");
								runUpgrade();
							},
							children: t("upgradeNow")
						})
					]
				})
				: upgrading
					? react_jsx_runtime.jsx(prim.Button, {
						variant: "primary",
						onClick: () => location.reload(),
						children: t("close")
					})
					: react_jsx_runtime.jsx(prim.Button, {
						variant: "default",
						onClick: closeDialog,
						children: t("close")
					});
			return react_jsx_runtime.jsx(prim.Modal, {
				open,
				onClose: closeDialog,
				title,
				description,
				footer,
				closeLabel: t("close")
			});
		}

		function UpgradeSlot(props) {
			return react_jsx_runtime.jsxs(react_jsx_runtime.Fragment, {
				children: [
					react_jsx_runtime.jsx(UpgradeBadge, { ...props }),
					react_jsx_runtime.jsx(UpgradeDialog, { ...props })
				]
			});
		}
		// #endregion

		// 注册：右上角 header.utilities 插槽（会话级，右对齐工具区），并注入依赖。
		const inject = ["slots", "locale"];
		function apply(ctx) {
			ctx.effect(() => ctx.locale.register(NS, { zh, en }), "dsh-updater: dictionaries");
			ctx.slots.inject("conversation.session.header.utilities", () =>
				ctx.slots.register({
					name: "conversation.session.header.utilities",
					id: "dsh-updater",
					order: 100,
					locale: NS
				}, UpgradeSlot)
			);
			// 插件卸载时停止轮询。
			ctx.effect(() => () => {
				clearInterval(pollId);
			}, "dsh-updater: poll cleanup");
			// 初次加载立即检查一次：若有新版本且未被忽略，自动弹出提示。
			refresh().then((status) => {
				const current = store.getSnapshot();
				if (status?.updateAvailable && current.dialog === "closed" && dismissedVersion() !== status.latest) {
					openDialog("prompt");
				}
			});
		}
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});