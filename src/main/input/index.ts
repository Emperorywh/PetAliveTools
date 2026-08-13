/**
 * 交互模块 (input) — 主进程端
 *
 * 负责：鼠标交互处理器（穿透/交互切换 + 抢占 + 拖拽 + IPC）、右键上下文菜单。
 * 参见 SPEC §6.1 (命中盒与穿透切换)、§10 (交互层)。
 *
 * 纯交互逻辑（命中盒检测、交互状态机）见 src/shared/input。
 * 渲染进程端交互处理见 src/renderer/input。
 *
 * 运行于主进程。
 */

export { showContextMenu } from './context-menu'
export type { ContextMenuCallbacks } from './context-menu'

export { MouseHandler } from './mouse-handler'
export type { MouseHandlerCallbacks } from './mouse-handler'
