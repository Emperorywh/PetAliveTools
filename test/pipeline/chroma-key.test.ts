import { describe, it, expect } from 'vitest'
import {
  type RawFrame,
  BLUE_BACKGROUND,
  GRAY_BACKGROUND,
  applyChromaKey,
  createFrame,
  createSolidFrame,
  generateAlphaMask,
  setPixel
} from '../../src/shared/pipeline'
import { rgbLuma } from '../../src/shared/pipeline/color-space'

/** 在帧上画一个纯色像素块（便于手控测试场景） */
function fillPixel(frame: RawFrame, x: number, y: number, color: { r: number; g: number; b: number }): void {
  setPixel(frame, y * frame.width + x, color)
}

describe('generateAlphaMask — 色键 + 可调容差', () => {
  it('marks background pixels transparent and foreground opaque (蓝幕 / YCbCr)', () => {
    const frame = createSolidFrame(20, 10, BLUE_BACKGROUND, 2, 3)
    // 画面中央画一个橙猫色前景块
    fillPixel(frame, 10, 5, { r: 230, g: 150, b: 80 })

    const mask = generateAlphaMask(frame, { referenceColor: BLUE_BACKGROUND })
    expect(mask.width).toBe(20)
    expect(mask.height).toBe(10)

    // 角落是背景噪声 → 透明；中央是橙毛 → 不透明
    expect(mask.alpha[0]).toBeLessThanOrEqual(5)
    expect(mask.alpha[5 * 20 + 10]).toBeGreaterThanOrEqual(250)
  })

  it('increases background-keyed area as tolerance grows (单调)', () => {
    const frame = createSolidFrame(30, 20, BLUE_BACKGROUND, 3, 11)
    // 在背景中混入一些朝前景过渡的中间色像素
    for (let i = 0; i < 30; i++) {
      const t = i / 29
      const r = BLUE_BACKGROUND.r * (1 - t) + 230 * t
      const g = BLUE_BACKGROUND.g * (1 - t) + 150 * t
      const b = BLUE_BACKGROUND.b * (1 - t) + 80 * t
      fillPixel(frame, i, 5, { r, g, b })
    }

    let prevBg = 0
    for (const tol of [0.1, 0.25, 0.4, 0.6]) {
      const mask = generateAlphaMask(frame, { referenceColor: BLUE_BACKGROUND, tolerance: tol })
      const bg = mask.alpha.filter((a) => a < 128).length
      expect(bg).toBeGreaterThanOrEqual(prevBg)
      prevBg = bg
    }
    expect(prevBg).toBeGreaterThan(0)
  })

  it('produces soft intermediate alpha when softness > 0', () => {
    // 在硬阈值（softness=0）下不存在中间值；提高 softness 后软边带出现中间 alpha
    const frame = createSolidFrame(30, 1, BLUE_BACKGROUND, 3, 11)
    for (let i = 0; i < 30; i++) {
      const t = i / 29
      const r = BLUE_BACKGROUND.r * (1 - t) + 230 * t
      const g = BLUE_BACKGROUND.g * (1 - t) + 150 * t
      const b = BLUE_BACKGROUND.b * (1 - t) + 80 * t
      fillPixel(frame, i, 0, { r, g, b })
    }

    const hard = generateAlphaMask(frame, {
      referenceColor: BLUE_BACKGROUND,
      tolerance: 0.4,
      softness: 0
    })
    expect(hard.alpha.some((a) => a > 0 && a < 255)).toBe(false)

    const soft = generateAlphaMask(frame, {
      referenceColor: BLUE_BACKGROUND,
      tolerance: 0.4,
      softness: 0.5
    })
    expect(soft.alpha.some((a) => a > 0 && a < 255)).toBe(true)
  })

  it('treats achromatic fur as foreground against a chromatic background (HSV)', () => {
    const frame = createSolidFrame(10, 10, BLUE_BACKGROUND, 2, 3)
    fillPixel(frame, 5, 5, { r: 245, g: 243, b: 240 }) // 白毛
    const mask = generateAlphaMask(frame, { referenceColor: BLUE_BACKGROUND, colorSpace: 'hsv' })
    expect(mask.alpha[5 * 10 + 5]).toBeGreaterThanOrEqual(250)
  })
})

