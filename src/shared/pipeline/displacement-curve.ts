/**
 * 位移曲线生成与手动校正 (§5.3 / §7.2)
 *
 * 跟踪裁切把宠物的源画面位移"转移"给了裁切窗口；位移曲线把它
 * 记录为逐帧 x 偏移序列（track.json），运行时驱动窗口平移
 * `window.x = startX + displacement(t) × scale`——即使动物变速
 * （停顿/加速），平移也与画面内步态严格同步，脚爪不滑步 (§7.2)。
 *
 * 手动校正（停顿/变速处）：关键点指定"某帧处的正确偏移"，
 * 校正曲线在关键点间对跟踪残差做分段线性过渡——关键点处严格
 * 命中目标值，段间保留跟踪曲线的局部形状（步态节奏不丢）。
 *
 * 纯计算，无平台依赖。
 */

import type { TrackFile, TrackKeypoint } from '../types/track-file'
import type { WalkFrameTrack } from './walk-tracker'

/**
 * 由逐帧跟踪序列生成位移曲线 (track.json, §5.3)。
 *
 * offsets[i] = 质心 x[i] − 质心 x[0]（起点归一为 0）。
 * 向左行走时为负值，运行时由方向/镜像处理，此处不取绝对值。
 *
 * sourceWidth 记录跟踪画面的像素宽度（跟踪通常在降采样帧上进行，
 * §5.5），运行时空间层据此把曲线像素换算为屏幕像素 (§7.2)。
 */
export function generateDisplacementCurve(
  track: readonly WalkFrameTrack[],
  fps: number,
  sourceWidth: number
): TrackFile {
  if (!Number.isFinite(fps) || fps <= 0) {
    throw new Error(`invalid fps: ${fps}`)
  }
  if (!Number.isInteger(sourceWidth) || sourceWidth <= 0) {
    throw new Error(`invalid sourceWidth: ${sourceWidth}`)
  }
  if (track.length === 0) {
    throw new Error('cannot generate displacement curve from empty track')
  }

  const baseX = track[0].centroidX
  const offsets = track.map((t) => t.centroidX - baseX)

  return {
    version: 1,
    fps,
    frameCount: offsets.length,
    sourceWidth,
    offsets,
    keypoints: []
  }
}

/**
 * 应用手动校正关键点，返回校正后的逐帧偏移序列 (§5.3 停顿/变速处)。
 *
 * 令 delta_j = keypoint_j.offset − raw[keypoint_j.frame]（该处的跟踪
 * 残差）：第一个关键点之前/最后一个之后恒定沿用端点残差，相邻关键点
 * 之间对残差线性过渡：
 *   corrected[f] = raw[f] + lerp(delta_j, delta_j+1, (f − f_j)/(f_j+1 − f_j))
 *
 * @param raw 跟踪生成的原始偏移序列
 * @param keypoints 校正关键点（帧唯一；帧须在 raw 范围内）
 */
export function applyKeypointCorrections(
  raw: readonly number[],
  keypoints: readonly TrackKeypoint[]
): number[] {
  if (keypoints.length === 0) {
    return [...raw]
  }

  const sorted = [...keypoints].sort((a, b) => a.frame - b.frame)
  for (let i = 0; i < sorted.length; i++) {
    const k = sorted[i]
    if (!Number.isInteger(k.frame) || k.frame < 0 || k.frame >= raw.length) {
      throw new Error(`keypoint frame ${k.frame} out of range [0, ${raw.length - 1}]`)
    }
    if (i > 0 && sorted[i - 1].frame === k.frame) {
      throw new Error(`duplicate keypoint frame: ${k.frame}`)
    }
  }

  const deltas = sorted.map((k) => k.offset - raw[k.frame])

  return raw.map((value, f) => {
    if (f <= sorted[0].frame) {
      return value + deltas[0]
    }
    const last = sorted.length - 1
    if (f >= sorted[last].frame) {
      return value + deltas[last]
    }
    // 位于相邻关键点之间：残差线性过渡
    let hi = 1
    while (sorted[hi].frame < f) {
      hi++
    }
    const lo = hi - 1
    const t = (f - sorted[lo].frame) / (sorted[hi].frame - sorted[lo].frame)
    return value + deltas[lo] + (deltas[hi] - deltas[lo]) * t
  })
}

/** 行走子段标注结果 (§5.3 moveStartSec/moveEndSec, §7.2 平移区间) */
export interface MoveSegment {
  readonly moveStartFrame: number
  readonly moveEndFrame: number
  readonly moveStartSec: number
  readonly moveEndSec: number
}

/** 行走子段检测选项 */
export interface MoveSegmentDetectOptions {
  /** 视为"站定"的帧间速度上限（源像素/帧，默认 0.25） */
  readonly speedThreshold?: number
  /** 判定为起/止站定段的最小连续帧数（默认 max(2, round(fps/3)) ≈ 0.33s） */
  readonly minStandFrames?: number
}

export const DEFAULT_SPEED_THRESHOLD = 0.25

/** 帧号 → 秒（浮点） */
export function frameToSec(frame: number, fps: number): number {
  return frame / fps
}

/**
 * 从位移曲线检测行走子段边界 (§5.3)。
 *
 * 起止的站定段不参与平移 (§7.2)：moveStart = 片段头部站定段之后
 * 的首帧，moveEnd = 尾部站定段之前的最末帧；片段中部的停顿属于
 * 曲线自身的平坦段，不影响起止边界。
 *
 * @returns 检测结果；整段站定（无位移）返回 null
 */
export function detectMoveSegment(
  offsets: readonly number[],
  fps: number,
  options: MoveSegmentDetectOptions = {}
): MoveSegment | null {
  if (offsets.length === 0) {
    throw new Error('cannot detect move segment from empty offsets')
  }
  if (!Number.isFinite(fps) || fps <= 0) {
    throw new Error(`invalid fps: ${fps}`)
  }

  const threshold = options.speedThreshold ?? DEFAULT_SPEED_THRESHOLD
  const minStand = options.minStandFrames ?? Math.max(2, Math.round(fps / 3))

  // 帧间速度（首帧视为 0）
  const speeds = offsets.map((o, i) => (i === 0 ? 0 : Math.abs(o - offsets[i - 1])))

  // 头部连续低速游程（含首帧）：游程 ≥ minStand 才视为起站定段
  let headRun = 0
  while (headRun < offsets.length && speeds[headRun] <= threshold) {
    headRun++
  }
  // 尾部连续低速游程：帧 [n-1-run, n-1] 相对前帧速度为 0
  let tailRun = 0
  while (tailRun < offsets.length && speeds[offsets.length - 1 - tailRun] <= threshold) {
    tailRun++
  }

  const moveStartFrame =
    headRun >= minStand ? Math.min(headRun, offsets.length - 1) : 0
  const moveEndFrame =
    tailRun >= minStand ? Math.max(offsets.length - 1 - tailRun, 0) : offsets.length - 1

  // 整段站定：起止站定游程重叠覆盖整段 → 无有效行走子段
  if (headRun + tailRun >= offsets.length || moveStartFrame >= moveEndFrame) {
    return null
  }

  return {
    moveStartFrame,
    moveEndFrame,
    moveStartSec: frameToSec(moveStartFrame, fps),
    moveEndSec: frameToSec(moveEndFrame, fps)
  }
}
