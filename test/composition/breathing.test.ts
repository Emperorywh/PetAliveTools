import { describe, it, expect } from 'vitest'
import {
  breathingScale,
  BREATHING_AMPLITUDE,
  BREATHING_FREQUENCY_HZ,
  BREATHING_PERIOD_MS,
} from '../../src/renderer/composition/breathing'

describe('breathingScale', () => {
  it('returns 1 at t=0 (sin(0) = 0)', () => {
    expect(breathingScale(0)).toBeCloseTo(1, 10)
  })

  it('stays within [1 - amplitude, 1 + amplitude]', () => {
    // 采样一个完整周期内的多个点
    for (let i = 0; i <= 100; i++) {
      const t = (i / 100) * BREATHING_PERIOD_MS
      const s = breathingScale(t)
      expect(s).toBeGreaterThanOrEqual(1 - BREATHING_AMPLITUDE)
      expect(s).toBeLessThanOrEqual(1 + BREATHING_AMPLITUDE)
    }
  })

  it('reaches maximum at quarter period (sin(π/2) = 1)', () => {
    const t = BREATHING_PERIOD_MS / 4
    expect(breathingScale(t)).toBeCloseTo(1 + BREATHING_AMPLITUDE, 6)
  })

  it('reaches minimum at three-quarter period (sin(3π/2) = -1)', () => {
    const t = (3 * BREATHING_PERIOD_MS) / 4
    expect(breathingScale(t)).toBeCloseTo(1 - BREATHING_AMPLITUDE, 6)
  })

  it('returns to 1 at full period', () => {
    expect(breathingScale(BREATHING_PERIOD_MS)).toBeCloseTo(1, 6)
  })

  it('oscillates at approximately 0.25Hz (period ≈ 4000ms)', () => {
    expect(BREATHING_FREQUENCY_HZ).toBeCloseTo(0.25, 2)
    expect(BREATHING_PERIOD_MS).toBeCloseTo(4000, 0)
  })

  it('amplitude is ±0.6%', () => {
    expect(BREATHING_AMPLITUDE).toBeCloseTo(0.006, 6)
  })
})
