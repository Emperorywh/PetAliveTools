/**
 * 拖拽机制 (§7.5)
 *
 * 拾取 → 跟随光标 → 松手 → 回到地面线。
 *
 * - 拖拽中：窗口跟随光标（保持拾取时的抓取偏移，宠物"挂"在光标上）。
 * - 松手：x 保持在松手位置（钳制到工作区可见范围），y 回落到地面线
 *   （"落回"片段的播放由调度层决定，§7.5；空间层负责位置）。
 * - 回落期：窗口 y 以恒定速度落向地面线，落地后恢复行走/静止。
 *
 * 鼠标事件与命中盒由交互层（TASK-012）驱动；本模块只提供显式状态
 * 转移与位置计算的纯逻辑。
 *
 * 纯计算，无平台依赖。
 */

import { type WorkAreaBounds, clampWindowX, groundedWindowY } from './ground-line'

/** 拖拽阶段 */
export type DragPhase = 'idle' | 'dragging' | 'returning'

/** 屏幕坐标点（DIP，与 workArea 同坐标系） */
export interface ScreenPoint {
  readonly x: number
  readonly y: number
}

/** 拖拽机制的窗口几何输入 */
export interface DragGeometry {
  /** 窗口宽度（像素） */
  readonly windowWidth: number
  /** 精灵锚点（足部）在窗口内的 y（像素，§6.2） */
  readonly spriteBaseY: number
}

/** 回落默认速度（像素/秒） */
export const DEFAULT_RETURN_SPEED_PX_PER_SEC = 900

/** 拖拽状态（显式状态机，转移函数返回新状态） */
export interface DragState {
  readonly phase: DragPhase
  /** 当前窗口位置（DIP） */
  readonly windowPos: ScreenPoint
  /** 拾取时的抓取偏移：窗口原点相对光标的偏移（dragging 期有效） */
  readonly grabOffset: ScreenPoint | null
  /** 回落起点 y（returning 期有效） */
  readonly returnFromY: number | null
}

/** 初始状态：窗口位于给定位置、位于地面线上 */
export function createDragState(windowPos: ScreenPoint): DragState {
  return { phase: 'idle', windowPos, grabOffset: null, returnFromY: null }
}

/**
 * 拾取 (§7.5)：记录抓取偏移，进入拖拽。
 *
 * @param cursor 拾取时的光标屏幕坐标
 */
export function pickupDrag(state: DragState, cursor: ScreenPoint): DragState {
  if (!Number.isFinite(cursor.x) || !Number.isFinite(cursor.y)) {
    throw new Error(`invalid cursor: ${cursor.x}, ${cursor.y}`)
  }
  return {
    phase: 'dragging',
    windowPos: state.windowPos,
    grabOffset: {
      x: state.windowPos.x - cursor.x,
      y: state.windowPos.y - cursor.y
    },
    returnFromY: null
  }
}

/**
 * 拖拽跟随 (§7.5)：窗口 = 光标 + 抓取偏移（宠物跟随光标）。
 */
export function dragFollow(state: DragState, cursor: ScreenPoint): DragState {
  if (state.phase !== 'dragging' || state.grabOffset === null) {
    throw new Error(`dragFollow requires phase 'dragging' (got '${state.phase}')`)
  }
  return {
    ...state,
    windowPos: {
      x: cursor.x + state.grabOffset.x,
      y: cursor.y + state.grabOffset.y
    }
  }
}

/**
 * 松手 (§7.5)：x 钳制到工作区可见范围并保持，y 进入回落期。
 *
 * 落点 x 以宠物锚点为准（窗口原点换算），保证宠物身体留在屏内。
 *
 * @param bounds 工作区边界
 * @param geometry 窗口几何
 * @param spriteBaseX 精灵锚点（足部）在窗口内的 x
 */
export function releaseDrag(
  state: DragState,
  bounds: WorkAreaBounds,
  geometry: DragGeometry
): DragState {
  if (state.phase !== 'dragging') {
    throw new Error(`releaseDrag requires phase 'dragging' (got '${state.phase}')`)
  }

  // 窗口 x 钳制到工作区可见范围（保证宠物身体留在屏内）
  const clampedWindowX = clampWindowX(bounds, state.windowPos.x, geometry.windowWidth)
  const visibleX = clampWindowX(bounds, clampedWindowX, geometry.windowWidth)

  return {
    phase: 'returning',
    windowPos: { x: visibleX, y: state.windowPos.y },
    grabOffset: null,
    returnFromY: state.windowPos.y
  }
}

/**
 * 回落推进 (§7.5)：y 向地面线以恒定速度回落，x 保持不变。
 *
 * 松手位置本就在地面线（y 距地面线 < 1px）时直接落地，不经过
 * returning 阶段。
 *
 * @param dtSec 距上一步的时长（秒）
 * @param speedPxPerSec 回落速度（默认 900 px/s）
 */
export function stepReturn(
  state: DragState,
  bounds: WorkAreaBounds,
  geometry: DragGeometry,
  dtSec: number,
  speedPxPerSec: number = DEFAULT_RETURN_SPEED_PX_PER_SEC
): DragState {
  if (state.phase !== 'returning') {
    throw new Error(`stepReturn requires phase 'returning' (got '${state.phase}')`)
  }
  if (!Number.isFinite(dtSec) || dtSec < 0) {
    throw new Error(`invalid dtSec: ${dtSec}`)
  }

  const groundY = groundedWindowY(bounds.groundLine, geometry.spriteBaseY)
  const fromY = state.returnFromY ?? state.windowPos.y
  const distance = groundY - state.windowPos.y
  const step = speedPxPerSec * dtSec

  // 已落到地面线（或越过）：落地，恢复 idle
  if (distance <= step || distance <= 0) {
    return { phase: 'idle', windowPos: { x: state.windowPos.x, y: groundY }, grabOffset: null, returnFromY: null }
  }

  return {
    ...state,
    returnFromY: fromY,
    windowPos: { x: state.windowPos.x, y: state.windowPos.y + step }
  }
}

/** 是否已回到静止（idle） */
export function isDragSettled(state: DragState): boolean {
  return state.phase === 'idle'
}
