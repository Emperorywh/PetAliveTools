/**
 * 位移曲线文件 (track.json) 验证 (§5.3、§12.1)
 *
 * 拒绝缺失必填字段、非法版本、帧数/偏移序列长度不一致、
 * 越界或重复/乱序的关键点。
 */

import type { TrackFile } from '../types/track-file'
import { check, isFiniteNumber, type ValidationErrors } from './validate'

/**
 * 验证 track.json 数据，返回错误列表（空 = 有效）。
 *
 * 检查范围：
 * - version === 1
 * - fps 为正有限数；frameCount 为 ≥ 1 的整数
 * - sourceWidth 为 ≥ 1 的整数（位移曲线像素空间，§7.2）
 * - offsets 为有限数字数组且长度 === frameCount
 * - keypoints 按 frame 升序、帧唯一、帧在 [0, frameCount) 内、offset 有限
 */
export function validateTrackFile(data: unknown): ValidationErrors {
  const errors: ValidationErrors = []
  if (typeof data !== 'object' || data === null) {
    return ['track: expected an object']
  }
  const t = data as Record<string, unknown>

  check(t['version'] === 1, errors, 'track.version: expected 1')

  check(
    isFiniteNumber(t['fps']) && (t['fps'] as number) > 0,
    errors,
    'track.fps: expected a positive finite number (§5.2)'
  )

  check(
    Number.isInteger(t['frameCount']) && (t['frameCount'] as number) >= 1,
    errors,
    'track.frameCount: expected an integer ≥ 1'
  )

  check(
    Number.isInteger(t['sourceWidth']) && (t['sourceWidth'] as number) >= 1,
    errors,
    'track.sourceWidth: expected an integer ≥ 1 (§7.2)'
  )

  const offsets = t['offsets']
  if (!Array.isArray(offsets)) {
    errors.push('track.offsets: expected an array of per-frame x offsets (§5.3)')
  } else {
    offsets.forEach((o, i) => {
      check(isFiniteNumber(o), errors, `track.offsets[${i}]: expected a finite number`)
    })
    if (Number.isInteger(t['frameCount'])) {
      check(
        offsets.length === t['frameCount'],
        errors,
        `track.offsets: length ${offsets.length} does not match frameCount ${t['frameCount']}`
      )
    }
  }

  const keypoints = t['keypoints']
  if (!Array.isArray(keypoints)) {
    errors.push('track.keypoints: expected an array of keypoint corrections')
  } else {
    let prevFrame: number | null = null
    keypoints.forEach((k, i) => {
      if (typeof k !== 'object' || k === null) {
        errors.push(`track.keypoints[${i}]: expected an object { frame, offset }`)
        return
      }
      const kp = k as Record<string, unknown>
      check(
        Number.isInteger(kp['frame']) && (kp['frame'] as number) >= 0,
        errors,
        `track.keypoints[${i}].frame: expected a non-negative integer`
      )
      check(
        isFiniteNumber(kp['offset']),
        errors,
        `track.keypoints[${i}].offset: expected a finite number`
      )
      if (Number.isInteger(kp['frame'])) {
        if (prevFrame !== null && (kp['frame'] as number) <= prevFrame) {
          errors.push(
            `track.keypoints[${i}].frame: must be strictly ascending (got ${kp['frame']} after ${prevFrame})`
          )
        }
        prevFrame = kp['frame'] as number
        if (Number.isInteger(t['frameCount'])) {
          check(
            (kp['frame'] as number) < (t['frameCount'] as number),
            errors,
            `track.keypoints[${i}].frame: must be < frameCount ${t['frameCount']}`
          )
        }
      }
    })
  }

  return errors
}

/** 判定未知值是否为合法 TrackFile（供读取端收敛类型） */
export function isTrackFile(data: unknown): data is TrackFile {
  return validateTrackFile(data).length === 0
}
