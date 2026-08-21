import { describe, it, expect } from 'vitest'
import {
  createInteractionState,
  createInteractionContext,
  processInput,
  DEFAULT_DRAG_MOVE_THRESHOLD,
  type InteractionState,
  type InteractionContext,
  type InteractionAction,
} from '../../src/shared/input/interaction-state'
import type { PixelRect } from '../../src/shared/input/hitbox'

// 命中盒：窗口中央 200×200 区域
const HITBOX_PX: PixelRect = { x: 100, y: 100, width: 200, height: 200 }

function ctx(overrides?: Partial<InteractionContext>): InteractionContext {
  return createInteractionContext(HITBOX_PX, overrides)
}

/** 处理一系列事件，返回最终状态和全部动作 */
function processSequence(
  events: ReadonlyArray<{ type: 'move' | 'down' | 'up'; x: number; y: number }>,
  context?: InteractionContext,
  initialState?: InteractionState,
): { state: InteractionState; actions: InteractionAction[] } {
  let state = initialState ?? createInteractionState()
  const c = context ?? ctx()
  const allActions: InteractionAction[] = []
  for (const e of events) {
    const result = processInput(state, e, c)
    state = result.state
    allActions.push(...result.actions)
  }
  return { state, actions: allActions }
}

function hasAction(actions: readonly InteractionAction[], kind: string): boolean {
  return actions.some((a) => a.kind === kind)
}

// ============================================================
// idle → hover (穿透 → 交互)
// ============================================================

describe('idle → hover: cursor enters buffer zone (§6.1)', () => {
  it('entering buffer zone triggers enter_interactive', () => {
    const result = processSequence([
      { type: 'move', x: 95, y: 200 }, // hitbox at x=100, buffer 10 → boundary x=90
    ])
    expect(result.state.phase).toBe('hover')
    expect(hasAction(result.actions, 'enter_interactive')).toBe(true)
  })

  it('cursor outside buffer zone stays idle', () => {
    const result = processSequence([
      { type: 'move', x: 50, y: 200 },
    ])
    expect(result.state.phase).toBe('idle')
    expect(hasAction(result.actions, 'enter_interactive')).toBe(false)
  })

  it('cursor deep inside hitbox enters hover immediately', () => {
    const result = processSequence([
      { type: 'move', x: 200, y: 200 },
    ])
    expect(result.state.phase).toBe('hover')
    expect(hasAction(result.actions, 'enter_interactive')).toBe(true)
  })
})

// ============================================================
// hover → idle (交互 → 穿透)
// ============================================================

describe('hover → idle: cursor exits buffer zone (§6.1)', () => {
  it('exiting buffer zone triggers exit_interactive', () => {
    const result = processSequence([
      { type: 'move', x: 200, y: 200 }, // enter buffer
      { type: 'move', x: 50, y: 200 }, // exit buffer
    ])
    expect(result.state.phase).toBe('idle')
    expect(hasAction(result.actions, 'exit_interactive')).toBe(true)
  })

  it('moving within buffer zone stays hover (no exit_interactive)', () => {
    const result = processSequence([
      { type: 'move', x: 95, y: 200 }, // enter hover (buffer zone, outside hitbox)
      { type: 'move', x: 96, y: 200 }, // move within buffer zone
    ])
    expect(result.state.phase).toBe('hover')
    expect(hasAction(result.actions, 'exit_interactive')).toBe(false)
  })
})

// ============================================================
// hover 内移动（悬停不抢占、不切换片段）
// ============================================================

describe('hover: cursor moves inside hitbox (悬停不切换视频)', () => {
  it('movement inside hitbox stays hover and emits no actions', () => {
    const result = processSequence([
      { type: 'move', x: 200, y: 200 }, // enter hover (in hitbox)
      { type: 'move', x: 205, y: 200 }, // 5px movement, previously petting threshold
    ])
    expect(result.state.phase).toBe('hover')
    expect(hasAction(result.actions, 'drag_move')).toBe(false)
    expect(hasAction(result.actions, 'drag_end')).toBe(false)
  })

  it('continuous movement across hitbox emits no actions', () => {
    const result = processSequence([
      { type: 'move', x: 105, y: 200 },
      { type: 'move', x: 150, y: 200 },
      { type: 'move', x: 200, y: 200 },
      { type: 'move', x: 250, y: 200 },
      { type: 'move', x: 290, y: 200 },
    ])
    expect(result.state.phase).toBe('hover')
    expect(hasAction(result.actions, 'drag_move')).toBe(false)
    expect(hasAction(result.actions, 'drag_end')).toBe(false)
  })

  it('cursor exiting buffer from hitbox exits interactive', () => {
    const result = processSequence([
      { type: 'move', x: 200, y: 200 }, // hover in hitbox
      { type: 'move', x: 205, y: 200 }, // movement inside hitbox
      { type: 'move', x: 50, y: 200 }, // exit buffer
    ])
    expect(result.state.phase).toBe('idle')
    expect(hasAction(result.actions, 'exit_interactive')).toBe(true)
    expect(hasAction(result.actions, 'drag_end')).toBe(false)
  })

  it('hover movement inside hitbox then click emits nothing (点击不切换视频)', () => {
    const result = processSequence([
      { type: 'move', x: 200, y: 200 },
      { type: 'move', x: 205, y: 200 },
      { type: 'down', x: 200, y: 200 },
      { type: 'up', x: 200, y: 200 },
    ])
    expect(result.state.phase).toBe('hover')
    // 除进入缓冲带的 enter_interactive 外无任何动作
    expect(result.actions).toEqual([{ kind: 'enter_interactive' }])
  })
})

