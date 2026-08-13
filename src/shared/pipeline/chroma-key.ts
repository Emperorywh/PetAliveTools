/**
 * 色键抠像 (§5.1)
 *
 * 取背景参考色 → 容差阈值 → 生成 alpha 蒙版：
 * 每像素计算其与参考色的色键距离 d（HSV/YCbCr），
 * d ≤ tolerance·(1−softness) → 背景（alpha 0），d ≥ tolerance → 前景（alpha 255），
 * 中间为 smoothstep 软过渡带。
 *
 * 背景参考帧减除（可选辅助）：先拍 1–2 秒空背景（§5.1），
 * 在色度判定的软过渡带（边缘最不稳定处）用帧差修正 alpha——
 * 与参考帧几乎相同的像素推向背景，差异明显的像素推向前景；
 * 色度已明确判定（alpha 0 或 255）的区域不受影响，保证整体稳定性。
 *
 * applyChromaKey 为完整处理入口：色键蒙版 → 溢色抑制 → 收缩 → 羽化。
 * 纯像素运算，无平台依赖；输出供转码（TASK-007）与行走跟踪（TASK-006）使用。
 */

import {
  type RgbColor,
  type RawFrame,
  assertSameDimensions,
  cloneFrame,
  getPixel
} from './frame'
import {
  type HsvColor,
  type YcbcrColor,
  hsvDistancePrecomputed,
  rgbDistance,
  rgbToHsv,
  rgbToYcbcr,
  ramp01,
  ycbcrDistancePrecomputed
} from './color-space'
import {
  type EdgeProcessingOptions,
  featherAlpha,
  shrinkAlpha,
  suppressSpill
} from './edge-processing'

/** 色键颜色空间：ycbcr（默认，灰/蓝背景皆宜）、hsv（彩色背景色相键） */
export type KeyColorSpace = 'ycbcr' | 'hsv'

/** 背景参考帧减除辅助配置 */
export interface ReferenceFrameAssist {
  /** 空背景参考帧（与输入帧同尺寸） */
  readonly frame: RawFrame
  /** 帧差容差（0..1 归一化 RGB 距离）：小于等于视为"与背景相同" */
  readonly tolerance: number
  /** 帧差软过渡带宽度（0..1，占容差比例） */
  readonly softness?: number
  /** 辅助强度（0..1）：软过渡带内参考帧话语权，0=完全关闭 */
  readonly influence?: number
}

/** 色键选项 */
export interface ChromaKeyOptions {
  /** 背景参考色（从背景圈选采样） */
  readonly referenceColor: RgbColor
  readonly colorSpace?: KeyColorSpace
  /** 容差阈值（0..1 色键距离） */
  readonly tolerance?: number
  /** 软过渡带宽度（0..1，占容差比例） */
  readonly softness?: number
  /** YCbCr 亮度混合权重（0=纯色度；灰背景需 >0，见 color-space.ts） */
  readonly lumaWeight?: number
  /** 背景参考帧减除辅助（可选） */
  readonly reference?: ReferenceFrameAssist | null
}

export const DEFAULT_TOLERANCE = 0.15
export const DEFAULT_SOFTNESS = 0.3
export const DEFAULT_LUMA_WEIGHT = 0
export const DEFAULT_REFERENCE_SOFTNESS = 0.3
export const DEFAULT_REFERENCE_INFLUENCE = 1

/** alpha 蒙版（0=全透明背景，255=不透明前景） */
export interface AlphaMask {
  readonly width: number
  readonly height: number
  readonly alpha: Uint8Array
}

/** 色键处理结果：已应用最终 alpha 的帧 + 最终蒙版 */
export interface KeyedFrame {
  readonly width: number
  readonly height: number
  readonly frame: RawFrame
  readonly alpha: Uint8Array
}

function quantizeAlpha(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)))
}

/**
 * 生成 alpha 蒙版（§5.1 色键 + 可选参考帧减除辅助）。
 *
 * 蒙版合成规则：
 *   chromaAlpha = ramp(d, tolerance·(1−softness), tolerance)
 *   u = chromaAlpha / 255
 *   w = 4·u·(1−u) · influence        ← 仅软过渡带（u≈0.5）生效
 *   alpha = chromaAlpha·(1−w) + refAlpha·w
 *
 * @param frame 输入帧（RGBA）
 * @param options 色键选项
 */
