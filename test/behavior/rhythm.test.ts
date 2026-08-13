import { describe, it, expect } from 'vitest'
import {
  isNightTime,
  rhythmWeightModifiers,
  rhythmNeedRates,
  computeRhythmModulation,
} from '../../src/main/behavior/rhythm'
import type { RhythmConfig } from '../../src/shared/types/behavior-config'

const defaultConfig: RhythmConfig = {
  nightStartHour: 22,
  nightEndHour: 7,
  nightSleepBoost: 3.0,
}

describe('isNightTime (§9.3 rhythm)', () => {
  it('detects night in cross-midnight range (22–7)', () => {
    expect(isNightTime(22, defaultConfig)).toBe(true)
    expect(isNightTime(23, defaultConfig)).toBe(true)
    expect(isNightTime(0, defaultConfig)).toBe(true)
    expect(isNightTime(3, defaultConfig)).toBe(true)
    expect(isNightTime(6, defaultConfig)).toBe(true)
  })

  it('detects daytime in cross-midnight range', () => {
    expect(isNightTime(7, defaultConfig)).toBe(false)
    expect(isNightTime(12, defaultConfig)).toBe(false)
    expect(isNightTime(18, defaultConfig)).toBe(false)
    expect(isNightTime(21, defaultConfig)).toBe(false)
  })

  it('handles same-day range (13–17)', () => {
    const config: RhythmConfig = { nightStartHour: 13, nightEndHour: 17, nightSleepBoost: 2.0 }
    expect(isNightTime(13, config)).toBe(true)
    expect(isNightTime(15, config)).toBe(true)
    expect(isNightTime(16, config)).toBe(true)
    expect(isNightTime(17, config)).toBe(false)
    expect(isNightTime(12, config)).toBe(false)
  })

  it('handles identical start/end as all-day night', () => {
    const config: RhythmConfig = { nightStartHour: 12, nightEndHour: 12, nightSleepBoost: 2.0 }
    expect(isNightTime(0, config)).toBe(true)
    expect(isNightTime(12, config)).toBe(true)
    expect(isNightTime(23, config)).toBe(true)
  })
})

describe('rhythmWeightModifiers (§9.3 night increases sleep weight)', () => {
  it('returns empty mods during day', () => {
    const mods = rhythmWeightModifiers(false, defaultConfig)
    expect(Object.keys(mods)).toHaveLength(0)
  })

  it('boosts sleep weight at night', () => {
    const mods = rhythmWeightModifiers(true, defaultConfig)
    expect(mods['lie']?.['sleep']).toBe(defaultConfig.nightSleepBoost)
    expect(mods['idle_sit']?.['sleep']).toBe(defaultConfig.nightSleepBoost)
  })

  it('reduces activity weight at night', () => {
    const mods = rhythmWeightModifiers(true, defaultConfig)
    // night: walk weight from idle_sit should be reduced
    expect(mods['idle_sit']?.['walk']).toBeLessThan(1)
    // stand→walk should be reduced
    expect(mods['stand']?.['walk']).toBeLessThan(1)
  })

  it('night sleep boost > day (empty)', () => {
    const nightMods = rhythmWeightModifiers(true, defaultConfig)
    const dayMods = rhythmWeightModifiers(false, defaultConfig)
    const nightSleep = nightMods['idle_sit']?.['sleep'] ?? 1
    const daySleep = dayMods['idle_sit']?.['sleep'] ?? 1
    expect(nightSleep).toBeGreaterThan(daySleep)
  })
})

describe('rhythmNeedRates (§9.4 fatigue rises at night)', () => {
  const baseRates = { hunger: 0.01, fatigue: 0.01, happiness: -0.01, attention: -0.01 }

  it('returns base rates during day', () => {
    const rates = rhythmNeedRates(false, baseRates)
    expect(rates).toEqual(baseRates)
  })

  it('doubles fatigue rate at night', () => {
    const rates = rhythmNeedRates(true, baseRates)
    expect(rates.fatigue).toBe(baseRates.fatigue * 2)
  })

  it('keeps other rates unchanged at night', () => {
    const rates = rhythmNeedRates(true, baseRates)
    expect(rates.hunger).toBe(baseRates.hunger)
    expect(rates.happiness).toBe(baseRates.happiness)
    expect(rates.attention).toBe(baseRates.attention)
  })
})

describe('computeRhythmModulation', () => {
  it('detects night correctly and produces modulation', () => {
    const result = computeRhythmModulation(23, defaultConfig)
    expect(result.isNight).toBe(true)
    expect(result.weightMods['idle_sit']?.['sleep']).toBe(defaultConfig.nightSleepBoost)
    expect(result.needRateFactor).toBe(2)
  })

  it('detects day correctly', () => {
    const result = computeRhythmModulation(14, defaultConfig)
    expect(result.isNight).toBe(false)
    expect(Object.keys(result.weightMods)).toHaveLength(0)
    expect(result.needRateFactor).toBe(1)
  })
})
