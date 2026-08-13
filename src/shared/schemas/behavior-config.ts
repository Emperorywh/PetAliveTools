/**
 * BehaviorConfig 验证 (§12.1 behavior-config.json, §9.3, §9.5)
 */

import { check, isFiniteNumber, inRange } from './validate'
import type { ValidationErrors } from './validate'

/** 验证 BehaviorConfig 对象，返回错误列表（空 = 有效） */
export function validateBehaviorConfig(data: unknown): ValidationErrors {
  const errors: ValidationErrors = []
  if (typeof data !== 'object' || data === null) {
    return ['behavior-config: expected an object']
  }
  const obj = data as Record<string, unknown>

  // weightOverrides: Record<string, Record<string, number>>
  const wo = obj['weightOverrides']
  if (typeof wo !== 'object' || wo === null) {
    errors.push('behavior-config.weightOverrides: expected an object')
  } else {
    for (const [srcState, targets] of Object.entries(wo as Record<string, unknown>)) {
      if (typeof targets !== 'object' || targets === null) {
        errors.push(`behavior-config.weightOverrides.${srcState}: expected an object`)
        continue
      }
      for (const [tgtState, weight] of Object.entries(targets as Record<string, unknown>)) {
        check(
          isFiniteNumber(weight) && weight >= 0,
          errors,
          `behavior-config.weightOverrides.${srcState}.${tgtState}: expected a non-negative number`,
        )
      }
    }
  }

  // rhythm
  const rhythm = obj['rhythm']
  if (typeof rhythm !== 'object' || rhythm === null) {
    errors.push('behavior-config.rhythm: expected an object (§9.3)')
  } else {
    const r = rhythm as Record<string, unknown>
    check(
      Number.isInteger(r['nightStartHour']) && inRange(r['nightStartHour'], 0, 23),
      errors,
      'behavior-config.rhythm.nightStartHour: expected an integer in [0, 23]',
    )
    check(
      Number.isInteger(r['nightEndHour']) && inRange(r['nightEndHour'], 0, 23),
      errors,
      'behavior-config.rhythm.nightEndHour: expected an integer in [0, 23]',
    )
    check(
      isFiniteNumber(r['nightSleepBoost']) && (r['nightSleepBoost'] as number) >= 0,
      errors,
      'behavior-config.rhythm.nightSleepBoost: expected a non-negative number',
    )
  }

  // microRandom
  const mr = obj['microRandom']
  if (typeof mr !== 'object' || mr === null) {
    errors.push('behavior-config.microRandom: expected an object (§9.5)')
  } else {
    const m = mr as Record<string, unknown>
    check(
      inRange(m['rateJitter'], 0, 1),
      errors,
      'behavior-config.microRandom.rateJitter: expected a number in [0, 1]',
    )
    check(
      isFiniteNumber(m['idleJitterSec']) && (m['idleJitterSec'] as number) >= 0,
      errors,
      'behavior-config.microRandom.idleJitterSec: expected a non-negative number',
    )
    check(
      inRange(m['signatureProbability'], 0, 1),
      errors,
      'behavior-config.microRandom.signatureProbability: expected a number in [0, 1]',
    )
  }

  return errors
}

/** 默认 BehaviorConfig */
export function defaultBehaviorConfig() {
  return {
    weightOverrides: {},
    rhythm: {
      nightStartHour: 22,
      nightEndHour: 7,
      nightSleepBoost: 3.0,
    },
    microRandom: {
      rateJitter: 0.05,
      idleJitterSec: 2,
      signatureProbability: 0.05,
    },
  }
}
