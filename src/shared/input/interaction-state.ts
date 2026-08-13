/**
 * 交互状态机 (§10 交互层)
 *
 * 管理鼠标交互的检测与抢占输出：
 *   - 抚摸：光标进入命中盒并移动 → 抢占 petted (§10)
 *   - 点击/双击：点击身体 → 抢占 clicked (§10)
 *   - 拖拽：按住身体拖动 → 抢占 dragged (§7.5)
 *   - 模式切换：光标进入/离开缓冲带 → 切换 setIgnoreMouseEvents (§6.1)
 *
 * 纯状态机：输入 = 鼠标事件 + 上下文（命中盒/缓冲带/阈值），
 * 输出 = 动作列表（进入交互态/退出交互态/抢占/结束抢占/拖拽位移）。
 * 调用方（渲染进程）负责将动作通过 IPC 路由到主进程。
 *
 * 纯计算，无平台依赖。
 */

import type { PixelRect } from './hitbox'
import { isPointInHitbox, isPointInBufferZone } from './hitbox'

// —— 交互类型 —— //

/** 交互抢占目标状态 (§9.1 互动响应) */
export type InteractionType = 'petted' | 'clicked' | 'dragged'

// —— 状态机阶段 —— //

/**
 * 交互阶段：
 * - idle：光标在缓冲带外，窗口穿透态
 * - hover：光标在缓冲带内，窗口交互态，等待交互
 * - petting：光标在命中盒内并移动 → 抢占 petted
 * - pressing：鼠标按下命中盒，判定点击 vs 拖拽
 * - dragging：拖拽进行中 → 抢占 dragged
 */
export type InteractionPhase = 'idle' | 'hover' | 'petting' | 'pressing' | 'dragging'

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
  | { readonly kind: 'preempt'; readonly interaction: InteractionType }
  | { readonly kind: 'end_preempt' }
  | { readonly kind: 'drag_move'; readonly x: number; readonly y: number }

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
  /** 命中盒内累积移动距离（用于抚摸检测，§10） */
  readonly moveAccum: number
  /** 鼠标按下位置 x（用于拖拽/点击区分） */
  readonly pressX: number | null
  /** 鼠标按下位置 y（用于拖拽/点击区分） */
  readonly pressY: number | null
  /** 当前活跃的抢占类型 */
  readonly activePreempt: InteractionType | null
}

// —— 上下文 —— //

/** 交互处理上下文（外部状态，不属于状态机） */
export interface InteractionContext {
  /** 命中盒像素坐标（窗口局部） */
  readonly hitboxPx: PixelRect
  /** 缓冲带像素 (§6.1: 8–12px) */
  readonly bufferPx: number
  /** 抚摸触发移动阈值（累积像素） */
  readonly pettingMoveThreshold: number
  /** 拖拽触发移动阈值（距按下点的像素） */
  readonly dragMoveThreshold: number
}

/** 默认阈值 */
export const DEFAULT_PETTING_MOVE_THRESHOLD = 3
export const DEFAULT_DRAG_MOVE_THRESHOLD = 5

// —— 工厂 —— //

/** 创建初始 idle 状态 */
export function createInteractionState(): InteractionState {
  return {
    phase: 'idle',
    cursorX: 0,
    cursorY: 0,
    moveAccum: 0,
    pressX: null,
    pressY: null,
    activePreempt: null,
  }
}

