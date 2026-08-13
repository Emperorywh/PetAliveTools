/**
 * 原始 RGBA 帧容器 (§5.1)
 *
 * 色键抠像、边缘处理、行走跟踪等管线阶段的统一帧格式：
 * 与 ImageData 同构的 RGBA 交错字节（每像素 4 字节），可零拷贝互转。
 *
 * 纯数据结构，无平台依赖（主进程转码与渲染进程预览共用）。
 */

/** RGB 颜色（0–255） */
export interface RgbColor {
  readonly r: number
  readonly g: number
  readonly b: number
}

/** 一帧 RGBA 图像：data.length === width * height * 4 */
export interface RawFrame {
  readonly width: number
  readonly height: number
  readonly data: Uint8ClampedArray
}

/** 创建全透明零值帧 */
export function createFrame(width: number, height: number): RawFrame {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new Error(`invalid frame dimensions: ${width}x${height}`)
  }
  return { width, height, data: new Uint8ClampedArray(width * height * 4) }
}

/** 深拷贝帧（含像素数据） */
export function cloneFrame(frame: RawFrame): RawFrame {
  return { width: frame.width, height: frame.height, data: new Uint8ClampedArray(frame.data) }
}

/** 校验两帧尺寸一致，不一致则抛错 */
export function assertSameDimensions(a: RawFrame, b: RawFrame, label: string): void {
  if (a.width !== b.width || a.height !== b.height) {
    throw new Error(
      `${label}: dimension mismatch ${a.width}x${a.height} vs ${b.width}x${b.height}`
    )
  }
}

/** 读取第 index 个像素（按像素序号，非字节序号）的 RGB */
export function getPixel(frame: RawFrame, index: number): RgbColor {
  const o = index * 4
  return { r: frame.data[o], g: frame.data[o + 1], b: frame.data[o + 2] }
}

/** 写入第 index 个像素的 RGB（alpha 不变） */
export function setPixel(frame: RawFrame, index: number, color: RgbColor): void {
  const o = index * 4
  frame.data[o] = color.r
  frame.data[o + 1] = color.g
  frame.data[o + 2] = color.b
}
