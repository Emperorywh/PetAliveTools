import { describe, it, expect } from 'vitest'
import { ACTION_AUDIO_MAP, resolveActionAudio } from '../../src/shared/audio/action-sounds'
import type { ClipMeta } from '../../src/shared/types/clip-meta'

function clip(overrides: Partial<ClipMeta> = {}): ClipMeta {
  return {
    id: 'test',
    fileName: 'test.webm',
    state: 'idle_sit',
    category: 'basic',
    direction: 'none',
    anchor: 'sit',
    loop: false,
    signature: false,
    variant: 1,
    prop: false,
    embeddedAudio: false,
    audio: null,
    hitbox: [0.1, 0.05, 0.8, 0.9],
    ...overrides,
  }
}

describe('ACTION_AUDIO_MAP', () => {
  it('maps key interactions to audio groups', () => {
    expect(ACTION_AUDIO_MAP['petted']).toBeDefined()
    expect(ACTION_AUDIO_MAP['eat']).toBeDefined()
    expect(ACTION_AUDIO_MAP['play']).toBeDefined()
    expect(ACTION_AUDIO_MAP['beg_food']).toBeDefined()
  })
})

describe('resolveActionAudio', () => {
  it('returns embedded=true for embeddedAudio clips (§11.1)', () => {
    const c = clip({ embeddedAudio: true })
    const result = resolveActionAudio('petted', c)
    expect(result.isEmbedded).toBe(true)
    expect(result.audioId).toBeNull()
  })

  it('uses clip.audio field when present (§5.4)', () => {
    const c = clip({ audio: 'custom_purr' })
    const result = resolveActionAudio('petted', c)
    expect(result.isEmbedded).toBe(false)
    expect(result.audioId).toBe('custom_purr')
  })

  it('falls back to action map when no clip', () => {
    const result = resolveActionAudio('petted', null)
    expect(result.isEmbedded).toBe(false)
    expect(result.audioId).toBe(ACTION_AUDIO_MAP['petted'])
  })

  it('falls back to action map when clip has no audio field', () => {
    const result = resolveActionAudio('eat', clip({ audio: null }))
    expect(result.isEmbedded).toBe(false)
    expect(result.audioId).toBe(ACTION_AUDIO_MAP['eat'])
  })

  it('returns null audioId for unknown action without clip', () => {
    const result = resolveActionAudio('unknown_action', null)
    expect(result.isEmbedded).toBe(false)
    expect(result.audioId).toBeNull()
  })

  it('embeddedAudio takes precedence over audio field (§11.1)', () => {
    const c = clip({ embeddedAudio: true, audio: 'should_be_ignored' })
    const result = resolveActionAudio('eat', c)
    expect(result.isEmbedded).toBe(true)
    expect(result.audioId).toBeNull()
  })
})
