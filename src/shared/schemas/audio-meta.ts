/**
 * AudioMeta 验证 (§12.1 audio.meta.json, §11)
 */

import { check, isNonEmptyString, isFiniteNumber, isOneOf } from './validate'
import type { ValidationErrors } from './validate'
import type { AudioCategory } from '../types/audio-meta'

const VALID_CATEGORIES: readonly AudioCategory[] = ['ambient', 'action']

/** 验证单条 AudioMeta，返回错误列表（空 = 有效） */
export function validateAudioMeta(data: unknown): ValidationErrors {
  const errors: ValidationErrors = []
  if (typeof data !== 'object' || data === null) {
    return ['audio: expected an object']
  }
  const a = data as Record<string, unknown>

  check(isNonEmptyString(a['id']), errors, 'audio.id: expected a non-empty string')
  check(isNonEmptyString(a['file']), errors, 'audio.file: expected a non-empty string')
  check(isNonEmptyString(a['label']), errors, 'audio.label: expected a non-empty string')

  check(
    isOneOf(a['category'], VALID_CATEGORIES),
    errors,
    `audio.category: expected one of ${VALID_CATEGORIES.join('|')} (§11.1)`,
  )

  check(
    isFiniteNumber(a['cooldownSec']) && (a['cooldownSec'] as number) >= 0,
    errors,
    'audio.cooldownSec: expected a non-negative number (§11.2)',
  )
  check(
    Number.isInteger(a['maxPerHour']) && (a['maxPerHour'] as number) >= 0,
    errors,
    'audio.maxPerHour: expected a non-negative integer (§11.2)',
  )

  return errors
}

/** 验证音频元数据数组 */
export function validateAudioMetaArray(data: unknown): ValidationErrors {
  const errors: ValidationErrors = []
  if (!Array.isArray(data)) {
    return ['audio.meta.json: expected an array of audio metadata']
  }

  const seenIds = new Set<string>()
  data.forEach((item, index) => {
    const itemErrors = validateAudioMeta(item)
    for (const e of itemErrors) {
      errors.push(`audio[${index}]: ${e}`)
    }
    if (typeof item === 'object' && item !== null && typeof (item as Record<string, unknown>)['id'] === 'string') {
      const id = (item as Record<string, string>)['id']
      check(!seenIds.has(id), errors, `audio[${index}]: duplicate id "${id}"`)
      seenIds.add(id)
    }
  })

  return errors
}
