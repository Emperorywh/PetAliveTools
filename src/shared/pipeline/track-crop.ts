/**
 * 行走跟踪裁切 (§5.3 / §7.2)
 *
 * 把"宠物在源画面内移动"的行走片段稳定化为"宠物近似居中"的
 * 定宽片段，屏幕位移交由窗口平移在运行时复现（位移曲线）：
 * - x 方向：裁切原点跟随质心 → 宠物在输出画面内近似居中
 * - y 方向：裁切原点由足部行驱动 → 足部锁定输出地面线，全程一致
 *
 * 裁切矩形与位移曲线由同一质心序列派生：位移[i] = 裁切原点位移[i]，
 * 二者按构造严格一致，窗口平移与画面内步态不会错位（脚爪不滑步）。
 *
 * 超出源边界的区域裁为全透明（抠像背景本就透明，视觉无差异），
 * 保证宠物走到源画面边缘时居中/贴地约束仍严格成立。
 *
 * 纯像素运算，无平台依赖。
 */

import { type RawFrame, createFrame } from './frame'
import type { WalkFrameTrack } from './walk-tracker'

/** 跟踪裁切配置 */
export interface TrackCropOptions {
  /** 输出宽度（像素，定宽） */
  readonly width: number
  /** 输出高度（像素） */
  readonly height: number
  /** 宠物目标质心在输出画面中的 x（默认 width/2） */
  readonly centerX?: number
  /** 地面线在输出画面中的 y（足部锁定行，默认 height - 1） */
  readonly groundY?: number
}

/** 单帧裁切矩形：源画面中输出画面的左上角 */
export interface TrackCropRect {
  readonly x: number
  readonly y: number
}

/**
 * 计算整段的裁切矩形序列 (§5.3)。
 *
 * - x = round(质心 x − centerX)：宠物在输出内水平居中
 * - y = round(足部 y − groundY)：足部锁定输出地面线
 */
export function computeTrackCropRects(
  track: readonly WalkFrameTrack[],
  options: TrackCropOptions
): TrackCropRect[] {
  const { width, height } = options
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new Error(`invalid track-crop dimensions: ${width}x${height}`)
  }
  const centerX = options.centerX ?? width / 2
  const groundY = options.groundY ?? height - 1

  return track.map((t) => ({
    x: Math.round(t.centroidX - centerX),
    y: Math.round(t.feetY - groundY)
  }))
}

/**
 * 按裁切矩形裁切一帧（超界区域补全透明）。
 *
 * @param source 源帧（RGBA，尺寸与跟踪时一致）
 * @param rect 裁切矩形（可为任意整数原点）
 * @param width 输出宽度
 * @param height 输出高度
 */
export function cropFrame(
  source: RawFrame,
  rect: TrackCropRect,
  width: number,
  height: number
): RawFrame {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new Error(`invalid crop dimensions: ${width}x${height}`)
  }

  const out = createFrame(width, height)

  // 源帧与输出画布的相交窗口
  const x0 = Math.max(0, rect.x)
  const y0 = Math.max(0, rect.y)
  const x1 = Math.min(source.width, rect.x + width)
  const y1 = Math.min(source.height, rect.y + height)

  for (let sy = y0; sy < y1; sy++) {
    const srcRow = sy * source.width
    const dy = sy - rect.y
    const dstRow = dy * width
    for (let sx = x0; sx < x1; sx++) {
      const so = (srcRow + sx) * 4
      const doff = (dstRow + (sx - rect.x)) * 4
      out.data[doff] = source.data[so]
      out.data[doff + 1] = source.data[so + 1]
      out.data[doff + 2] = source.data[so + 2]
      out.data[doff + 3] = source.data[so + 3]
    }
  }

  return out
}
