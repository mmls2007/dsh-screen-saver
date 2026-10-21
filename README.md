# dsh-screen-saver

[English](README.en.md) | 简体中文

给 [DeepSeek Harness](https://github.com/deepseek-ai)（DSH / DSHM）用的**屏幕常亮**插件：在设置页提供一个独立分区，会话输入框上方 dock 提供一个快捷胶囊，一键让屏幕保持常亮。

基于 Web 标准 [Screen Wake Lock API](https://w3c.github.io/screen-wake-lock/)（`navigator.wakeLock`），不需要任何原生代码、不申请系统权限、不改动上游。

## 功能

- **独立设置分区**：设置 → 左侧导航「屏幕常亮」，一个开关卡片，显示当前状态与错误原因。
- **会话前台入口**：输入框上方 dock 的紧凑胶囊，随手开关：
  - 关闭：仅灰色灯泡图标，无底色；
  - 开启：绿色图标 + 深色底 + 绿色「常」字。
- **自动续期**：切到后台系统会收回锁，回到前台自动重新申请（`visibilitychange` / `pageshow` / `focus` 三重触发，且强制换新锁）。
- **状态持久化**：开关意图存 `localStorage`，重载或重进应用后自动恢复。
- **中英双语**：跟随宿主当前语言。

## 已知边界（重要，如实说明）

**只在页面可见时生效。** Wake Lock 是浏览器能力，页面被切到后台、锁屏或应用退出时，系统一定会收回；本插件会在回到前台时自动重新申请。**它无法在应用处于后台时保持屏幕常亮**——那需要系统级长任务 API，而 DSHM 的 ArkTS 桥当前没有暴露这类能力，应用也未申请相关权限。

其他限制：

- 需要宿主运行在支持 Screen Wake Lock 的 WebView 上（本项目在 HarmonyOS ArkWeb 7.0 上验证通过）。不支持时会给出明确提示而不是静默失败。
- 系统省电策略、低电量模式可能拒绝供锁，此时分区内会显示具体原因。

## 安装

### 方式一：插件页安装（推荐）

在 DSHM 的 **设置 → 插件 → 安装插件** 里填入：

```
github.com/<你的用户名>/dsh-screen-saver
```

安装完成后**重启 DSHM 应用**（宿主只在启动时合成插件行），即可在设置页左侧看到「屏幕常亮」。

### 方式二：手动放置

把本仓库内容放到 profile 的 `node_modules/dsh-screen-saver/` 下：

```
<DSH_HOME>/profiles/<profile>/node_modules/dsh-screen-saver/
├── package.json
├── cordis.patch.yml
├── lib/index.js
├── lib/client.js
└── locale/{zh,en}.json
```

然后在该 profile 的 `package.json` 里加入依赖与 bundle：

```json
{
  "dependencies": { "dsh-screen-saver": "1.0.0" },
  "dsh": { "profile": { "bundles": ["…", "dsh-screen-saver"] } }
}
```

重启应用后生效。

## 结构

本包是标准的 DSH 双半身插件：

| 文件 | 作用 |
| --- | --- |
| `lib/index.js` | Host 半边。空 `apply()`——本插件所有逻辑都在浏览器侧，Host 只需存在以让包进入 cordis Loader。 |
| `lib/client.js` | 浏览器半边。注册 `settings.section` 与 `conversation.composer.dock` 两个槽位，自己持有 wake lock 状态源。 |
| `cordis.patch.yml` | bundle 层，一行 `insert` 把插件挂进 profile。 |
| `locale/*.json` | 分区名的中英文案（界面文案内联在 `client.js`）。 |

`dsh.client` 声明：

```json
{
  "platform": "web",
  "immediately": true,
  "inject": ["@deepseek-ai/dsh-client-ui-slots", "@deepseek-ai/dsh-client-locale"]
}
```

## 实现要点

- **状态源必须返回引用稳定的快照。** `getSnapshot()` 按 `revision` 缓存一个对象，否则 `useSyncExternalStore` 会判定快照反复变化而无限重渲染。
- **`label` 必须是能在无参调用下安全求值的函数。** 设置导航通过 `resolveSlotLabel` 以 `f()` 形式取文本，它一旦抛错会让整个设置面板白屏。这里的实现包了 try/catch 兜底。
- **回前台要强制换锁，而不是「没锁才申请」。** WebView 被系统挂起后，旧 sentinel 常常既不置 `released` 也不回调 `release`，`get()` 会一直返回 `true`，导致「按意图补申请」被误判成已持有而跳过。
- **关闭态不能有 hover 底色。** 移动端 `:hover` 会粘住（sticky hover），触摸后残留浅色块看起来像偶发轮廓；改用 `:focus-visible` 提供键盘焦点环。

## License

MIT
