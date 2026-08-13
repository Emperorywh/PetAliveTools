import { describe, it, expect } from 'vitest'
import {
  computeAnchorOffset,
  getAnchorPoint,
  DEFAULT_ANCHOR_POINTS,
  type SpriteDimensions,
  type BasePoint,
} from '../../src/renderer/composition/anchor-alignment'

describe('getAnchorPoint', () => {
  it('returns sit anchor at (0.5, 0.9) — hip/ground contact (§6.2)', () => {
    const p = getAnchorPoint('sit')
    expect(p.x).toBeCloseTo(0.5, 2)
    expect(p.y).toBeCloseTo(0.9, 2)
  })

  it('returns stand anchor at (0.5, 1.0) — feet center (§6.2)', () => {
    const p = getAnchorPoint('stand')
    expect(p.x).toBeCloseTo(0.5, 2)
    expect(p.y).toBeCloseTo(1.0, 2)
  })
})

describe('DEFAULT_ANCHOR_POINTS', () => {
  it('has exactly sit and stand entries', () => {
    expect(Object.keys(DEFAULT_ANCHOR_POINTS).sort()).toEqual(['sit', 'stand'])
  })
})

describe('computeAnchorOffset', () => {
  const size: SpriteDimensions = { width: 320, height: 240 }
  const basePoint: BasePoint = { x: 200, y: 380 }

  it('computes offset so anchor lands at base point (stand)', () => {
    const anchor = getAnchorPoint('stand') // (0.5, 1.0)
    const offset = computeAnchorOffset(anchor, size, basePoint)

    // offset = base - anchor × size
    expect(offset.x).toBeCloseTo(200 - 0.5 * 320, 6) // 200 - 160 = 40
    expect(offset.y).toBeCloseTo(380 - 1.0 * 240, 6) // 380 - 240 = 140
  })

  it('computes offset so anchor lands at base point (sit)', () => {
    const anchor = getAnchorPoint('sit') // (0.5, 0.9)
    const offset = computeAnchorOffset(anchor, size, basePoint)

    expect(offset.x).toBeCloseTo(200 - 0.5 * 320, 6) // 40
    expect(offset.y).toBeCloseTo(380 - 0.9 * 240, 6) // 380 - 216 = 164
  })

  it('different clip sizes align to same base point', () => {
    const anchor = getAnchorPoint('stand')
    const basePoint: BasePoint = { x: 500, y: 1000 }

    const sizeA: SpriteDimensions = { width: 200, height: 150 }
    const sizeB: SpriteDimensions = { width: 400, height: 300 }

    const offsetA = computeAnchorOffset(anchor, sizeA, basePoint)
    const offsetB = computeAnchorOffset(anchor, sizeB, basePoint)

    // Verify anchor point lands at base after translate
    const anchorScreenA = {
      x: offsetA.x + anchor.x * sizeA.width,
      y: offsetA.y + anchor.y * sizeA.height,
    }
    const anchorScreenB = {
      x: offsetB.x + anchor.x * sizeB.width,
      y: offsetB.y + anchor.y * sizeB.height,
    }

    expect(anchorScreenA.x).toBeCloseTo(basePoint.x, 6)
    expect(anchorScreenA.y).toBeCloseTo(basePoint.y, 6)
    expect(anchorScreenB.x).toBeCloseTo(basePoint.x, 6)
    expect(anchorScreenB.y).toBeCloseTo(basePoint.y, 6)
  })

  it('handles custom anchor point (e.g., asymmetric sprite)', () => {
    const customAnchor = { x: 0.35, y: 0.95 }
    const offset = computeAnchorOffset(customAnchor, size, basePoint)

    expect(offset.x).toBeCloseTo(200 - 0.35 * 320, 6)
    expect(offset.y).toBeCloseTo(380 - 0.95 * 240, 6)
  })

  it('handles zero-size clip gracefully', () => {
    const zeroSize: SpriteDimensions = { width: 0, height: 0 }
    const offset = computeAnchorOffset(getAnchorPoint('stand'), zeroSize, basePoint)

    expect(offset.x).toBe(basePoint.x)
    expect(offset.y).toBe(basePoint.y)
  })
})