describe('generateAlphaMask — 灰幕质量悬崖与亮度权重', () => {
  it('cannot key white fur on gray background with pure chroma distance', () => {
    const frame = createSolidFrame(10, 10, GRAY_BACKGROUND, 1, 3)
    fillPixel(frame, 5, 5, { r: 245, g: 243, b: 240 }) // 白毛
    const mask = generateAlphaMask(frame, { referenceColor: GRAY_BACKGROUND, lumaWeight: 0 })
    // 灰幕 + 白毛色度同为中性 → 被误判为背景（§16 风险 1）
    expect(mask.alpha[5 * 10 + 5]).toBeLessThanOrEqual(5)
  })

  it('keys white fur on gray background with luma weight', () => {
    const frame = createSolidFrame(10, 10, GRAY_BACKGROUND, 1, 3)
    fillPixel(frame, 5, 5, { r: 245, g: 243, b: 240 })
    const mask = generateAlphaMask(frame, { referenceColor: GRAY_BACKGROUND, lumaWeight: 1 })
    expect(mask.alpha[5 * 10 + 5]).toBeGreaterThanOrEqual(250)
  })
})

describe('generateAlphaMask — 背景参考帧减除辅助', () => {
  const bandColor = { r: 118, g: 141, b: 176 } // 蓝幕与橙毛的中间色，落在色键软边带内

  function makeFrame(): RawFrame {
    const f = createFrame(2, 1)
    setPixel(f, 0, bandColor) // 软边带像素（场景中）
    setPixel(f, 1, bandColor)
    return f
  }

  it('reduces alpha when the pixel matches the reference frame (背景证据)', () => {
    const frame = makeFrame()
    // 像素0 与参考帧完全相同 → 背景证据
    const refSame = createFrame(2, 1)
    setPixel(refSame, 0, bandColor)
    setPixel(refSame, 1, bandColor)

    const withoutRef = generateAlphaMask(frame, {
      referenceColor: BLUE_BACKGROUND,
      tolerance: 0.4,
      softness: 0.8
    })
    const withRef = generateAlphaMask(frame, {
      referenceColor: BLUE_BACKGROUND,
      tolerance: 0.4,
      softness: 0.8,
      reference: { frame: refSame, tolerance: 0.05, influence: 1 }
    })
    // 软边带内（u≈0.2..0.8）参考帧匹配 → alpha 被压向背景
    expect(withRef.alpha[0]).toBeLessThan(withoutRef.alpha[0])
  })

  it('raises alpha when the pixel differs from the reference frame (前景证据)', () => {
    const frame = makeFrame()
    // 像素1 与参考帧差异巨大（毛色）→ 前景证据
    const refFar = createFrame(2, 1)
    setPixel(refFar, 0, bandColor)
    setPixel(refFar, 1, { r: 230, g: 150, b: 80 })

    const withoutRef = generateAlphaMask(frame, {
      referenceColor: BLUE_BACKGROUND,
      tolerance: 0.4,
      softness: 0.8
    })
    const withRef = generateAlphaMask(frame, {
      referenceColor: BLUE_BACKGROUND,
      tolerance: 0.4,
      softness: 0.8,
      reference: { frame: refFar, tolerance: 0.05, influence: 1 }
    })
    expect(withRef.alpha[1]).toBeGreaterThan(withoutRef.alpha[1])
  })

  it('does not affect regions where chroma already decides (稳定区域不受影响)', () => {
    // 纯背景像素：chromaAlpha=0（u=0）→ 辅助带权重 w=0，alpha 恒为 0
    const frame = createSolidFrame(2, 1, BLUE_BACKGROUND, 0, 3)
    const refWild = createFrame(2, 1)
    setPixel(refWild, 0, { r: 255, g: 0, b: 0 })
    setPixel(refWild, 1, { r: 0, g: 255, b: 0 })

    const withoutRef = generateAlphaMask(frame, { referenceColor: BLUE_BACKGROUND })
    const withRef = generateAlphaMask(frame, {
      referenceColor: BLUE_BACKGROUND,
      reference: { frame: refWild, tolerance: 0.05, influence: 1 }
    })
    expect(withRef.alpha[0]).toBe(withoutRef.alpha[0])
    expect(withRef.alpha[1]).toBe(withoutRef.alpha[1])
  })

  it('throws on dimension mismatch between frame and reference', () => {
    const frame = createSolidFrame(2, 1, BLUE_BACKGROUND)
    const ref = createSolidFrame(3, 1, BLUE_BACKGROUND)
    expect(() =>
      generateAlphaMask(frame, {
        referenceColor: BLUE_BACKGROUND,
        reference: { frame: ref, tolerance: 0.05 }
      })
    ).toThrow(/dimension mismatch/)
  })
})