/** 创建默认上下文 */
export function createInteractionContext(
  hitboxPx: PixelRect,
  overrides?: Partial<Omit<InteractionContext, 'hitboxPx'>>,
): InteractionContext {
  return {
    hitboxPx,
    bufferPx: 10,
    pettingMoveThreshold: DEFAULT_PETTING_MOVE_THRESHOLD,
    dragMoveThreshold: DEFAULT_DRAG_MOVE_THRESHOLD,
    ...overrides,
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
    case 'petting':
      return handlePetting(state, event, ctx)
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
      moveAccum: 0,
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
      moveAccum: 0,
    }
    return { state: newState, actions: [{ kind: 'exit_interactive' }] }
  }

  const inHitbox = isPointInHitbox(event.x, event.y, ctx.hitboxPx)
  if (!inHitbox) {
    // 在缓冲带但不在命中盒：重置累积移动
    return {
      state: { ...state, cursorX: event.x, cursorY: event.y, moveAccum: 0 },
      actions: [],
    }
  }

  // 在命中盒内：累积移动距离，检测抚摸 (§10)
  const moved = distance(state.cursorX, state.cursorY, event.x, event.y)
  const moveAccum = state.moveAccum + moved

  if (moveAccum >= ctx.pettingMoveThreshold) {
    // 抚摸触发：抢占 petted (§10)
    const newState: InteractionState = {
      ...state,
      phase: 'petting',
      cursorX: event.x,
      cursorY: event.y,
      moveAccum: 0,
      activePreempt: 'petted',
    }
    return {
      state: newState,
      actions: [{ kind: 'preempt', interaction: 'petted' }],
    }
  }

  // 继续累积
  return {
    state: { ...state, cursorX: event.x, cursorY: event.y, moveAccum },
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

// —— petting 阶段 —— //

function handlePetting(
  state: InteractionState,
  event: MouseInputEvent,
  ctx: InteractionContext,
): InteractionResult {
  if (event.type === 'move') {
    return handlePettingMove(state, event, ctx)
  }
  if (event.type === 'down') {
    return handlePettingDown(state, event, ctx)
  }
  // up 在 petting 阶段忽略
  return { state, actions: [] }
}

function handlePettingMove(
  state: InteractionState,
  event: MouseInputEvent,
  ctx: InteractionContext,
): InteractionResult {
  const inBuffer = isPointInBufferZone(event.x, event.y, ctx.hitboxPx, ctx.bufferPx)

  if (!inBuffer) {
    // 光标离开缓冲带：结束抚摸，退出交互态
    const newState: InteractionState = {
      ...state,
      phase: 'idle',
      cursorX: event.x,
      cursorY: event.y,
      moveAccum: 0,
      activePreempt: null,
    }
    return {
      state: newState,
      actions: [{ kind: 'end_preempt' }, { kind: 'exit_interactive' }],
    }
  }

  const inHitbox = isPointInHitbox(event.x, event.y, ctx.hitboxPx)
  if (!inHitbox) {
    // 离开命中盒但仍在缓冲带：结束抚摸，回到 hover
    const newState: InteractionState = {
      ...state,
      phase: 'hover',
      cursorX: event.x,
      cursorY: event.y,
      moveAccum: 0,
      activePreempt: null,
    }
    return {
      state: newState,
      actions: [{ kind: 'end_preempt' }],
    }
  }

  // 继续在命中盒内：保持抚摸
  return {
    state: { ...state, cursorX: event.x, cursorY: event.y },
    actions: [],
  }
}

function handlePettingDown(
  state: InteractionState,
  event: MouseInputEvent,
  ctx: InteractionContext,
): InteractionResult {
  const inHitbox = isPointInHitbox(event.x, event.y, ctx.hitboxPx)
  if (!inHitbox) {
    return { state, actions: [] }
  }

  // 抚摸中按下：进入 pressing（保持 petted 抢占，等待拖拽/点击判定）
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
    return handlePressingUp(state, event, ctx)
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
    const actions: InteractionAction[] = []
    if (state.activePreempt) {
      actions.push({ kind: 'end_preempt' })
    }
    actions.push({ kind: 'exit_interactive' })

    const newState: InteractionState = {
      ...state,
      phase: 'idle',
      cursorX: event.x,
      cursorY: event.y,
      moveAccum: 0,
      pressX: null,
      pressY: null,
      activePreempt: null,
    }
    return { state: newState, actions }
  }

  // 检查拖拽阈值 (§7.5)
  const dx = state.pressX ?? event.x
  const dy = state.pressY ?? event.y
  const dist = distance(dx, dy, event.x, event.y)

  if (dist >= ctx.dragMoveThreshold) {
    // 拖拽触发 (§7.5)
    const actions: InteractionAction[] = []
    // 如果之前在 petting 抢占，先结束
    if (state.activePreempt === 'petted') {
      actions.push({ kind: 'end_preempt' })
    }
    actions.push({ kind: 'preempt', interaction: 'dragged' })
    actions.push({ kind: 'drag_move', x: event.x, y: event.y })

    const newState: InteractionState = {
      ...state,
      phase: 'dragging',
      cursorX: event.x,
      cursorY: event.y,
      activePreempt: 'dragged',
    }
    return { state: newState, actions }
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
  ctx: InteractionContext,
): InteractionResult {
  const inHitbox = isPointInHitbox(event.x, event.y, ctx.hitboxPx)

  if (!inHitbox) {
    // 在命中盒外松手：取消，回到 hover
    const actions: InteractionAction[] = []
    if (state.activePreempt) {
      actions.push({ kind: 'end_preempt' })
    }

    const newState: InteractionState = {
      ...state,
      phase: 'hover',
      cursorX: event.x,
      cursorY: event.y,
      moveAccum: 0,
      pressX: null,
      pressY: null,
      activePreempt: null,
    }
    return { state: newState, actions }
  }

  // 在命中盒内松手 = 点击 (§10)
  // clicked 片段播放一次后自然结束，不需要 end_preempt
  const actions: InteractionAction[] = []
  if (state.activePreempt === 'petted') {
    actions.push({ kind: 'end_preempt' })
  }
  actions.push({ kind: 'preempt', interaction: 'clicked' })

  const newState: InteractionState = {
    ...state,
    phase: 'hover',
    cursorX: event.x,
    cursorY: event.y,
    moveAccum: 0,
    pressX: null,
    pressY: null,
    activePreempt: null,
  }
  return { state: newState, actions }
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
    // 松手：结束拖拽抢占，回到地面线 (§7.5)
    const inBuffer = isPointInBufferZone(event.x, event.y, ctx.hitboxPx, ctx.bufferPx)

    const actions: InteractionAction[] = [
      { kind: 'end_preempt' },
    ]

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
      moveAccum: 0,
      pressX: null,
      pressY: null,
      activePreempt: null,
    }
    return { state: newState, actions }
  }

  // down 在 dragging 阶段忽略
  return { state, actions: [] }
}
