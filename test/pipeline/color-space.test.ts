import { describe, it, expect } from 'vitest'
import {
  hueDistance,
  hsvDistance,
  ramp01,
  rgbDistance,
  rgbToHsv,
  rgbToYcbcr,
  ycbcrDistance
} from '../../src/shared/pipeline/color-space'

describe('rgbToYcbcr', () => {
  it('maps achromatic colors to neutral chroma (cb=cr=128)', () => {
    for (const v of [0, 64, 128, 200, 255]) {
      const { cb, cr } = rgbToYcbcr({ r: v, g: v, b: v })
      expect(cb).toBeCloseTo(128, 6)
      expect(cr).toBeCloseTo(128, 6)
    }
  })

  it('maps pure blue to high cb chroma', () => {
    const { cb, cr } = rgbToYcbcr({ r: 0, g: 0, b: 255 })
    expect(cb).toBeCloseTo(255.5, 1)
    expect(cr).toBeCloseTo(107.3, 1)
  })

  it('computes Rec.601 luma as y', () => {
    const { y } = rgbToYcbcr({ r: 255, g: 0, b: 0 })
    expect(y).toBeCloseTo(0.299 * 255, 6)
  })
})

describe('rgbToHsv', () => {
  it('maps pure red to h=0, s=1, v=1', () => {
    expect(rgbToHsv({ r: 255, g: 0, b: 0 })).toEqual({ h: 0, s: 1, v: 1 })
  })

  it('maps pure blue to h=240', () => {
    expect(rgbToHsv({ r: 0, g: 0, b: 255 }).h).toBeCloseTo(240, 6)
  })

  it('maps gray to zero saturation', () => {
    expect(rgbToHsv({ r: 128, g: 128, b: 128 }).s).toBe(0)
  })

  it('keeps hue in [0, 360) for the magenta-red wraparound', () => {
    // g < b 时 (g-b)/d 为负，hue 需回卷到 [300, 360)
    const { h } = rgbToHsv({ r: 255, g: 20, b: 60 })
    expect(h).toBeGreaterThanOrEqual(300)
    expect(h).toBeLessThan(360)
  })
})

describe('hueDistance', () => {
  it('measures the shortest arc', () => {
    expect(hueDistance(0, 350)).toBeCloseTo(10, 6)
    expect(hueDistance(240, 250)).toBeCloseTo(10, 6)
  })

  it('caps at 180 degrees', () => {
    expect(hueDistance(0, 180)).toBeCloseTo(180, 6)
    expect(hueDistance(10, 190)).toBeCloseTo(180, 6)
  })
})

describe('ycbcrDistance', () => {
  const blueBg = { r: 70, g: 120, b: 200 }
  const orangeFur = { r: 230, g: 150, b: 80 }

  it('is ~0 for identical colors and in [0,1] overall', () => {
    expect(ycbcrDistance(blueBg, blueBg)).toBeCloseTo(0, 6)
    expect(ycbcrDistance(orangeFur, blueBg)).toBeGreaterThan(0)
    expect(ycbcrDistance(orangeFur, blueBg)).toBeLessThanOrEqual(1)
  })

  it('cannot separate white fur from gray background on pure chroma alone', () => {
    // 灰幕与白毛的色度同为中性——质量悬崖（§16 风险 1），需亮度权重
    const gray = { r: 128, g: 128, b: 128 }
    const white = { r: 245, g: 243, b: 240 }
    expect(ycbcrDistance(white, gray, 0)).toBeLessThan(0.05)
  })

  it('separates white fur from gray background with luma weight', () => {
    const gray = { r: 128, g: 128, b: 128 }
    const white = { r: 245, g: 243, b: 240 }
    const d = ycbcrDistance(white, gray, 1)
    expect(d).toBeGreaterThan(0.4)
    expect(d).toBeLessThanOrEqual(1)
  })
})

describe('hsvDistance', () => {
  const blueBg = { r: 70, g: 120, b: 200 }

  it('is small for pixels sharing the background hue', () => {
    const shadedBlue = { r: 90, g: 130, b: 190 }
    expect(hsvDistance(shadedBlue, blueBg)).toBeLessThan(0.1)
  })

  it('treats achromatic fur pixels as maximally distant from a chromatic background', () => {
    expect(hsvDistance({ r: 245, g: 243, b: 240 }, blueBg)).toBeCloseTo(1, 6)
    // 近黑毛近乎消色差，色相对彩色背景无区分意义 → 远离背景（判为前景）
    expect(hsvDistance({ r: 35, g: 33, b: 30 }, blueBg)).toBeGreaterThan(0.8)
  })

  it('degrades to a brightness key for achromatic backgrounds', () => {
    const gray = { r: 128, g: 128, b: 128 }
    expect(hsvDistance(gray, gray)).toBeCloseTo(0, 6)
    expect(hsvDistance({ r: 245, g: 243, b: 240 }, gray)).toBeGreaterThan(0.4)
  })
})

describe('rgbDistance', () => {
  it('is 0 for identical colors and 1 for maximally different', () => {
    const a = { r: 10, g: 200, b: 77 }
    expect(rgbDistance(a, a)).toBe(0)
    expect(rgbDistance({ r: 0, g: 0, b: 0 }, { r: 255, g: 255, b: 255 })).toBeCloseTo(1, 6)
  })
})

describe('ramp01', () => {
  it('returns 0 below edge0 and 1 above edge1', () => {
    expect(ramp01(0.05, 0.1, 0.2)).toBe(0)
    expect(ramp01(0.25, 0.1, 0.2)).toBe(1)
  })

  it('smoothsteps monotonically inside the band', () => {
    let prev = 0
    for (let i = 1; i <= 20; i++) {
      const v = ramp01(0.1 + (i / 20) * 0.1, 0.1, 0.2)
      expect(v).toBeGreaterThan(prev)
      prev = v
    }
    expect(prev).toBe(1)
  })

  it('degenerates to a hard threshold when the band collapses', () => {
    expect(ramp01(0.19, 0.2, 0.2)).toBe(0)
    expect(ramp01(0.2, 0.2, 0.2)).toBe(1)
  })
})
