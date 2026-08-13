/**
 * 全局呼吸缩放近似 (§6.3)
 *
 * 对整个精灵施加极小幅（±0.6%）、低频（~0.25Hz）的 scale 振荡，
 * 近似呼吸节奏。纯函数，不依赖 DOM。
 *
 * 局限：只是整体缩放，宠物画面本身不会真实胸腹起伏；
 * 仅供近距离"不循环感"，不可夸大（§6.3）。
 */

/** 呼吸振幅：±0.6%（§6.3） */
export const BREATHING_AMPLITUDE = 0.006

/** 呼吸频率：~0.25Hz（§6.3） */
export const BREATHING_FREQUENCY_HZ = 0.25

/** 呼吸周期（毫秒）= 1 / 0.25Hz = 4000ms */
export const BREATHING_PERIOD_MS = 1000 / BREATHING_FREQUENCY_HZ

/**
 * 计算呼吸缩放因子。
 *
 * 返回值在 [1 - 0.006, 1 + 0.006] 范围内正弦振荡，
 * 周期约 4 秒（0.25Hz）。
 *
 * @param elapsedMs 自呼吸开始以来的毫秒数
 * @returns 缩放因子
 */
export function breathingScale(elapsedMs: number): number {
  const phase = (2 * Math.PI * BREATHING_FREQUENCY_HZ * elapsedMs) / 1000
  return 1 + BREATHING_AMPLITUDE * Math.sin(phase)
}
