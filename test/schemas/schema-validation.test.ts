import { describe, it, expect } from 'vitest'
import {
  validatePersona,
  validateNeedsState,
  validateBehaviorConfig,
  validateClipMeta,
  validateClipMetaArray,
  validateAudioMeta,
  validateAudioMetaArray,
} from '../../src/shared/schemas'
import type { ClipMeta } from '../../src/shared/types/clip-meta'

/** 从对象中移除指定键，返回新对象（用于测试缺失字段场景） */
function omit<T extends object>(obj: T, key: string): Partial<T> {
  const copy = { ...obj } as Record<string, unknown>
  delete copy[key]
  return copy as Partial<T>
}

// ── Persona ── //

describe('validatePersona', () => {
  const valid = {
    name: '小橘',
    symmetrical: false,
    personality: {
      liveliness: 0.8,
      laziness: 0.3,
      clinginess: 0.6,
      timidity: 0.2,
      curiosity: 0.7,
    },
  }

  it('accepts a valid persona (§9.6, §4.3)', () => {
    expect(validatePersona(valid)).toHaveLength(0)
  })

  it('rejects missing name', () => {
    const errors = validatePersona({ ...valid, name: '' })
    expect(errors).toContain('persona.name: expected a non-empty string')
  })

  it('rejects missing symmetrical', () => {
    const rest = omit(valid, 'symmetrical')
    const errors = validatePersona(rest)
    expect(errors.some((e) => e.includes('persona.symmetrical'))).toBe(true)
  })

  it('rejects personality dimension out of range', () => {
    const errors = validatePersona({
      ...valid,
      personality: { ...valid.personality, liveliness: 1.5 },
    })
    expect(errors.some((e) => e.includes('liveliness'))).toBe(true)
  })

  it('rejects personality dimension below zero', () => {
    const errors = validatePersona({
      ...valid,
      personality: { ...valid.personality, timidity: -0.1 },
    })
    expect(errors.some((e) => e.includes('timidity'))).toBe(true)
  })

  it('rejects non-object input', () => {
    expect(validatePersona(null)).toHaveLength(1)
    expect(validatePersona(42)).toHaveLength(1)
  })
})

// ── NeedsState ── //

describe('validateNeedsState', () => {
  const valid = { hunger: 50, fatigue: 30, happiness: 70, attention: 60 }

  it('accepts valid needs state (§9.4)', () => {
    expect(validateNeedsState(valid)).toHaveLength(0)
  })

  it('accepts boundary values 0 and 100', () => {
    expect(validateNeedsState({ hunger: 0, fatigue: 100, happiness: 0, attention: 100 })).toHaveLength(0)
  })

  it('rejects out-of-range values', () => {
    const errors = validateNeedsState({ hunger: 150, fatigue: -10, happiness: 70, attention: 60 })
    expect(errors.some((e) => e.includes('hunger'))).toBe(true)
    expect(errors.some((e) => e.includes('fatigue'))).toBe(true)
  })

  it('rejects missing field', () => {
    const errors = validateNeedsState({ hunger: 50, fatigue: 30, happiness: 70 })
    expect(errors.some((e) => e.includes('attention'))).toBe(true)
  })
})

// ── BehaviorConfig ── //

describe('validateBehaviorConfig', () => {
  const valid = {
    weightOverrides: { idle_sit: { walk: 1.5 } },
    rhythm: { nightStartHour: 22, nightEndHour: 7, nightSleepBoost: 3.0 },
    microRandom: { rateJitter: 0.05, idleJitterSec: 2, signatureProbability: 0.05 },
  }

  it('accepts valid config (§9.3, §9.5)', () => {
    expect(validateBehaviorConfig(valid)).toHaveLength(0)
  })

  it('accepts empty weightOverrides', () => {
    expect(validateBehaviorConfig({ ...valid, weightOverrides: {} })).toHaveLength(0)
  })

  it('rejects negative weight', () => {
    const errors = validateBehaviorConfig({
      ...valid,
      weightOverrides: { idle_sit: { walk: -1 } },
    })
    expect(errors.some((e) => e.includes('weightOverrides.idle_sit.walk'))).toBe(true)
  })

  it('rejects invalid nightStartHour', () => {
    const errors = validateBehaviorConfig({
      ...valid,
      rhythm: { ...valid.rhythm, nightStartHour: 25 },
    })
    expect(errors.some((e) => e.includes('nightStartHour'))).toBe(true)
  })

  it('rejects out-of-range signatureProbability', () => {
    const errors = validateBehaviorConfig({
      ...valid,
      microRandom: { ...valid.microRandom, signatureProbability: 1.5 },
    })
    expect(errors.some((e) => e.includes('signatureProbability'))).toBe(true)
  })
})

