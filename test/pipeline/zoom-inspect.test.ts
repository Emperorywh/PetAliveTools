import { describe, it, expect } from 'vitest'
import { computeZoomRect } from '../../src/renderer/pipeline/zoom-inspect'

describe('computeZoomRect', () => {
  it('centers the inspect point when there is room', () => {
    const rect = computeZoomRect(100, 100, 49, 200, 200)
    // 49 是奇数，half=24 → x = 100-24 = 76
    expect(rect).toEqual({ x: 76, y: 76, w: 49, h: 49 })
  })

  it('clamps the rect to stay inside the image near the top-left corner', () => {
    const rect = computeZoomRect(2, 2, 49, 200, 200)
    expect(rect.x).toBe(0)
    expect(rect.y).toBe(0)
    expect(rect.w).toBe(49)
    expect(rect.h).toBe(49)
  })

  it('clamps the rect near the bottom-right corner', () => {
    const rect = computeZoomRect(199, 199, 49, 200, 200)
    expect(rect.x).toBe(200 - 49)
    expect(rect.y).toBe(200 - 49)
  })

  it('forces an even size to odd (so the inspect point stays centered)', () => {
    const rect = computeZoomRect(50, 50, 48, 200, 200)
    expect(rect.w).toBe(49)
    expect(rect.h).toBe(49)
  })

  it('degenerates to the whole image when the requested size exceeds it', () => {
    const rect = computeZoomRect(5, 5, 200, 10, 8)
    expect(rect).toEqual({ x: 0, y: 0, w: 10, h: 8 })
  })

  it('throws on invalid image dimensions', () => {
    expect(() => computeZoomRect(1, 1, 9, 0, 8)).toThrow(/invalid image dimensions/)
    expect(() => computeZoomRect(1, 1, 9, 10, -1)).toThrow(/invalid image dimensions/)
  })
})
