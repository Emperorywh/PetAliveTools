/**
 * 配置文件 Schema 验证入口。
 *
 * 视频片段不再使用 JSON 元数据或轨迹 Schema，因此这里只验证应用配置和音频库。
 */

export { validatePersona, defaultPersonality } from './persona'
export { validateNeedsState, defaultNeedsState } from './needs-state'
export { validateBehaviorConfig, validateShellSettings, defaultBehaviorConfig, defaultShellSettings } from './behavior-config'
export { validateAudioMeta, validateAudioMetaArray } from './audio-meta'
export { check, isFiniteNumber, inRange, isNonEmptyString, isBoolean, isOneOf } from './validate'
export type { ValidationErrors } from './validate'
