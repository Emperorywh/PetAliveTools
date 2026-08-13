/**
 * 渲染合成模块 (render)
 *
 * 负责：透明置顶窗口精灵渲染、WebM-alpha 视频播放、CSS transform 位置/尺度/方向控制、
 * 全局呼吸缩放近似、接触阴影（可选）。
 * 参见 SPEC §6 (渲染层)。
 *
 * 运行于渲染进程。
 */

export { breathingScale, BREATHING_AMPLITUDE, BREATHING_FREQUENCY_HZ } from '../composition/breathing'
export {
  type AnchorType,
  type NormalizedPoint,
  type SpriteDimensions,
  type BasePoint,
  type TranslateOffset,
  DEFAULT_ANCHOR_POINTS,
  getAnchorPoint,
  computeAnchorOffset,
} from '../composition/anchor-alignment'
export {
  type ContactShadowConfig,
  type ContactShadowStyle,
  DEFAULT_SHADOW_CONFIG,
  computeShadowStyle,
} from '../composition/contact-shadow'
export { type TransformParams, buildTransform } from '../composition/transform'
export { type SpritePlayerConfig, SpritePlayer } from '../sprite/video-player'
