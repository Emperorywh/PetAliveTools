/**
 * 拖拽机制 (§7.3)
 *
 * 拾取 → 跟随光标 → 松手 → 停在松手位置。
 *
 * - 拖拽中：窗口跟随光标（保持拾取时的抓取偏移，宠物"挂"在光标上）。
 * - 松手：窗口停留在松手位置，x/y 钳制到工作区可见范围，
 *   宠物可被自由摆放。
 *
 * 鼠标事件与命中盒由交互层驱动；本模块只提供显式状态
 * 转移与位置计算的纯逻辑。
 *
 * 纯计算，无平台依赖。
 */

import { type WorkAreaBounds, clampWindowX, clampWindowY } from './ground-line'

/** 拖拽阶段 */
export type DragPhase = 'idle' | 'dragging'

/** 屏幕坐标点（DIP，与 workArea 同坐标系） */
export interface ScreenPoint {
  readonly x: number
  readonly y: number
}

/** 拖拽机制的窗口几何输入 */
export interface DragGeometry {
  /** 窗口宽度（像素） */
  readonly windowWidth: number
  /** 窗口高度（像素） */
  readonly windowHeight: number
}

/** 拖拽状态（显式状态机，转移函数返回新状态） */
export interface DragState {
  readonly phase: DragPhase
  /** 当前窗口位置（DIP） */
  readonly windowPos: ScreenPoint
  /** 拾取时的抓取偏移：窗口原点相对光标的偏移（dragging 期有效） */
  readonly grabOffset: ScreenPoint | null
}

/** 初始状态：窗口位于给定位置 */
export function createDragState(windowPos: ScreenPoint): DragState {
  return { phase: 'idle', windowPos, grabOffset: null }
}

/**
 * 拾取：记录抓取偏移，进入拖拽。
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
    }
  }
}

/**
 * 拖拽跟随：窗口 = 光标 + 抓取偏移（宠物跟随光标）。
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
 * 松手：窗口停留在松手位置，x/y 钳制到工作区可见范围，
 * 恢复 idle。
 *
 * @param bounds 工作区边界
 * @param geometry 窗口几何
 */
export function releaseDrag(
  state: DragState,
  bounds: WorkAreaBounds,
  geometry: DragGeometry
): DragState {
  if (state.phase !== 'dragging') {
    throw new Error(`releaseDrag requires phase 'dragging' (got '${state.phase}')`)
  }

  // 窗口 x/y 钳制到工作区可见范围（保证宠物留在屏内）
  const x = clampWindowX(bounds, state.windowPos.x, geometry.windowWidth)
  const y = clampWindowY(bounds, state.windowPos.y, geometry.windowHeight)

  return { phase: 'idle', windowPos: { x, y }, grabOffset: null }
}

/** 是否已回到静止（idle） */
export function isDragSettled(state: DragState): boolean {
  return state.phase === 'idle'
}