// ── ClipMeta ── //

function validClip(overrides: Partial<ClipMeta> = {}): ClipMeta {
  return {
    id: 'walk_right_01',
    state: 'walk',
    category: 'basic',
    direction: 'right',
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
    hitbox: [0.1, 0.05, 0.8, 0.9],
    moveStartSec: 0.6,
    moveEndSec: 6.2,
    track: 'walk_right_01.track.json',
    ...overrides,
  }
}

describe('validateClipMeta', () => {
  it('accepts a valid walk clip with all fields (§5.4)', () => {
    expect(validateClipMeta(validClip())).toHaveLength(0)
  })

  it('accepts a valid idle clip without walk-only fields', () => {
    const clip = validClip({
      id: 'idle_sit_01',
      state: 'idle_sit',
      direction: 'none',
      anchor: 'sit',
      moveStartSec: undefined,
      moveEndSec: undefined,
      track: undefined,
    })
    expect(validateClipMeta(clip)).toHaveLength(0)
  })

  it('accepts a loop clip with loop points', () => {
    const clip = validClip({
      id: 'sleep_01',
      state: 'sleep',
      direction: 'none',
      anchor: 'none',
      loop: true,
      loopInSec: 0.5,
      loopOutSec: 5.0,
    })
    expect(validateClipMeta(clip)).toHaveLength(0)
  })

  // ── 拒绝缺失必填字段 ── //

  it('rejects missing id', () => {
    const rest = omit(validClip(), 'id')
    expect(validateClipMeta(rest)).toContain('clip.id: expected a non-empty string')
  })

  it('rejects missing state', () => {
    const rest = omit(validClip(), 'state')
    expect(validateClipMeta(rest)).toContain('clip.state: expected a non-empty string (FSM state key, §9.1)')
  })

  it('rejects missing hitbox', () => {
    const rest = omit(validClip(), 'hitbox')
    expect(validateClipMeta(rest)).toContain('clip.hitbox: expected an array of 4 numbers [x, y, w, h] (§5.4)')
  })

  // ── 拒绝非法枚举 ── //

  it('rejects invalid category', () => {
    const errors = validateClipMeta(validClip({ category: 'invalid' as ClipMeta['category'] }))
    expect(errors.some((e) => e.includes('clip.category'))).toBe(true)
  })

  it('rejects invalid direction', () => {
    const errors = validateClipMeta(validClip({ direction: 'up' as ClipMeta['direction'] }))
    expect(errors.some((e) => e.includes('clip.direction'))).toBe(true)
  })

  it('rejects invalid anchor', () => {
    const errors = validateClipMeta(validClip({ anchor: 'crouch' as ClipMeta['anchor'] }))
    expect(errors.some((e) => e.includes('clip.anchor'))).toBe(true)
  })

  // ── 拒绝越界值 ── //

  it('rejects variant < 1', () => {
    const errors = validateClipMeta(validClip({ variant: 0 }))
    expect(errors.some((e) => e.includes('variant'))).toBe(true)
  })

  it('rejects scaleHint ≤ 0', () => {
    const errors = validateClipMeta(validClip({ scaleHint: 0 }))
    expect(errors.some((e) => e.includes('scaleHint'))).toBe(true)
  })

  it('rejects hitbox values out of [0, 1]', () => {
    const errors = validateClipMeta(validClip({ hitbox: [1.5, 0.05, 0.8, 0.9] }))
    expect(errors.some((e) => e.includes('hitbox[0]'))).toBe(true)
  })

  // ── 循环逻辑 ── //

  it('rejects loop=true with null loopInSec', () => {
    const errors = validateClipMeta(validClip({ loop: true, loopInSec: null, loopOutSec: 5.0 }))
    expect(errors.some((e) => e.includes('loopInSec: must not be null'))).toBe(true)
  })

  it('rejects loopInSec >= loopOutSec', () => {
    const errors = validateClipMeta(validClip({ loop: true, loopInSec: 5.0, loopOutSec: 3.0 }))
    expect(errors.some((e) => e.includes('must be less than'))).toBe(true)
  })

  // ── 行走字段逻辑 ── //

  it('rejects moveStartSec >= moveEndSec', () => {
    const errors = validateClipMeta(validClip({ moveStartSec: 6.0, moveEndSec: 5.0 }))
    expect(errors.some((e) => e.includes('moveStartSec: must be less than'))).toBe(true)
  })

  it('rejects negative moveStartSec', () => {
    const errors = validateClipMeta(validClip({ moveStartSec: -1 }))
    expect(errors.some((e) => e.includes('moveStartSec'))).toBe(true)
  })
})

