/**
 * 动作触发声 (§11.1 动作触发声)
 *
 * 将交互状态 / FSM 状态映射到音频组前缀。
 * 处理 embeddedAudio 例外 (§4.8, §11.1)：
 *   embeddedAudio=true 的片段播放内嵌音轨，不另叠加采样。
 *
 * 纯逻辑，无平台依赖。
 */

import type { ClipMeta } from '../types/clip-meta'

/**
 * 交互/状态 → 音频组前缀映射 (§11.1, §10)。
 *
 * 抚摸 → purr（呼噜/享受声）
 * 点击 → chirp（呼应声）
 * 拖拽 → —（无独立声效）
 * 讨食 → meow（叫声）
 * 求玩 → play（求玩声）
 * 进食 → eating（进食声）
 * 喝水 → drinking（喝水声）
 * 玩耍 → play（玩耍声）
 * 烦躁 → hiss（不满声）
 * 开心 → happy（愉悦声）
 */
export const ACTION_AUDIO_MAP: Readonly<Record<string, string>> = {
  petted: 'purr',
  clicked: 'chirp',
  called: 'call',
  dragged: 'struggle',
  beg_food: 'meow',
  want_play: 'whine',
  eat: 'eating',
  drink: 'drinking',
  play: 'play',
  bored: 'sigh',
  happy: 'happy',
  annoyed: 'hiss',
}

/**
 * 动作声解析结果。
 */
export interface ActionAudioResult {
  /** 是否使用内嵌音轨 (§11.1 embeddedAudio) */
  readonly isEmbedded: boolean
  /** 音频 id 或组前缀；isEmbedded 时为 null */
  readonly audioId: string | null
}

/**
 * 解析交互/状态动作对应的音频 (§11.1)。
 *
 * 规则：
 *   1. 若提供片段且 embeddedAudio=true → 播放内嵌音轨，不叠加采样 (§11.1)
 *   2. 若提供片段且 audio 非空 → 使用片段的 audio 引用 (§5.4)
 *   3. 否则 → 使用 ACTION_AUDIO_MAP 默认映射
 *
 * @param action 交互/状态键（如 'petted', 'eat', 'play'）
 * @param clip 关联片段（可为 null）
 */
export function resolveActionAudio(
  action: string,
  clip: ClipMeta | null,
): ActionAudioResult {
  // 规则 1：embeddedAudio 片段播放内嵌音轨 (§11.1)
  if (clip?.embeddedAudio === true) {
    return { isEmbedded: true, audioId: null }
  }

  // 规则 2：片段的 audio 字段引用 (§5.4)
  if (clip?.audio) {
    return { isEmbedded: false, audioId: clip.audio }
  }

  // 规则 3：默认映射
  const mapped = ACTION_AUDIO_MAP[action]
  if (mapped) {
    return { isEmbedded: false, audioId: mapped }
  }

  return { isEmbedded: false, audioId: null }
}
