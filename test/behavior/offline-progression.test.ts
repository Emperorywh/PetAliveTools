import { describe, it, expect } from 'vitest'
import {
  OFFLINE_BOUNDS,
  applyOfflineBounds,
  advanceOffline,
  computeOfflineSec,
} from '../../src/main/behavior/offline-progression'
import { DEFAULT_NEED_RATES } from '../../src/main/behavior/needs'
import type { NeedsState } from '../../src/shared/types/needs-state'

const midState: NeedsState = {
  hunger: 30,
  fatigue: 20,
  happiness: 70,
  attention: 60,
}

describe('OFFLINE_BOUNDS (§9.4)', () => {
  it('defines non-punitive boundaries', () => {
    expect(OFFLINE_BOUNDS.hungerMax).toBeLessThan(100)
    expect(OFFLINE_BOUNDS.fatigueMax).toBeLessThan(100)
    expect(OFFLINE_BOUNDS.happinessMin).toBeGreaterThan(0)
    expect(OFFLINE_BOUNDS.attentionMin).toBeGreaterThan(0)
  })
})

describe('applyOfflineBounds', () => {
  it('clamps hunger below hungerMax', () => {
    const state = { ...midState, hunger: 100 }
    const result = applyOfflineBounds(state)
    expect(result.hunger).toBe(OFFLINE_BOUNDS.hungerMax)
  })

  it('clamps fatigue below fatigueMax', () => {
    const state = { ...midState, fatigue: 100 }
    const result = applyOfflineBounds(state)
    expect(result.fatigue).toBe(OFFLINE_BOUNDS.fatigueMax)
  })

  it('clamps happiness above happinessMin', () => {
    const state = { ...midState, happiness: 0 }
    const result = applyOfflineBounds(state)
    expect(result.happiness).toBe(OFFLINE_BOUNDS.happinessMin)
  })

  it('clamps attention above attentionMin', () => {
    const state = { ...midState, attention: 0 }
    const result = applyOfflineBounds(state)
    expect(result.attention).toBe(OFFLINE_BOUNDS.attentionMin)
  })

  it('does not affect values already within bounds', () => {
    const result = applyOfflineBounds(midState)
    expect(result).toEqual(midState)
  })
})

describe('advanceOffline (§9.4 offline progression)', () => {
  it('advances needs by elapsed real time', () => {
    const result = advanceOffline(midState, 3600, DEFAULT_NEED_RATES)
    expect(result.hunger).toBeGreaterThan(midState.hunger)
    expect(result.fatigue).toBeGreaterThan(midState.fatigue)
  })

  it('never reaches punitive extremes on long absence', () => {
    // Simulate 24 hours offline
    const result = advanceOffline(midState, 86400, DEFAULT_NEED_RATES)
    expect(result.hunger).toBeLessThanOrEqual(OFFLINE_BOUNDS.hungerMax)
    expect(result.fatigue).toBeLessThanOrEqual(OFFLINE_BOUNDS.fatigueMax)
    expect(result.happiness).toBeGreaterThanOrEqual(OFFLINE_BOUNDS.happinessMin)
    expect(result.attention).toBeGreaterThanOrEqual(OFFLINE_BOUNDS.attentionMin)
  })

  it('returns original state for zero elapsed', () => {
    const result = advanceOffline(midState, 0, DEFAULT_NEED_RATES)
    expect(result).toEqual(midState)
  })

  it('returns original state for negative elapsed', () => {
    const result = advanceOffline(midState, -100, DEFAULT_NEED_RATES)
    expect(result).toEqual(midState)
  })

  it('does not produce punitive state even from low baseline', () => {
    const lowState: NeedsState = { hunger: 0, fatigue: 0, happiness: 100, attention: 100 }
    const result = advanceOffline(lowState, 86400, DEFAULT_NEED_RATES)
    expect(result.hunger).toBeLessThanOrEqual(OFFLINE_BOUNDS.hungerMax)
    expect(result.fatigue).toBeLessThanOrEqual(OFFLINE_BOUNDS.fatigueMax)
    expect(result.happiness).toBeGreaterThanOrEqual(OFFLINE_BOUNDS.happinessMin)
    expect(result.attention).toBeGreaterThanOrEqual(OFFLINE_BOUNDS.attentionMin)
  })
})

describe('computeOfflineSec', () => {
  it('computes elapsed seconds between two timestamps', () => {
    expect(computeOfflineSec(1000, 61000)).toBe(60)
  })

  it('returns 0 for negative or zero difference', () => {
    expect(computeOfflineSec(5000, 3000)).toBe(0)
    expect(computeOfflineSec(5000, 5000)).toBe(0)
  })
})
