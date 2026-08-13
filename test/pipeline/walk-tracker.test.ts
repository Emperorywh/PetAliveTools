import { describe, it, expect } from 'vitest'

import {
  type TrackableAlpha,
  trackWalkFrame,
  trackWalkFrames
} from '../../src/shared/pipeline/walk-tracker'

/** 构造纯 alpha 蒙版：矩形团块（alpha 默认 255），其余透明 */
function rectAlpha(
  width: number,
  height: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  alphaValue = 255
): TrackableAlpha {
  const alpha = new Uint8Array(width * height)
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      alpha[y * width + x] = alphaValue
    }
  }
  return { width, height, alpha }
}

/** 构造空蒙版 */
function emptyAlpha(width: number, height: number): TrackableAlpha {
  return { width, height, alpha: new Uint8Array(width * height) }
}

describe('trackWalkFrame（单帧测量）', () => {
  it('produces per-frame x and y coordinates of the pet (§5.3 质心)', () => {
    // 40×30 团块，中心 (60, 50)
    const m = trackWalkFrame(rectAlpha(240, 180, 40, 35, 80, 65), 0)
    expect(m.frameIndex).toBe(0)
    expect(m.centroidX).toBeCloseTo(59.5, 5) // (40+80)/2 - 0.5 像素中心
    expect(m.centroidY).toBeCloseTo(49.5, 5)
    expect(m.foreground).toBe(true)
  })

  it('weights the centroid by alpha (软边像素按不透明度计入)', () => {
    // 两块同尺寸团块：x≈30 处全不透明，x≈70 处半透明（均高于默认阈值）
    const width = 120
    const height = 40
    const alpha = new Uint8Array(width * height)
    for (let y = 10; y < 20; y++) {
      for (let x = 20; x < 40; x++) alpha[y * width + x] = 255
      for (let x = 60; x < 80; x++) alpha[y * width + x] = 160
    }
    const m = trackWalkFrame({ width, height, alpha }, 3)
    // 质心被拉向更重的左侧团块（左侧中心 29.5，右侧中心 69.5，中点 49.5）
    expect(m.centroidX).toBeGreaterThan(29.5)
    expect(m.centroidX).toBeLessThan(49.5)
  })

  it('reports feetY as the deepest foreground row', () => {
    const m = trackWalkFrame(rectAlpha(240, 180, 100, 90, 140, 111), 0)
    expect(m.feetY).toBe(110)
  })

  it('ignores sparse noise rows below the feet (行覆盖率过滤)', () => {
    const width = 240
    const alpha = new Uint8Array(width * 180)
    // 团块：y 90..111
    for (let y = 90; y < 111; y++) {
      for (let x = 100; x < 140; x++) alpha[y * width + x] = 255
    }
    // 单像素散噪在 y=150（覆盖率 1/240 远低于阈值）
    alpha[150 * width + 10] = 255
    const m = trackWalkFrame({ width, height: 180, alpha }, 0)
    expect(m.feetY).toBe(110)
  })

  it('flags empty frames and falls back to bottom-center', () => {
    const m = trackWalkFrame(emptyAlpha(240, 180), 7)
    expect(m.foreground).toBe(false)
    expect(m.centroidX).toBe(120)
    expect(m.centroidY).toBe(179)
    expect(m.feetY).toBe(179)
  })
})

describe('trackWalkFrames（整段逐帧跟踪）', () => {
  it('tracks the pet moving right across frames (逐帧质心序列)', () => {
    const xs = [60, 90, 120, 150]
    const alphas = xs.map((x) => rectAlpha(240, 180, x - 20, 40, x + 20, 70))
    const track = trackWalkFrames(alphas, { smoothingRadius: 0 })

    expect(track).toHaveLength(4)
    track.forEach((t, i) => {
      expect(t.frameIndex).toBe(i)
      expect(t.foreground).toBe(true)
      expect(t.centroidX).toBeCloseTo(xs[i] - 0.5, 5)
    })
  })

  it('carries forward coordinates across empty frames with foreground=false', () => {
    const alphas = [
      rectAlpha(240, 180, 40, 40, 80, 70),
      rectAlpha(240, 180, 70, 40, 110, 70),
      emptyAlpha(240, 180),
      rectAlpha(240, 180, 130, 40, 170, 70)
    ]
    const track = trackWalkFrames(alphas, { smoothingRadius: 0 })
    expect(track[2].foreground).toBe(false)
    expect(track[2].centroidX).toBeCloseTo(track[1].centroidX, 5)
    expect(track[2].feetY).toBe(track[1].feetY)
    expect(track[3].foreground).toBe(true)
  })

  it('smooths centroid jitter with a centered moving average', () => {
    // 注入 ±2 交替抖动，半径 1 的中心化均值应显著收敛
    const xs = [60, 62, 58, 62, 58, 60]
    const alphas = xs.map((x) => rectAlpha(240, 180, x - 10, 40, x + 10, 70))
    const track = trackWalkFrames(alphas, { smoothingRadius: 1 })

    const rawSpread = Math.max(...xs) - Math.min(...xs)
    const smoothedXs = track.map((t) => t.centroidX)
    const smoothedSpread = Math.max(...smoothedXs) - Math.min(...smoothedXs)
    expect(smoothedSpread).toBeLessThan(rawSpread)
    // 中间帧 = 相邻三帧均值（测量值 = x − 0.5 像素中心）
    expect(track[2].centroidX).toBeCloseTo((62 + 58 + 62 - 1.5) / 3, 3)
  })

  it('returns empty for empty input and keeps smoothing off at radius 0', () => {
    expect(trackWalkFrames([])).toEqual([])
    const alphas = [rectAlpha(100, 80, 40, 30, 60, 50), rectAlpha(100, 80, 42, 30, 62, 50)]
    const [a, b] = trackWalkFrames(alphas, { smoothingRadius: 0 })
    expect(a.centroidX).toBeCloseTo(49.5, 5)
    expect(b.centroidX).toBeCloseTo(51.5, 5)
  })
})
