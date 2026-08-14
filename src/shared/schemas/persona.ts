/**
 * Persona 验证。
 *
 * 只验证身份与性格，不再接受或要求视频镜像配置。
 */

import type { Persona } from '../types/persona'
import { check, inRange, isNonEmptyString } from './validate'
import type { ValidationErrors } from './validate'

const PERSONALITY_DIMS = ['liveliness', 'laziness', 'clinginess', 'timidity', 'curiosity'] as const

/** 验证 Persona 对象，返回错误列表（空 = 有效） */
export function validatePersona(data: unknown): ValidationErrors {
  const errors: ValidationErrors = []
  if (typeof data !== 'object' || data === null) {
    return ['persona: expected an object']
  }
  const obj = data as Record<string, unknown>

  check(isNonEmptyString(obj['name']), errors, 'persona.name: expected a non-empty string')

  const personality = obj['personality']
  if (typeof personality !== 'object' || personality === null) {
    errors.push('persona.personality: expected an object (§9.6)')
  } else {
    const p = personality as Record<string, unknown>
    for (const dim of PERSONALITY_DIMS) {
      const label = `persona.personality.${dim}`
      check(
        inRange(p[dim], 0, 1),
        errors,
        `${label}: expected a number in [0, 1] (§9.6)`,
      )
    }
  }

  return errors
}

/** 默认 Personality（全部居中 0.5） */
export function defaultPersonality(): Persona['personality'] {
  return {
    liveliness: 0.5,
    laziness: 0.5,
    clinginess: 0.5,
    timidity: 0.5,
    curiosity: 0.5,
  }
}
