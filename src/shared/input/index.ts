/**
 * 交互输入模块 (input) — 跨进程共享纯逻辑
 *
 * 负责：命中盒检测与缓冲带 (§6.1)、交互状态机 (§10 抚摸/点击/拖拽)。
 * 平台胶水（Electron 鼠标事件、IPC、窗口操作）见 src/main/input。
 *
 * 参见 SPEC §6.1 (命中盒与穿透切换)、§10 (交互层)。
 */

export type { PixelRect } from './hitbox'
export {
  BUFFER_PX_MIN,
  BUFFER_PX_MAX,
  DEFAULT_BUFFER_PX,
  clampBufferPx,
  hitboxToPixels,
  expandRect,
  isPointInRect,
  isPointInHitbox,
  isPointInBufferZone,
  isPointInBufferOnly,
} from './hitbox'

export type {
  InteractionType,
  InteractionPhase,
  MouseInputEvent,
  InteractionAction,
  InteractionResult,
  InteractionState,
  InteractionContext,
} from './interaction-state'
export {
  DEFAULT_PETTING_MOVE_THRESHOLD,
  DEFAULT_DRAG_MOVE_THRESHOLD,
  createInteractionState,
  createInteractionContext,
  processInput,
} from './interaction-state'
