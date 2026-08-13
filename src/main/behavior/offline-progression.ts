/**
 * 离线推进 (§9.4 离线处理)
 *
 * 应用重启时，根据上次保存的 needs-state 时间戳与当前时间差，
 * 按真实时间推进需求。但 §9.4 明确要求"离线不惩罚到极端"，
 * 避免重启后宠物处于"濒死"的惩罚性状态。
 *
 * 策略：
 *   1. 按真实经过时间正常推进（advanceNeeds）
 *   2. 推进后钳制到非惩罚性边界：
 *      - hunger 上限 85（不到 100 饿死）
 *      - fatigue 上限 85
 *      - happiness 下限 15（不会到 0 崩溃）
 *      - attention 下限 10
 *   3. 确保所有维度仍处于 [0, 100]
 *
 * 纯逻辑，无平台依赖。
 */

import type { NeedsState } from '../../shared/types/needs-state'
import { advanceNeeds, type NeedRates } from './needs'

/**
 * 离线推进的非惩罚性边界。
 *
 * 离线后需求不会达到极端值（§9.4）。
 */
export const OFFLINE_BOUNDS = {
  /** 饥饿上限（离线不超过 85，不到惩罚性 100） */
  hungerMax: 85,
  /** 疲劳上限（离线不超过 85） */
  fatigueMax: 85,
  /** 愉悦下限（离线不低于 15） */
  happinessMin: 15,
  /** 注意力下限（离线不低于 10） */
  attentionMin: 10,
} as const

/**
 * 对离线推进后的状态施加非惩罚性边界 (§9.4)。
 */
export function applyOfflineBounds(state: NeedsState): NeedsState {
  const s = state
  return {
    hunger: Math.min(s.hunger, OFFLINE_BOUNDS.hungerMax),
    fatigue: Math.min(s.fatigue, OFFLINE_BOUNDS.fatigueMax),
    happiness: Math.max(s.happiness, OFFLINE_BOUNDS.happinessMin),
    attention: Math.max(s.attention, OFFLINE_BOUNDS.attentionMin),
  }
}

/**
 * 离线需求推进 (§9.4 离线处理)。
 *
 * 按真实经过时间推进，然后施加非惩罚性边界。
 * 避免宠物重启后处于惩罚性状态（饥饿/疲劳到 100、愉悦/注意力到 0）。
 *
 * @param state 上次保存的需求状态
 * @param offlineSec 离线时长（秒）
 * @param rates 变化速率（已含性格调制）
 * @returns 推进并施加边界后的需求状态
 */
export function advanceOffline(
  state: NeedsState,
  offlineSec: number,
  rates: NeedRates,
): NeedsState {
  if (offlineSec <= 0) return state
  const advanced = advanceNeeds(state, offlineSec, rates)
  return applyOfflineBounds(advanced)
}

/**
 * 从两个时间戳计算离线时长（秒）。
 *
 * @param lastSavedMs 上次保存的时钟时间（ms）
 * @param nowMs 当前时钟时间（ms）
 * @returns 离线秒数（非负）
 */
export function computeOfflineSec(lastSavedMs: number, nowMs: number): number {
  const diff = nowMs - lastSavedMs
  return diff > 0 ? diff / 1000 : 0
}
