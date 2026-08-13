/**
 * 色键颜色空间与距离度量 (§5.1)
 *
 * HSV / YCbCr 两种色键颜色空间的转换，以及像素对背景参考色的
 * "色度距离"（0=与背景同色，1=相距最远）。距离是容差阈值的作用对象：
 * d ≤ tolerance → 背景，d ≥ tolerance → 前景，中间为软过渡带。
 *
 * 纯函数，无平台依赖。
 */

import type { RgbColor } from './frame'

/** YCbCr 颜色（JPEG 全量程：y 0–255，cb/cr 以 128 为中心） */
export interface YcbcrColor {
  readonly y: number
  readonly cb: number
  readonly cr: number
}

/** HSV 颜色（h ∈ [0,360)，s/v ∈ [0,1]） */
export interface HsvColor {
  readonly h: number
  readonly s: number
  readonly v: number
}

/** 饱和度低于该值视为消色差（灰/白/黑），色相失去区分意义 */
export const HSV_ACHROMATIC_THRESHOLD = 0.06

/** YCbCr 色度平面（cb-cr）的最大可能距离，用于归一化到 [0,1] */
const YCBCR_CHROMA_MAX_DISTANCE = 127.5 * Math.SQRT2

/** RGB 立方体空间的最大欧氏距离，用于帧差归一化到 [0,1] */
const RGB_MAX_DISTANCE = 255 * Math.sqrt(3)

export function rgbToYcbcr(c: RgbColor): YcbcrColor {
  return {
    y: 0.299 * c.r + 0.587 * c.g + 0.114 * c.b,
    cb: 128 - 0.168736 * c.r - 0.331264 * c.g + 0.5 * c.b,
    cr: 128 + 0.5 * c.r - 0.418688 * c.g - 0.081312 * c.b
  }
}

export function rgbToHsv(c: RgbColor): HsvColor {
  const r = c.r / 255
  const g = c.g / 255
  const b = c.b / 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const d = max - min
  let h: number
  if (d === 0) {
    h = 0
  } else if (max === r) {
    h = 60 * (((g - b) / d) % 6)
  } else if (max === g) {
    h = 60 * ((b - r) / d + 2)
  } else {
    h = 60 * ((r - g) / d + 4)
  }
  if (h < 0) h += 360
  return { h, s: max === 0 ? 0 : d / max, v: max }
}

/** Rec.601 亮度 */
export function rgbLuma(c: RgbColor): number {
  return 0.299 * c.r + 0.587 * c.g + 0.114 * c.b
}

/** 色相角距离（0–180 度，环形最短弧） */
export function hueDistance(a: number, b: number): number {
  const d = Math.abs(a - b) % 360
  return d > 180 ? 360 - d : d
}

/**
 * YCbCr 色键距离（0..1）。
 *
 * 默认纯色度距离（cb-cr 平面欧氏距离）；lumaWeight > 0 时按
 * sqrt(chroma² + w · (Δy/255)²) 混入亮度差——灰色/白色等消色差背景
 * 的色度接近中性（cb≈cr≈128），纯色度无法区分黑/白毛色，需亮度参与
 * （灰背景实际退化为亮度键，§4.1 推荐灰/蓝背景，§16 风险 1）。
 */
export function ycbcrDistance(
  pixel: RgbColor,
  ref: RgbColor,
  lumaWeight: number = 0
): number {
  return ycbcrDistancePrecomputed(pixel.r, pixel.g, pixel.b, rgbToYcbcr(ref), lumaWeight)
}

/** ycbcrDistance 的逐像素快路径：参考色 YCbCr 预计算，避免逐像素重复转换 */
export function ycbcrDistancePrecomputed(
  r: number,
  g: number,
  b: number,
  ref: YcbcrColor,
  lumaWeight: number
): number {
  const cb = 128 - 0.168736 * r - 0.331264 * g + 0.5 * b
  const cr = 128 + 0.5 * r - 0.418688 * g - 0.081312 * b
  const chroma = Math.hypot(cb - ref.cb, cr - ref.cr) / YCBCR_CHROMA_MAX_DISTANCE
  if (lumaWeight <= 0) {
    return Math.min(1, chroma)
  }
  const y = 0.299 * r + 0.587 * g + 0.114 * b
  const luma = Math.abs(y - ref.y) / 255
  return Math.min(1, Math.sqrt(chroma * chroma + lumaWeight * luma * luma))
}

/**
 * HSV 色键距离（0..1）。
 *
 * - 彩色背景（蓝幕等）：色相角距离 / 180；消色差像素（白/黑/灰毛）
 *   不携带背景色相 → 距离 1（判为前景）。
 * - 消色差背景（灰幕）：色相无意义，退化为明度距离。
 */
export function hsvDistance(pixel: RgbColor, ref: RgbColor): number {
  return hsvDistancePrecomputed(pixel.r, pixel.g, pixel.b, rgbToHsv(ref))
}

/** hsvDistance 的逐像素快路径：参考色 HSV 预计算 */
export function hsvDistancePrecomputed(
  r: number,
  g: number,
  b: number,
  ref: HsvColor
): number {
  if (ref.s < HSV_ACHROMATIC_THRESHOLD) {
    return Math.abs(Math.max(r, g, b) / 255 - ref.v)
  }
  const px = rgbToHsv({ r, g, b })
  if (px.s < HSV_ACHROMATIC_THRESHOLD) {
    return 1
  }
  return hueDistance(px.h, ref.h) / 180
}

/** 两 RGB 颜色的欧氏距离，归一化到 [0,1]（背景参考帧差分用） */
export function rgbDistance(a: RgbColor, b: RgbColor): number {
  const dr = a.r - b.r
  const dg = a.g - b.g
  const db = a.b - b.b
  return Math.min(1, Math.sqrt(dr * dr + dg * dg + db * db) / RGB_MAX_DISTANCE)
}

/**
 * 平滑阶梯（smoothstep）：x ≤ edge0 → 0，x ≥ edge1 → 1，中间平滑过渡。
 * edge1 ≤ edge0（softness=0）时退化为硬阈值。
 */
export function ramp01(x: number, edge0: number, edge1: number): number {
  if (edge1 <= edge0) {
    return x >= edge1 ? 1 : 0
  }
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)))
  return t * t * (3 - 2 * t)
}
