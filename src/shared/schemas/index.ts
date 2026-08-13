/**
 * Schema 验证模块入口
 *
 * 导出所有类型验证函数与默认值工厂。
 * 参见 SPEC §5.4 (片段 schema)、§12.1 (项目格式)。
 */

export { validatePersona, defaultPersonality } from './persona'
export { validateNeedsState, defaultNeedsState } from './needs-state'
export { validateBehaviorConfig, defaultBehaviorConfig } from './behavior-config'
export { validateClipMeta, validateClipMetaArray } from './clip-meta'
export { validateAudioMeta, validateAudioMetaArray } from './audio-meta'
export { validateTrackFile, isTrackFile } from './track-file'
export { check, isFiniteNumber, inRange, isNonEmptyString, isBoolean, isOneOf } from './validate'
export type { ValidationErrors } from './validate'