// ============================================================
// click detection (§10)
// ============================================================

describe('click: mousedown + mouseup on hitbox（点击不切换视频）', () => {
  it('click on hitbox returns to hover without actions', () => {
    const result = processSequence([
      { type: 'move', x: 200, y: 200 }, // hover (in hitbox)
      { type: 'down', x: 200, y: 200 }, // press
      { type: 'up', x: 200, y: 200 }, // release on hitbox = click
    ])
    expect(result.state.phase).toBe('hover')
    // 除进入缓冲带的 enter_interactive 外无任何动作
    expect(result.actions).toEqual([{ kind: 'enter_interactive' }])
  })

  it('mouseup outside hitbox also returns to hover without actions', () => {
    const result = processSequence([
      { type: 'move', x: 200, y: 200 },
      { type: 'down', x: 200, y: 200 },
      { type: 'up', x: 95, y: 200 }, // release in buffer, not hitbox
    ])
    expect(result.actions).toEqual([{ kind: 'enter_interactive' }])
    expect(result.state.phase).toBe('hover')
  })

  it('mousedown outside hitbox does not start pressing', () => {
    const result = processSequence([
      { type: 'move', x: 95, y: 200 }, // hover in buffer
      { type: 'down', x: 95, y: 200 }, // press outside hitbox
    ])
    expect(result.state.phase).toBe('hover')
    expect(result.state.pressX).toBeNull()
  })
})

// ============================================================
// drag detection (§7.5)
// ============================================================

describe('drag: mousedown + movement → window follow only (§7.5)', () => {
  it('drag beyond threshold enters dragging with drag_move, no clip switch', () => {
    const result = processSequence([
      { type: 'move', x: 200, y: 200 }, // hover
      { type: 'down', x: 200, y: 200 }, // press
      { type: 'move', x: 210, y: 200 }, // 10px > drag threshold 5
    ])
    expect(result.state.phase).toBe('dragging')
    expect(hasAction(result.actions, 'drag_move')).toBe(true)
    expect(hasAction(result.actions, 'drag_end')).toBe(false)
  })

  it('drag_move action emitted with cursor position', () => {
    const result = processSequence([
      { type: 'move', x: 200, y: 200 },
      { type: 'down', x: 200, y: 200 },
      { type: 'move', x: 210, y: 205 }, // drag triggered
    ])
    const dragMove = result.actions.find((a) => a.kind === 'drag_move')
    expect(dragMove).toBeDefined()
    expect(dragMove!.kind === 'drag_move' && dragMove!.x).toBe(210)
    expect(dragMove!.kind === 'drag_move' && dragMove!.y).toBe(205)
  })

  it('movement below drag threshold stays pressing', () => {
    const result = processSequence([
      { type: 'move', x: 200, y: 200 },
      { type: 'down', x: 200, y: 200 },
      { type: 'move', x: 203, y: 200 }, // 3px < threshold 5
    ])
    expect(result.state.phase).toBe('pressing')
    expect(hasAction(result.actions, 'drag_move')).toBe(false)
  })

  it('drag continues emitting drag_move on each move', () => {
    const result = processSequence([
      { type: 'move', x: 200, y: 200 },
      { type: 'down', x: 200, y: 200 },
      { type: 'move', x: 210, y: 200 }, // drag starts
      { type: 'move', x: 220, y: 210 }, // continue
      { type: 'move', x: 230, y: 220 }, // continue
    ])
    const dragMoves = result.actions.filter((a) => a.kind === 'drag_move')
    expect(dragMoves.length).toBe(3)
  })

  it('drag release (mouseup) emits drag_end', () => {
    const result = processSequence([
      { type: 'move', x: 200, y: 200 },
      { type: 'down', x: 200, y: 200 },
      { type: 'move', x: 210, y: 200 }, // drag
      { type: 'up', x: 210, y: 200 }, // release
    ])
    expect(hasAction(result.actions, 'drag_end')).toBe(true)
    // cursor still in buffer → stay interactive (hover)
    expect(result.state.phase).toBe('hover')
  })

  it('drag release outside buffer exits interactive', () => {
    const result = processSequence([
      { type: 'move', x: 200, y: 200 },
      { type: 'down', x: 200, y: 200 },
      { type: 'move', x: 210, y: 200 },
      { type: 'up', x: 50, y: 200 }, // release outside buffer
    ])
    expect(hasAction(result.actions, 'drag_end')).toBe(true)
    expect(hasAction(result.actions, 'exit_interactive')).toBe(true)
    expect(result.state.phase).toBe('idle')
  })
})

