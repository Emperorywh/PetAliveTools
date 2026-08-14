/**
 * 原样片段播放器的唯一播放决策。
 *
 * 这里不解析媒体时长、循环点或播放速率，只处理浏览器重复播放同一文件时
 * 是否需要从文件开头重新开始。
 */
export type ReplayAction =
  /** 切到新片段：加载并播放 */
  | 'load'
  /** 同片段重选且已播毕/暂停：回到循环入点（或 0）重播 */
  | 'restart'
  /** 同片段且仍在播放（或循环中）：无需动作 */
  | 'none'

/**
 * 决定是否直接装载文件，或在自然播毕后从文件开头重播。
 * 循环仅使用原生 video.loop 对完整文件循环，不维护自定义循环区间。
 */
export function decideReplayAction(
  sameSrc: boolean,
  loop: boolean,
  paused: boolean,
  ended: boolean,
): ReplayAction {
  if (!sameSrc) return 'load'
  if (loop) return 'none'
  if (paused || ended) return 'restart'
  return 'none'
}