describe('validateClipMetaArray', () => {
  it('accepts valid array', () => {
    const clips = [validClip(), validClip({ id: 'idle_sit_01', state: 'idle_sit' })]
    expect(validateClipMetaArray(clips)).toHaveLength(0)
  })

  it('rejects non-array', () => {
    expect(validateClipMetaArray({})).toHaveLength(1)
  })

  it('rejects duplicate ids', () => {
    const clips = [validClip(), validClip()]
    const errors = validateClipMetaArray(clips)
    expect(errors.some((e) => e.includes('duplicate id'))).toBe(true)
  })

  it('prefixes errors with array index', () => {
    const errors = validateClipMetaArray([{ bad: true }])
    expect(errors.every((e) => e.startsWith('clips[0]:'))).toBe(true)
  })
})

// ── AudioMeta ── //

describe('validateAudioMeta', () => {
  const valid = {
    id: 'meow_02',
    file: 'meow_02.wav',
    label: '喵叫 2',
    category: 'action',
    cooldownSec: 30,
    maxPerHour: 5,
  }

  it('accepts valid audio meta (§11)', () => {
    expect(validateAudioMeta(valid)).toHaveLength(0)
  })

  it('accepts ambient category', () => {
    expect(validateAudioMeta({ ...valid, category: 'ambient' })).toHaveLength(0)
  })

  it('rejects missing id', () => {
    const rest = omit(valid, 'id')
    expect(validateAudioMeta(rest)).toContain('audio.id: expected a non-empty string')
  })

  it('rejects invalid category', () => {
    const errors = validateAudioMeta({ ...valid, category: 'invalid' })
    expect(errors.some((e) => e.includes('category'))).toBe(true)
  })

  it('rejects negative cooldownSec', () => {
    const errors = validateAudioMeta({ ...valid, cooldownSec: -5 })
    expect(errors.some((e) => e.includes('cooldownSec'))).toBe(true)
  })

  it('rejects non-integer maxPerHour', () => {
    const errors = validateAudioMeta({ ...valid, maxPerHour: 1.5 })
    expect(errors.some((e) => e.includes('maxPerHour'))).toBe(true)
  })
})

describe('validateAudioMetaArray', () => {
  it('rejects duplicate ids', () => {
    const items = [
      { id: 'meow', file: 'a.wav', label: 'A', category: 'action', cooldownSec: 10, maxPerHour: 3 },
      { id: 'meow', file: 'b.wav', label: 'B', category: 'action', cooldownSec: 10, maxPerHour: 3 },
    ]
    const errors = validateAudioMetaArray(items)
    expect(errors.some((e) => e.includes('duplicate id'))).toBe(true)
  })
})
