/**
 * 行走跟踪全流程编排测试 (§5.3)
 *
 * 验证 buildWalkTrack 把色键后的帧序列走完
 * trackWalkFrames → generateDisplacementCurve → detectMoveSegment，
 * 产出与帧内容对应的位移曲线与行走子段。
 */
import { describe, it, expect } from 'vitest'

import {
  BLUE_BACKGROUND,
  FUR_ORANGE,
  applyChromaKey,
  createFurBlobScene,
  buildWalkTrack,
} from '../../src/shared/pipeline'
import type { KeyedFrame } from '../../src/shared/pipeline'

/** 合成行走帧序列：毛发团从左向右匀速移动，首尾站定 */
function makeWalkKeyedFrames(
  frameCount: number,
  width: number,
  height: number,
): KeyedFrame[] {
  const keyed: KeyedFrame[] = []
  const startX = 40
  const endX = width - 40
  const groundY = height - 20
  const rx = 20
  const ry = 16

  for (let i = 0; i < frameCount; i++) {
    let cx: number
    if (i < 15 || i >= frameCount - 15) {
      // 站定段
      cx = i < 15 ? startX : endX
    } else {
      // 匀速行走
      const t = (i - 15) / (frameCount - 30)
      cx = startX + (endX - startX) * t
    }
    const scene = createFurBlobScene({
      width,
      height,
      background: BLUE_BACKGROUND,
      furColor: FUR_ORANGE,
      centerX: cx,
      centerY: groundY - ry,
      radiusX: rx,
      radiusY: ry,
      edgeSoftnessPx: 2,
      noiseLevel: 3,
      seed: 1000 + i,
    })
    keyed.push(
      applyChromaKey(scene.frame, {
        referenceColor: BLUE_BACKGROUND,
        tolerance: 0.15,
        softness: 0.3,
        edge: { shrinkRadius: 1, featherRadius: 1 },
      }),
    )
  }
  return keyed
}

describe('buildWalkTrack', () => {
  it('produces displacement curve from keyed walk frames', () => {
    const fps = 30
    const frames = makeWalkKeyedFrames(90, 160, 120)
    const result = buildWalkTrack(frames, fps)

    expect(result.trackFile.fps).toBe(fps)
    expect(result.trackFile.frameCount).toBe(frames.length)
    expect(result.trackFile.offsets).toHaveLength(frames.length)
    // 起点归零
    expect(result.trackFile.offsets[0]).toBeCloseTo(0, 0)
    // 向右移动 → 末值为正
    expect(result.trackFile.offsets[frames.length - 1]).toBeGreaterThan(0)
  })

  it('detects move segment excluding head/tail standstill', () => {
    const fps = 30
    const frames = makeWalkKeyedFrames(90, 160, 120)
    const result = buildWalkTrack(frames, fps)

    expect(result.moveSegment).not.toBeNull()
    const seg = result.moveSegment!
    // 起始站定段之后
    expect(seg.moveStartFrame).toBeGreaterThanOrEqual(10)
    // 结束站定段之前
    expect(seg.moveEndFrame).toBeLessThanOrEqual(80)
    expect(seg.moveStartSec).toBeCloseTo(seg.moveStartFrame / fps, 5)
    expect(seg.moveEndSec).toBeCloseTo(seg.moveEndFrame / fps, 5)
  })

  it('returns null moveSegment for entirely static subject', () => {
    const fps = 30
    // 宠物始终在同一位置 → 无位移
    const keyed: KeyedFrame[] = []
    for (let i = 0; i < 30; i++) {
      const scene = createFurBlobScene({
        width: 120,
        height: 100,
        background: BLUE_BACKGROUND,
        furColor: FUR_ORANGE,
        centerX: 60,
        centerY: 60,
        radiusX: 20,
        radiusY: 16,
        seed: 2000 + i,
      })
      keyed.push(
        applyChromaKey(scene.frame, {
          referenceColor: BLUE_BACKGROUND,
          tolerance: 0.15,
          softness: 0.3,
          edge: { shrinkRadius: 1, featherRadius: 1 },
        }),
      )
    }
    const result = buildWalkTrack(keyed, fps)

    expect(result.trackFile.frameCount).toBe(30)
    // 无显著位移 → 所有 offset 接近 0
    expect(Math.abs(result.trackFile.offsets[29])).toBeLessThan(5)
    // 整段站定 → 无有效行走子段
    expect(result.moveSegment).toBeNull()
  })

  it('throws on empty frames', () => {
    expect(() => buildWalkTrack([], 30)).toThrow('empty')
  })
})
