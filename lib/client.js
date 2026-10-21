window.__ModuleLoader__.load({
	id: "dsh-screen-saver",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		let react_jsx_runtime = require("react/jsx-runtime");
		let _deepseek_ai_dsh_client_ui_primitives = require("@deepseek-ai/dsh-client-ui-primitives");

		const NS = "dshScreenSaver";
		const STORAGE_KEY = "dsh-screen-saver.enabled";

		/** 会话前台入口开关。 */
		const ENABLE_DOCK = true;

		const zh = {
			"nav": "屏幕常亮",
			"title": "保持屏幕常亮",
			"description": "打开后本页面向系统申请屏幕保持唤醒，直到你手动关闭或页面被隐藏。",
			"hint": "仅在 DSHM 前端页面可见时生效；切到后台或锁屏后系统会收回，回到页面会自动重新申请。",
			"status.on": "已常亮",
			"status.off": "未开启",
			"status.pending": "请求中…",
			"dock.on": "常",
			"dock.offTip": "让屏幕保持常亮",
			"dock.onTip": "屏幕正保持常亮，点击关闭",
			"dock.offAria": "屏幕常亮：未开启，点击开启",
			"dock.onAria": "屏幕常亮：已开启，点击关闭",
			"toast.acquired": "屏幕已常亮",
			"toast.released": "已恢复系统默认的息屏行为",
			"error.unsupported": "当前 ArkWeb 未提供 Screen Wake Lock API，无法在页面内保持屏幕常亮。",
			"error.denied": "申请被拒绝：系统或浏览器不允许常亮。",
			"error.threw": "申请屏幕常亮失败：{message}"
		};

		const en = {
			"nav": "Keep screen on",
			"title": "Keep screen on",
			"description": "When enabled, this page requests a screen wake lock until you turn it off or the page is hidden.",
			"hint": "Only effective while the DSHM web page is visible. The system releases it when the page is hidden or the screen locks; it is re-acquired when the page becomes visible again.",
			"status.on": "On",
			"status.off": "Off",
			"status.pending": "Requesting…",
			"dock.on": "On",
			"dock.offTip": "Keep the screen on",
			"dock.onTip": "The screen is being kept on; click to turn off",
			"dock.offAria": "Keep screen on: off, activate to enable",
			"dock.onAria": "Keep screen on: on, activate to disable",
			"toast.acquired": "Screen kept awake",
			"toast.released": "Back to the system default screen timeout",
			"error.unsupported": "This ArkWeb build has no Screen Wake Lock API; cannot keep the screen awake from a web page.",
			"error.denied": "Wake lock request was denied by the system or browser.",
			"error.threw": "Requesting the wake lock failed: {message}"
		};

		/** 读上次的开关意图；默认关。 */
		function readStored() {
			try {
				return window.localStorage?.getItem(STORAGE_KEY) === "1";
			} catch {
				return false;
			}
		}

		function writeStored(value) {
			try {
				if (value) window.localStorage?.setItem(STORAGE_KEY, "1");
				else window.localStorage?.removeItem(STORAGE_KEY);
			} catch {
				/* localStorage 不可用时放弃持久化（本次会话仍生效） */
			}
		}

		/**
		 * 自管 Wake Lock —— 不绑组件生命周期，由插件半边持有。
		 * 标准行为：页面隐藏时 sentinel 被系统自动释放；回来时按用户意图重新申请。
		 */
		const wake = {
			sentinel: null,
			desired: -1, // 用户意图；-1 表示尚未初始化
			acquiring: false,
			get() {
				return this.sentinel !== null && !this.sentinel.released;
			},
			async acquire() {
				if (this.acquiring) return this.get();
				// 失效的 sentinel 先摘掉：系统在后台收回锁时会置 released=true，
				// 这种残留若不清理，会让后续 acquire 以为"已经持有"而空转。
				if (this.sentinel !== null && this.sentinel.released) this.sentinel = null;
				if (this.get()) return true;
				if (typeof navigator?.wakeLock?.request !== "function") {
					const error = new Error("Screen Wake Lock API unavailable");
					error.name = "NotSupportedError";
					throw error;
				}
				this.acquiring = true;
				try {
					const sentinel = await navigator.wakeLock.request("screen");
					this.sentinel = sentinel;
					// sentinel 被系统收回时回调；只有它仍是"当前"那把锁才改状态，
					// 避免 release() 主动释放时把 UI 状态改乱。
					sentinel.addEventListener?.("release", () => {
						if (this.sentinel === sentinel) {
							this.sentinel = null;
							statusStore.notify();
						}
					});
					return this.get();
				} catch (error) {
					this.sentinel = null;
					throw error;
				} finally {
					this.acquiring = false;
				}
			},
			async release() {
				const sentinel = this.sentinel;
				this.sentinel = null;
				if (sentinel !== null && !sentinel.released) {
					try {
						await sentinel.release();
					} catch {
						/* 已被系统释放 */
					}
				}
				return false;
			},
			/**
			 * 回到前台时强制续期：不问"当前是否还有锁"，直接换一把新的。
			 * 为什么必须强制——WebView 被系统挂起后，旧 sentinel 往往既不置
			 * released、也不回调 release，get() 会一直返回 true，于是"按意图补申请"
			 * 被误判成"已经持有"而跳过，表现就是回到前台不再常亮。
			 */
			async renew() {
				if (this.desired !== true) return false;
				const old = this.sentinel;
				this.sentinel = null;
				if (old !== null && !old.released) {
					try {
						await old.release();
					} catch {
						/* 忽略：本来就要换新的 */
					}
				}
				try {
					return await this.acquire();
				} catch (error) {
					// 换锁失败时再试一次：一次性失败多半是切前台的时序抖动，
					// 重试能救回大部分场景；仍失败才把错误交给上层展示。
					try {
						return await this.acquire();
					} catch {
						throw error;
					}
				}
			}
		};

		/**
		 * 状态源：getSnapshot 必须返回**引用稳定**的对象，
		 * 否则 useSyncExternalStore 会判定快照反复变化而无限重渲染。
		 * 做法：按 revision 缓存，任何状态变更都 invalidate。
		 */
		const listeners = new Set();
		const statusStore = {
			revision: 0,
			lastError: null, // null | {key, params}
			pending: false,
			cached: null,
			subscribe(listener) {
				listeners.add(listener);
				return () => {
					listeners.delete(listener);
				};
			},
			getSnapshot() {
				if (this.cached === null) {
					this.cached = {
						revision: this.revision,
						on: wake.get(),
						pending: this.pending,
						error: this.lastError
					};
				}
				return this.cached;
			},
			/** 状态位改动后调用：作废缓存快照并通知订阅者。 */
			notify() {
				this.revision += 1;
				this.cached = null;
				for (const listener of listeners) {
					try {
						listener();
					} catch {
						/* 单个订阅者失败不拖累其它 */
					}
				}
			}
		};

		// 传给 useSyncExternalStore 的这两个引用必须恒定，否则每次渲染都会重订阅。
		const subscribeStatus = (listener) => statusStore.subscribe(listener);
		const getStatusSnapshot = () => statusStore.getSnapshot();

		async function setIntent(intent) {
			// 必须先记下用户意图：visibilitychange 回来时是按 desired 决定要不要重取锁，
			// 漏了这一步就会出现「切后台自动释放 → 回前台不再申请」的死角。
			wake.desired = intent === true;
			statusStore.pending = true;
			statusStore.notify();
			writeStored(intent);
			try {
				if (intent) await wake.acquire();
				else await wake.release();
				statusStore.lastError = null;
			} catch (error) {
				statusStore.lastError = {
					key: error?.name === "NotAllowedError"
						? "error.denied"
						: (error?.name === "NotSupportedError" ? "error.unsupported" : "error.threw"),
					params: { message: error instanceof Error ? error.message : String(error) }
				};
			}
			statusStore.pending = false;
			statusStore.notify();
		}

		/**
		 * 页面重新可见时按用户意图补申请一次（系统隐藏页面时会自动释放锁）。
		 * 除 visibilitychange 外还挂 pageshow / focus：鸿蒙上从后台回前台，
		 * 少数情况下 WebView 只走 resume 路径、不发 visibilitychange。
		 */
		function installVisibilityHandler() {
			if (typeof document === "undefined") return () => {};

			const reacquire = () => {
				if (wake.desired !== true) return;
				if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
				// 强制续期：不判断"是否已持有"，见 wake.renew 的注释。
				wake.renew().then(
					() => {
						statusStore.lastError = null;
						statusStore.notify();
					},
					(error) => {
						statusStore.lastError = {
							key: error?.name === "NotAllowedError" ? "error.denied" : "error.threw",
							params: { message: error instanceof Error ? error.message : String(error) }
						};
						statusStore.notify();
					}
				);
			};

			const onVisibility = () => {
				if (document.visibilityState !== "visible") return;
				reacquire();
			};

			document.addEventListener("visibilitychange", onVisibility);
			window.addEventListener("pageshow", reacquire);
			window.addEventListener("focus", reacquire);

			return () => {
				document.removeEventListener("visibilitychange", onVisibility);
				window.removeEventListener("pageshow", reacquire);
				window.removeEventListener("focus", reacquire);
			};
		}

		/** 按持久化的意图恢复一次（幂等）。 */
		let restoreTried = false;
		function tryRestoreOnce() {
			if (restoreTried) return;
			restoreTried = true;
			const wanted = readStored();
			wake.desired = wanted;
			statusStore.notify();
			if (!wanted) return;
			wake.acquire().then(
				() => {
					statusStore.lastError = null;
					statusStore.notify();
				},
				(error) => {
					statusStore.lastError = {
						key: error?.name === "NotAllowedError" ? "error.denied" : "error.threw",
						params: { message: error instanceof Error ? error.message : String(error) }
					};
					statusStore.notify();
				}
			);
		}

		/** 本分区正文：自订阅状态源，不经由 slot inject 面装配。 */
		function ScreenSaverSection(props) {
			const t = props.t;
			const status = react.useSyncExternalStore(subscribeStatus, getStatusSnapshot);
			const [banner, setBanner] = react.useState(null);
			const seq = react.useRef(0);

			react.useEffect(() => {
				tryRestoreOnce();
			}, []);

			const announce = (text) => {
				seq.current += 1;
				setBanner({ seq: seq.current, text });
			};

			const on = status.on;
			const toggle = () => {
				const next = !on;
				void setIntent(next).then(() => {
					if (statusStore.getSnapshot().error === null) {
						announce(next ? t("toast.acquired") : t("toast.released"));
					}
				});
			};

			const statusText = on ? t("status.on") : (status.pending ? t("status.pending") : t("status.off"));
			const errorText = status.error === null ? null : t(status.error.key, status.error.params);

			return react_jsx_runtime.jsxs(react_jsx_runtime.Fragment, {
				children: [
					react_jsx_runtime.jsx("div", {
						className: "ssPane",
						"data-dsh-screen-saver": "pane",
						children: react_jsx_runtime.jsxs("div", {
							className: "ssCard",
							children: [
								react_jsx_runtime.jsx("div", {
									className: on ? "ssIconBox on" : "ssIconBox",
									children: react_jsx_runtime.jsx(_deepseek_ai_dsh_client_ui_primitives.IconLightOutlineRegular, { size: 20 })
								}),
								react_jsx_runtime.jsxs("div", {
									className: "ssBody",
									children: [
										react_jsx_runtime.jsxs("div", {
											className: "ssTitleRow",
											children: [
												react_jsx_runtime.jsx("span", { className: "ssTitle", children: t("title") }),
												react_jsx_runtime.jsx("span", {
													className: on ? "ssState on" : "ssState",
													children: statusText
												})
											]
										}),
										react_jsx_runtime.jsx("div", { className: "ssDesc", children: t("description") })
									]
								}),
								react_jsx_runtime.jsx("div", {
									className: "ssControl",
									children: react_jsx_runtime.jsx(_deepseek_ai_dsh_client_ui_primitives.Switch, {
										checked: on,
										disabled: status.pending,
										label: t("title"),
										title: t("title"),
										onChange: toggle
									})
								})
							]
						})
					}),
					errorText === null ? null : react_jsx_runtime.jsx("div", {
						className: "ssError",
						role: "alert",
						children: errorText
					}),
					react_jsx_runtime.jsx("div", { className: "ssHint", children: t("hint") }),
					banner === null ? null : react_jsx_runtime.jsx(_deepseek_ai_dsh_client_ui_primitives.Toast, {
						text: banner.text,
						holdMs: 3000,
						onDone: () => {
							setBanner(null);
						}
					}, banner.seq)
				]
			});
		}

		/**
		 * 会话前台入口：输入框上方 dock 的小胶囊。
		 *
		 * 尺寸对齐 ui-chat 自带的 StatsPills（14px 图标 / 13px 细字），否则这一行会被撑开截断。
		 * 状态表达刻意做成"图标 + 极短文字"：
		 *   开启 → 绿色图标 + 深色（primary 实心）底 + 单字「常」
		 *   关闭 → 默认图标色 + 无底色 + 无文字
		 * 只放一个字是为了在任何窄屏都不被裁剪；状态主要靠颜色与底色传达。
		 */
		function ScreenSaverDock(props) {
			const t = props.t;
			const status = react.useSyncExternalStore(subscribeStatus, getStatusSnapshot);
			react.useEffect(() => {
				tryRestoreOnce();
			}, []);
			const on = status.on;
			const toggle = () => {
				void setIntent(!on);
			};
			return react_jsx_runtime.jsxs("span", {
				className: "ssDock",
				"data-dsh-screen-saver": on ? "dock-on" : "dock",
				children: [
					react_jsx_runtime.jsxs("button", {
						type: "button",
						className: on ? "ssDockPill on" : "ssDockPill",
						"aria-pressed": on,
						"aria-label": on ? t("dock.onAria") : t("dock.offAria"),
						title: on ? t("dock.onTip") : t("dock.offTip"),
						onClick: toggle,
						children: [
							react_jsx_runtime.jsx(_deepseek_ai_dsh_client_ui_primitives.IconLightOutlineRegular, { size: 14 }),
							on ? react_jsx_runtime.jsx("span", { className: "ssDockLabel", children: t("dock.on") }) : null
						]
					}),
					status.pending ? react_jsx_runtime.jsx("span", { className: "ssDockPending", children: t("status.pending") }) : null
				]
			});
		}

		/** 注入样式；配色全走设计 token，随主题变化。 */
		const css = ".ssPane{display:flex;flex-direction:column;width:100%}.ssCard{display:flex;align-items:flex-start;gap:14px;box-sizing:border-box;padding:16px;border-radius:var(--dsw-radius-lg);background:var(--dsw-alias-bg-layer-1);border:.5px solid var(--dsw-alias-border-l2)}.ssIconBox{flex:none;display:flex;align-items:center;justify-content:center;width:36px;height:36px;border-radius:var(--dsw-radius-md);color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-bg-layer-2)}.ssIconBox.on{color:var(--dsw-alias-state-success-primary,var(--dsw-alias-label-primary))}.ssBody{flex:1;min-width:0;padding-top:1px}.ssTitleRow{display:flex;align-items:center;gap:8px}.ssTitle{color:var(--dsw-alias-label-primary);font-size:14px;line-height:22px}.ssState{flex:none;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:22px}.ssState.on{color:var(--dsw-alias-state-success-primary,var(--dsw-alias-label-primary))}.ssDesc{color:var(--dsw-alias-label-secondary);margin-top:4px;font-size:12px;line-height:18px}.ssControl{flex:none;display:flex;align-items:center;padding-top:1px}.ssHint{color:var(--dsw-alias-label-tertiary);margin-top:12px;font-size:12px;line-height:18px}.ssError{color:var(--dsw-alias-label-error,var(--dsw-alias-label-primary));margin-top:12px;font-size:12px;line-height:18px}.ssDock{display:inline-flex;align-items:center;gap:6px;flex:none;font-size:calc(var(--dsh-content-font-size-secondary,13px) - 1px);line-height:calc(20px + var(--dsh-content-font-delta-secondary,0px))}.ssDockPill{box-sizing:border-box;display:inline-flex;align-items:center;justify-content:center;gap:3px;flex:none;padding:1px 8px;border:0;border-radius:var(--dsw-radius-sm);background:none;background-color:transparent;box-shadow:none;outline:none;appearance:none;-webkit-appearance:none;-webkit-tap-highlight-color:transparent;color:var(--dsw-alias-label-tertiary);font:inherit;line-height:inherit;white-space:nowrap;cursor:pointer}.ssDockPill svg{flex:none;width:14px;height:14px}.ssDockPill:hover{color:var(--dsw-alias-label-secondary)}.ssDockPill:focus-visible{outline:2px solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:1px}.ssDockPill.on{background:var(--dsw-alias-button-primary-fill);color:var(--dsw-alias-state-success-primary,#3ccf7f)}.ssDockPill.on svg{color:var(--dsw-alias-state-success-primary,#3ccf7f)}.ssDockPill.on:focus-visible{outline:2px solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:1px}.ssDockPill.on:hover{background:var(--dsw-alias-button-primary-hover)}.ssDockPill.on:hover svg{color:var(--dsw-alias-state-success-primary,#3ccf7f)}.ssDockLabel{flex:none;min-width:1em;text-align:center;white-space:nowrap}.ssDockPending{color:var(--dsw-alias-label-tertiary);font-size:inherit;line-height:inherit;white-space:nowrap}";

		const tagId = "dsh-screen-saver/ScreenSaverSection.module.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId) + "]") === null) {
			const tag = document.createElement("style");
			// data-plugin 必须是本插件包名：dsh-client-modules 的 removeOwnedStyles(id)
			// 按 `style[data-plugin=<模块 id>]` 精确摘除，写错就会漏摘。
			tag.dataset.plugin = "dsh-screen-saver";
			tag.dataset.pluginCss = tagId;
			tag.textContent = css;
			document.head.appendChild(tag);
		}

		const inject = ["slots", "locale"];

		function apply(ctx) {
			// `t` 必须在这里取：settings.section 的 label thunk 由设置面板以
			// 无参形式调用（resolveSlotLabel: typeof f === "function" ? f() : f），
			// 不能依赖组件作用域里的任何东西。
			const t = ctx.locale.bind(NS);

			// label thunk 在**设置导航渲染路径**上被调用；它一旦抛错，整个设置面板
			// 会白屏（本插件上一次事故就是这个形态）。这里兜底成纯字符串，
			// 任何异常都不许逃逸出渲染路径。
			const navLabel = () => {
				try {
					return t("nav");
				} catch {
					return "屏幕常亮";
				}
			};

			try {
				ctx.effect(() => ctx.locale.register(NS, { zh, en }), "dsh-screen-saver: dictionaries");
			} catch (error) {
				console.error("dsh-screen-saver: dictionary registration failed", error);
			}

			try {
				ctx.effect(() => installVisibilityHandler(), "dsh-screen-saver: visibility handler");
			} catch (error) {
				console.error("dsh-screen-saver: visibility handler install failed", error);
			}

			// 独立设置分区：id 必须与导航项一致，面板按 id 过滤（opts.only）。
			try {
				ctx.effect(() => ctx.slots.inject("settings.section", () => ctx.slots.register({
					name: "settings.section",
					id: "screen-saver",
					order: 40,
					label: navLabel,
					locale: NS
				}, ScreenSaverSection)), "dsh-screen-saver: settings.section");
			} catch (error) {
				console.error("dsh-screen-saver: settings.section registration failed", error);
			}

			// 会话前台入口（验证通过后再打开 ENABLE_DOCK）。
			if (ENABLE_DOCK) {
				try {
					ctx.effect(() => ctx.slots.inject("conversation.composer.dock", () => ctx.slots.register({
						name: "conversation.composer.dock",
						id: "screen-saver-dock",
						order: 3,
						label: navLabel,
						locale: NS
					}, ScreenSaverDock)), "dsh-screen-saver: composer.dock");
				} catch (error) {
					console.error("dsh-screen-saver: composer.dock registration failed", error);
				}
			}
		}

		exports.apply = apply;
		exports.inject = inject;
		exports.name = "dsh-screen-saver";
		return module.exports;
	},
});
