import { describe, it, expect } from 'vitest'
import {
  chooseWalkDirection,
  planWalk,
  directionAfterWalk,
  type WalkPlanInput,
} from '../../src/main/scheduler/walk-planner'
import type { ClipMeta } from '../../src/shared/types/clip-meta'
import type { TrackFile } from '../../src/shared/types/track-file'
import type { WorkAreaBounds } from '../../src/shared/spatial'

// —— 测试辅助 —— //

function clip(overrides: Partial<ClipMeta> & Pick<ClipMeta, 'id' | 'state'>): ClipMeta {
  return {
    category: 'basic',
    direction: 'none',
    anchor: 'sit',
    loop: false,
    loopInSec: null,
    loopOutSec: null,
    signature: false,
    variant: 1,
    prop: false,
    embeddedAudio: false,
    audio: null,
    scaleHint: 1.0,
    hitbox: [0.1, 0.05, 0.8, 0.9],
    ...overrides,
  }
}

function makeTrack(offsets: number[], fps = 10, sourceWidth = 100): TrackFile {
  return {
    version: 1,
    fps,
    frameCount: offsets.length,
    sourceWidth,
    offsets,
    keypoints: [],
  }
}

/** 右行位移曲线：前 5 帧站定（offset=0），后 15 帧匀速右行（每帧 +2px） */
function rightwardTrack(): TrackFile {
  const offsets: number[] = []
  for (let i = 0; i < 5; i++) offsets.push(0)
  for (let i = 0; i < 15; i++) offsets.push((i + 1) * 2) // frames 5..19: 2,4,...,30
  return makeTrack(offsets)
}

/** 左行位移曲线：前 5 帧站定，后 15 帧匀速左行（每帧 -2px） */
function leftwardTrack(): TrackFile {
  const offsets: number[] = []
  for (let i = 0; i < 5; i++) offsets.push(0)
  for (let i = 0; i < 15; i++) offsets.push(-(i + 1) * 2)
  return makeTrack(offsets)
}

const BOUNDS: WorkAreaBounds = {
  x: 0,
  y: 0,
  width: 1920,
  height: 1080,
  groundLine: 1080,
}

function walkClips(): ClipMeta[] {
  return [
    clip({
      id: 'walk_right_01',
      state: 'walk',
      anchor: 'stand',
      direction: 'right',
      moveStartSec: 0.5,
      moveEndSec: 2.0,
      track: 'walk_right_01.track.json',
    }),
    clip({
      id: 'walk_left_01',
      state: 'walk',
      anchor: 'stand',
      direction: 'left',
      moveStartSec: 0.5,
      moveEndSec: 2.0,
      track: 'walk_left_01.track.json',
    }),
  ]
}

function baseWalkInput(overrides: Partial<WalkPlanInput>): WalkPlanInput {
  return {
    currentX: 500,
    bounds: BOUNDS,
    clips: walkClips(),
    track: rightwardTrack(),
    symmetrical: false,
    displayedWidthPx: 200,
    direction: 'right',
    ...overrides,
  }
}

// —— chooseWalkDirection —— //

describe('chooseWalkDirection (§7.3, §9)', () => {
  const clips = walkClips()

  it('forces right when at left edge', () => {
    const result = chooseWalkDirection(0 + 5, BOUNDS, clips, false)
    expect(result.direction).toBe('right')
    expect(result.forcedByEdge).toBe(true)
  })

  it('forces left when at right edge', () => {
    const result = chooseWalkDirection(1920 - 5, BOUNDS, clips, false)
    expect(result.direction).toBe('left')
    expect(result.forcedByEdge).toBe(true)
  })

  it('picks randomly when not at edge with both directions available', () => {
    const directions = new Set<WalkDirection>()
    for (let i = 0; i < 100; i++) {
      const result = chooseWalkDirection(960, BOUNDS, clips, false, () => i / 100)
      directions.add(result.direction)
      expect(result.forcedByEdge).toBe(false)
    }
    expect(directions.size).toBe(2)
  })

  it('picks available direction when only one exists', () => {
    const rightOnly = [clip({ id: 'walk_right_01', state: 'walk', anchor: 'stand', direction: 'right' })]
    const result = chooseWalkDirection(960, BOUNDS, rightOnly, false, () => 0.1)
    expect(result.direction).toBe('right')
  })
})

type WalkDirection = 'left' | 'right'

// —— planWalk —— //

