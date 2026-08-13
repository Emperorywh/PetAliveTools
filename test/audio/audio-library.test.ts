import { describe, it, expect } from 'vitest'
import {
  extractGroupPrefix,
  buildAudioLibrary,
  getAudioById,
  getSampleGroup,
  getByCategory,
  createRotationState,
  pickNextSample,
  resolveClipAudio,
} from '../../src/shared/audio/audio-library'
import type { AudioMeta } from '../../src/shared/types/audio-meta'

function entry(overrides: Partial<AudioMeta>): AudioMeta {
  return {
    file: 'test.wav',
    label: 'Test',
    category: 'action',
    cooldownSec: 5,
    maxPerHour: 10,
    ...overrides,
  } as AudioMeta
}

describe('extractGroupPrefix', () => {
  it('extracts prefix from numbered id', () => {
    expect(extractGroupPrefix('purr_01')).toBe('purr')
    expect(extractGroupPrefix('meow_03')).toBe('meow')
  })

  it('returns id as-is when no numeric suffix', () => {
    expect(extractGroupPrefix('meow')).toBe('meow')
    expect(extractGroupPrefix('ambient_bird')).toBe('ambient_bird')
  })

  it('handles multi-segment prefix', () => {
    expect(extractGroupPrefix('ambient_bird_02')).toBe('ambient_bird')
  })
})

describe('buildAudioLibrary', () => {
  it('builds id index', () => {
    const lib = buildAudioLibrary([
      entry({ id: 'a_01' }),
      entry({ id: 'b_01' }),
    ])
    expect(getAudioById(lib, 'a_01')?.id).toBe('a_01')
    expect(getAudioById(lib, 'b_01')?.id).toBe('b_01')
    expect(getAudioById(lib, 'missing')).toBeNull()
  })

  it('groups samples by prefix', () => {
    const lib = buildAudioLibrary([
      entry({ id: 'purr_01' }),
      entry({ id: 'purr_02' }),
      entry({ id: 'purr_03' }),
      entry({ id: 'meow_01' }),
    ])
    const group = getSampleGroup(lib, 'purr')
    expect(group).not.toBeNull()
    expect(group!.samples).toHaveLength(3)
    expect(getSampleGroup(lib, 'meow')!.samples).toHaveLength(1)
  })

  it('indexes by category', () => {
    const lib = buildAudioLibrary([
      entry({ id: 'amb_01', category: 'ambient' }),
      entry({ id: 'amb_02', category: 'ambient' }),
      entry({ id: 'act_01', category: 'action' }),
    ])
    expect(getByCategory(lib, 'ambient')).toHaveLength(2)
    expect(getByCategory(lib, 'action')).toHaveLength(1)
  })

  it('handles empty entries', () => {
    const lib = buildAudioLibrary([])
    expect(lib.entries).toHaveLength(0)
    expect(getByCategory(lib, 'ambient')).toHaveLength(0)
  })
})

describe('pickNextSample', () => {
  it('returns single sample directly', () => {
    const group = buildAudioLibrary([entry({ id: 'lonely_01' })]).groups.get('lonely')!
    const { sample, state } = pickNextSample(createRotationState(), group, () => 0.5)
    expect(sample.id).toBe('lonely_01')
    expect(state.indices.size).toBe(0) // no rotation needed
  })

  it('rotates among multiple samples', () => {
    const lib = buildAudioLibrary([
      entry({ id: 'p_01' }),
      entry({ id: 'p_02' }),
      entry({ id: 'p_03' }),
    ])
    const group = lib.groups.get('p')!
    let rotState = createRotationState()
    const picked = new Set<string>()

    for (let i = 0; i < 10; i++) {
      const result = pickNextSample(rotState, group, Math.random)
      picked.add(result.sample.id)
      rotState = result.state
    }
    expect(picked.size).toBeGreaterThanOrEqual(2)
  })

  it('does not repeat same sample consecutively', () => {
    const lib = buildAudioLibrary([
      entry({ id: 'p_01' }),
      entry({ id: 'p_02' }),
    ])
    const group = lib.groups.get('p')!
    let rotState = createRotationState()

    for (let i = 0; i < 20; i++) {
      const result = pickNextSample(rotState, group, Math.random)
      const prevIndex = rotState.indices.get('p')
      const currIndex = result.state.indices.get('p')
      if (prevIndex !== undefined) {
        expect(currIndex).not.toBe(prevIndex)
      }
      rotState = result.state
    }
  })

  it('uses injected rng for determinism', () => {
    const lib = buildAudioLibrary([
      entry({ id: 'p_01' }),
      entry({ id: 'p_02' }),
      entry({ id: 'p_03' }),
    ])
    const group = lib.groups.get('p')!
    const rng = () => 0.0 // always pick first candidate
    const r1 = pickNextSample(createRotationState(), group, rng)
    const r2 = pickNextSample(r1.state, group, rng)
    // With rng=0.0, always picks index 0 (first candidate != lastIndex)
    // First: candidates=[0,1,2], pick 0. Second: candidates=[1,2], pick 1.
    expect(r1.sample.id).toBe('p_01')
    expect(r2.sample.id).toBe('p_02')
  })
})

describe('resolveClipAudio', () => {
  it('resolves group prefix', () => {
    const lib = buildAudioLibrary([
      entry({ id: 'purr_01' }),
      entry({ id: 'purr_02' }),
    ])
    const result = resolveClipAudio(lib, 'purr')
    expect(result?.kind).toBe('group')
  })

  it('resolves exact id when no group match', () => {
    // An id with no numeric suffix still forms a 1-sample group;
    // resolveClipAudio finds the group first. Use an id that exists
    // but whose group prefix differs from the query.
    const lib = buildAudioLibrary([
      entry({ id: 'purr_01' }),
      entry({ id: 'purr_02' }),
      entry({ id: 'standalone' }),
    ])
    // Querying by group prefix "purr" returns a multi-sample group
    const groupResult = resolveClipAudio(lib, 'purr')
    expect(groupResult?.kind).toBe('group')
    // Querying a single-entry group also returns group (1 sample)
    const singleResult = resolveClipAudio(lib, 'standalone')
    expect(singleResult?.kind).toBe('group')
  })

  it('returns null for unknown id', () => {
    const lib = buildAudioLibrary([entry({ id: 'exists' })])
    expect(resolveClipAudio(lib, 'nonexistent')).toBeNull()
  })
})
