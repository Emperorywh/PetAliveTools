import { describe, it, expect } from 'vitest'
import {
  personalityWeightModifiers,
  personalityNeedRates,
  personalityInteractionModifiers,
  personalitySignatureProbability,
} from '../../src/main/behavior/personality'
import { DEFAULT_NEED_RATES } from '../../src/main/behavior/needs'
import type { Personality } from '../../src/shared/types/persona'

function mid(): Personality {
  return { liveliness: 0.5, laziness: 0.5, clinginess: 0.5, timidity: 0.5, curiosity: 0.5 }
}

function highActive(): Personality {
  return { liveliness: 1.0, laziness: 0.0, clinginess: 0.3, timidity: 0.2, curiosity: 0.7 }
}

function highLazy(): Personality {
  return { liveliness: 0.0, laziness: 1.0, clinginess: 0.6, timidity: 0.4, curiosity: 0.3 }
}

describe('personalityWeightModifiers (§9.6 transition weight modulation)', () => {
  it('returns a non-empty modulation table', () => {
    const mods = personalityWeightModifiers(mid())
    expect(Object.keys(mods).length).toBeGreaterThan(0)
  })

  it('high liveliness boosts walk from stand', () => {
    const activeMods = personalityWeightModifiers(highActive())
    expect(activeMods['stand']?.['walk']).toBeGreaterThan(1)
  })

  it('high liveliness reduces idle (idle_sit→lie)', () => {
    const activeMods = personalityWeightModifiers(highActive())
    // At liveliness=1.0, idlePenalty = 1.5-1.0 = 0.5, but sleepBoost for laziness=0 also applies
    // walkBoost on idle_sit→stand should be > 1
    expect(activeMods['idle_sit']?.['stand']).toBeGreaterThan(1)
  })

  it('high laziness boosts sleep from lie', () => {
    const lazyMods = personalityWeightModifiers(highLazy())
    expect(lazyMods['lie']?.['sleep']).toBeGreaterThan(1)
  })

  it('high laziness reduces walk from stand', () => {
    const lazyMods = personalityWeightModifiers(highLazy())
    // stand→walk should be penalized
    expect(lazyMods['stand']?.['walk']).toBeLessThanOrEqual(1)
  })

  it('high timidity increases retreat to idle_sit from stand', () => {
    const timid: Personality = { ...mid(), timidity: 1.0 }
    const mods = personalityWeightModifiers(timid)
    expect(mods['stand']?.['idle_sit']).toBeGreaterThan(1)
  })

  it('active personality produces more walk-oriented mods than lazy', () => {
    const activeMods = personalityWeightModifiers(highActive())
    const lazyMods = personalityWeightModifiers(highLazy())
    const activeWalk = activeMods['stand']?.['walk'] ?? 1
    const lazyWalk = lazyMods['stand']?.['walk'] ?? 1
    expect(activeWalk).toBeGreaterThan(lazyWalk)
  })
})

describe('personalityNeedRates (§9.6 need decay rates)', () => {
  it('returns rates for all four dimensions', () => {
    const rates = personalityNeedRates(mid())
    expect(rates.hunger).toBeDefined()
    expect(rates.fatigue).toBeDefined()
    expect(rates.happiness).toBeDefined()
    expect(rates.attention).toBeDefined()
  })

  it('hunger rate is unaffected by personality', () => {
    const active = personalityNeedRates(highActive())
    const lazy = personalityNeedRates(highLazy())
    expect(active.hunger).toBe(lazy.hunger)
    expect(active.hunger).toBe(DEFAULT_NEED_RATES.hunger)
  })

  it('high liveliness increases fatigue accumulation rate', () => {
    const active = personalityNeedRates(highActive())
    // liveliness=1.0 → livelinessFactor=1.3, laziness=0.0 → lazinessFactor=1.3
    // combined = 1.3 × 1.3 = 1.69
    expect(active.fatigue).toBeGreaterThan(DEFAULT_NEED_RATES.fatigue)
  })

  it('high laziness decreases fatigue accumulation rate', () => {
    const lazy = personalityNeedRates(highLazy())
    // liveliness=0.0 → factor=0.7, laziness=1.0 → factor=0.7
    // combined = 0.7 × 0.7 = 0.49
    expect(lazy.fatigue).toBeLessThan(DEFAULT_NEED_RATES.fatigue)
  })

  it('high liveliness increases happiness decline rate (faster fallback)', () => {
    const active = personalityNeedRates(highActive())
    // happiness is negative; livelinessFactor=1.3 makes it more negative
    expect(active.happiness).toBeLessThan(DEFAULT_NEED_RATES.happiness)
  })

  it('high clinginess increases attention decline rate', () => {
    const clingy: Personality = { ...mid(), clinginess: 1.0 }
    const rates = personalityNeedRates(clingy)
    // attention is negative; clinginessFactor=1.5 makes it more negative
    expect(rates.attention).toBeLessThan(DEFAULT_NEED_RATES.attention)
  })

  it('mid personality produces rates close to default', () => {
    const rates = personalityNeedRates(mid())
    // liveliness=0.5 → factor=1.0, laziness=0.5 → factor=1.0
    // clinginess=0.5 → factor=1.15
    // fatigue = base × 1.0 × 1.0 = base
    expect(rates.fatigue).toBeCloseTo(DEFAULT_NEED_RATES.fatigue, 5)
    expect(rates.happiness).toBeCloseTo(DEFAULT_NEED_RATES.happiness, 5)
  })
})

