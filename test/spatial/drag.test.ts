import { describe, it, expect } from 'vitest'
import {
  createDragState,
  pickupDrag,
  dragFollow,
  releaseDrag,
  isDragSettled,
  type DragGeometry
} from '../../src/shared/spatial'
import { computeGroundLine, type Rect } from '../../src/shared/spatial'

const WORK_AREA: Rect = { x: 0, y: 0, width: 1920, height: 1080 }
const bounds = computeGroundLine(WORK_AREA)

const GEOMETRY: DragGeometry = { windowWidth: 400, windowHeight: 400 }

describe('createDragState', () => {
  it('creates idle state at given position', () => {
    const s = createDragState({ x: 100, y: 700 })
    expect(s.phase).toBe('idle')
    expect(s.windowPos).toEqual({ x: 100, y: 700 })
    expect(s.grabOffset).toBeNull()
  })
})

describe('pickupDrag → dragFollow (§7.3 拾取 → 跟随光标)', () => {
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

describe('releaseDrag (§7.3 松手停在放置位置)', () => {
  it('stays at drop position and enters idle', () => {
    const s0 = createDragState({ x: 500, y: 700 })
    const s1 = pickupDrag(s0, { x: 550, y: 750 })
    const s2 = dragFollow(s1, { x: 600, y: 400 })
    // window at (550, 350) — within bounds
    const s3 = releaseDrag(s2, bounds, GEOMETRY)
    expect(s3.phase).toBe('idle')
    expect(s3.windowPos).toEqual({ x: 550, y: 350 })
    expect(s3.grabOffset).toBeNull()
  })

  it('clamps drop x to visible area', () => {
    const s0 = createDragState({ x: 500, y: 700 })
    const s1 = pickupDrag(s0, { x: 580, y: 750 })
    const s2 = dragFollow(s1, { x: 2000, y: 400 })
    // window at (1920, 350), clamp to [0, 1520] → 1520
    const s3 = releaseDrag(s2, bounds, GEOMETRY)
    expect(s3.phase).toBe('idle')
    expect(s3.windowPos.x).toBe(1520)
    expect(s3.windowPos.y).toBe(350)
  })

  it('clamps drop y above the top edge', () => {
    const s0 = createDragState({ x: 500, y: 700 })
    const s1 = pickupDrag(s0, { x: 580, y: 750 })
    const s2 = dragFollow(s1, { x: 600, y: 20 })
    // window at (520, -30) → y clamped to 0
    const s3 = releaseDrag(s2, bounds, GEOMETRY)
    expect(s3.windowPos).toEqual({ x: 520, y: 0 })
  })

  it('clamps drop y below the work area bottom', () => {
    const s0 = createDragState({ x: 500, y: 700 })
    const s1 = pickupDrag(s0, { x: 580, y: 750 })
    const s2 = dragFollow(s1, { x: 600, y: 1500 })
    // window at (520, 1450) → y clamped to 1080 - 400 = 680
    const s3 = releaseDrag(s2, bounds, GEOMETRY)
    expect(s3.windowPos).toEqual({ x: 520, y: 680 })
  })

  it('clamps into work area with non-zero origin (secondary display)', () => {
    const secondary = computeGroundLine({ x: 1920, y: 0, width: 2560, height: 1440 })
    const s0 = createDragState({ x: 2000, y: 700 })
    const s1 = pickupDrag(s0, { x: 2080, y: 750 })
    const s2 = dragFollow(s1, { x: 1000, y: 500 })
    // window at (920, 450) → x clamped to [1920, 4080]
    const s3 = releaseDrag(s2, secondary, GEOMETRY)
    expect(s3.windowPos).toEqual({ x: 1920, y: 450 })
  })
})

describe('isDragSettled', () => {
  it('returns true when idle', () => {
    expect(isDragSettled(createDragState({ x: 100, y: 700 }))).toBe(true)
  })
  it('returns false during dragging', () => {
    const s0 = createDragState({ x: 100, y: 700 })
    const s1 = pickupDrag(s0, { x: 150, y: 700 })
    expect(isDragSettled(s1)).toBe(false)
  })
  it('returns true after release', () => {
    const s0 = createDragState({ x: 500, y: 700 })
    const s1 = pickupDrag(s0, { x: 580, y: 750 })
    const s2 = dragFollow(s1, { x: 700, y: 600 })
    const s3 = releaseDrag(s2, bounds, GEOMETRY)
    expect(isDragSettled(s3)).toBe(true)
  })
})
