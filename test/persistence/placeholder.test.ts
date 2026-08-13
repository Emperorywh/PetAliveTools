import { describe, it, expect } from 'vitest'
import {
  PLACEHOLDER_CLIP_ID,
  createPlaceholderClip,
  resolveClipForState,
  getMissingStates,
  buildClipLookup,
  isPlaceholderClip,
} from '../../src/main/persistence/placeholder'
import type { ClipMeta } from '../../src/shared/types/clip-meta'
import { validateClipMeta } from '../../src/shared/schemas'

function testClip(state: string, id: string): ClipMeta {
  return {
    id,
    state,
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
  }
}

describe('createPlaceholderClip', () => {
  it('creates a generic idle_sit clip (§5.5)', () => {
    const clip = createPlaceholderClip()
    expect(clip.state).toBe('idle_sit')
    expect(clip.id).toBe(PLACEHOLDER_CLIP_ID)
    expect(clip.loop).toBe(true)
    expect(clip.anchor).toBe('sit')
    expect(clip.category).toBe('basic')
  })

  it('produces a structurally valid ClipMeta', () => {
    const clip = createPlaceholderClip()
    expect(validateClipMeta(clip)).toHaveLength(0)
  })

  it('has a full hitbox [x, y, w, h]', () => {
    const clip = createPlaceholderClip()
    expect(clip.hitbox).toHaveLength(4)
    for (const v of clip.hitbox) {
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThanOrEqual(1)
    }
  })
})

describe('resolveClipForState', () => {
  it('returns real clip when state has clips (§5.5)', () => {
    const clips = [testClip('idle_sit', 'idle_sit_01')]
    const result = resolveClipForState('idle_sit', clips)
    expect(result.id).toBe('idle_sit_01')
  })

  it('returns placeholder when state is missing (§5.5)', () => {
    const clips = [testClip('idle_sit', 'idle_sit_01')]
    const result = resolveClipForState('walk', clips)
    expect(result.id).toBe(PLACEHOLDER_CLIP_ID)
    expect(result.state).toBe('idle_sit')
  })

  it('returns placeholder when clips array is empty', () => {
    const result = resolveClipForState('sleep', [])
    expect(result.id).toBe(PLACEHOLDER_CLIP_ID)
  })

  it('returns first matching clip when multiple variants exist', () => {
    const clips = [
      testClip('idle_sit', 'idle_sit_01'),
      testClip('idle_sit', 'idle_sit_02'),
    ]
    const result = resolveClipForState('idle_sit', clips)
    expect(result.id).toBe('idle_sit_01')
  })
})

describe('getMissingStates', () => {
  const requiredStates = ['idle_sit', 'stand', 'walk', 'lie', 'sleep']

  it('identifies all missing states when clips array is empty', () => {
    const missing = getMissingStates(requiredStates, [])
    expect(missing).toEqual(requiredStates)
  })

  it('identifies no missing states when all present', () => {
    const clips = requiredStates.map((s) => testClip(s, `${s}_01`))
    const missing = getMissingStates(requiredStates, clips)
    expect(missing).toEqual([])
  })

  it('identifies partial missing states', () => {
    const clips = [
      testClip('idle_sit', 'idle_sit_01'),
      testClip('walk', 'walk_01'),
    ]
    const missing = getMissingStates(requiredStates, clips)
    expect(missing).toContain('stand')
    expect(missing).toContain('lie')
    expect(missing).toContain('sleep')
    expect(missing).not.toContain('idle_sit')
    expect(missing).not.toContain('walk')
  })

  it('ignores placeholder clips when computing availability', () => {
    const placeholder = createPlaceholderClip()
    const missing = getMissingStates(['idle_sit'], [placeholder])
    expect(missing).toContain('idle_sit')
  })
})

describe('buildClipLookup', () => {
  it('builds lookup with real clips for available states', () => {
    const requiredStates = ['idle_sit', 'walk']
    const clips = [testClip('idle_sit', 'idle_sit_01')]
    const lookup = buildClipLookup(requiredStates, clips)

    expect(lookup.get('idle_sit')?.id).toBe('idle_sit_01')
    expect(lookup.get('walk')?.id).toBe(PLACEHOLDER_CLIP_ID)
    expect(lookup.size).toBe(2)
  })
})

describe('isPlaceholderClip', () => {
  it('returns true for placeholder clip', () => {
    expect(isPlaceholderClip(createPlaceholderClip())).toBe(true)
  })

  it('returns false for real clip', () => {
    expect(isPlaceholderClip(testClip('idle_sit', 'real_clip'))).toBe(false)
  })
})
