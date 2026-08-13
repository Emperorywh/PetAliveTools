/**
 * 空间运动模块 (spatial) — 底部地面条带
 *
 * 负责：地面线计算（workArea 底边）、行走位移曲线驱动窗口平移（脚爪不滑步）、
 * 尺度归一化、边缘转身、拖拽跟随。
 * 参见 SPEC §7 (空间与运动层)。
 *
 * 跨进程共享模块。
 */

export type { Rect, WorkAreaBounds } from './ground-line'
export { computeGroundLine, groundedWindowY, clampWindowX } from './ground-line'

export type {
  WalkWindowMapping
} from './walk-mapping'
export {
  sampleDisplacementAt,
  computeWalkScale,
  walkDisplacementPx,
  walkDisplacementScreenPx,
  walkWindowX,
  walkScreenSpan
} from './walk-mapping'

export type { WalkDirection, EdgeSide, DirectionResolution, EdgeTurnPlan } from './edge-turning'
export {
  DEFAULT_EDGE_MARGIN_PX,
  oppositeDirection,
  detectEdgeSide,
  directionAfterEdge,
  resolveDirectedClip,
  planEdgeTurn
} from './edge-turning'

export type { ScaleNormalizationInput } from './scale'
export {
  SHOULDER_HEIGHT_FACTOR,
  DEFAULT_SCREEN_PERCENT,
  computeNormalizedScale,
  displayedClipHeightPx
} from './scale'

export type { DragPhase, ScreenPoint, DragGeometry, DragState } from './drag'
export {
  DEFAULT_RETURN_SPEED_PX_PER_SEC,
  createDragState,
  pickupDrag,
  dragFollow,
  releaseDrag,
  stepReturn,
  isDragSettled
} from './drag'
