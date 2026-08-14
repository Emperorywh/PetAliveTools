/**
 * BehaviorConfig 验证 (§12.1 behavior-config.json, §9.3, §9.5, §12.4)
 */

import { check, isFiniteNumber, inRange, isBoolean, isNonEmptyString } from './validate'
import type { ValidationErrors } from './validate'
import type { ShellSettings } from '../types/behavior-config'

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

  // shell (§12.4)
  errors.push(...validateShellSettings(obj['shell']))

  return errors
}

/** 验证 ShellSettings 对象，返回错误列表（空 = 有效） */
export function validateShellSettings(data: unknown): ValidationErrors {
  const errors: ValidationErrors = []
  if (typeof data !== 'object' || data === null) {
    return ['behavior-config.shell: expected an object (§12.4)']
  }
  const s = data as Record<string, unknown>

  // displayId: number | null
  if (s['displayId'] !== null && !isFiniteNumber(s['displayId'])) {
    errors.push('behavior-config.shell.displayId: expected a number or null (§6.4)')
  }

  check(
    inRange(s['volume'], 0, 1),
    errors,
    'behavior-config.shell.volume: expected a number in [0, 1] (§11.2)',
  )
  check(
    isFiniteNumber(s['ambientFrequency']) && (s['ambientFrequency'] as number) > 0,
    errors,
    'behavior-config.shell.ambientFrequency: expected a positive number (§11.1)',
  )
  check(
    isBoolean(s['autoLaunch']),
    errors,
    'behavior-config.shell.autoLaunch: expected a boolean (§12.4)',
  )
  check(
    isNonEmptyString(s['hideHotkey']),
    errors,
    'behavior-config.shell.hideHotkey: expected a non-empty string (§10)',
  )

  return errors
}

/** 默认外壳设置 (§12.4) */
export function defaultShellSettings(): ShellSettings {
  return {
    displayId: null,
    volume: 0.25,
    ambientFrequency: 1.0,
    autoLaunch: true,
    hideHotkey: 'CommandOrControl+Shift+H',
  }
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
      idleJitterSec: 2,
      signatureProbability: 0.05,
    },
    shell: defaultShellSettings(),
  }
}