// ============================================================
// hover → drag after prior movement（悬停移动后拖拽不受影响）
// ============================================================

describe('hover → drag transition', () => {
  it('drag after moving inside hitbox only emits drag_move', () => {
    const result = processSequence([
      { type: 'move', x: 200, y: 200 }, // hover
      { type: 'move', x: 205, y: 200 }, // movement inside hitbox (no action)
      { type: 'down', x: 200, y: 200 }, // press
      { type: 'move', x: 210, y: 200 }, // drag
    ])
    expect(result.state.phase).toBe('dragging')
    expect(hasAction(result.actions, 'drag_end')).toBe(false)
    const dragMoves = result.actions.filter((a) => a.kind === 'drag_move')
    expect(dragMoves.length).toBe(1)
  })
})

// ============================================================
// pressing cancel (cursor leaves buffer)
// ============================================================

describe('pressing cancel: cursor leaves buffer while pressed', () => {
  it('leaving buffer during press cancels and exits interactive', () => {
    const result = processSequence([
      { type: 'move', x: 200, y: 200 },
      { type: 'down', x: 200, y: 200 },
      { type: 'move', x: 50, y: 200 }, // leave buffer
    ])
    expect(result.state.phase).toBe('idle')
    expect(hasAction(result.actions, 'exit_interactive')).toBe(true)
  })
})

// ============================================================
// Custom thresholds
// ============================================================

describe('custom thresholds', () => {
  it('custom drag threshold', () => {
    const c = ctx({ dragMoveThreshold: 20 })
    const result = processSequence(
      [
        { type: 'move', x: 200, y: 200 },
        { type: 'down', x: 200, y: 200 },
        { type: 'move', x: 215, y: 200 }, // 15px < 20
      ],
      c,
    )
    expect(result.state.phase).toBe('pressing')

    const result2 = processSequence(
      [
        { type: 'move', x: 200, y: 200 },
        { type: 'down', x: 200, y: 200 },
        { type: 'move', x: 230, y: 200 }, // 30px > 20
      ],
      c,
    )
    expect(result2.state.phase).toBe('dragging')
  })
})

// ============================================================
// Default threshold values
// ============================================================

describe('default thresholds', () => {
  it('drag move threshold is 5', () => {
    expect(DEFAULT_DRAG_MOVE_THRESHOLD).toBe(5)
  })
})

// ============================================================
// Buffer zone size affects activation distance
// ============================================================

describe('buffer zone size affects activation (§6.1 8–12px)', () => {
  it('8px buffer activates closer than 12px buffer', () => {
    const c8 = ctx({ bufferPx: 8 })
    const c12 = ctx({ bufferPx: 12 })

    // hitbox starts at x=100, cursor at x=91
    // 8px buffer: boundary at x=92 → outside
    const r8 = processSequence([{ type: 'move', x: 91, y: 200 }], c8)
    expect(r8.state.phase).toBe('idle')

    // 12px buffer: boundary at x=88 → inside
    const r12 = processSequence([{ type: 'move', x: 91, y: 200 }], c12)
    expect(r12.state.phase).toBe('hover')
  })
})

// ============================================================
// 回归：undefined 覆盖不得击穿默认阈值
// （InteractionHandler 把可选配置全部展开传入，未配置的阈值
//   以显式 undefined 到达；展开合并会覆盖默认值，导致
//   `dist >= undefined` 恒为 false，拖拽永不触发）
// ============================================================

describe('createInteractionContext: undefined overrides fall back to defaults', () => {
  it('显式 undefined 阈值回落默认值（不再被展开覆盖）', () => {
    const c = ctx({
      bufferPx: 10,
      dragMoveThreshold: undefined,
    })
    expect(c.dragMoveThreshold).toBe(DEFAULT_DRAG_MOVE_THRESHOLD)
  })

  it('undefined 阈值上下文中按住 + 移动 6px 触发拖拽（运行时回归场景）', () => {
    const c = ctx({
      bufferPx: 10,
      dragMoveThreshold: undefined,
    })
    const result = processSequence(
      [
        { type: 'move', x: 200, y: 200 },
        { type: 'down', x: 200, y: 200 },
        { type: 'move', x: 206, y: 200 },
      ],
      c,
    )
    expect(result.state.phase).toBe('dragging')
    expect(hasAction(result.actions, 'drag_move')).toBe(true)
  })

  it('undefined 阈值上下文中命中盒内移动不触发抢占（悬停不切换视频）', () => {
    const c = ctx({
      bufferPx: 10,
      dragMoveThreshold: undefined,
    })
    const result = processSequence(
      [
        { type: 'move', x: 200, y: 200 },
        { type: 'move', x: 204, y: 200 },
      ],
      c,
    )
    expect(result.state.phase).toBe('hover')
    expect(hasAction(result.actions, 'preempt')).toBe(false)
  })
})
