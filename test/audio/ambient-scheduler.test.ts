import { describe, it, expect } from 'vitest'
import {
  DEFAULT_AMBIENT_CONFIG,
  computeNextAmbientIntervalSec,
  createAmbientScheduleState,
  shouldPlayAmbient,
  scheduleNextAmbient,
} from '../../src/shared/audio/ambient-scheduler'

describe('computeNextAmbientIntervalSec', () => {
  it('returns interval within day range during daytime', () => {
    const config = { ...DEFAULT_AMBIENT_CONFIG, frequencyMultiplier: 1.0 }
    const interval = computeNextAmbientIntervalSec(config, false, () => 0.5)
    // Day: [30, 120], mid = 75
    expect(interval).toBeGreaterThanOrEqual(5)
    expect(interval).toBeLessThanOrEqual(120)
  })

  it('returns longer interval at night', () => {
    const config = { ...DEFAULT_AMBIENT_CONFIG, frequencyMultiplier: 1.0 }
    const dayInterval = computeNextAmbientIntervalSec(config, false, () => 0.5)
    const nightInterval = computeNextAmbientIntervalSec(config, true, () => 0.5)
    expect(nightInterval).toBeGreaterThan(dayInterval)
  })

  it('reduces interval with higher frequency multiplier', () => {
    const config: typeof DEFAULT_AMBIENT_CONFIG = {
      ...DEFAULT_AMBIENT_CONFIG,
      frequencyMultiplier: 2.0,
    }
    const interval = computeNextAmbientIntervalSec(config, false, () => 0.5)
    // Day mid = 75, divided by 2 = 37.5
    expect(interval).toBeCloseTo(37.5, 0)
  })

  it('increases interval with lower frequency multiplier', () => {
    const config: typeof DEFAULT_AMBIENT_CONFIG = {
      ...DEFAULT_AMBIENT_CONFIG,
      frequencyMultiplier: 0.5,
    }
    const interval = computeNextAmbientIntervalSec(config, false, () => 0.5)
    // Day mid = 75, divided by 0.5 = 150
    expect(interval).toBeCloseTo(150, 0)
  })

  it('clamps minimum to 5 seconds', () => {
    const config: typeof DEFAULT_AMBIENT_CONFIG = {
      dayIntervalSec: [1, 2],
      nightIntervalSec: [1, 2],
      frequencyMultiplier: 10,
    }
    const interval = computeNextAmbientIntervalSec(config, false, () => 0.5)
    expect(interval).toBeGreaterThanOrEqual(5)
  })

  it('respects rng for randomization', () => {
    const config = DEFAULT_AMBIENT_CONFIG
    const i1 = computeNextAmbientIntervalSec(config, false, () => 0.0)
    const i2 = computeNextAmbientIntervalSec(config, false, () => 1.0)
    // rng=0 → min (30s), rng=1 → max (120s)
    expect(i1).toBeCloseTo(30, 0)
    expect(i2).toBeCloseTo(120, 0)
  })
})

describe('createAmbientScheduleState', () => {
  it('sets next play time in the future', () => {
    const state = createAmbientScheduleState(10000, 30)
    expect(state.nextPlayMs).toBe(40000)
  })
})

describe('shouldPlayAmbient', () => {
  it('returns true when time has arrived', () => {
    const state = createAmbientScheduleState(0, 10)
    expect(shouldPlayAmbient(state, 10001)).toBe(true)
  })

  it('returns false before scheduled time', () => {
    const state = createAmbientScheduleState(0, 10)
    expect(shouldPlayAmbient(state, 9999)).toBe(false)
  })

  it('returns true exactly at scheduled time', () => {
    const state = createAmbientScheduleState(0, 10)
    expect(shouldPlayAmbient(state, 10000)).toBe(true)
  })
})

describe('scheduleNextAmbient', () => {
  it('computes next play time from now', () => {
    const next = scheduleNextAmbient(15000, 60)
    expect(next.nextPlayMs).toBe(75000)
  })
})
