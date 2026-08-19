/**
 * 拖拽机制 (§7.3)
 *
 * 拾取 → 跟随光标 → 松手 → 停在松手位置。
 *
 * - 拖拽中：窗口跟随光标（保持拾取时的抓取偏移，宠物"挂"在光标上）。
 * - 松手：x 按精灵可见范围钳制到工作区（窗口可越出屏幕边缘，
 *   只要宠物本体留在屏内）；y 直接落回地面线 (§7.1)，
 *   与行走/启动的口径一致。
 *
 * 鼠标事件与命中盒由交互层驱动；本模块只提供显式状态
 * 转移与位置计算的纯逻辑。
 *
 * 纯计算，无平台依赖。
 */

import { type WorkAreaBounds } from './ground-line'

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

/**
 * 精灵可见包围盒（窗口局部像素，由当前片段命中盒推导）。
 * 拖拽放置的钳制口径：窗口是固定 400×400 的透明容器，
 * 精灵只占其中一部分，按窗口矩形钳制会让宠物永远贴不到屏幕边缘。
 */
export interface SpriteBounds {
  /** 精灵左上角在窗口内的 x */
  readonly x: number
  /** 精灵左上角在窗口内的 y */
  readonly y: number
  /** 精灵宽度（像素） */
  readonly width: number
  /** 精灵高度（像素） */
  readonly height: number
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
 * 松手：窗口停留在松手位置，恢复 idle。
 *
 * x 按精灵可见范围钳制到工作区（窗口可越出屏幕边缘）；
 * y 落回地面线，使精灵足部贴合 (§7.1，与行走/启动口径一致)。
 *
 * @param bounds 工作区边界
 * @param sprite 精灵可见包围盒（窗口局部像素）
 */
export function releaseDrag(
  state: DragState,
  bounds: WorkAreaBounds,
  sprite: SpriteBounds
): DragState {
  if (state.phase !== 'dragging') {
    throw new Error(`releaseDrag requires phase 'dragging' (got '${state.phase}')`)
  }
  for (const [field, value] of Object.entries(sprite)) {
    if (!Number.isFinite(value)) {
      throw new Error(`invalid sprite ${field}: ${value}`)
    }
  }
  if (sprite.width <= 0 || sprite.height <= 0) {
    throw new Error(`invalid sprite size: ${sprite.width}x${sprite.height}`)
  }

  // 精灵留在工作区内，窗口透明区域允许越出屏幕边缘
  const minX = bounds.x - sprite.x
  const maxX = bounds.x + bounds.width - (sprite.x + sprite.width)
  const x = maxX <= minX ? minX : Math.min(Math.max(state.windowPos.x, minX), maxX)

  // 足部（精灵底边）贴合地面线
  const y = bounds.groundLine - (sprite.y + sprite.height)

  return { phase: 'idle', windowPos: { x, y }, grabOffset: null }
}

/** 是否已回到静止（idle） */
export function isDragSettled(state: DragState): boolean {
  return state.phase === 'idle'
}
