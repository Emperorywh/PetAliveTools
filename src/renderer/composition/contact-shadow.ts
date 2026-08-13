/**
 * 接触阴影 (§6.5)
 *
 * 纯渲染层在宠物足部下方投影极淡的椭圆软阴影，
 * 随 scale 联动、随行走位移跟随，增强"贴地感"。
 * 不依赖素材、可在设置中关闭（§6.5）。
 *
 * 纯函数模块，不依赖 DOM。
 */

/** 接触阴影配置 */
export interface ContactShadowConfig {
  /** 是否可见（可在设置中关闭，§6.5） */
  visible: boolean
  /** 最大不透明度（0..1），默认极淡到几乎不可察觉 */
  opacity: number
  /** 阴影宽度占精灵固有宽度的比例 */
  widthRatio: number
  /** 阴影高度占精灵固有宽度的比例（椭圆扁度） */
  heightRatio: number
}

/** 默认接触阴影配置：极淡，消除漂浮感（§6.5） */
export const DEFAULT_SHADOW_CONFIG: ContactShadowConfig = {
  visible: true,
  opacity: 0.12,
  widthRatio: 0.65,
  heightRatio: 0.1,
}

/** 计算后的阴影样式值（像素，可直接用于 DOM） */
export interface ContactShadowStyle {
  /** 阴影宽度（像素） */
  readonly width: number
  /** 阴影高度（像素） */
  readonly height: number
  /** 不透明度（0..1），visible=false 时为 0 */
  readonly opacity: number
}

/**
 * 根据精灵固有宽度和配置计算接触阴影样式。
 *
 * 阴影为椭圆，宽而扁（widthRatio >> heightRatio），
 * 定位于精灵锚点（足部）正下方。
 *
 * @param spriteWidth 精灵固有宽度（像素）
 * @param config 阴影配置，默认 DEFAULT_SHADOW_CONFIG
 * @returns 阴影样式（宽/高/不透明度）
 */
export function computeShadowStyle(
  spriteWidth: number,
  config: ContactShadowConfig = DEFAULT_SHADOW_CONFIG,
): ContactShadowStyle {
  return {
    width: spriteWidth * config.widthRatio,
    height: spriteWidth * config.heightRatio,
    opacity: config.visible ? config.opacity : 0,
  }
}
