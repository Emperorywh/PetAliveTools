/**
 * 窗口空间模块。
 *
 * 只保留初始贴底、可见区域约束与用户主动拖拽；视频播放不会再驱动
 * 窗口移动，也不会根据视频内容计算尺度或方向。
 */

export type { Rect, WorkAreaBounds } from './ground-line'
export { computeGroundLine, groundedWindowY, clampWindowX, clampWindowY } from './ground-line'

export type { DragPhase, ScreenPoint, DragGeometry, DragState } from './drag'
export {
  createDragState,
  pickupDrag,
  dragFollow,
  releaseDrag,
  isDragSettled
} from './drag'
