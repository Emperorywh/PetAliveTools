/**
 * 音频纯逻辑模块 (audio) — shared
 *
 * 负责：音频素材库管理 (§11.1)、冷却与速率限制 (§11.2)、多采样轮播 (§11.2)、
 * 环境声调度 (§11.1 节律随机)、动作触发声解析 (§11.1)。
 *
 * 纯逻辑，无平台依赖，可供测试直接调用。
 */

export {
  createCooldownState,
  canPlay,
  recordPlay,
  tryPlay,
  remainingCooldownSec,
} from './cooldown'
export type { CooldownState } from './cooldown'

export {
  extractGroupPrefix,
  buildAudioLibrary,
  getAudioById,
  getSampleGroup,
  getByCategory,
  createRotationState,
  pickNextSample,
  resolveClipAudio,
} from './audio-library'
export type { AudioLibrary, AudioSampleGroup, RotationState } from './audio-library'

export {
  DEFAULT_AMBIENT_CONFIG,
  computeNextAmbientIntervalSec,
  createAmbientScheduleState,
  shouldPlayAmbient,
  scheduleNextAmbient,
} from './ambient-scheduler'
export type { AmbientConfig, AmbientScheduleState } from './ambient-scheduler'

export {
  ACTION_AUDIO_MAP,
  resolveActionAudio,
} from './action-sounds'
export type { ActionAudioResult } from './action-sounds'

export {
  DEFAULT_AUDIO_VOLUME,
  DEFAULT_AUDIO_CONFIG,
  clampVolume,
  clampFrequency,
  updateAudioConfig,
} from './audio-config'
export type { AudioConfig } from './audio-config'
