import { describe, it, expect } from 'vitest'
import {
  createCooldownState,
  canPlay,
  recordPlay,
  tryPlay,
  remainingCooldownSec,
} from '../../src/shared/audio/cooldown'
import type { AudioMeta } from '../../src/shared/types/audio-meta'

function meta(overrides: Partial<AudioMeta> = {}): AudioMeta {
  return {
    id: 'test_sound',
    file: 'test.wav',
    label: 'Test',
    category: 'action',
    cooldownSec: 5,
    maxPerHour: 10,
    ...overrides,
  }
}

describe('CooldownState', () => {
  it('creates empty state', () => {
    const state = createCooldownState()
    expect(state.lastPlayed.size).toBe(0)
    expect(state.playHistory.size).toBe(0)
  })
})

describe('canPlay', () => {
  it('allows first play (no history)', () => {
    const state = createCooldownState()
    expect(canPlay(state, 'test_sound', meta(), 0)).toBe(true)
  })

  it('blocks during cooldown period', () => {
    const state = recordPlay(createCooldownState(), 'test_sound', 1000)
    expect(canPlay(state, 'test_sound', meta({ cooldownSec: 5 }), 3000)).toBe(false)
  })

  it('allows after cooldown expires', () => {
    const state = recordPlay(createCooldownState(), 'test_sound', 1000)
    expect(canPlay(state, 'test_sound', meta({ cooldownSec: 5 }), 6001)).toBe(true)
  })

  it('blocks when maxPerHour exceeded', () => {
    let state = createCooldownState()
    // Play 3 times at t=0, 6, 12 (cooldown=5, each after cooldown)
    const m = meta({ cooldownSec: 5, maxPerHour: 3 })
    state = recordPlay(state, 'test_sound', 0)
    state = recordPlay(state, 'test_sound', 6000)
    state = recordPlay(state, 'test_sound', 12000)
    // 4th play within same hour should be blocked
    expect(canPlay(state, 'test_sound', m, 18000)).toBe(false)
  })

  it('allows again after rate limit window passes', () => {
    let state = createCooldownState()
    const m = meta({ cooldownSec: 1, maxPerHour: 2 })
    state = recordPlay(state, 'test_sound', 0)
    state = recordPlay(state, 'test_sound', 2000)
    // After 1 hour + cooldown
    expect(canPlay(state, 'test_sound', m, 3_602_000)).toBe(true)
  })

  it('independent cooldown per sound id', () => {
    let state = createCooldownState()
    state = recordPlay(state, 'sound_a', 0)
    // sound_b should be playable even though sound_a is on cooldown
    expect(canPlay(state, 'sound_a', meta({ id: 'sound_a', cooldownSec: 10 }), 1000)).toBe(false)
    expect(canPlay(state, 'sound_b', meta({ id: 'sound_b', cooldownSec: 10 }), 1000)).toBe(true)
  })

  it('respects zero cooldown (always allowed by cooldown)', () => {
    const state = recordPlay(createCooldownState(), 'test_sound', 0)
    expect(canPlay(state, 'test_sound', meta({ cooldownSec: 0 }), 0)).toBe(true)
  })

  it('respects zero maxPerHour (never allowed)', () => {
    const state = createCooldownState()
    expect(canPlay(state, 'test_sound', meta({ maxPerHour: 0 }), 0)).toBe(false)
  })
})

describe('tryPlay', () => {
  it('returns allowed=true and updated state on success', () => {
    const state = createCooldownState()
    const result = tryPlay(state, 'test_sound', meta(), 1000)
    expect(result.allowed).toBe(true)
    expect(result.state.lastPlayed.get('test_sound')).toBe(1000)
  })

  it('returns allowed=false and unchanged state on cooldown', () => {
    const state = recordPlay(createCooldownState(), 'test_sound', 0)
    const result = tryPlay(state, 'test_sound', meta({ cooldownSec: 10 }), 1000)
    expect(result.allowed).toBe(false)
    // State should be unchanged (not a new play recorded)
    expect(result.state.lastPlayed.get('test_sound')).toBe(0)
  })
})

describe('remainingCooldownSec', () => {
  it('returns 0 when never played', () => {
    const state = createCooldownState()
    expect(remainingCooldownSec(state, 'test_sound', meta({ cooldownSec: 5 }), 0)).toBe(0)
  })

  it('returns remaining seconds during cooldown', () => {
    const state = recordPlay(createCooldownState(), 'test_sound', 1000)
    expect(remainingCooldownSec(state, 'test_sound', meta({ cooldownSec: 10 }), 4000)).toBe(7)
  })

  it('returns 0 after cooldown expired', () => {
    const state = recordPlay(createCooldownState(), 'test_sound', 1000)
    expect(remainingCooldownSec(state, 'test_sound', meta({ cooldownSec: 5 }), 7000)).toBe(0)
  })
})

describe('recordPlay', () => {
  it('records timestamp and prunes old history', () => {
    let state = createCooldownState()
    // Play at t=0, 1000, 2000
    state = recordPlay(state, 's', 0)
    state = recordPlay(state, 's', 1000)
    state = recordPlay(state, 's', 2000)
    const history = state.playHistory.get('s')!
    expect(history).toHaveLength(3)
    // Play after > 1 hour: old entries (0, 1000, 2000) are all >1h old relative to 3_700_000
    // cutoff = 3_700_000 - 3_600_000 = 100_000; entries < 100_000 are pruned
    state = recordPlay(state, 's', 3_700_000)
    const pruned = state.playHistory.get('s')!
    // All old entries (0, 1000, 2000) are < 100_000 → pruned; only 3_700_000 remains
    expect(pruned).toHaveLength(1)
    expect(pruned[0]).toBe(3_700_000)
  })
})