describe('applyChromaKey — 完整管线', () => {
  it('produces a keyed frame whose alpha channel equals the mask and corners are transparent', () => {
    const frame = createSolidFrame(24, 12, BLUE_BACKGROUND, 2, 3)
    fillPixel(frame, 12, 6, { r: 230, g: 150, b: 80 })

    const result = applyChromaKey(frame, {
      referenceColor: BLUE_BACKGROUND,
      edge: { spillRange: 0.3, shrinkRadius: 1, featherRadius: 1 }
    })

    expect(result.width).toBe(24)
    expect(result.height).toBe(12)
    expect(result.alpha.length).toBe(24 * 12)
    // 角落透明
    expect(result.frame.data[3]).toBeLessThanOrEqual(5)
    // alpha 通道与返回蒙版一致
    for (let i = 0; i < result.alpha.length; i++) {
      expect(result.frame.data[i * 4 + 3]).toBe(result.alpha[i])
    }
  })

  it('does not mutate the input frame', () => {
    const frame = createSolidFrame(8, 8, BLUE_BACKGROUND, 0, 3)
    const before = new Uint8ClampedArray(frame.data)
    applyChromaKey(frame, { referenceColor: BLUE_BACKGROUND })
    expect(Array.from(frame.data)).toEqual(Array.from(before))
  })

  it('skips edge processing when edge=null', () => {
    const frame = createSolidFrame(10, 10, BLUE_BACKGROUND, 2, 3)
    fillPixel(frame, 5, 5, { r: 230, g: 150, b: 80 })

    const keyOnly = applyChromaKey(frame, { referenceColor: BLUE_BACKGROUND, edge: null })
    const mask = generateAlphaMask(frame, { referenceColor: BLUE_BACKGROUND })
    // 未做收缩/羽化/溢色：alpha 与原始色键蒙版完全一致
    expect(Array.from(keyOnly.alpha)).toEqual(Array.from(mask.alpha))
    // 源像素 RGB 不变（未做溢色抑制）
    expect(keyOnly.frame.data[(5 * 10 + 5) * 4]).toBe(230)
  })

  it('keeps foreground foreground luma close to the fur color (溢色抑制)', () => {
    const frame = createSolidFrame(8, 8, BLUE_BACKGROUND, 0, 3)
    // 中央一个被蓝幕色污染的橙毛像素
    const contaminated = { r: 150, g: 160, b: 200 }
    fillPixel(frame, 4, 4, contaminated)

    const result = applyChromaKey(frame, {
      referenceColor: BLUE_BACKGROUND,
      edge: { spillRange: 0.4, spillStrength: 1, shrinkRadius: 0, featherRadius: 0 }
    })
    const o = (4 * 8 + 4) * 4
    const before = rgbLuma(contaminated)
    const afterR = result.frame.data[o]
    // 溢色抑制把通道拉向自身亮度 → |afterR - luma| < |contaminatedR - luma|
    expect(Math.abs(afterR - before)).toBeLessThanOrEqual(Math.abs(contaminated.r - before))
  })
})
