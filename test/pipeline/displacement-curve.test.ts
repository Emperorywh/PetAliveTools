import { describe, it, expect } from 'vitest'

import type { WalkFrameTrack } from '../../src/shared/pipeline/walk-tracker'
import {
  generateDisplacementCurve,
  applyKeypointCorrections,
  detectMoveSegment,
  frameToSec
} from '../../src/shared/pipeline/displacement-curve'

/** 构造跟踪帧（只需质心 x） */
function trackXs(xs: number[], feetY = 110): WalkFrameTrack[] {
  return xs.map((x, i) => ({ frameIndex: i, centroidX: x, centroidY: 50, feetY, foreground: true }))
}

describe('generateDisplacementCurve（位移曲线 track.json, §5.3）', () => {
  it('emits per-frame x offsets normalized to zero at the first frame', () => {
    const curve = generateDisplacementCurve(trackXs([60, 63, 66, 70]), 30, 240)

    expect(curve.version).toBe(1)
    expect(curve.fps).toBe(30)
    expect(curve.frameCount).toBe(4)
    expect(curve.sourceWidth).toBe(240)
    expect(curve.offsets).toHaveLength(4)
    expect(curve.offsets[0]).toBe(0)
    expect(curve.offsets[1]).toBeCloseTo(3, 6)
    expect(curve.offsets[3]).toBeCloseTo(10, 6)
    expect(curve.keypoints).toEqual([])
  })

  it('keeps negative offsets for leftward walks (方向由镜像处理，不取绝对值)', () => {
    const curve = generateDisplacementCurve(trackXs([100, 95, 90]), 30, 240)
    expect(curve.offsets[1]).toBeCloseTo(-5, 6)
    expect(curve.offsets[2]).toBeCloseTo(-10, 6)
  })

  it('throws on invalid input', () => {
    expect(() => generateDisplacementCurve([], 30, 240)).toThrow(/empty track/)
    expect(() => generateDisplacementCurve(trackXs([1]), 0, 240)).toThrow(/invalid fps/)
    expect(() => generateDisplacementCurve(trackXs([1]), 30, 0)).toThrow(/invalid sourceWidth/)
    expect(() => generateDisplacementCurve(trackXs([1]), 30, 1.5)).toThrow(/invalid sourceWidth/)
  })
})

describe('applyKeypointCorrections（手动校正关键点, §5.3 停顿/变速处）', () => {
  it('returns a copy of the raw curve when no keypoints exist', () => {
    const raw = [0, 1, 2, 3]
    const corrected = applyKeypointCorrections(raw, [])
    expect(corrected).toEqual(raw)
    expect(corrected).not.toBe(raw)
  })

  it('applies a constant residual shift with a single keypoint', () => {
    const raw = [0, 1, 2, 3, 4]
    // 第 2 帧跟踪残差 +10
    const corrected = applyKeypointCorrections(raw, [{ frame: 2, offset: 12 }])
    expect(corrected).toEqual([10, 11, 12, 13, 14])
  })

  it('passes exactly through keypoints and blends residuals linearly between them', () => {
    const raw = [0, 2, 4, 6, 8, 10]
    // 两个关键点：帧 1 → 2（残差 0），帧 4 → 13（残差 +5）
    const corrected = applyKeypointCorrections(raw, [
      { frame: 1, offset: 2 },
      { frame: 4, offset: 13 }
    ])

    expect(corrected[1]).toBeCloseTo(2, 6)
    expect(corrected[4]).toBeCloseTo(13, 6)
    // 帧间残差线性过渡：帧 2 → +5/3，帧 3 → +10/3
    expect(corrected[2]).toBeCloseTo(4 + 5 / 3, 6)
    expect(corrected[3]).toBeCloseTo(6 + 10 / 3, 6)
    // 关键点之前恒用第一个残差（0），之后恒用最后一个残差（+5）
    expect(corrected[0]).toBeCloseTo(0, 6)
    expect(corrected[5]).toBeCloseTo(15, 6)
    // 段间保留跟踪曲线局部形状（等差保持）
    expect(corrected[2] - corrected[1]).toBeCloseTo(corrected[3] - corrected[2], 6)
  })

  it('accepts unsorted keypoints and rejects duplicate or out-of-range frames', () => {
    const raw = [0, 1, 2]
    const corrected = applyKeypointCorrections(raw, [
      { frame: 2, offset: 5 },
      { frame: 0, offset: 3 }
    ])
    expect(corrected[0]).toBeCloseTo(3, 6)
    expect(corrected[2]).toBeCloseTo(5, 6)

    expect(() => applyKeypointCorrections(raw, [{ frame: 1, offset: 1 }, { frame: 1, offset: 2 }])).toThrow(
      /duplicate keypoint frame/
    )
    expect(() => applyKeypointCorrections(raw, [{ frame: 3, offset: 1 }])).toThrow(/out of range/)
  })
})

describe('detectMoveSegment（行走子段边界 moveStartSec/moveEndSec, §5.3/§7.2）', () => {
  /** 起站定 15 帧 → 匀速 1.2px/帧 → 止站定 15 帧（30fps） */
  function buildOffsets(): number[] {
    const offsets: number[] = []
    let x = 0
    for (let i = 0; i < 15; i++) offsets.push(x)
    for (let i = 0; i < 120; i++) {
      x += 1.2
      offsets.push(x)
    }
    for (let i = 0; i < 15; i++) offsets.push(x)
    return offsets
  }

  it('detects boundaries around the leading/trailing standing segments', () => {
    const offsets = buildOffsets()
    const seg = detectMoveSegment(offsets, 30)

    expect(seg).not.toBeNull()
    expect(seg!.moveStartFrame).toBe(15)
    expect(seg!.moveEndFrame).toBe(134)
    expect(seg!.moveStartSec).toBeCloseTo(0.5, 6)
    expect(seg!.moveEndSec).toBeCloseTo(134 / 30, 6)
  })

  it('ignores a mid-clip pause (中部停顿属于曲线平坦段)', () => {
    const offsets: number[] = []
    let x = 0
    for (let i = 0; i < 15; i++) offsets.push(x)
    for (let i = 0; i < 50; i++) {
      x += 1.2
      offsets.push(x)
    }
    for (let i = 0; i < 20; i++) offsets.push(x) // 中途停顿
    for (let i = 0; i < 50; i++) {
      x += 1.2
      offsets.push(x)
    }
    for (let i = 0; i < 15; i++) offsets.push(x)

    const seg = detectMoveSegment(offsets, 30)
    expect(seg!.moveStartFrame).toBe(15)
    expect(seg!.moveEndFrame).toBe(offsets.length - 16)
  })

  it('returns null when the pet never moves', () => {
    expect(detectMoveSegment([0, 0, 0, 0, 0], 30)).toBeNull()
  })

  it('treats the whole clip as the move segment when there is no standing pad', () => {
    const offsets = [0, 1, 2, 3, 4]
    const seg = detectMoveSegment(offsets, 30, { minStandFrames: 6 })
    expect(seg!.moveStartFrame).toBe(0)
    expect(seg!.moveEndFrame).toBe(4)
  })

  it('throws on invalid input', () => {
    expect(() => detectMoveSegment([], 30)).toThrow(/empty offsets/)
    expect(() => detectMoveSegment([0, 1], -1)).toThrow(/invalid fps/)
  })

  it('frameToSec converts frames to floating seconds', () => {
    expect(frameToSec(15, 30)).toBeCloseTo(0.5, 6)
    expect(frameToSec(7, 30)).toBeCloseTo(7 / 30, 6)
  })
})