describe('personalityInteractionModifiers (§9.6 interaction responses)', () => {
  it('returns all modifier fields', () => {
    const mods = personalityInteractionModifiers(mid())
    expect(mods.petHappinessGain).toBeDefined()
    expect(mods.retreatTendency).toBeDefined()
    expect(mods.clickAttentionGain).toBeDefined()
    expect(mods.petWeightMultiplier).toBeDefined()
  })

  it('high clinginess increases pet happiness gain', () => {
    const clingy = personalityInteractionModifiers({ ...mid(), clinginess: 1.0 })
    const non = personalityInteractionModifiers({ ...mid(), clinginess: 0.0 })
    expect(clingy.petHappinessGain).toBeGreaterThan(non.petHappinessGain)
  })

  it('high timidity increases retreat tendency', () => {
    const timid = personalityInteractionModifiers({ ...mid(), timidity: 1.0 })
    const bold = personalityInteractionModifiers({ ...mid(), timidity: 0.0 })
    expect(timid.retreatTendency).toBeGreaterThan(bold.retreatTendency)
  })

  it('high timidity reduces pet weight multiplier', () => {
    const timid = personalityInteractionModifiers({ ...mid(), timidity: 1.0 })
    const bold = personalityInteractionModifiers({ ...mid(), timidity: 0.0 })
    expect(timid.petWeightMultiplier).toBeLessThan(bold.petWeightMultiplier)
  })

  it('high liveliness increases click attention gain', () => {
    const active = personalityInteractionModifiers({ ...mid(), liveliness: 1.0 })
    const calm = personalityInteractionModifiers({ ...mid(), liveliness: 0.0 })
    expect(active.clickAttentionGain).toBeGreaterThan(calm.clickAttentionGain)
  })
})

describe('personalitySignatureProbability (§9.6 signature frequency)', () => {
  it('base probability at mid curiosity is close to base', () => {
    const result = personalitySignatureProbability(mid(), 0.05)
    // curiosity=0.5 → factor = 0.4 + 0.5×1.2 = 1.0
    expect(result).toBeCloseTo(0.05, 5)
  })

  it('high curiosity increases probability', () => {
    const curious: Personality = { ...mid(), curiosity: 1.0 }
    const result = personalitySignatureProbability(curious, 0.05)
    // factor = 0.4 + 1.0×1.2 = 1.6
    expect(result).toBeGreaterThan(0.05)
  })

  it('low curiosity decreases probability', () => {
    const indifferent: Personality = { ...mid(), curiosity: 0.0 }
    const result = personalitySignatureProbability(indifferent, 0.05)
    // factor = 0.4 + 0.0×1.2 = 0.4
    expect(result).toBeLessThan(0.05)
  })

  it('clamps to 0 for very high probability', () => {
    const result = personalitySignatureProbability({ ...mid(), curiosity: 1.0 }, 0.2)
    expect(result).toBeLessThanOrEqual(0.15)
  })

  it('clamps to 0 for negative probability', () => {
    const result = personalitySignatureProbability(mid(), -0.1)
    expect(result).toBe(0)
  })

  it('curious personality has higher sig probability than indifferent', () => {
    const curious = personalitySignatureProbability({ ...mid(), curiosity: 1.0 }, 0.05)
    const indifferent = personalitySignatureProbability({ ...mid(), curiosity: 0.0 }, 0.05)
    expect(curious).toBeGreaterThan(indifferent)
  })
})