describe('planWalk (§7.2, §9)', () => {
  it('plans a rightward walk with correct start/end positions', () => {
    const plan = planWalk(baseWalkInput({ direction: 'right' }))
    expect(plan).not.toBeNull()
    expect(plan!.clip.id).toBe('walk_right_01')
    expect(plan!.direction).toBe('right')
    expect(plan!.mirrored).toBe(false)
    expect(plan!.startX).toBe(500)
    expect(plan!.endX).toBeGreaterThan(plan!.startX)
  })

  it('plans a leftward walk with correct start/end positions', () => {
    const plan = planWalk(
      baseWalkInput({ direction: 'left', track: leftwardTrack() }),
    )
    expect(plan).not.toBeNull()
    expect(plan!.clip.id).toBe('walk_left_01')
    expect(plan!.direction).toBe('left')
    expect(plan!.endX).toBeLessThan(plan!.startX)
  })

  it('computes duration from track frameCount / fps', () => {
    const plan = planWalk(baseWalkInput({ direction: 'right' }))
    expect(plan).not.toBeNull()
    // 20 frames at 10fps = 2 seconds
    expect(plan!.clipDurationSec).toBeCloseTo(2.0, 1)
  })

  it('computes screen span from displacement × scale', () => {
    const plan = planWalk(
      baseWalkInput({ displayedWidthPx: 200, direction: 'right' }),
    )
    expect(plan).not.toBeNull()
    // Track: 20 frames at 10fps. frames 0-4 offset=0, frames 5-19 offset = 2,4,...,30
    // moveStartSec=0.5 → frame 5, offsets[5] = 2
    // moveEndSec=2.0 → clamped to frame 19, offsets[19] = 30
    // displacement = 30 - 2 = 28 curve pixels
    // scale = 200 / 100 = 2
    // span = 28 * 2 = 56 screen pixels
    expect(plan!.screenSpanPx).toBeCloseTo(56, 0)
  })

  it('detects edge collision when walk would reach boundary', () => {
    // Start very close to right edge; rightward walk should hit edge
    const plan = planWalk(
      baseWalkInput({ currentX: 1900, direction: 'right' }),
    )
    expect(plan).not.toBeNull()
    expect(plan!.wouldHitEdge).toBe(true)
    expect(plan!.edgeSide).toBe('right')
  })

  it('does not detect edge when walk stays within bounds', () => {
    const plan = planWalk(baseWalkInput({ currentX: 500, direction: 'right' }))
    expect(plan).not.toBeNull()
    expect(plan!.wouldHitEdge).toBe(false)
    expect(plan!.edgeSide).toBeNull()
  })

  it('mirrors for symmetric pets when only opposite direction available', () => {
    const rightOnlyClips = [
      clip({
        id: 'walk_right_01',
        state: 'walk',
        anchor: 'stand',
        direction: 'right',
        moveStartSec: 0.5,
        moveEndSec: 2.0,
      }),
    ]
    const plan = planWalk(
      baseWalkInput({
        clips: rightOnlyClips,
        direction: 'left',
        symmetrical: true,
        track: rightwardTrack(),
      }),
    )
    expect(plan).not.toBeNull()
    expect(plan!.mirrored).toBe(true)
    expect(plan!.clip.direction).toBe('right')
  })

  it('returns null when no walk clip available for asymmetric pet', () => {
    const rightOnlyClips = [
      clip({
        id: 'walk_right_01',
        state: 'walk',
        anchor: 'stand',
        direction: 'right',
      }),
    ]
    const plan = planWalk(
      baseWalkInput({
        clips: rightOnlyClips,
        direction: 'left',
        symmetrical: false,
      }),
    )
    expect(plan).toBeNull()
  })

  it('returns null when no walk clips at all', () => {
    const plan = planWalk(baseWalkInput({ clips: [] }))
    expect(plan).toBeNull()
  })
})

// —— directionAfterWalk —— //

describe('directionAfterWalk (§7.3)', () => {
  it('returns opposite direction when edge was hit', () => {
    const plan = planWalk(baseWalkInput({ currentX: 1900, direction: 'right' }))!
    expect(directionAfterWalk(plan)).toBe('left')
  })

  it('keeps same direction when no edge hit', () => {
    const plan = planWalk(baseWalkInput({ currentX: 500, direction: 'right' }))!
    expect(directionAfterWalk(plan)).toBe('right')
  })
})
