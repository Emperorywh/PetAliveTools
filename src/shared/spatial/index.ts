/**
 * 窗口空间模块。
 *
 * 初始贴底、可见区域约束、用户主动拖拽与行走片段期间的墙钟恒速位移；
 * 位移不读取视频时间，也不根据视频内容计算尺度或方向。
 */

export type { Rect, WorkAreaBounds } from './ground-line'
export { computeGroundLine, groundedWindowY, clampWindowX, clampWindowY } from './ground-line'

export type { DragPhase, ScreenPoint, DragGeometry, DragState, SpriteBounds } from './drag'
export {
  createDragState,
  pickupDrag,
  dragFollow,
  releaseDrag,
  isDragSettled
} from './drag'

export type { WalkDirection, WalkMotion } from './walk-motion'
export {
  createWalkMotion,
  walkXAt,
  hasReachedWalkBound,
  DEFAULT_WALK_VELOCITY_PX_PER_SEC
} from './walk-motion'

export type { MenuPositionInput } from './menu-position'
export { clampMenuPosition } from './menu-position'
