import { describe, it, expect } from 'vitest'
import {
  computeNormalizedScale,
  displayedClipHeightPx,
  SHOULDER_HEIGHT_FACTOR,
  DEFAULT_SCREEN_PERCENT
} from '../../src/shared/spatial'

describe('computeNormalizedScale (§7.4 尺度归一化)', () => {
  it('applies scaleHint to normalize shoulder height to target screen percent', () => {
    // screen 1080px tall, 15% shoulder, clip 259px high, scaleHint 1.0
    // shoulder = 1080 * 0.15 = 162; clip height ≈ shoulder * 1.6 = 259.2
    // scale = 1080 * 0.15 * 1.6 * 1.0 / 259 ≈ 1.0 (clip already at target)
    const scale = computeNormalizedScale({
      screenHeightPx: 1080,
      screenPercent: 0.15,
      clipHeightPx: 259,
      scaleHint: 1.0
    })
    expect(scale).toBeCloseTo(1.0, 1)
  })

  it('scales up when clip smaller than target', () => {
    // clip half the target size → scale ≈ 2
    const scale = computeNormalizedScale({
      screenHeightPx: 1080,
      screenPercent: 0.15,
      clipHeightPx: 130,
      scaleHint: 1.0
    })
    expect(scale).toBeCloseTo(2.0, 0)
  })

  it('applies scaleHint multiplicatively', () => {
    // scaleHint 2.0 → double the base scale
    const base = computeNormalizedScale({
      screenHeightPx: 1080,
      screenPercent: 0.15,
      clipHeightPx: 259,
      scaleHint: 1.0
    })
    const withHint = computeNormalizedScale({
      screenHeightPx: 1080,
      screenPercent: 0.15,
      clipHeightPx: 259,
      scaleHint: 2.0
    })
    expect(withHint).toBeCloseTo(base * 2, 2)
  })

  it('adapts to different screen heights (§13 分辨率变化)', () => {
    const scale1080 = computeNormalizedScale({
      screenHeightPx: 1080,
      screenPercent: 0.15,
      clipHeightPx: 200,
      scaleHint: 1.0
    })
    const scale1440 = computeNormalizedScale({
      screenHeightPx: 1440,
      screenPercent: 0.15,
      clipHeightPx: 200,
      scaleHint: 1.0
    })
    expect(scale1440 / scale1080).toBeCloseTo(1440 / 1080, 2)
  })

  it('throws on invalid inputs', () => {
    expect(() => computeNormalizedScale({ screenHeightPx: 0, screenPercent: 0.15, clipHeightPx: 200, scaleHint: 1 })).toThrow()
    expect(() => computeNormalizedScale({ screenHeightPx: 1080, screenPercent: 0, clipHeightPx: 200, scaleHint: 1 })).toThrow()
    expect(() => computeNormalizedScale({ screenHeightPx: 1080, screenPercent: 0.15, clipHeightPx: 0, scaleHint: 1 })).toThrow()
    expect(() => computeNormalizedScale({ screenHeightPx: 1080, screenPercent: 0.15, clipHeightPx: 200, scaleHint: 0 })).toThrow()
  })
})

describe('displayedClipHeightPx', () => {
  it('returns scale × clipHeight', () => {
    const h = displayedClipHeightPx({
      screenHeightPx: 1080,
      screenPercent: 0.15,
      clipHeightPx: 200,
      scaleHint: 1.0
    })
    // shoulder = 162, clip ≈ shoulder * 1.6 = 259.2
    expect(h).toBeCloseTo(259.2, 1)
  })
})

describe('constants', () => {
  it('SHOULDER_HEIGHT_FACTOR is 1.6', () => {
    expect(SHOULDER_HEIGHT_FACTOR).toBe(1.6)
  })
  it('DEFAULT_SCREEN_PERCENT is 0.15', () => {
    expect(DEFAULT_SCREEN_PERCENT).toBe(0.15)
  })
})
