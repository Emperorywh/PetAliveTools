import { describe, it, expect } from 'vitest'
import {
  jitteredPlaybackRate,
  syncedWalkDuration,
  jitteredIdleDuration,
  jitteredPositionX,
  shuffleVariants,
  shouldInsertRareAction,
  effectiveRareActionProbability,
  pickRareAction,
  generateRandomizationParams,
} from '../../src/main/scheduler/randomization'
import { createSeededRandom } from '../../src/main/behavior/transitions'
import type { MicroRandomConfig } from '../../src/shared/types/behavior-config'
import type { Personality } from '../../src/shared/types/persona'

function defaultMicroRandom(): MicroRandomConfig {
  return { rateJitter: 0.05, idleJitterSec: 2, signatureProbability: 0.05 }
}

function midPersonality(): Personality {
  return { liveliness: 0.5, laziness: 0.5, clinginess: 0.5, timidity: 0.5, curiosity: 0.5 }
}

describe('jitteredPlaybackRate (§9.5 ±5%)', () => {
  it('produces rate within [0.95, 1.05] for 5% jitter', () => {
    const rng = createSeededRandom(42)
    for (let i = 0; i < 1000; i++) {
      const rate = jitteredPlaybackRate(0.05, rng)
      expect(rate).toBeGreaterThanOrEqual(0.95)
      expect(rate).toBeLessThanOrEqual(1.05)
    }
  })

  it('produces rate within [0.97, 1.03] for 3% jitter', () => {
    const rng = createSeededRandom(1)
    for (let i = 0; i < 1000; i++) {
      const rate = jitteredPlaybackRate(0.03, rng)
      expect(rate).toBeGreaterThanOrEqual(0.97)
      expect(rate).toBeLessThanOrEqual(1.03)
    }
  })

  it('returns exactly 1.0 for zero jitter', () => {
    const rng = createSeededRandom(1)
    expect(jitteredPlaybackRate(0, rng)).toBe(1.0)
  })

  it('is deterministic with same seed', () => {
    const r1 = jitteredPlaybackRate(0.05, createSeededRandom(42))
    const r2 = jitteredPlaybackRate(0.05, createSeededRandom(42))
    expect(r1).toBe(r2)
  })
})

describe('syncedWalkDuration (§7.2 displacement curve sync)', () => {
  it('scales duration inversely with rate', () => {
    expect(syncedWalkDuration(10, 1.0)).toBeCloseTo(10, 5)
    expect(syncedWalkDuration(10, 2.0)).toBeCloseTo(5, 5)
    expect(syncedWalkDuration(10, 0.5)).toBeCloseTo(20, 5)
  })

  it('faster playback → shorter duration (no foot slipping)', () => {
    const dur = syncedWalkDuration(6.0, 1.05)
    expect(dur).toBeLessThan(6.0)
  })

  it('slower playback → longer duration', () => {
    const dur = syncedWalkDuration(6.0, 0.95)
    expect(dur).toBeGreaterThan(6.0)
  })
})

describe('jitteredIdleDuration (§9.5 idle duration jitter)', () => {
  it('produces intervals within jitter range', () => {
    const rng = createSeededRandom(42)
    // base=8000ms, jitter=2s=2000ms → range [6000, 10000]
    for (let i = 0; i < 1000; i++) {
      const result = jitteredIdleDuration(8000, 2, rng)
      expect(result).toBeGreaterThanOrEqual(6000)
      expect(result).toBeLessThanOrEqual(10000)
    }
  })

  it('enforces minimum of 1000ms', () => {
    const rng = createSeededRandom(42)
    // base=500ms, jitter=0 → should be at least 1000
    const result = jitteredIdleDuration(500, 0, rng)
    expect(result).toBeGreaterThanOrEqual(1000)
  })

  it('returns base for zero jitter', () => {
    const rng = createSeededRandom(1)
    const result = jitteredIdleDuration(8000, 0, rng)
    expect(result).toBe(8000)
  })
})

describe('jitteredPositionX (§9.5 position x jitter)', () => {
  it('produces x within jitter range', () => {
    const rng = createSeededRandom(42)
    for (let i = 0; i < 1000; i++) {
      const result = jitteredPositionX(500, 20, rng)
      expect(result).toBeGreaterThanOrEqual(480)
      expect(result).toBeLessThanOrEqual(520)
    }
  })

  it('returns base for zero jitter', () => {
    const rng = createSeededRandom(1)
    expect(jitteredPositionX(500, 0, rng)).toBe(500)
  })
})

describe('shuffleVariants (§9.5 variant shuffling)', () => {
  it('returns a permutation of the same elements', () => {
    const rng = createSeededRandom(42)
    const original = [1, 2, 3, 4, 5]
    const shuffled = shuffleVariants(original, rng)
    expect(shuffled.sort()).toEqual([...original].sort())
  })

  it('does not mutate the original array', () => {
    const rng = createSeededRandom(42)
    const original = [1, 2, 3]
    const copy = [...original]
    shuffleVariants(original, rng)
    expect(original).toEqual(copy)
  })

  it('is deterministic with same seed', () => {
    const s1 = shuffleVariants([1, 2, 3, 4, 5], createSeededRandom(42))
    const s2 = shuffleVariants([1, 2, 3, 4, 5], createSeededRandom(42))
    expect(s1).toEqual(s2)
  })

  it('handles single-element array', () => {
    expect(shuffleVariants([42], createSeededRandom(1))).toEqual([42])
  })

  it('handles empty array', () => {
    expect(shuffleVariants([], createSeededRandom(1))).toEqual([])
  })
})

