/**
 * 交互模块 (input) — 渲染进程端
 *
 * 负责：渲染进程鼠标事件处理，驱动交互状态机，通过 IPC 将动作
 * 路由到主进程执行（穿透/交互切换、抢占、拖拽、右键菜单）。
 * 参见 SPEC §6.1 (命中盒与穿透切换)、§10 (交互层)。
 *
 * 纯交互逻辑（命中盒检测、交互状态机）见 src/shared/input。
 * 主进程端交互处理见 src/main/input。
 *
 * 运行于渲染进程。
 */

export { InteractionHandler } from './interaction'
export type { InteractionHandlerConfig } from './interaction'
