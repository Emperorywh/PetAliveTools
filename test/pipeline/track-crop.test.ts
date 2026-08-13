import { describe, it, expect } from 'vitest'

import { createFrame, type RawFrame } from '../../src/shared/pipeline/frame'
import type { WalkFrameTrack } from '../../src/shared/pipeline/walk-tracker'
import { computeTrackCropRects, cropFrame } from '../../src/shared/pipeline/track-crop'

/** 构造跟踪帧（质心 + 足部行） */
function frame(
  frameIndex: number,
  centroidX: number,
  feetY: number,
  centroidY = 50
): WalkFrameTrack {
  return { frameIndex, centroidX, centroidY, feetY, foreground: true }
}

/** 构造源帧：指定矩形内白色不透明，其余全透明 */
function opaqueRectFrame(
  width: number,
  height: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number
): RawFrame {
  const f = createFrame(width, height)
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const o = (y * width + x) * 4
      f.data[o] = 255
      f.data[o + 1] = 255
      f.data[o + 2] = 255
      f.data[o + 3] = 255
    }
  }
  return f
}

/** 帧内最下方非透明行；无前景返回 -1 */
function deepestRow(f: RawFrame): number {
  for (let y = f.height - 1; y >= 0; y--) {
    for (let x = 0; x < f.width; x++) {
      if (f.data[(y * f.width + x) * 4 + 3] > 0) return y
    }
  }
  return -1
}

/** 帧内前景（非透明）的水平中心 */
function opaqueCenterX(f: RawFrame): number {
  let min = Infinity
  let max = -Infinity
  for (let y = 0; y < f.height; y++) {
    for (let x = 0; x < f.width; x++) {
      if (f.data[(y * f.width + x) * 4 + 3] > 0) {
        min = Math.min(min, x)
        max = Math.max(max, x)
      }
    }
  }
  return (min + max) / 2
}

describe('computeTrackCropRects（跟踪裁切矩形）', () => {
  it('follows the centroid so the pet stays centered in the fixed-width crop (§5.3)', () => {
    const track = [frame(0, 60, 110), frame(1, 100, 110), frame(2, 140, 110)]
    const rects = computeTrackCropRects(track, { width: 100, height: 180 })

    // 裁切原点 x = 质心 x − 定宽中心 50
    expect(rects.map((r) => r.x)).toEqual([10, 50, 90])
    // 宠物在输出画面中的位置恒为 centerX
    track.forEach((t, i) => {
      expect(t.centroidX - rects[i].x).toBeCloseTo(50, 6)
    })
  })

  it('locks the feet row to the output ground line regardless of source feetY (§5.3)', () => {
    // 源画面足部行在 100/102/101 间摆动
    const feetRows = [100, 102, 101]
    const track = feetRows.map((fy, i) => frame(i, 60, fy))
    const rects = computeTrackCropRects(track, { width: 100, height: 180, groundY: 120 })

    feetRows.forEach((fy, i) => {
      expect(fy - rects[i].y).toBe(120)
    })
  })

  it('defaults centerX to width/2 and groundY to height-1', () => {
    const rects = computeTrackCropRects([frame(0, 70, 179)], { width: 100, height: 180 })
    expect(rects[0].x).toBe(20)
    expect(rects[0].y).toBe(0)
  })

  it('throws on invalid crop dimensions', () => {
    expect(() => computeTrackCropRects([frame(0, 50, 100)], { width: 0, height: 180 })).toThrow(
      /invalid track-crop dimensions/
    )
    expect(() =>
      computeTrackCropRects([frame(0, 50, 100)], { width: 100, height: -2 })
    ).toThrow(/invalid track-crop dimensions/)
  })
})

describe('cropFrame（裁切 + 越界透明填充）', () => {
  it('crops with transparent padding so the pet stays centered near the right edge', () => {
    // 源宽 240，团块 x 220..240（质心 229.5），定宽 100 → 裁切原点 180，
    // 右侧 40px 越界补全透明，团块在输出内仍居中
    const src = opaqueRectFrame(240, 180, 220, 40, 240, 60)
    const out = cropFrame(src, { x: 180, y: 0 }, 100, 180)

    expect(out.width).toBe(100)
    expect(out.height).toBe(180)
    expect(opaqueCenterX(out)).toBeCloseTo(49.5, 6)
    // 越界区域全透明
    let opaqueRightmost = 0
    for (let y = 0; y < out.height; y++) {
      for (let x = 60; x < out.width; x++) {
        if (out.data[(y * out.width + x) * 4 + 3] > 0) opaqueRightmost = x
      }
    }
    expect(opaqueRightmost).toBeLessThan(60)
  })

  it('maps source pixels to output coordinates exactly', () => {
    const src = opaqueRectFrame(240, 180, 100, 90, 101, 91)
    const out = cropFrame(src, { x: 80, y: 70 }, 100, 180)
    const o = ((90 - 70) * 100 + (100 - 80)) * 4
    expect(Array.from(out.data.slice(o, o + 4))).toEqual([255, 255, 255, 255])
    // 输出其余位置全透明
    let opaqueCount = 0
    for (let i = 3; i < out.data.length; i += 4) {
      if (out.data[i] > 0) opaqueCount++
    }
    expect(opaqueCount).toBe(1)
  })

  it('keeps the feet on the ground line across frames with varying feetY', () => {
    // 三帧足部行 100/102/101 → 裁切后输出足部行恒为 groundY 120
    const feetRows = [100, 102, 101]
    const groundY = 120
    const outs = feetRows.map((fy) => {
      // 团块底部即足部行（opaqueRectFrame 为半开区间，y1 = fy+1）
      const src = opaqueRectFrame(240, 180, 100, fy - 30, 140, fy + 1)
      const rectY = fy - groundY
      return cropFrame(src, { x: 10, y: rectY }, 100, 180)
    })

    for (const out of outs) {
      expect(deepestRow(out)).toBe(groundY)
    }
  })

  it('throws on invalid crop dimensions', () => {
    const src = opaqueRectFrame(10, 10, 0, 0, 10, 10)
    expect(() => cropFrame(src, { x: 0, y: 0 }, 0, 10)).toThrow(/invalid crop dimensions/)
    expect(() => cropFrame(src, { x: 0, y: 0 }, 10, 1.5)).toThrow(/invalid crop dimensions/)
  })
})
