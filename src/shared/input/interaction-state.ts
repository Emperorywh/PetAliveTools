/**
 * 交互状态机 (§10 交互层)
 *
 * 管理鼠标交互的检测与输出：
 *   - 点击/双击：不再触发任何抢占，仅结束按压
 *   - 拖拽：按住身体拖动 → 窗口跟随光标 (§7.5)
 *   - 模式切换：光标进入/离开缓冲带 → 切换 setIgnoreMouseEvents (§6.1)
 *
 * 交互不切换视频片段：悬停、点击、拖拽都不抢占调度器，
 * 调度器按自身节律继续播放行为片段。
 *
 * 纯状态机：输入 = 鼠标事件 + 上下文（命中盒/缓冲带/阈值），
 * 输出 = 动作列表（进入交互态/退出交互态/拖拽位移/拖拽结束）。
 * 调用方（渲染进程）负责将动作通过 IPC 路由到主进程。
 *
 * 纯计算，无平台依赖。
 */

import type { PixelRect } from './hitbox'
import { isPointInHitbox, isPointInBufferZone } from './hitbox'

// —— 状态机阶段 —— //

/**
 * 交互阶段：
 * - idle：光标在缓冲带外，窗口穿透态
 * - hover：光标在缓冲带内，窗口交互态，等待按下
 * - pressing：鼠标按下命中盒，判定点击 vs 拖拽
 * - dragging：拖拽进行中，窗口跟随光标
 */
export type InteractionPhase = 'idle' | 'hover' | 'pressing' | 'dragging'

// —— 输入事件 —— //

/** 鼠标输入事件 */
export type MouseInputEvent =
  | { readonly type: 'move'; readonly x: number; readonly y: number }
  | { readonly type: 'down'; readonly x: number; readonly y: number }
  | { readonly type: 'up'; readonly x: number; readonly y: number }

// —— 输出动作 —— //

/** 交互动作（调用方需执行） */
export type InteractionAction =
  | { readonly kind: 'enter_interactive' }
  | { readonly kind: 'exit_interactive' }
  | { readonly kind: 'drag_move'; readonly x: number; readonly y: number }
  | { readonly kind: 'drag_end' }

/** 处理结果 */
export interface InteractionResult {
  readonly state: InteractionState
  readonly actions: readonly InteractionAction[]
}

// —— 状态 —— //

/** 交互状态机状态 */
export interface InteractionState {
  /** 当前阶段 */
  readonly phase: InteractionPhase
  /** 光标 x（窗口局部坐标） */
  readonly cursorX: number
  /** 光标 y（窗口局部坐标） */
  readonly cursorY: number
  /** 鼠标按下位置 x（用于拖拽/点击区分） */
  readonly pressX: number | null
  /** 鼠标按下位置 y（用于拖拽/点击区分） */
  readonly pressY: number | null
}

// —— 上下文 —— //

/** 交互处理上下文（外部状态，不属于状态机） */
export interface InteractionContext {
  /** 命中盒像素坐标（窗口局部） */
  readonly hitboxPx: PixelRect
  /** 缓冲带像素 (§6.1: 8–12px) */
  readonly bufferPx: number
  /** 拖拽触发移动阈值（距按下点的像素） */
  readonly dragMoveThreshold: number
}

/** 默认阈值 */
export const DEFAULT_DRAG_MOVE_THRESHOLD = 5

// —— 工厂 —— //

/** 创建初始 idle 状态 */
export function createInteractionState(): InteractionState {
  return {
    phase: 'idle',
    cursorX: 0,
    cursorY: 0,
    pressX: null,
    pressY: null,
  }
}

/**
 * 创建默认上下文。
 *
 * 未提供（undefined）的字段回落到默认值：可选配置经对象展开合并时，
 * 显式 undefined 会覆盖默认值，导致 `dist >= undefined` 恒为 false、
 * 拖拽永不触发，因此这里逐字段取值。
 */
export function createInteractionContext(
  hitboxPx: PixelRect,
  overrides?: Partial<Omit<InteractionContext, 'hitboxPx'>>,
): InteractionContext {
  return {
    hitboxPx,
    bufferPx: overrides?.bufferPx ?? 10,
    dragMoveThreshold: overrides?.dragMoveThreshold ?? DEFAULT_DRAG_MOVE_THRESHOLD,
  }
}

// —— 辅助函数 —— //

/** 欧氏距离 */
function distance(x1: number, y1: number, x2: number, y2: number): number {
  return Math.hypot(x2 - x1, y2 - y1)
}

// —— 核心：处理输入事件 —— //

/**
 * 处理一个鼠标输入事件，返回新状态与需执行的动作列表。
 *
 * 事件流：
 *   - idle 阶段仅收到 move（穿透模式下只有 mousemove 被转发，§6.1）
 *   - 交互态下收到 move / down / up（setIgnoreMouseEvents(false) 后正常事件）
 */
export function processInput(
  state: InteractionState,
  event: MouseInputEvent,
  ctx: InteractionContext,
): InteractionResult {
  switch (state.phase) {
    case 'idle':
      return handleIdle(state, event, ctx)
    case 'hover':
      return handleHover(state, event, ctx)
    case 'pressing':
      return handlePressing(state, event, ctx)
    case 'dragging':
      return handleDragging(state, event, ctx)
  }
}

// —— idle 阶段 —— //

function handleIdle(
  state: InteractionState,
  event: MouseInputEvent,
  ctx: InteractionContext,
): InteractionResult {
  if (event.type !== 'move') {
    // 穿透模式下不应收到 down/up；忽略
    return { state, actions: [] }
  }

  const inBuffer = isPointInBufferZone(event.x, event.y, ctx.hitboxPx, ctx.bufferPx)

  if (inBuffer) {
    // 光标进入缓冲带 → 切换为交互态 (§6.1)
    const newState: InteractionState = {
      ...state,
      phase: 'hover',
      cursorX: event.x,
      cursorY: event.y,
    }
    return { state: newState, actions: [{ kind: 'enter_interactive' }] }
  }

  // 仍在缓冲带外，保持穿透
  return {
    state: { ...state, cursorX: event.x, cursorY: event.y },
    actions: [],
  }
}

