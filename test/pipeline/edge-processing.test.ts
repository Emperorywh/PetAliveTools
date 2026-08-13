import { describe, it, expect } from 'vitest'
import {
  BLUE_BACKGROUND,
  type RawFrame,
  cloneFrame,
  createFrame,
  featherAlpha,
  setPixel,
  shrinkAlpha,
  suppressSpill
} from '../../src/shared/pipeline'
import { rgbLuma, ycbcrDistance } from '../../src/shared/pipeline/color-space'

function makeAlpha1d(values: number[]): Uint8Array {
  return Uint8Array.from(values)
}

describe('suppressSpill', () => {
  it('pulls contaminated foreground channels toward their own luma', () => {
    const frame = createFrame(1, 1)
    const contaminated = { r: 150, g: 160, b: 200 }
    setPixel(frame, 0, contaminated)
    const alpha = new Uint8Array([255])

    const out = suppressSpill(frame, alpha, BLUE_BACKGROUND, { spillRange: 0.4 })
    const luma = rgbLuma(contaminated)
    expect(Math.abs(out.data[0] - luma)).toBeLessThan(Math.abs(contaminated.r - luma))
    expect(Math.abs(out.data[1] - luma)).toBeLessThan(Math.abs(contaminated.g - luma))
    expect(Math.abs(out.data[2] - luma)).toBeLessThan(Math.abs(contaminated.b - luma))
  })

  it('is a no-op when spillStrength is 0', () => {
    const frame = createFrame(1, 1)
    setPixel(frame, 0, { r: 150, g: 160, b: 200 })
    const alpha = new Uint8Array([255])
    const out = suppressSpill(frame, alpha, BLUE_BACKGROUND, { spillStrength: 0 })
    expect(out.data[0]).toBe(150)
    expect(out.data[1]).toBe(160)
    expect(out.data[2]).toBe(200)
  })

  it('does not touch background pixels (alpha=0)', () => {
    const frame = createFrame(1, 1)
    setPixel(frame, 0, { r: 150, g: 160, b: 200 })
    const out = suppressSpill(frame, new Uint8Array([0]), BLUE_BACKGROUND, { spillRange: 0.4 })
    expect(out.data[0]).toBe(150)
    expect(out.data[1]).toBe(160)
    expect(out.data[2]).toBe(200)
  })

  it('does not mutate the input frame', () => {
    const frame = createFrame(1, 1)
    setPixel(frame, 0, { r: 150, g: 160, b: 200 })
    const before = cloneFrame(frame)
    suppressSpill(frame, new Uint8Array([255]), BLUE_BACKGROUND, { spillRange: 0.4 })
    expect(Array.from(frame.data)).toEqual(Array.from(before.data))
  })
})

describe('shrinkAlpha', () => {
  it('erodes an isolated pixel away', () => {
    const alpha = makeAlpha1d([0, 0, 0, 0, 255, 0, 0, 0, 0])
    const out = shrinkAlpha(alpha, 3, 3, { shrinkRadius: 1 })
    expect(out.every((v) => v === 0)).toBe(true)
  })

  it('keeps the interior of a solid block but removes the outer ring', () => {
    // 7×7：中央 5×5 全 255，外围 1px 边框为 0（背景）
    const alpha = new Uint8Array(7 * 7)
    for (let y = 1; y <= 5; y++) {
      for (let x = 1; x <= 5; x++) {
        alpha[y * 7 + x] = 255
      }
    }
    const out = shrinkAlpha(alpha, 7, 7, { shrinkRadius: 1 })
    // 腐蚀吃掉 5×5 块自身的最外圈，仅剩中央 3×3（rows 2..4, cols 2..4）
    expect(out[1 * 7 + 1]).toBe(0) // 块左上角被腐蚀
    expect(out[2 * 7 + 2]).toBe(255) // 中央 3×3 保留
    expect(out[3 * 7 + 3]).toBe(255) // 块正中心
    expect(out[4 * 7 + 4]).toBe(255) // 中央 3×3 右下
    expect(out[0]).toBe(0) // 背景保持
  })

  it('is identity when radius is 0', () => {
    const alpha = makeAlpha1d([0, 255, 128, 0])
    const out = shrinkAlpha(alpha, 4, 1, { shrinkRadius: 0 })
    expect(Array.from(out)).toEqual(Array.from(alpha))
  })
})

describe('featherAlpha', () => {
  it('keeps interiors 255 and far background 0 while smoothing the boundary', () => {
    const alpha = new Uint8Array(8).fill(255)
    alpha[0] = 0
    alpha[1] = 0
    // [0,0,255,255,255,255,255,255]
    const out = featherAlpha(alpha, 8, 1, { featherRadius: 1 })
    expect(out[0]).toBeLessThanOrEqual(5)
    expect(out[7]).toBeGreaterThanOrEqual(250)
    expect(out.some((v) => v > 5 && v < 250)).toBe(true)
  })

  it('is monotonic across a single hard edge', () => {
    const alpha = new Uint8Array(10)
    for (let i = 0; i < 5; i++) alpha[i] = 0
    for (let i = 5; i < 10; i++) alpha[i] = 255
    const out = featherAlpha(alpha, 10, 1, { featherRadius: 1 })
    for (let i = 1; i < 9; i++) {
      expect(out[i]).toBeGreaterThanOrEqual(out[i - 1])
    }
  })

  it('is identity when radius is 0', () => {
    const alpha = makeAlpha1d([0, 255, 128, 64])
    const out = featherAlpha(alpha, 4, 1, { featherRadius: 0 })
    expect(Array.from(out)).toEqual(Array.from(alpha))
  })
})

describe('edge processing integration', () => {
  it('shrink+feather removes fringe color residue on opaque pixels (蓝幕)', () => {
    // 构造一帧：纯背景，中央一团橙毛（用足够大区域避免被整体腐蚀）
    const frame: RawFrame = createFrame(20, 20)
    for (let y = 0; y < 20; y++) {
      for (let x = 0; x < 20; x++) {
        const isFur = x >= 6 && x <= 13 && y >= 6 && y <= 13
        setPixel(frame, y * 20 + x, isFur ? { r: 230, g: 150, b: 80 } : BLUE_BACKGROUND)
      }
    }

    // alpha：前景块区域 255，其余 0
    const alpha = new Uint8Array(20 * 20)
    for (let y = 6; y <= 13; y++) {
      for (let x = 6; x <= 13; x++) {
        alpha[y * 20 + x] = 255
      }
    }

    const suppressed = suppressSpill(frame, alpha, BLUE_BACKGROUND, {
      spillRange: 0.3,
      spillStrength: 1
    })
    const shrunk = shrinkAlpha(alpha, 20, 20, { shrinkRadius: 1 })
    const feathered = featherAlpha(shrunk, 20, 20, { featherRadius: 1 })

    // 任何仍不透明（≥200）的像素都不应残留蓝幕色污染
    let violations = 0
    for (let i = 0; i < feathered.length; i++) {
      if (feathered[i] >= 200) {
        const px = { r: suppressed.data[i * 4], g: suppressed.data[i * 4 + 1], b: suppressed.data[i * 4 + 2] }
        if (ycbcrDistance(px, BLUE_BACKGROUND, 0) < 0.1) violations++
      }
    }
    expect(violations).toBe(0)
  })
})