describe('shouldInsertRareAction (§9.5 3–8% rare actions)', () => {
  it('always returns false for 0 probability', () => {
    const rng = createSeededRandom(42)
    for (let i = 0; i < 100; i++) {
      expect(shouldInsertRareAction(0, rng)).toBe(false)
    }
  })

  it('always returns true for probability 1', () => {
    const rng = createSeededRandom(42)
    for (let i = 0; i < 100; i++) {
      expect(shouldInsertRareAction(1, rng)).toBe(true)
    }
  })

  it('triggers approximately at expected rate', () => {
    const rng = createSeededRandom(42)
    const probability = 0.05
    const trials = 10000
    let count = 0
    for (let i = 0; i < trials; i++) {
      if (shouldInsertRareAction(probability, rng)) count++
    }
    const observed = count / trials
    // 5% ± 2% tolerance
    expect(observed).toBeGreaterThan(0.03)
    expect(observed).toBeLessThan(0.07)
  })
})

describe('effectiveRareActionProbability', () => {
  it('clamps to [3%, 8%] without personality', () => {
    expect(effectiveRareActionProbability(defaultMicroRandom())).toBeGreaterThanOrEqual(0.03)
    expect(effectiveRareActionProbability(defaultMicroRandom())).toBeLessThanOrEqual(0.08)
  })

  it('returns 0 for explicitly disabled (signatureProbability=0)', () => {
    const config: MicroRandomConfig = { ...defaultMicroRandom(), signatureProbability: 0 }
    expect(effectiveRareActionProbability(config)).toBe(0)
  })

  it('clamps very low probability to 3%', () => {
    const config: MicroRandomConfig = { ...defaultMicroRandom(), signatureProbability: 0.001 }
    expect(effectiveRareActionProbability(config)).toBe(0.03)
  })

  it('clamps very high probability to 8%', () => {
    const config: MicroRandomConfig = { ...defaultMicroRandom(), signatureProbability: 0.5 }
    expect(effectiveRareActionProbability(config)).toBe(0.08)
  })

  it('applies personality curiosity modulation', () => {
    const curious: Personality = { ...midPersonality(), curiosity: 1.0 }
    const indifferent: Personality = { ...midPersonality(), curiosity: 0.0 }
    const curiousProb = effectiveRareActionProbability(defaultMicroRandom(), curious)
    const indifferentProb = effectiveRareActionProbability(defaultMicroRandom(), indifferent)
    expect(curiousProb).toBeGreaterThan(indifferentProb)
  })
})

describe('pickRareAction', () => {
  it('returns one of the candidates', () => {
    const actions = ['yawn', 'stretch', 'scratch']
    const rng = createSeededRandom(42)
    const result = pickRareAction(actions, rng)
    expect(actions).toContain(result)
  })

  it('returns null for empty array', () => {
    expect(pickRareAction([], createSeededRandom(1))).toBeNull()
  })

  it('distributes across candidates over many trials', () => {
    const actions = ['a', 'b', 'c']
    const rng = createSeededRandom(42)
    const counts: Record<string, number> = { a: 0, b: 0, c: 0 }
    for (let i = 0; i < 3000; i++) {
      const result = pickRareAction(actions, rng)
      if (result) counts[result]++
    }
    // Each should be roughly 1000 ± 200
    for (const key of actions) {
      expect(counts[key]).toBeGreaterThan(700)
      expect(counts[key]).toBeLessThan(1300)
    }
  })
})

describe('generateRandomizationParams', () => {
  it('generates all fields', () => {
    const rng = createSeededRandom(42)
    const params = generateRandomizationParams({
      config: defaultMicroRandom(),
      baseIdleIntervalMs: 8000,
      baseX: 500,
      positionJitterPx: 20,
      rareActions: ['yawn', 'stretch'],
      rng,
    })
    expect(params.playbackRate).toBeGreaterThanOrEqual(0.95)
    expect(params.playbackRate).toBeLessThanOrEqual(1.05)
    expect(params.idleIntervalMs).toBeGreaterThan(0)
    expect(params.positionX).toBeGreaterThanOrEqual(480)
    expect(params.positionX).toBeLessThanOrEqual(520)
    expect(params.rareActionProbability).toBeGreaterThan(0)
    expect(typeof params.insertRareAction).toBe('boolean')
  })

  it('is deterministic with same seed', () => {
    const opts = {
      config: defaultMicroRandom(),
      baseIdleIntervalMs: 8000,
      baseX: 500,
      positionJitterPx: 20,
      rareActions: ['yawn'],
      rng: createSeededRandom(42),
    }
    const r1 = generateRandomizationParams(opts)
    opts.rng = createSeededRandom(42)
    const r2 = generateRandomizationParams(opts)
    expect(r1).toEqual(r2)
  })

  it('rare action insertion respects probability', () => {
    const rng = createSeededRandom(42)
    const config: MicroRandomConfig = { rateJitter: 0.05, idleJitterSec: 2, signatureProbability: 0 }
    let triggered = false
    for (let i = 0; i < 100; i++) {
      const params = generateRandomizationParams({
        config,
        baseIdleIntervalMs: 8000,
        baseX: 500,
        positionJitterPx: 20,
        rareActions: ['yawn'],
        rng,
      })
      if (params.insertRareAction) triggered = true
    }
    expect(triggered).toBe(false)
  })

  it('with personality, includes curiosity-modulated probability', () => {
    const rng = createSeededRandom(42)
    const params = generateRandomizationParams({
      config: defaultMicroRandom(),
      personality: midPersonality(),
      baseIdleIntervalMs: 8000,
      baseX: 500,
      positionJitterPx: 20,
      rareActions: ['yawn'],
      rng,
    })
    // With mid curiosity, probability should be close to base 0.05
    expect(params.rareActionProbability).toBeGreaterThan(0.03)
    expect(params.rareActionProbability).toBeLessThan(0.08)
  })
})
