import { describe, it, expect } from 'vitest'
import {
  detectEdgeSide,
  directionAfterEdge,
  oppositeDirection,
  resolveDirectedClip,
  planEdgeTurn,
  DEFAULT_EDGE_MARGIN_PX
} from '../../src/shared/spatial'
import { computeGroundLine, type Rect } from '../../src/shared/spatial'
import type { ClipMeta } from '../../src/shared/types/clip-meta'

const WORK_AREA: Rect = { x: 0, y: 0, width: 1920, height: 1080 }
const bounds = computeGroundLine(WORK_AREA)

function makeClip(
  id: string,
  state: string,
  direction: 'left' | 'right' | 'none'
): ClipMeta {
  return {
    id,
    state,
    category: 'basic',
    direction,
    anchor: 'stand',
    loop: false,
    loopInSec: null,
    loopOutSec: null,
    signature: false,
    variant: 1,
    prop: false,
    embeddedAudio: false,
    audio: null,
    scaleHint: 1.0,
    hitbox: [0.1, 0.05, 0.8, 0.9]
  }
}

describe('detectEdgeSide (§7.3 边界检测)', () => {
  it('detects left edge when pet near left boundary', () => {
    expect(detectEdgeSide(5, bounds)).toBe('left')
    expect(detectEdgeSide(0, bounds)).toBe('left')
  })

  it('detects right edge when pet near right boundary', () => {
    expect(detectEdgeSide(1918, bounds)).toBe('right')
    expect(detectEdgeSide(1920, bounds)).toBe('right')
  })

  it('returns null when pet is mid-screen', () => {
    expect(detectEdgeSide(960, bounds)).toBeNull()
    expect(detectEdgeSide(500, bounds)).toBeNull()
  })

  it('respects custom margin', () => {
    expect(detectEdgeSide(40, bounds, 50)).toBe('left')
    expect(detectEdgeSide(60, bounds, 50)).toBeNull()
  })

  it('default margin is 8px', () => {
    expect(DEFAULT_EDGE_MARGIN_PX).toBe(8)
    expect(detectEdgeSide(7, bounds)).toBe('left')
    expect(detectEdgeSide(9, bounds)).toBeNull()
  })

  it('handles offset work area', () => {
    const wa: Rect = { x: 1920, y: 0, width: 2560, height: 1440 }
    const ob = computeGroundLine(wa)
    expect(detectEdgeSide(1925, ob)).toBe('left')
    expect(detectEdgeSide(4475, ob)).toBe('right')
  })
})

describe('directionAfterEdge / oppositeDirection (§7.3 方向改变)', () => {
  it('left edge → walk right', () => {
    expect(directionAfterEdge('left')).toBe('right')
  })
  it('right edge → walk left', () => {
    expect(directionAfterEdge('right')).toBe('left')
  })
  it('oppositeDirection flips', () => {
    expect(oppositeDirection('left')).toBe('right')
    expect(oppositeDirection('right')).toBe('left')
  })
})

describe('resolveDirectedClip (§4.3 方向与镜像)', () => {
  const walkRight = makeClip('walk_right_01', 'walk', 'right')
  const walkLeft = makeClip('walk_left_01', 'walk', 'left')

  it('uses direct match when clip direction matches', () => {
    const result = resolveDirectedClip([walkRight, walkLeft], 'walk', 'right', false)
    expect(result).not.toBeNull()
    expect(result!.clip.id).toBe('walk_right_01')
    expect(result!.mirrored).toBe(false)
  })

  it('mirrors opposite clip for symmetric pet', () => {
    // only walk_right exists, want left → mirror
    const result = resolveDirectedClip([walkRight], 'walk', 'left', true)
    expect(result).not.toBeNull()
    expect(result!.clip.id).toBe('walk_right_01')
    expect(result!.mirrored).toBe(true)
  })

  it('returns null for asymmetric pet when only opposite clip exists', () => {
    // only walk_right exists, want left, NOT symmetric → must have real left clip
    const result = resolveDirectedClip([walkRight], 'walk', 'left', false)
    expect(result).toBeNull()
  })

  it('returns null when no matching state clips exist', () => {
    const result = resolveDirectedClip([walkRight], 'turn', 'left', true)
    expect(result).toBeNull()
  })

  it('does not mirror direction=none clips', () => {
    const idle = makeClip('idle_01', 'idle_sit', 'none')
    const result = resolveDirectedClip([idle], 'idle_sit', 'right', true)
    expect(result).toBeNull()
  })
})

describe('planEdgeTurn (§7.3 边缘转身决策)', () => {
  const walkRight = makeClip('walk_right_01', 'walk', 'right')
  const walkLeft = makeClip('walk_left_01', 'walk', 'left')
  const turnRight = makeClip('turn_right_01', 'turn', 'right')
  const turnLeft = makeClip('turn_left_01', 'turn', 'left')

  it('returns null when pet is mid-screen', () => {
    expect(planEdgeTurn(960, bounds, [walkRight], false)).toBeNull()
  })

  it('at left edge: plan to walk right with turn clip', () => {
    const plan = planEdgeTurn(5, bounds, [walkRight, turnRight], false)
    expect(plan).not.toBeNull()
    expect(plan!.side).toBe('left')
    expect(plan!.nextDirection).toBe('right')
    expect(plan!.walk!.clip.id).toBe('walk_right_01')
    expect(plan!.turn!.clip.id).toBe('turn_right_01')
    expect(plan!.canProceed).toBe(true)
  })

  it('at right edge: plan to walk left', () => {
    const plan = planEdgeTurn(1918, bounds, [walkLeft, turnLeft], false)
    expect(plan).not.toBeNull()
    expect(plan!.side).toBe('right')
    expect(plan!.nextDirection).toBe('left')
  })

  it('symmetric pet can mirror when turn clip only exists for one direction', () => {
    const plan = planEdgeTurn(5, bounds, [walkRight, turnRight], true)
    expect(plan).not.toBeNull()
    expect(plan!.turn!.mirrored).toBe(false) // turn_right matches needed right
  })

  it('asymmetric pet without opposite walk clip cannot proceed (兜底)', () => {
    // at right edge → needs to walk LEFT; only have walk_right, asymmetric → can't mirror
    const plan = planEdgeTurn(1918, bounds, [walkRight], false)
    expect(plan).not.toBeNull()
    expect(plan!.nextDirection).toBe('left')
    expect(plan!.canProceed).toBe(false)
    expect(plan!.walk).toBeNull()
  })

  it('symmetric pet can proceed even without explicit opposite walk clip', () => {
    const plan = planEdgeTurn(5, bounds, [walkRight], true)
    expect(plan!.canProceed).toBe(true)
    expect(plan!.walk!.mirrored).toBe(false) // walk_right directly matches needed right
  })
})
