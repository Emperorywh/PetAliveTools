/**
 * 共享资产类型入口。
 *
 * 视频片段由 clips/ 直接扫描；这里只保留运行时类型和非视频配置验证。
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
  validateAudioMeta,
  validateAudioMetaArray,
} from '../schemas'