export function generateAlphaMask(frame: RawFrame, options: ChromaKeyOptions): AlphaMask {
  const tolerance = options.tolerance ?? DEFAULT_TOLERANCE
  const softness = options.softness ?? DEFAULT_SOFTNESS
  const lumaWeight = options.lumaWeight ?? DEFAULT_LUMA_WEIGHT
  const colorSpace = options.colorSpace ?? 'ycbcr'
  const reference = options.reference ?? null

  if (reference) {
    assertSameDimensions(frame, reference.frame, 'reference frame')
  }

  const refYcbcr: YcbcrColor | null =
    colorSpace === 'ycbcr' ? rgbToYcbcr(options.referenceColor) : null
  const refHsv: HsvColor | null = colorSpace === 'hsv' ? rgbToHsv(options.referenceColor) : null

  const edge0 = tolerance * (1 - softness)
  const pixelCount = frame.width * frame.height
  const alpha = new Uint8Array(pixelCount)

  for (let i = 0; i < pixelCount; i++) {
    const o = i * 4
    const r = frame.data[o]
    const g = frame.data[o + 1]
    const b = frame.data[o + 2]

    const d =
      refYcbcr !== null
        ? ycbcrDistancePrecomputed(r, g, b, refYcbcr, lumaWeight)
        : hsvDistancePrecomputed(r, g, b, refHsv as HsvColor)
    const chromaAlpha = ramp01(d, edge0, tolerance) * 255

    if (!reference) {
      alpha[i] = quantizeAlpha(chromaAlpha)
      continue
    }

    // 参考帧减除：帧差大 → 前景证据；帧差小 → 背景证据
    const refTolerance = reference.tolerance
    const refSoftness = reference.softness ?? DEFAULT_REFERENCE_SOFTNESS
    const influence = reference.influence ?? DEFAULT_REFERENCE_INFLUENCE
    const dRef = rgbDistance({ r, g, b }, getPixel(reference.frame, i))
    const refAlpha = ramp01(dRef, refTolerance * (1 - refSoftness), refTolerance) * 255

    const u = chromaAlpha / 255
    const w = 4 * u * (1 - u) * influence
    alpha[i] = quantizeAlpha(chromaAlpha * (1 - w) + refAlpha * w)
  }

  return { width: frame.width, height: frame.height, alpha }
}

/** 完整色键管线选项：色键 + 边缘处理（edge=null 跳过边缘处理） */
export type KeyingPipelineOptions = ChromaKeyOptions & {
  readonly edge?: EdgeProcessingOptions | null
}

/**
 * 完整色键处理入口：视频帧 + 参考色 → 抠像后的帧。
 *
 * 流程（§5.1）：色键蒙版 → 溢色抑制（去除边缘背景色污染）
 * → alpha 轻微收缩（erosion）→ 羽化（box blur）→ 应用最终 alpha。
 *
 * @param frame 输入帧（不被修改）
 * @param options 色键与边缘处理选项
 * @returns 抠像帧（新分配）与最终蒙版
 */
export function applyChromaKey(frame: RawFrame, options: KeyingPipelineOptions): KeyedFrame {
  const mask = generateAlphaMask(frame, options)

  let out: RawFrame
  let alpha: Uint8Array
  if (options.edge === null) {
    // edge=null：跳过边缘处理，仅应用色键蒙版
    out = cloneFrame(frame)
    alpha = mask.alpha
  } else {
    const edge = options.edge ?? {}
    // 1. 溢色抑制（作用于 RGB）
    out = suppressSpill(frame, mask.alpha, options.referenceColor, edge)
    // 2. 收缩 + 羽化（作用于 alpha）
    const shrunk = shrinkAlpha(mask.alpha, frame.width, frame.height, edge)
    alpha = featherAlpha(shrunk, frame.width, frame.height, edge)
  }

  // 3. 应用最终 alpha
  for (let i = 0; i < alpha.length; i++) {
    out.data[i * 4 + 3] = alpha[i]
  }

  return { width: frame.width, height: frame.height, frame: out, alpha }
}
