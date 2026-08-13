/**
 * 色键边缘处理 (§5.1)
 *
 * 消除抠像边缘杂色（毛边）的三段处理：
 * 1. 溢色抑制——去除前景边缘被背景色"污染"的像素（把色度拉回自身亮度对应的中性色）；
 * 2. alpha 轻微收缩——min 滤波腐蚀蒙版，吃掉最外圈的混合像素；
 * 3. 羽化——box blur 模糊蒙版，让边缘呈半透明渐变而非硬边。
 *
 * 顺序固定：先抑制后收缩再羽化（§5.1 "色溢出抑制 → 收缩+羽化"）。
 * 纯像素运算，无平台依赖。
 */

import { type RgbColor, type RawFrame, cloneFrame } from './frame'
import {
  type YcbcrColor,
  rgbLuma,
  rgbToYcbcr,
  ramp01,
  ycbcrDistancePrecomputed
} from './color-space'

/** 边缘处理选项 */
export interface EdgeProcessingOptions {
  /** 溢色抑制范围（0..1 色度距离）：范围内前景像素按接近程度去污染 */
  readonly spillRange?: number
  /** 溢色抑制强度（0..1，0=关闭） */
  readonly spillStrength?: number
  /** alpha 收缩半径（像素，0=跳过） */
  readonly shrinkRadius?: number
  /** alpha 羽化半径（像素，0=跳过） */
  readonly featherRadius?: number
}

export const DEFAULT_SPILL_RANGE = 0.3
export const DEFAULT_SPILL_STRENGTH = 1
export const DEFAULT_SHRINK_RADIUS = 1
export const DEFAULT_FEATHER_RADIUS = 1

/**
 * 溢色抑制：把前景像素中被背景色污染的色度拉回其自身亮度对应的中性色。
 *
 * 溢出量 s = ramp 随色度接近背景色而增大；每通道向亮度 luma 收敛：
 *   c' = c + s·(luma − c)
 *
 * 溢出本质是色度污染，故始终用纯色度距离（无亮度项）判定；
 * 灰背景为消色差（无可去污的色相），本步骤对其自然无操作。
 * alpha=0 的背景像素不动。
 *
 * @param frame 输入帧（不被修改）
 * @param alpha 当前蒙版（alpha>0 视为前景）
 * @param referenceColor 背景参考色
 * @returns 新帧（RGB 已去污染，alpha 通道保持输入原值）
 */
export function suppressSpill(
  frame: RawFrame,
  alpha: Uint8Array,
  referenceColor: RgbColor,
  options?: EdgeProcessingOptions
): RawFrame {
  const spillRange = options?.spillRange ?? DEFAULT_SPILL_RANGE
  const spillStrength = options?.spillStrength ?? DEFAULT_SPILL_STRENGTH
  if (spillRange <= 0 || spillStrength <= 0) {
    return cloneFrame(frame)
  }

  const refYcbcr: YcbcrColor = rgbToYcbcr(referenceColor)
  const out = cloneFrame(frame)
  const pixelCount = frame.width * frame.height

  for (let i = 0; i < pixelCount; i++) {
    if (alpha[i] <= 0) {
      continue
    }
    const o = i * 4
    const r = out.data[o]
    const g = out.data[o + 1]
    const b = out.data[o + 2]

    const d = ycbcrDistancePrecomputed(r, g, b, refYcbcr, 0)
    const s = (1 - ramp01(d, 0, spillRange)) * spillStrength
    if (s <= 0) {
      continue
    }

    const luma = rgbLuma({ r, g, b })
    out.data[o] = r + s * (luma - r)
    out.data[o + 1] = g + s * (luma - g)
    out.data[o + 2] = b + s * (luma - b)
  }

  return out
}

/**
 * alpha 轻微收缩：方形 min 滤波（腐蚀）。
 *
 * 吃掉蒙版最外圈的背景-前景混合像素，消除实底毛边。
 * 半径 0 原样返回；边界采用边缘延伸（clamp）采样。
 */
export function shrinkAlpha(
  alpha: Uint8Array,
  width: number,
  height: number,
  options?: EdgeProcessingOptions
): Uint8Array {
  const radius = options?.shrinkRadius ?? DEFAULT_SHRINK_RADIUS
  if (radius <= 0) {
    return alpha
  }

  const out = new Uint8Array(alpha.length)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let min = 255
      for (let dy = -radius; dy <= radius; dy++) {
        const sy = Math.min(height - 1, Math.max(0, y + dy))
        const row = sy * width
        for (let dx = -radius; dx <= radius; dx++) {
          const sx = Math.min(width - 1, Math.max(0, x + dx))
          const v = alpha[row + sx]
          if (v < min) {
            min = v
          }
        }
      }
      out[y * width + x] = min
    }
  }
  return out
}

/**
 * alpha 羽化：可分离 box blur。
 *
 * 让收缩后的硬边缘呈半透明渐变（水平+垂直两趟，边界 clamp）。
 * 半径 0 原样返回。
 */
export function featherAlpha(
  alpha: Uint8Array,
  width: number,
  height: number,
  options?: EdgeProcessingOptions
): Uint8Array {
  const radius = options?.featherRadius ?? DEFAULT_FEATHER_RADIUS
  if (radius <= 0) {
    return alpha
  }

  const horizontal = new Float64Array(alpha.length)
  const divisor = radius * 2 + 1

  // 水平趟：窗口 [x−r, x+r] clamp 到图像内
  for (let y = 0; y < height; y++) {
    const row = y * width
    for (let x = 0; x < width; x++) {
      let sum = 0
      for (let dx = -radius; dx <= radius; dx++) {
        const sx = Math.min(width - 1, Math.max(0, x + dx))
        sum += alpha[row + sx]
      }
      horizontal[row + x] = sum / divisor
    }
  }

  // 垂直趟
  const out = new Uint8Array(alpha.length)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let sum = 0
      for (let dy = -radius; dy <= radius; dy++) {
        const sy = Math.min(height - 1, Math.max(0, y + dy))
        sum += horizontal[sy * width + x]
      }
      out[y * width + x] = Math.round(sum / divisor)
    }
  }
  return out
}
