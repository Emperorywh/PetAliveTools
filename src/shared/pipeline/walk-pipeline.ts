/**
 * 行走跟踪全流程编排 (§5.3)
 *
 * 把色键输出（KeyedFrame[]）走完 §5.3 行走跟踪管线：
 *   trackWalkFrames → generateDisplacementCurve → detectMoveSegment
 *
 * 导入向导（§5.5）的行走跟踪步骤调用此函数从用户实际视频生成
 * 位移曲线与行走子段边界；walk-correction-demo.ts 使用同样的范式。
 *
 * 纯计算，无平台依赖。
 */

import type { KeyedFrame } from './chroma-key'
import type { TrackFile } from '../types/track-file'
import { trackWalkFrames } from './walk-tracker'
import {
  type MoveSegment,
  generateDisplacementCurve,
  detectMoveSegment
} from './displacement-curve'

/** 行走跟踪全流程结果 */
export interface WalkTrackResult {
  /** 位移曲线（track.json 原始，未校正） */
  readonly trackFile: TrackFile
  /** 行走子段边界（整段站定时为 null） */
  readonly moveSegment: MoveSegment | null
}

/**
 * 由色键后的帧序列走完行走跟踪管线 (§5.3)。
 *
 * @param keyedFrames 色键输出帧序列
 * @param fps 源视频帧率
 * @returns 位移曲线 + 行走子段检测结果
 */
export function buildWalkTrack(
  keyedFrames: readonly KeyedFrame[],
  fps: number
): WalkTrackResult {
  if (keyedFrames.length === 0) {
    throw new Error('cannot build walk track from empty frames')
  }
  const track = trackWalkFrames(keyedFrames)
  const trackFile = generateDisplacementCurve(track, fps)
  const moveSegment = detectMoveSegment(trackFile.offsets, fps)
  return { trackFile, moveSegment }
}
