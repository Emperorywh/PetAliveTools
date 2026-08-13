import { describe, it, expect } from 'vitest'
import {
  createInteractionState,
  createInteractionContext,
  processInput,
  DEFAULT_PETTING_MOVE_THRESHOLD,
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
// hover → petting (抚摸检测, §10)
// ============================================================

describe('hover → petting: cursor in hitbox + movement (§10)', () => {
  it('movement inside hitbox triggers preempt petted', () => {
    const result = processSequence([
      { type: 'move', x: 200, y: 200 }, // enter hover (in hitbox)
      { type: 'move', x: 205, y: 200 }, // accumulate 5px > threshold 3
    ])
    expect(result.state.phase).toBe('petting')
    expect(result.state.activePreempt).toBe('petted')
    const preempt = result.actions.find(
      (a) => a.kind === 'preempt',
    )
    expect(preempt).toBeDefined()
    expect(preempt!.kind === 'preempt' && preempt!.interaction).toBe('petted')
  })

  it('insufficient movement does not trigger petting', () => {
    const result = processSequence([
      { type: 'move', x: 200, y: 200 }, // enter hover
      { type: 'move', x: 201, y: 200 }, // only 1px < threshold 3
    ])
    expect(result.state.phase).toBe('hover')
    expect(hasAction(result.actions, 'preempt')).toBe(false)
  })

  it('movement outside hitbox (buffer only) does not accumulate', () => {
    const result = processSequence([
      { type: 'move', x: 95, y: 200 }, // in buffer, not hitbox
      { type: 'move', x: 96, y: 200 },
      { type: 'move', x: 97, y: 200 },
      { type: 'move', x: 98, y: 200 }, // moved 3px but in buffer zone only
    ])
    expect(result.state.phase).toBe('hover')
    expect(hasAction(result.actions, 'preempt')).toBe(false)
  })

  it('petting ends when cursor exits hitbox but stays in buffer', () => {
    const result = processSequence([
      { type: 'move', x: 200, y: 200 }, // hover
      { type: 'move', x: 205, y: 200 }, // petting triggered
      { type: 'move', x: 95, y: 200 }, // exit hitbox, stay in buffer
    ])
    expect(result.state.phase).toBe('hover')
    expect(result.state.activePreempt).toBeNull()
    expect(hasAction(result.actions, 'end_preempt')).toBe(true)
  })

  it('petting ends when cursor exits buffer zone', () => {
    const result = processSequence([
      { type: 'move', x: 200, y: 200 },
      { type: 'move', x: 205, y: 200 }, // petting
      { type: 'move', x: 50, y: 200 }, // exit buffer
    ])
    expect(result.state.phase).toBe('idle')
    expect(hasAction(result.actions, 'end_preempt')).toBe(true)
    expect(hasAction(result.actions, 'exit_interactive')).toBe(true)
  })
})

// ============================================================
// click detection (§10)
// ============================================================

describe('click: mousedown + mouseup on hitbox → preempt clicked (§10)', () => {
  it('click on hitbox triggers preempt clicked', () => {
    const result = processSequence([
      { type: 'move', x: 200, y: 200 }, // hover (in hitbox)
      { type: 'down', x: 200, y: 200 }, // press
      { type: 'up', x: 200, y: 200 }, // release on hitbox = click
    ])
    expect(result.state.phase).toBe('hover')
    const preempt = result.actions.find((a) => a.kind === 'preempt')
    expect(preempt).toBeDefined()
    expect(preempt!.kind === 'preempt' && preempt!.interaction).toBe('clicked')
  })

  it('mouseup outside hitbox does not trigger click', () => {
    const result = processSequence([
      { type: 'move', x: 200, y: 200 },
      { type: 'down', x: 200, y: 200 },
      { type: 'up', x: 95, y: 200 }, // release in buffer, not hitbox
    ])
    expect(hasAction(result.actions, 'preempt')).toBe(false)
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

describe('drag: mousedown + movement → preempt dragged (§7.5)', () => {
  it('drag beyond threshold triggers preempt dragged', () => {
    const result = processSequence([
      { type: 'move', x: 200, y: 200 }, // hover
      { type: 'down', x: 200, y: 200 }, // press
      { type: 'move', x: 210, y: 200 }, // 10px > drag threshold 5
    ])
    expect(result.state.phase).toBe('dragging')
    expect(result.state.activePreempt).toBe('dragged')
    const preempt = result.actions.find((a) => a.kind === 'preempt')
    expect(preempt).toBeDefined()
    expect(preempt!.kind === 'preempt' && preempt!.interaction).toBe('dragged')
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
    expect(hasAction(result.actions, 'preempt')).toBe(false)
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

  it('drag release (mouseup) ends preempt', () => {
    const result = processSequence([
      { type: 'move', x: 200, y: 200 },
      { type: 'down', x: 200, y: 200 },
      { type: 'move', x: 210, y: 200 }, // drag
      { type: 'up', x: 210, y: 200 }, // release
    ])
    expect(hasAction(result.actions, 'end_preempt')).toBe(true)
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
    expect(hasAction(result.actions, 'end_preempt')).toBe(true)
    expect(hasAction(result.actions, 'exit_interactive')).toBe(true)
    expect(result.state.phase).toBe('idle')
  })
})

// ============================================================
// petting → pressing → drag transition
// ============================================================

describe('petting → drag transition', () => {
  it('drag from petting ends petted preempt then starts dragged', () => {
    const result = processSequence([
      { type: 'move', x: 200, y: 200 }, // hover
      { type: 'move', x: 205, y: 200 }, // petting
      { type: 'down', x: 200, y: 200 }, // press while petting
      { type: 'move', x: 210, y: 200 }, // drag
    ])
    expect(result.state.phase).toBe('dragging')
    expect(result.state.activePreempt).toBe('dragged')
    // end_preempt for petted, then preempt for dragged
    const endPreempts = result.actions.filter((a) => a.kind === 'end_preempt')
    expect(endPreempts.length).toBe(1)
    const preempts = result.actions.filter((a) => a.kind === 'preempt')
    expect(preempts.length).toBe(2)
  })
})

// ============================================================
// petting → click transition
// ============================================================

describe('petting → click transition', () => {
  it('click from petting ends petted preempt then starts clicked', () => {
    const result = processSequence([
      { type: 'move', x: 200, y: 200 },
      { type: 'move', x: 205, y: 200 }, // petting
      { type: 'down', x: 200, y: 200 },
      { type: 'up', x: 200, y: 200 }, // click
    ])
    expect(hasAction(result.actions, 'end_preempt')).toBe(true)
    const clickedPreempt = result.actions.find(
      (a) => a.kind === 'preempt' && a.kind === 'preempt' && 'interaction' in a && a.interaction === 'clicked',
    )
    expect(clickedPreempt).toBeDefined()
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
  it('custom petting threshold', () => {
    const c = ctx({ pettingMoveThreshold: 10 })
    const result = processSequence(
      [
        { type: 'move', x: 200, y: 200 },
        { type: 'move', x: 205, y: 200 }, // 5px < 10
      ],
      c,
    )
    expect(result.state.phase).toBe('hover')

    const result2 = processSequence(
      [
        { type: 'move', x: 200, y: 200 },
        { type: 'move', x: 215, y: 200 }, // 15px > 10
      ],
      c,
    )
    expect(result2.state.phase).toBe('petting')
  })

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
  it('petting move threshold is 3', () => {
    expect(DEFAULT_PETTING_MOVE_THRESHOLD).toBe(3)
  })

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
