import { describe, it, expect } from 'vitest'
import {
  sampleDisplacementAt,
  computeWalkScale,
  walkDisplacementPx,
  walkWindowX,
  walkScreenSpan,
  type WalkWindowMapping
} from '../../src/shared/spatial'
import type { TrackFile } from '../../src/shared/types/track-file'

/** 构造位移曲线：前 10 帧站定（offset=0），后 20 帧匀速右行（每帧 +2px） */
function makeRightwardTrack(): TrackFile {
  const offsets: number[] = []
  for (let i = 0; i < 10; i++) offsets.push(0)
  for (let i = 0; i < 20; i++) offsets.push((i + 1) * 2) // frames 10..29: 2,4,...,40
  return { version: 1, fps: 10, frameCount: 30, sourceWidth: 100, offsets, keypoints: [] }
}

/** 左行：offsets 为负 */
function makeLeftwardTrack(): TrackFile {
  const offsets: number[] = []
  for (let i = 0; i < 10; i++) offsets.push(0)
  for (let i = 0; i < 20; i++) offsets.push(-(i + 1) * 2)
  return { version: 1, fps: 10, frameCount: 30, sourceWidth: 100, offsets, keypoints: [] }
}

describe('sampleDisplacementAt (§7.2 曲线采样)', () => {
  const track = makeRightwardTrack()

  it('returns offsets[0] = 0 at t=0', () => {
    expect(sampleDisplacementAt(track, 0)).toBe(0)
  })

  it('returns exact frame value at integer frame time', () => {
    // frame 15 → offsets[15] = (15-9)*2 = 12
    expect(sampleDisplacementAt(track, 1.5)).toBeCloseTo(12, 6)
  })

  it('linearly interpolates between frames', () => {
    // frame 10.5 → between offsets[10]=2 and offsets[11]=4 → 3
    expect(sampleDisplacementAt(track, 1.05)).toBeCloseTo(3, 6)
  })

  it('clamps to last frame when t exceeds duration', () => {
    expect(sampleDisplacementAt(track, 999)).toBeCloseTo(40, 6)
  })

  it('clamps to first frame when t < 0', () => {
    expect(sampleDisplacementAt(track, -5)).toBe(0)
  })
})

describe('computeWalkScale (§7.2 scale = 显示宽度 / sourceWidth)', () => {
  it('computes screen px per track px', () => {
    const track = makeRightwardTrack()
    // displayed 200px, track source 100px → scale 2
    expect(computeWalkScale(200, track)).toBeCloseTo(2, 6)
  })

  it('handles displayed width smaller than source', () => {
    const track = makeRightwardTrack()
    expect(computeWalkScale(50, track)).toBeCloseTo(0.5, 6)
  })

  it('throws on invalid displayedWidth', () => {
    expect(() => computeWalkScale(0, makeRightwardTrack())).toThrow(/displayedWidth/)
    expect(() => computeWalkScale(-1, makeRightwardTrack())).toThrow(/displayedWidth/)
  })
})

describe('walkDisplacementPx (§7.2 行走子段门控)', () => {
  const track = makeRightwardTrack()
  // moveStartSec = 1.0 (frame 10), moveEndSec = 2.9 (frame 29)

  it('returns 0 during standing segment before moveStartSec', () => {
    expect(walkDisplacementPx(track, 0, 1.0, 2.9)).toBe(0)
    expect(walkDisplacementPx(track, 0.5, 1.0, 2.9)).toBe(0)
    expect(walkDisplacementPx(track, 1.0, 1.0, 2.9)).toBe(0)
  })

  it('returns positive displacement during move segment, relative to moveStart value', () => {
    // at t=1.5 (frame 15): offsets[15]=12, offsets[10]=2 → 10
    expect(walkDisplacementPx(track, 1.5, 1.0, 2.9)).toBeCloseTo(10, 6)
  })

  it('holds at moveEnd value after moveEndSec', () => {
    // at t=2.9: offsets[29]=40, offsets[10]=2 → 38
    expect(walkDisplacementPx(track, 2.9, 1.0, 2.9)).toBeCloseTo(38, 6)
    expect(walkDisplacementPx(track, 5.0, 1.0, 2.9)).toBeCloseTo(38, 6)
  })

  it('is continuous at moveStartSec boundary (no jump)', () => {
    const justBefore = walkDisplacementPx(track, 1.0, 1.0, 2.9)
    const justAfter = walkDisplacementPx(track, 1.001, 1.0, 2.9)
    expect(justAfter - justBefore).toBeLessThan(0.5)
  })
})

describe('walkWindowX (§7.2 主公式: window.x = startX + sign × displacement(t) × scale)', () => {
  const track = makeRightwardTrack()

  it('computes rightward window position with sign=+1', () => {
    const mapping: WalkWindowMapping = {
      track,
      moveStartSec: 1.0,
      moveEndSec: 2.9,
      scale: 2,
      sign: 1,
      startX: 100
    }
    // t=0 (站定): startX = 100
    expect(walkWindowX(mapping, 0)).toBe(100)
    // t=1.5: startX + (12-2)*2 = 100 + 20 = 120
    expect(walkWindowX(mapping, 1.5)).toBeCloseTo(120, 6)
  })

  it('mirrors direction with sign=-1 (镜像播放)', () => {
    const mapping: WalkWindowMapping = {
      track,
      moveStartSec: 1.0,
      moveEndSec: 2.9,
      scale: 2,
      sign: -1,
      startX: 500
    }
    // t=0 (站定): startX = 500
    expect(walkWindowX(mapping, 0)).toBe(500)
    // t=1.5: startX - (12-2)*2 = 500 - 20 = 480
    expect(walkWindowX(mapping, 1.5)).toBeCloseTo(480, 6)
  })

  it('stationary (startX) throughout the standing segment', () => {
    const mapping: WalkWindowMapping = {
      track,
      moveStartSec: 1.0,
      moveEndSec: 2.9,
      scale: 1,
      sign: 1,
      startX: 200
    }
    for (const t of [0, 0.3, 0.6, 0.9, 1.0]) {
      expect(walkWindowX(mapping, t)).toBe(200)
    }
  })

  it('leftward track with sign=+1 walks left (negative displacement)', () => {
    const leftTrack = makeLeftwardTrack()
    const mapping: WalkWindowMapping = {
      track: leftTrack,
      moveStartSec: 1.0,
      moveEndSec: 2.9,
      scale: 2,
      sign: 1,
      startX: 500
    }
    // t=1.5: offsets[15]=-12, offsets[10]=-2 → -10, × 2 → -20 → 480
    expect(walkWindowX(mapping, 1.5)).toBeCloseTo(480, 6)
  })
})

describe('walkScreenSpan (§7.2 屏幕跨度标定)', () => {
  it('returns absolute screen span for a move segment', () => {
    const track = makeRightwardTrack()
    const mapping: WalkWindowMapping = {
      track,
      moveStartSec: 1.0,
      moveEndSec: 2.9,
      scale: 2,
      sign: 1,
      startX: 100
    }
    // (40 - 2) * 2 = 76
    expect(walkScreenSpan(mapping)).toBeCloseTo(76, 6)
  })
})