// —— hover 阶段 —— //

function handleHover(
  state: InteractionState,
  event: MouseInputEvent,
  ctx: InteractionContext,
): InteractionResult {
  if (event.type === 'move') {
    return handleHoverMove(state, event, ctx)
  }
  if (event.type === 'down') {
    return handleHoverDown(state, event, ctx)
  }
  // up 在 hover 阶段忽略
  return { state, actions: [] }
}

function handleHoverMove(
  state: InteractionState,
  event: MouseInputEvent,
  ctx: InteractionContext,
): InteractionResult {
  const inBuffer = isPointInBufferZone(event.x, event.y, ctx.hitboxPx, ctx.bufferPx)

  if (!inBuffer) {
    // 光标离开缓冲带 → 切换回穿透态 (§6.1)
    const newState: InteractionState = {
      ...state,
      phase: 'idle',
      cursorX: event.x,
      cursorY: event.y,
    }
    return { state: newState, actions: [{ kind: 'exit_interactive' }] }
  }

  // 缓冲带内（含命中盒）移动：只追踪光标，悬停不抢占、不切换片段
  return {
    state: { ...state, cursorX: event.x, cursorY: event.y },
    actions: [],
  }
}

function handleHoverDown(
  state: InteractionState,
  event: MouseInputEvent,
  ctx: InteractionContext,
): InteractionResult {
  const inHitbox = isPointInHitbox(event.x, event.y, ctx.hitboxPx)
  if (!inHitbox) {
    // 在缓冲带但不在命中盒：忽略按下
    return { state, actions: [] }
  }

  // 鼠标按下命中盒 → 进入 pressing 阶段，判定点击 vs 拖拽
  const newState: InteractionState = {
    ...state,
    phase: 'pressing',
    cursorX: event.x,
    cursorY: event.y,
    pressX: event.x,
    pressY: event.y,
  }
  return { state: newState, actions: [] }
}

// —— pressing 阶段 —— //

function handlePressing(
  state: InteractionState,
  event: MouseInputEvent,
  ctx: InteractionContext,
): InteractionResult {
  if (event.type === 'move') {
    return handlePressingMove(state, event, ctx)
  }
  if (event.type === 'up') {
    return handlePressingUp(state, event)
  }
  // down 在 pressing 阶段忽略
  return { state, actions: [] }
}

function handlePressingMove(
  state: InteractionState,
  event: MouseInputEvent,
  ctx: InteractionContext,
): InteractionResult {
  // 检查是否离开缓冲带（取消按下）
  const inBuffer = isPointInBufferZone(event.x, event.y, ctx.hitboxPx, ctx.bufferPx)
  if (!inBuffer) {
    // 离开缓冲带：取消
    const newState: InteractionState = {
      ...state,
      phase: 'idle',
      cursorX: event.x,
      cursorY: event.y,
      pressX: null,
      pressY: null,
    }
    return { state: newState, actions: [{ kind: 'exit_interactive' }] }
  }

  // 检查拖拽阈值 (§7.5)
  const dx = state.pressX ?? event.x
  const dy = state.pressY ?? event.y
  const dist = distance(dx, dy, event.x, event.y)

  if (dist >= ctx.dragMoveThreshold) {
    // 拖拽触发 (§7.5)：窗口跟随光标，不抢占片段
    const newState: InteractionState = {
      ...state,
      phase: 'dragging',
      cursorX: event.x,
      cursorY: event.y,
    }
    return {
      state: newState,
      actions: [{ kind: 'drag_move', x: event.x, y: event.y }],
    }
  }

  // 继续按下，更新光标位置
  return {
    state: { ...state, cursorX: event.x, cursorY: event.y },
    actions: [],
  }
}

function handlePressingUp(
  state: InteractionState,
  event: MouseInputEvent,
): InteractionResult {
  // 松手 = 点击，不触发任何抢占/片段切换，仅结束按压回到 hover
  const newState: InteractionState = {
    ...state,
    phase: 'hover',
    cursorX: event.x,
    cursorY: event.y,
    pressX: null,
    pressY: null,
  }
  return { state: newState, actions: [] }
}

// —— dragging 阶段 —— //

function handleDragging(
  state: InteractionState,
  event: MouseInputEvent,
  ctx: InteractionContext,
): InteractionResult {
  if (event.type === 'move') {
    // 拖拽跟随：窗口跟随光标 (§7.5)
    return {
      state: { ...state, cursorX: event.x, cursorY: event.y },
      actions: [{ kind: 'drag_move', x: event.x, y: event.y }],
    }
  }

  if (event.type === 'up') {
    // 松手：结束拖拽，窗口钳制到可见区并落回地面线 (§7.3/§7.5)
    const inBuffer = isPointInBufferZone(event.x, event.y, ctx.hitboxPx, ctx.bufferPx)

    const actions: InteractionAction[] = [{ kind: 'drag_end' }]

    let newPhase: InteractionPhase
    if (inBuffer) {
      newPhase = 'hover'
    } else {
      newPhase = 'idle'
      actions.push({ kind: 'exit_interactive' })
    }

    const newState: InteractionState = {
      ...state,
      phase: newPhase,
      cursorX: event.x,
      cursorY: event.y,
      pressX: null,
      pressY: null,
    }
    return { state: newState, actions }
  }

  // down 在 dragging 阶段忽略
  return { state, actions: [] }
}
