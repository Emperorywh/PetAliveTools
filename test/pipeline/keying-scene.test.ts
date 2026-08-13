import { describe, it, expect } from 'vitest'
import {
  BLUE_BACKGROUND,
  FUR_BLACK,
  FUR_BROWN,
  FUR_ORANGE,
  FUR_WHITE,
  GRAY_BACKGROUND,
  applyChromaKey,
  createFurBlobScene,
  type RgbColor
} from '../../src/shared/pipeline'
import { ycbcrDistance } from '../../src/shared/pipeline/color-space'

const FUR_COLORS: { name: string; color: RgbColor }[] = [
  { name: '橙猫', color: FUR_ORANGE },
  { name: '白猫', color: FUR_WHITE },
  { name: '黑猫', color: FUR_BLACK },
  { name: '棕猫', color: FUR_BROWN }
]

describe('common pet fur colors against blue background (蓝幕 / YCbCr 默认)', () => {
  for (const fur of FUR_COLORS) {
    it(`keys ${fur.name} against blue cloth cleanly`, () => {
      const { frame, reference } = createFurBlobScene({
        width: 200,
        height: 150,
        background: BLUE_BACKGROUND,
        furColor: fur.color,
        radiusX: 50,
        radiusY: 50,
        seed: 42
      })

      const result = applyChromaKey(frame, {
        referenceColor: BLUE_BACKGROUND,
        edge: {}
      })

      // 角落（纯背景）透明
      expect(result.alpha[0]).toBeLessThanOrEqual(8)
      expect(result.alpha[149 * 200 + 199]).toBeLessThanOrEqual(8)

      // 团块中心不透明
      const cx = 100
      const cy = Math.floor(150 * 0.55)
      const centerIdx = cy * 200 + cx
      expect(result.alpha[centerIdx]).toBeGreaterThanOrEqual(250)

      // 任何仍不透明的像素都不残留背景色污染
      let violations = 0
      for (let i = 0; i < result.alpha.length; i++) {
        if (result.alpha[i] >= 200) {
          const px = {
            r: result.frame.data[i * 4],
            g: result.frame.data[i * 4 + 1],
            b: result.frame.data[i * 4 + 2]
          }
          if (ycbcrDistance(px, BLUE_BACKGROUND, 0) < 0.1) violations++
        }
      }
      expect(violations).toBe(0)

      // 前景面积合理（椭圆面积的合理区间）
      const fgCount = result.alpha.filter((a) => a > 128).length
      const ellipseArea = Math.PI * 50 * 50
      expect(fgCount).toBeGreaterThan(0.4 * ellipseArea)
      expect(fgCount).toBeLessThan(1.1 * ellipseArea)

      void reference
    })
  }
})

describe('common pet fur colors against gray background (灰幕 / lumaWeight)', () => {
  for (const fur of FUR_COLORS) {
    it(`keys ${fur.name} against gray cloth with luma weight`, () => {
      const { frame } = createFurBlobScene({
        width: 200,
        height: 150,
        background: GRAY_BACKGROUND,
        furColor: fur.color,
        radiusX: 50,
        radiusY: 50,
        seed: 42
      })

      const result = applyChromaKey(frame, {
        referenceColor: GRAY_BACKGROUND,
        lumaWeight: 1,
        edge: {}
      })

      expect(result.alpha[0]).toBeLessThanOrEqual(8)
      const cx = 100
      const cy = Math.floor(150 * 0.55)
      expect(result.alpha[cy * 200 + cx]).toBeGreaterThanOrEqual(240)
    })
  }
})

describe('synthetic scene determinism', () => {
  it('shares identical background noise between frame and reference frame', () => {
    const a = createFurBlobScene({
      width: 40,
      height: 30,
      background: BLUE_BACKGROUND,
      furColor: FUR_ORANGE,
      seed: 9
    })
    const b = createFurBlobScene({
      width: 40,
      height: 30,
      background: BLUE_BACKGROUND,
      furColor: FUR_ORANGE,
      seed: 9
    })
    expect(Array.from(a.frame.data)).toEqual(Array.from(b.frame.data))
    // 角落噪声逐像素一致
    expect(Array.from(a.reference.data.slice(0, 16))).toEqual(
      Array.from(b.reference.data.slice(0, 16))
    )
  })
})
