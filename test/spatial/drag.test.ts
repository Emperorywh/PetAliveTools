import { describe, it, expect } from 'vitest'
import {
  createDragState,
  pickupDrag,
  dragFollow,
  releaseDrag,
  isDragSettled,
  type SpriteBounds
} from '../../src/shared/spatial'
import { computeGroundLine, type Rect } from '../../src/shared/spatial'

const WORK_AREA: Rect = { x: 0, y: 0, width: 1920, height: 1080 }
const bounds = computeGroundLine(WORK_AREA)

/** 默认命中盒 [0.1, 0.05, 0.8, 0.9] 在 400×400 窗口内的精灵包围盒 */
const SPRITE: SpriteBounds = { x: 40, y: 20, width: 320, height: 360 }

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
  it('stays at the drop position when inside the work area', () => {
    const s0 = createDragState({ x: 500, y: 700 })
    const s1 = pickupDrag(s0, { x: 550, y: 750 })
    const s2 = dragFollow(s1, { x: 600, y: 400 })
    // window at (550, 350) — 松手位置即放置位置，y 不再落回地面线
    const s3 = releaseDrag(s2, bounds, SPRITE)
    expect(s3.phase).toBe('idle')
    expect(s3.windowPos).toEqual({ x: 550, y: 350 })
    expect(s3.grabOffset).toBeNull()
  })

  it('clamps drop x so the sprite stays visible (right edge)', () => {
    const s0 = createDragState({ x: 500, y: 700 })
    const s1 = pickupDrag(s0, { x: 580, y: 750 })
    const s2 = dragFollow(s1, { x: 2000, y: 400 })
    // window at (1920, 350), sprite x range [-40, 1920-360=1560] → 1560
    const s3 = releaseDrag(s2, bounds, SPRITE)
    expect(s3.phase).toBe('idle')
    expect(s3.windowPos.x).toBe(1560)
    expect(s3.windowPos.y).toBe(350)
  })

  it('allows the window to overhang the left screen edge', () => {
    const s0 = createDragState({ x: 500, y: 700 })
    const s1 = pickupDrag(s0, { x: 580, y: 750 })
    const s2 = dragFollow(s1, { x: -20, y: 500 })
    // window at (-100, 450) → x clamped to -40（精灵左缘贴屏幕左缘）
    const s3 = releaseDrag(s2, bounds, SPRITE)
    expect(s3.windowPos.x).toBe(-40)
    expect(s3.windowPos.y).toBe(450)
  })

  it('clamps y so the sprite stays visible when dropped above the work area', () => {
    const s0 = createDragState({ x: 500, y: 700 })
    const s1 = pickupDrag(s0, { x: 580, y: 750 })
    const s2 = dragFollow(s1, { x: 600, y: 20 })
    // window at (520, -30) → 精灵顶缘贴工作区顶：y = 0 - 20 = -20
    const s3 = releaseDrag(s2, bounds, SPRITE)
    expect(s3.windowPos).toEqual({ x: 520, y: -20 })
  })

  it('clamps y to the ground line when released below the work area', () => {
    const s0 = createDragState({ x: 500, y: 700 })
    const s1 = pickupDrag(s0, { x: 580, y: 750 })
    const s2 = dragFollow(s1, { x: 600, y: 1500 })
    // window at (520, 1450) → y 最多落到地面线：groundLine(1080) - 380 = 700（足部贴地）
    const s3 = releaseDrag(s2, bounds, SPRITE)
    expect(s3.windowPos).toEqual({ x: 520, y: 700 })
  })

  it('clamps into work area with non-zero origin (secondary display)', () => {
    const secondary = computeGroundLine({ x: 1920, y: 0, width: 2560, height: 1440 })
    const s0 = createDragState({ x: 2000, y: 700 })
    const s1 = pickupDrag(s0, { x: 2080, y: 750 })
    const s2 = dragFollow(s1, { x: 1000, y: 500 })
    // window at (920, 450) → x clamped to [1880, 4120]；y 在工作区内，停在 450
    const s3 = releaseDrag(s2, secondary, SPRITE)
    expect(s3.windowPos).toEqual({ x: 1880, y: 450 })
  })

  it('throws on invalid sprite bounds', () => {
    const s0 = createDragState({ x: 500, y: 700 })
    const s1 = pickupDrag(s0, { x: 580, y: 750 })
    const s2 = dragFollow(s1, { x: 600, y: 400 })
    expect(() => releaseDrag(s2, bounds, { x: 40, y: 20, width: 0, height: 360 })).toThrow(
      /invalid sprite/,
    )
    expect(() =>
      releaseDrag(s2, bounds, { x: Number.NaN, y: 20, width: 320, height: 360 }),
    ).toThrow(/invalid sprite/)
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
    const s3 = releaseDrag(s2, bounds, SPRITE)
    expect(isDragSettled(s3)).toBe(true)
  })
})
