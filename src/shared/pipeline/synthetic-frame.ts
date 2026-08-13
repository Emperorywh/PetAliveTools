/**
 * 合成抠像测试帧 (§5.1 / §5.5)
 *
 * 程序化生成"纯色背景 + 软边毛发团 + 传感器噪声"的测试场景，
 * 并附带同噪声的空背景参考帧（模拟 §5.1 先拍 1–2 秒空背景）。
 * 单元测试与导入预览的合成演示共用，无需真实素材即可验证色键。
 *
 * 噪声用按像素索引的确定性哈希生成，保证同一场景的帧与参考帧
 * 背景噪声逐像素一致（否则减除辅助会被噪声淹没）。
 */

import { type RgbColor, type RawFrame, createFrame } from './frame'
import { ramp01 } from './color-space'

/** 常用背景色（§4.1 推荐中灰/中蓝布幕） */
export const GRAY_BACKGROUND: RgbColor = { r: 128, g: 128, b: 128 }
export const BLUE_BACKGROUND: RgbColor = { r: 70, g: 120, b: 200 }

/** 常见宠物毛色 */
export const FUR_ORANGE: RgbColor = { r: 230, g: 150, b: 80 }
export const FUR_WHITE: RgbColor = { r: 245, g: 243, b: 240 }
export const FUR_BLACK: RgbColor = { r: 35, g: 33, b: 30 }
export const FUR_BROWN: RgbColor = { r: 140, g: 95, b: 60 }

/** 毛发团场景配置 */
export interface FurBlobSceneOptions {
  readonly width?: number
  readonly height?: number
  /** 背景色 */
  readonly background: RgbColor
  /** 毛色 */
  readonly furColor: RgbColor
  /** 团块中心（像素坐标，默认画面中心偏下） */
  readonly centerX?: number
  readonly centerY?: number
  /** 椭圆半径（像素，默认画面短边的 30%） */
  readonly radiusX?: number
  readonly radiusY?: number
  /** 软边宽度（像素，默认 3）：边缘毛发与背景的混合过渡带 */
  readonly edgeSoftnessPx?: number
  /** 背景传感器噪声幅度（0–255，默认 3） */
  readonly noiseLevel?: number
  /** 毛发纹理抖动幅度（0–255，默认 12） */
  readonly furJitter?: number
  /** 噪声种子（同种子 → 帧与参考帧噪声一致） */
  readonly seed?: number
}

/** 合成场景：宠物帧 + 同背景的空参考帧 */
export interface SyntheticKeyingScene {
  readonly frame: RawFrame
  readonly reference: RawFrame
}

/** 确定性像素噪声：同一 (seed, index) 恒返回同一 [0,1) 值 */
function hashNoise(seed: number, index: number): number {
  let t = (seed + index * 0x9e3779b9) >>> 0
  t = Math.imul(t ^ (t >>> 15), t | 1)
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

/** 确定性毛色抖动：同一 (seed, index) 恒返回同一 [-1,1) 值 */
function hashJitter(seed: number, index: number): number {
  return hashNoise(seed ^ 0x5f356495, index) * 2 - 1
}

/**
 * 创建"纯色背景 + 软边毛发团"合成场景。
 *
 * 团块边缘在 edgeSoftnessPx 内从背景线性混到毛色（模拟半透明绒毛
 * 与背景色溢出），毛色带逐像素抖动（模拟毛发纹理），背景带传感器噪声。
 * reference 为不含团块的同一背景（噪声逐像素一致）。
 */
export function createFurBlobScene(options: FurBlobSceneOptions): SyntheticKeyingScene {
  const width = options.width ?? 160
  const height = options.height ?? 120
  const background = options.background
  const furColor = options.furColor
  const centerX = options.centerX ?? Math.floor(width / 2)
  const centerY = options.centerY ?? Math.floor(height * 0.55)
  const radiusX = options.radiusX ?? Math.floor(Math.min(width, height) * 0.3)
  const radiusY = options.radiusY ?? Math.floor(Math.min(width, height) * 0.3)
  const edgeSoftnessPx = options.edgeSoftnessPx ?? 3
  const noiseLevel = options.noiseLevel ?? 3
  const furJitter = options.furJitter ?? 12
  const seed = options.seed ?? 1

  const frame = createFrame(width, height)
  const reference = createFrame(width, height)
  const minRadius = Math.min(radiusX, radiusY)

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x

      // 背景噪声（帧与参考帧共享同一哈希序列）
      const noise = hashNoise(seed, i)
      const nb = background.r + (noise - 0.5) * 2 * noiseLevel
      const ng = background.g + (noise - 0.5) * 2 * noiseLevel
      const nr = background.b + (noise - 0.5) * 2 * noiseLevel

      const o = i * 4
      reference.data[o] = nb
      reference.data[o + 1] = ng
      reference.data[o + 2] = nr
      reference.data[o + 3] = 255

      // 椭圆归一化坐标 e：1 = 边界，<1 前景，>1 背景
      const ex = (x - centerX) / radiusX
      const ey = (y - centerY) / radiusY
      const e = Math.sqrt(ex * ex + ey * ey)
      // 归一化距离换算为像素级带符号边界距离（近似）
      const boundaryDistPx = (1 - e) * minRadius
      const coverage = ramp01(boundaryDistPx, 0, edgeSoftnessPx)

      if (coverage <= 0) {
        frame.data[o] = nb
        frame.data[o + 1] = ng
        frame.data[o + 2] = nr
      } else {
        const j = hashJitter(seed, i)
        const fr = furColor.r + j * furJitter
        const fg = furColor.g + j * furJitter * 0.8
        const fb = furColor.b + j * furJitter * 0.6
        frame.data[o] = nb * (1 - coverage) + fr * coverage
        frame.data[o + 1] = ng * (1 - coverage) + fg * coverage
        frame.data[o + 2] = nr * (1 - coverage) + fb * coverage
      }
      frame.data[o + 3] = 255
    }
  }

  return { frame, reference }
}

/** 创建纯色帧（可选确定性噪声） */
export function createSolidFrame(
  width: number,
  height: number,
  color: RgbColor,
  noiseLevel: number = 0,
  seed: number = 1
): RawFrame {
  const frame = createFrame(width, height)
  for (let i = 0; i < width * height; i++) {
    const o = i * 4
    const noise = noiseLevel > 0 ? (hashNoise(seed, i) - 0.5) * 2 * noiseLevel : 0
    frame.data[o] = color.r + noise
    frame.data[o + 1] = color.g + noise
    frame.data[o + 2] = color.b + noise
    frame.data[o + 3] = 255
  }
  return frame
}
