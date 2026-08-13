/**
 * ClipMeta 验证 (§5.4 打标 schema)
 *
 * 验证单条片段元数据与片段元数据数组。
 * 拒绝缺失必填字段、越界值、非法枚举、逻辑冲突。
 */

import type { ClipCategory, ClipDirection, ClipAnchor } from '../types/clip-meta'
import { check, isNonEmptyString, isBoolean, isFiniteNumber, inRange, isOneOf } from './validate'
import type { ValidationErrors } from './validate'

const VALID_CATEGORIES: readonly ClipCategory[] = ['basic', 'interactive', 'signature', 'emotion']
const VALID_DIRECTIONS: readonly ClipDirection[] = ['left', 'right', 'none']
const VALID_ANCHORS: readonly ClipAnchor[] = ['sit', 'stand', 'none']

/**
 * 验证单条 ClipMeta，返回错误列表（空 = 有效）。
 *
 * 检查范围：
 * - 必填字段存在且类型正确 (§5.4)
 * - 枚举值合法 (category, direction, anchor)
 * - 数值范围合法 (variant ≥ 1, scaleHint > 0, hitbox 0–1)
 * - 循环字段逻辑 (loop=true 时 loopInSec/loopOutSec 应存在)
 * - 行走字段逻辑 (moveStartSec/moveEndSec > 0 且 start < end，track 非空)
 */
export function validateClipMeta(data: unknown): ValidationErrors {
  const errors: ValidationErrors = []
  if (typeof data !== 'object' || data === null) {
    return ['clip: expected an object']
  }
  const c = data as Record<string, unknown>

  // 必填字段
  check(isNonEmptyString(c['id']), errors, 'clip.id: expected a non-empty string')
  check(isNonEmptyString(c['state']), errors, 'clip.state: expected a non-empty string (FSM state key, §9.1)')

  check(
    isOneOf(c['category'], VALID_CATEGORIES),
    errors,
    `clip.category: expected one of ${VALID_CATEGORIES.join('|')} (§5.4)`,
  )
  check(
    isOneOf(c['direction'], VALID_DIRECTIONS),
    errors,
    `clip.direction: expected one of ${VALID_DIRECTIONS.join('|')} (§5.4)`,
  )
  check(
    isOneOf(c['anchor'], VALID_ANCHORS),
    errors,
    `clip.anchor: expected one of ${VALID_ANCHORS.join('|')} (§5.4)`,
  )

  check(isBoolean(c['loop']), errors, 'clip.loop: expected a boolean')

  // loopInSec / loopOutSec: number | null
  check(
    c['loopInSec'] === null || isFiniteNumber(c['loopInSec'] as unknown) && (c['loopInSec'] as number) >= 0,
    errors,
    'clip.loopInSec: expected a non-negative number or null',
  )
  check(
    c['loopOutSec'] === null || isFiniteNumber(c['loopOutSec'] as unknown) && (c['loopOutSec'] as number) >= 0,
    errors,
    'clip.loopOutSec: expected a non-negative number or null',
  )

  // 循环逻辑：loop=true 时 loopInSec/loopOutSec 不应为 null
  if (c['loop'] === true) {
    check(c['loopInSec'] !== null, errors, 'clip.loopInSec: must not be null when loop=true')
    check(c['loopOutSec'] !== null, errors, 'clip.loopOutSec: must not be null when loop=true')
    if (isFiniteNumber(c['loopInSec']) && isFiniteNumber(c['loopOutSec'])) {
      check(
        (c['loopInSec'] as number) < (c['loopOutSec'] as number),
        errors,
        'clip.loopInSec: must be less than loopOutSec',
      )
    }
  }

  check(isBoolean(c['signature']), errors, 'clip.signature: expected a boolean')
  check(isBoolean(c['prop']), errors, 'clip.prop: expected a boolean (§4.7)')
  check(isBoolean(c['embeddedAudio']), errors, 'clip.embeddedAudio: expected a boolean (§4.8)')

  // variant: integer ≥ 1
  check(
    Number.isInteger(c['variant']) && (c['variant'] as number) >= 1,
    errors,
    'clip.variant: expected an integer ≥ 1 (§4.5)',
  )

  // audio: string | null
  check(
    c['audio'] === null || isNonEmptyString(c['audio']),
    errors,
    'clip.audio: expected a non-empty string or null',
  )

  // scaleHint: positive number
  check(
    isFiniteNumber(c['scaleHint']) && (c['scaleHint'] as number) > 0,
    errors,
    'clip.scaleHint: expected a positive number (§7.4)',
  )

  // hitbox: [x, y, w, h] each in [0, 1]
  const hitbox = c['hitbox']
  if (!Array.isArray(hitbox) || hitbox.length !== 4) {
    errors.push('clip.hitbox: expected an array of 4 numbers [x, y, w, h] (§5.4)')
  } else {
    const [hx, hy, hw, hh] = hitbox
    check(inRange(hx, 0, 1), errors, 'clip.hitbox[0] (x): expected a number in [0, 1]')
    check(inRange(hy, 0, 1), errors, 'clip.hitbox[1] (y): expected a number in [0, 1]')
    check(inRange(hw, 0, 1), errors, 'clip.hitbox[2] (w): expected a number in [0, 1]')
    check(inRange(hh, 0, 1), errors, 'clip.hitbox[3] (h): expected a number in [0, 1]')
  }

  // 行走类可选字段 (§5.3, §7.2)
  if (c['moveStartSec'] !== undefined) {
    check(
      isFiniteNumber(c['moveStartSec']) && (c['moveStartSec'] as number) >= 0,
      errors,
      'clip.moveStartSec: expected a non-negative number (§5.3)',
    )
  }
  if (c['moveEndSec'] !== undefined) {
    check(
      isFiniteNumber(c['moveEndSec']) && (c['moveEndSec'] as number) >= 0,
      errors,
      'clip.moveEndSec: expected a non-negative number (§5.3)',
    )
  }
  if (isFiniteNumber(c['moveStartSec']) && isFiniteNumber(c['moveEndSec'])) {
    check(
      (c['moveStartSec'] as number) < (c['moveEndSec'] as number),
      errors,
      'clip.moveStartSec: must be less than moveEndSec',
    )
  }
  if (c['track'] !== undefined) {
    check(isNonEmptyString(c['track']), errors, 'clip.track: expected a non-empty string (§5.3)')
  }

  return errors
}

/**
 * 验证片段元数据数组 (clips.meta.json)。
 *
 * 除逐条验证外，还检查 id 唯一性。
 */
export function validateClipMetaArray(data: unknown): ValidationErrors {
  const errors: ValidationErrors = []
  if (!Array.isArray(data)) {
    return ['clips.meta.json: expected an array of clip metadata']
  }

  const seenIds = new Set<string>()
  data.forEach((clip, index) => {
    const clipErrors = validateClipMeta(clip)
    // 加上前缀
    for (const e of clipErrors) {
      errors.push(`clips[${index}]: ${e}`)
    }
    // id 唯一性
    if (typeof clip === 'object' && clip !== null && typeof (clip as Record<string, unknown>)['id'] === 'string') {
      const id = (clip as Record<string, string>)['id']
      check(!seenIds.has(id), errors, `clips[${index}]: duplicate id "${id}"`)
      seenIds.add(id)
    }
  })

  return errors
}
