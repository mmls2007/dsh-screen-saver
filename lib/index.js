/**
 * 屏幕常亮开关插件（Host 半边）。
 *
 * 本插件是纯客户端插件：所有逻辑都在浏览器半边（lib/client.js）。
 * Host 半边只是一个空 apply，让本包出现在宿主 cordis Loader 里，
 * 浏览器半边通过 package.json 的 dsh.client + exports["./client"] 被发现。
 *
 * 为什么不用宿主做任何事：
 *  - ArkTS 桥 __DSHM_BRIDGES__ 没有 keepScreenOn 类方法（真机 modules.abc 证据）；
 *  - 应用权限清单没有 KEEP_SCREEN_ON 类权限；
 *  - 正确入口是 ArkWeb 的 Screen Wake Lock API（libarkweb_engine.so 内有完整的
 *    blink::WakeLockService / device.mojom.WakeLockProvider / screen-wake-lock
 *    权限名 / WakeLockSentinel 等符号），是浏览器自己的能力，宿主无需参与。
 *
 * 纪律：不改上游、不新增权限、不碰文件系统、不阻断启动（apply 同步空体）。
 */

const name = "dsh-screen-saver";

function apply() {}

export { apply, name };
