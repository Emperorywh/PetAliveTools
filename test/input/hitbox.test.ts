import { describe, it, expect } from 'vitest'
import type { Hitbox } from '../../src/shared/types/clip-meta'
import {
  BUFFER_PX_MIN,
  BUFFER_PX_MAX,
  DEFAULT_BUFFER_PX,
  clampBufferPx,
  hitboxToPixels,
  expandRect,
  isPointInRect,
  isPointInHitbox,
  isPointInBufferZone,
  isPointInBufferOnly,
  type PixelRect,
} from '../../src/shared/input/hitbox'

const SPRITE: PixelRect = { x: 0, y: 0, width: 400, height: 400 }
const HITBOX: Hitbox = [0.1, 0.05, 0.8, 0.9] // [40, 20, 320, 360]
const HITBOX_PX = hitboxToPixels(HITBOX, SPRITE)

describe('clampBufferPx (§6.1: 8–12px buffer zone)', () => {
  it('clamps below minimum to 8', () => {
    expect(clampBufferPx(0)).toBe(8)
    expect(clampBufferPx(-5)).toBe(8)
    expect(clampBufferPx(7.9)).toBe(8)
  })

  it('clamps above maximum to 12', () => {
    expect(clampBufferPx(20)).toBe(12)
    expect(clampBufferPx(100)).toBe(12)
    expect(clampBufferPx(12.1)).toBe(12)
  })

  it('passes through values within 8–12', () => {
    expect(clampBufferPx(8)).toBe(8)
    expect(clampBufferPx(10)).toBe(10)
    expect(clampBufferPx(12)).toBe(12)
  })

  it('returns default (10) for invalid input', () => {
    expect(clampBufferPx(NaN)).toBe(DEFAULT_BUFFER_PX)
    expect(clampBufferPx(Infinity)).toBe(DEFAULT_BUFFER_PX)
  })

  it('default is within range', () => {
    expect(DEFAULT_BUFFER_PX).toBeGreaterThanOrEqual(BUFFER_PX_MIN)
    expect(DEFAULT_BUFFER_PX).toBeLessThanOrEqual(BUFFER_PX_MAX)
  })
})

describe('hitboxToPixels (§5.4 normalized → pixel)', () => {
  it('converts normalized [x,y,w,h] to pixel coordinates', () => {
    expect(hitboxToPixels([0.1, 0.05, 0.8, 0.9], SPRITE)).toEqual({
      x: 40,
      y: 20,
      width: 320,
      height: 360,
    })
  })

  it('handles sprite offset', () => {
    const sprite: PixelRect = { x: 100, y: 50, width: 200, height: 300 }
    const px = hitboxToPixels([0.5, 0.5, 0.2, 0.2], sprite)
    expect(px).toEqual({ x: 200, y: 200, width: 40, height: 60 })
  })

  it('full sprite hitbox maps to sprite bounds', () => {
    const px = hitboxToPixels([0, 0, 1, 1], SPRITE)
    expect(px).toEqual({ x: 0, y: 0, width: 400, height: 400 })
  })
})

describe('expandRect (§6.1 buffer expansion)', () => {
  it('expands all four sides by bufferPx', () => {
    const rect: PixelRect = { x: 100, y: 100, width: 200, height: 200 }
    expect(expandRect(rect, 10)).toEqual({
      x: 90,
      y: 90,
      width: 220,
      height: 220,
    })
  })

  it('zero buffer returns same rect', () => {
    const rect: PixelRect = { x: 50, y: 60, width: 100, height: 120 }
    expect(expandRect(rect, 0)).toEqual(rect)
  })
})

describe('isPointInRect', () => {
  const rect: PixelRect = { x: 100, y: 100, width: 200, height: 200 }

  it('returns true for points inside', () => {
    expect(isPointInRect(150, 150, rect)).toBe(true)
    expect(isPointInRect(200, 200, rect)).toBe(true)
  })

  it('returns true for points on boundary', () => {
    expect(isPointInRect(100, 100, rect)).toBe(true) // top-left
    expect(isPointInRect(300, 300, rect)).toBe(true) // bottom-right
  })

  it('returns false for points outside', () => {
    expect(isPointInRect(50, 150, rect)).toBe(false)
    expect(isPointInRect(150, 50, rect)).toBe(false)
    expect(isPointInRect(350, 350, rect)).toBe(false)
  })
})

describe('isPointInHitbox (§6.1 core hitbox)', () => {
  it('returns true for cursor inside hitbox', () => {
    expect(isPointInHitbox(200, 200, HITBOX_PX)).toBe(true)
  })

  it('returns false for cursor outside hitbox', () => {
    expect(isPointInHitbox(10, 10, HITBOX_PX)).toBe(false)
    expect(isPointInHitbox(390, 390, HITBOX_PX)).toBe(false)
  })
})

describe('isPointInBufferZone (§6.1: activates interactive mode 8–12px early)', () => {
  it('returns true for cursor inside core hitbox', () => {
    expect(isPointInBufferZone(200, 200, HITBOX_PX, 10)).toBe(true)
  })

  it('returns true for cursor in buffer zone but outside hitbox', () => {
    // hitbox starts at x=40, buffer expands to x=30
    expect(isPointInBufferZone(35, 200, HITBOX_PX, 10)).toBe(true)
    // hitbox starts at y=20, buffer expands to y=10
    expect(isPointInBufferZone(200, 15, HITBOX_PX, 10)).toBe(true)
  })

  it('returns false for cursor outside buffer zone', () => {
    expect(isPointInBufferZone(10, 200, HITBOX_PX, 10)).toBe(false)
    expect(isPointInBufferZone(200, 5, HITBOX_PX, 10)).toBe(false)
  })

  it('clamps buffer to 8–12px range', () => {
    // request buffer=0 but minimum is 8
    expect(isPointInBufferZone(35, 200, HITBOX_PX, 0)).toBe(true) // 8px buffer → 32px boundary
    expect(isPointInBufferZone(31, 200, HITBOX_PX, 0)).toBe(false) // outside 8px buffer

    // request buffer=100 but maximum is 12
    expect(isPointInBufferZone(29, 200, HITBOX_PX, 100)).toBe(true) // 12px buffer → 28px boundary
    expect(isPointInBufferZone(27, 200, HITBOX_PX, 100)).toBe(false) // outside 12px buffer
  })

  it('uses default buffer (10px) when not specified', () => {
    // hitbox at x=40, default buffer 10 → boundary at x=30
    expect(isPointInBufferZone(30, 200, HITBOX_PX)).toBe(true)
    expect(isPointInBufferZone(29, 200, HITBOX_PX)).toBe(false)
  })
})

describe('isPointInBufferOnly (buffer zone excluding core hitbox)', () => {
  it('returns false for points inside core hitbox', () => {
    expect(isPointInBufferOnly(200, 200, HITBOX_PX, 10)).toBe(false)
  })

  it('returns true for points in buffer but not in hitbox', () => {
    expect(isPointInBufferOnly(35, 200, HITBOX_PX, 10)).toBe(true)
  })

  it('returns false for points outside buffer zone', () => {
    expect(isPointInBufferOnly(10, 200, HITBOX_PX, 10)).toBe(false)
  })
})
