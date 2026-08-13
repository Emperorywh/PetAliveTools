/**
 * CSS 变换管线 (§6.2)
 *
 * 构建 CSS transform 字符串：
 *   translate(x, y) scale(s) scaleX(±1)
 *
 * 控制屏幕位置 / 尺度 / 方向（镜像仅对对称宠物，§4.3）。
 * 全局呼吸缩放（§6.3）通过 breathing 因子叠加到 scale 上。
 *
 * 纯函数模块。
 */

/** CSS 变换参数 */
export interface TransformParams {
  /** X 方向平移（像素） */
  translateX: number
  /** Y 方向平移（像素） */
  translateY: number
  /** 显示尺度系数（scaleHint，§7.4） */
  scale: number
  /** 是否水平镜像 scaleX(-1)（仅对称宠物，§4.3） */
  flip: boolean
  /** 呼吸缩放因子（由 breathingScale 计算，§6.3） */
  breathing: number
}

/**
 * 构建 CSS transform 字符串。
 *
 * 组合顺序（§6.2）：translate → scale（含呼吸因子） → scaleX（方向）
 *
 * transform-origin 应设为锚点位置，使锚点在缩放/镜像下保持固定。
 *
 * @returns 形如 "translate(40px, 140px) scale(1.006) scaleX(1)" 的字符串
 */
export function buildTransform(params: TransformParams): string {
  const totalScale = params.scale * params.breathing
  const scaleX = params.flip ? -1 : 1
  return `translate(${params.translateX}px, ${params.translateY}px) scale(${totalScale}) scaleX(${scaleX})`
}
