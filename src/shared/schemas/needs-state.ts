/**
 * NeedsState 验证 (§12.1 needs-state.json, §9.4)
 */

import { check, inRange } from './validate'
import type { ValidationErrors } from './validate'

const NEED_FIELDS = ['hunger', 'fatigue', 'happiness', 'attention'] as const

/** 验证 NeedsState 对象，返回错误列表（空 = 有效） */
export function validateNeedsState(data: unknown): ValidationErrors {
  const errors: ValidationErrors = []
  if (typeof data !== 'object' || data === null) {
    return ['needs-state: expected an object']
  }
  const obj = data as Record<string, unknown>

  for (const field of NEED_FIELDS) {
    check(
      inRange(obj[field], 0, 100),
      errors,
      `needs-state.${field}: expected a number in [0, 100] (§9.4)`,
    )
  }

  return errors
}

/** 默认 NeedsState（全部居中 50） */
export function defaultNeedsState() {
  return {
    hunger: 50,
    fatigue: 30,
    happiness: 70,
    attention: 50,
  }
}
