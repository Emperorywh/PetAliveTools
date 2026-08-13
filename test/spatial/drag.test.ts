import { describe, it, expect } from 'vitest'
import {
  createDragState,
  pickupDrag,
  dragFollow,
  releaseDrag,
  stepReturn,
  isDragSettled,
  DEFAULT_RETURN_SPEED_PX_PER_SEC,
  type DragState,
  type DragGeometry
} from '../../src/shared/spatial'
import { computeGroundLine, type Rect } from '../../src/shared/spatial'

const WORK_AREA: Rect = { x: 0, y: 0, width: 1920, height: 1080 }
const bounds = computeGroundLine(WORK_AREA)

const GEOMETRY: DragGeometry = { windowWidth: 400, spriteBaseY: 380 }
// groundedWindowY(1080, 380) = 700

describe('createDragState', () => {
  it('creates idle state at given position', () => {
    const s = createDragState({ x: 100, y: 700 })
    expect(s.phase).toBe('idle')
    expect(s.windowPos).toEqual({ x: 100, y: 700 })
    expect(s.grabOffset).toBeNull()
  })
})

describe('pickupDrag → dragFollow (§7.5 拾取 → 跟随光标)', () => {
  it('records grab offset and enters dragging phase', () => {
    const s0 = createDragState({ x: 500, y: 700 })
    const s1 = pickupDrag(s0, { x: 580, y: 750 })
    expect(s1.phase).toBe('dragging')
    // window was at (500,700), cursor at (580,750) → grab offset = (-80, -50)
    expect(s1.grabOffset).toEqual({ x: -80, y: -50 })
  })

  it('follows cursor maintaining grab offset', () => {
    const s0 = createDragState({ x: 500, y: 700 })
    const s1 = pickupDrag(s0, { x: 580, y: 750 })
    const s2 = dragFollow(s1, { x: 700, y: 600 })
    // window = cursor + offset = (700-80, 600-50) = (620, 550)
    expect(s2.windowPos).toEqual({ x: 620, y: 550 })
  })

  it('multiple follows track cursor continuously', () => {
    const s0 = createDragState({ x: 200, y: 700 })
    const s1 = pickupDrag(s0, { x: 300, y: 700 })
    const s2 = dragFollow(s1, { x: 400, y: 500 })
    const s3 = dragFollow(s2, { x: 350, y: 450 })
    expect(s3.windowPos).toEqual({ x: 250, y: 450 })
  })

  it('throws if dragFollow called outside dragging phase', () => {
    const s0 = createDragState({ x: 100, y: 700 })
    expect(() => dragFollow(s0, { x: 200, y: 200 })).toThrow(/dragging/)
  })
})

describe('releaseDrag (§7.5 松手)', () => {
  it('clamps drop x to visible area and enters returning', () => {
    const s0 = createDragState({ x: 500, y: 700 })
    const s1 = pickupDrag(s0, { x: 580, y: 750 })
    const s2 = dragFollow(s1, { x: 2000, y: 300 })
    // window at (1920, 250), clamp to [0, 1520] → 1520
    const s3 = releaseDrag(s2, bounds, GEOMETRY)
    expect(s3.phase).toBe('returning')
    expect(s3.windowPos.x).toBe(1520)
    expect(s3.windowPos.y).toBe(250)
    expect(s3.returnFromY).toBe(250)
  })

  it('keeps x if within bounds', () => {
    const s0 = createDragState({ x: 500, y: 700 })
    const s1 = pickupDrag(s0, { x: 550, y: 750 })
    const s2 = dragFollow(s1, { x: 600, y: 400 })
    // window at (550, 350) — x 550 is valid
    const s3 = releaseDrag(s2, bounds, GEOMETRY)
    expect(s3.windowPos.x).toBe(550)
  })
})

describe('stepReturn (§7.5 回到地面线)', () => {
  it('descends y toward ground line at constant speed', () => {
    // window released at y=300, ground is y=700, distance=400
    const released: DragState = {
      phase: 'returning',
      windowPos: { x: 500, y: 300 },
      grabOffset: null,
      returnFromY: 300
    }
    // speed 900px/s, dt 0.1s → step 90px → y=390
    const s1 = stepReturn(released, bounds, GEOMETRY, 0.1, 900)
    expect(s1.phase).toBe('returning')
    expect(s1.windowPos.y).toBe(390)
    expect(s1.windowPos.x).toBe(500) // x unchanged
  })

  it('lands on ground line and enters idle when step reaches/exceeds', () => {
    const released: DragState = {
      phase: 'returning',
      windowPos: { x: 500, y: 690 },
      grabOffset: null,
      returnFromY: 300
    }
    // distance = 10, step = 900 * 0.1 = 90 → lands
    const s1 = stepReturn(released, bounds, GEOMETRY, 0.1, 900)
    expect(s1.phase).toBe('idle')
    expect(s1.windowPos.y).toBe(700) // groundLine 1080 - spriteBaseY 380
  })

  it('returns idle immediately if already at ground line', () => {
    const released: DragState = {
      phase: 'returning',
      windowPos: { x: 500, y: 700 },
      grabOffset: null,
      returnFromY: 300
    }
    // distance = 0 → lands
    const s1 = stepReturn(released, bounds, GEOMETRY, 0.1, 900)
    expect(s1.phase).toBe('idle')
  })

  it('full return from drop to ground over multiple steps', () => {
    let state: DragState = {
      phase: 'returning',
      windowPos: { x: 500, y: 100 },
      grabOffset: null,
      returnFromY: 100
    }
    const dt = 0.05 // 50ms steps at 900px/s → 45px/step
    let steps = 0
    while (state.phase === 'returning' && steps < 100) {
      state = stepReturn(state, bounds, GEOMETRY, dt, 900)
      steps++
    }
    expect(state.phase).toBe('idle')
    expect(state.windowPos.y).toBe(700)
    expect(steps).toBeLessThan(100)
  })
})

describe('isDragSettled', () => {
  it('returns true when idle', () => {
    expect(isDragSettled(createDragState({ x: 100, y: 700 }))).toBe(true)
  })
  it('returns false during dragging/returning', () => {
    const s0 = createDragState({ x: 100, y: 700 })
    const s1 = pickupDrag(s0, { x: 150, y: 700 })
    expect(isDragSettled(s1)).toBe(false)
  })
})

describe('constants', () => {
  it('DEFAULT_RETURN_SPEED is 900 px/s', () => {
    expect(DEFAULT_RETURN_SPEED_PX_PER_SEC).toBe(900)
  })
})
