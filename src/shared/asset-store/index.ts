/**
 * 资产库模块 (asset-store)
 *
 * 负责：片段元数据管理 (clips.meta.json)、音频素材管理、清单进度跟踪、缺素材占位兜底。
 * 参见 SPEC §5.4 (打标 schema) 与 §12.1 (项目格式)。
 *
 * 跨进程共享模块。
 */

// 类型定义
export type {
  Persona,
  Personality,
  NeedsState,
  BehaviorConfig,
  RhythmConfig,
  MicroRandomConfig,
  ClipMeta,
  ClipCategory,
  ClipDirection,
  ClipAnchor,
  Hitbox,
  AudioMeta,
  AudioCategory,
  ProjectData,
} from '../types/project'

// Schema 验证
export {
  validatePersona,
  validateNeedsState,
  validateBehaviorConfig,
  validateClipMeta,
  validateClipMetaArray,
  validateAudioMeta,
  validateAudioMetaArray,
} from '../schemas'
