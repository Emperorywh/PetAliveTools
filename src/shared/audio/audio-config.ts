/**
 * 音频系统配置 (§11)
 *
 * 全局音量、静音开关与环境声频率。
 * §11.2: 默认音量偏低、全局静音开关。
 * §11.1: 频率/音量可调。
 *
 * 跨进程共享类型。
 */

/** 音频系统运行时配置 */
export interface AudioConfig {
  /** 全局音量 (0.0–1.0)，默认偏低 (§11.2) */
  readonly volume: number
  /** 全局静音 (§11.2) */
  readonly muted: boolean
  /** 环境声频率倍率 (§11.1 频率可调)：> 1 更频繁 */
  readonly ambientFrequency: number
}

/** 默认音量偏低 (§11.2) */
export const DEFAULT_AUDIO_VOLUME = 0.25

/** 默认音频配置 */
export const DEFAULT_AUDIO_CONFIG: AudioConfig = {
  volume: DEFAULT_AUDIO_VOLUME,
  muted: false,
  ambientFrequency: 1.0,
}

/**
 * 钳制音量到 [0, 1]。
 */
export function clampVolume(volume: number): number {
  if (volume < 0) return 0
  if (volume > 1) return 1
  return volume
}

/**
 * 钳制频率倍率到正数。
 */
export function clampFrequency(freq: number): number {
  if (freq < 0.1) return 0.1
  return freq
}

/**
 * 更新音频配置（不可变更新）。
 */
export function updateAudioConfig(
  base: AudioConfig,
  changes: Partial<AudioConfig>,
): AudioConfig {
  return {
    volume: changes.volume !== undefined ? clampVolume(changes.volume) : base.volume,
    muted: changes.muted ?? base.muted,
    ambientFrequency:
      changes.ambientFrequency !== undefined
        ? clampFrequency(changes.ambientFrequency)
        : base.ambientFrequency,
  }
}
