/**
 * 锚点对齐 (§6.2)
 *
 * 所有片段按锚定姿态的关键点对齐到窗口内的统一基准坐标，
 * 保证锚定中转时无位置跳动。
 *
 * - sit（端坐）：臀部着地点（§6.2）
 * - stand（站立）：足部中心（§6.2）
 *
 * 纯函数模块，不依赖 DOM。
 */

/** 锚定类型（§4.2 双锚定集合） */
export type AnchorType = 'sit' | 'stand'

/** 归一化坐标点 [0, 1]，相对于片段左上角 */
export interface NormalizedPoint {
  readonly x: number
  readonly y: number
}

/** 默认锚点：关键点在片段归一化坐标中的位置 */
export const DEFAULT_ANCHOR_POINTS: Readonly<Record<AnchorType, NormalizedPoint>> = {
  /** 端坐：臀部着地点，略偏下方中央（§6.2） */
  sit: { x: 0.5, y: 0.9 },
  /** 站立：足部中心，底部中央（§6.2） */
  stand: { x: 0.5, y: 1.0 },
}

/** 精灵固有尺寸（像素，CSS 尺寸） */
export interface SpriteDimensions {
  readonly width: number
  readonly height: number
}

/** 基准坐标（像素），窗口内所有片段锚点对齐的目标点 */
export interface BasePoint {
  readonly x: number
  readonly y: number
}

/** translate 偏移量（像素） */
export interface TranslateOffset {
  readonly x: number
  readonly y: number
}

/**
 * 获取指定锚定类型的默认锚点坐标。
 */
export function getAnchorPoint(type: AnchorType): NormalizedPoint {
  return DEFAULT_ANCHOR_POINTS[type]
}

/**
 * 计算锚点对齐的 translate 偏移量。
 *
 * 配合 CSS transform-origin 设为锚点百分比位置使用：
 * 当 transform-origin = anchorPoint 时，scale 和 scaleX 围绕锚点变换，
 * 锚点在缩放/镜像下保持固定，因此偏移量与 scale 无关。
 *
 * offset = basePoint - anchorPoint × intrinsicSize
 *
 * @param anchorPoint 锚点在归一化坐标 [0,1] 中的位置
 * @param intrinsicSize 片段固有尺寸（像素）
 * @param basePoint 窗口内基准坐标（像素）
 * @returns translate 偏移量（像素）
 */
export function computeAnchorOffset(
  anchorPoint: NormalizedPoint,
  intrinsicSize: SpriteDimensions,
  basePoint: BasePoint,
): TranslateOffset {
  return {
    x: basePoint.x - anchorPoint.x * intrinsicSize.width,
    y: basePoint.y - anchorPoint.y * intrinsicSize.height,
  }
}
