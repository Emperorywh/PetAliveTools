/**
 * 项目运行时聚合数据。
 *
 * clips 由项目目录实时扫描得到，不对应 clips.meta.json 持久化文件。
 */

import type { Persona } from './persona'
import type { NeedsState } from './needs-state'
import type { BehaviorConfig } from './behavior-config'
import type { ClipMeta } from './clip-meta'
import type { AudioMeta } from './audio-meta'

/** 项目全部结构化数据 (§12.1) */
export interface ProjectData {
  /** persona.json — 性格 5 维 + 名字 + 对称性 */
  readonly persona: Persona
  /** needs-state.json — 当前需求数值 */
  readonly needsState: NeedsState
  /** behavior-config.json — FSM 权重覆盖 / 节律设置 */
  readonly behaviorConfig: BehaviorConfig
  /** clips/ 扫描得到的直接播放片段 */
  readonly clips: readonly ClipMeta[]
  /** audio.meta.json — 音频素材元数据数组 */
  readonly audio: readonly AudioMeta[]
}

export type { Persona, Personality } from './persona'
export type { NeedsState } from './needs-state'
export type { BehaviorConfig, RhythmConfig, MicroRandomConfig, ShellSettings } from './behavior-config'
export type {
  ClipMeta,
  ClipCategory,
  ClipDirection,
  ClipAnchor,
  Hitbox,
} from './clip-meta'
export type { AudioMeta, AudioCategory } from './audio-meta'
