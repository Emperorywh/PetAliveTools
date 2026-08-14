/**
 * 需求模型 (§9.4)
 *
 * 四维需求：hunger / fatigue / happiness / attention，范围 0–100。
 *
 * 实时推进：
 *   - hunger / fatigue 随真实时间缓慢上升
 *   - happiness 闲置缓慢回落，交互提升
 *   - attention 长时间无交互下降
 *
 * 上下限保护：所有维度始终钳制在 [0, 100]。
 * 离线推进（§9.4 离线处理）见 offline-progression.ts。
 *
 * 性格影响衰减速率由 §9.6 调制（传入 decayRates）。
 * 纯逻辑，无平台依赖。
 */

import type { NeedsState } from '../../shared/types/needs-state'

/** 需求维度键 */
export type NeedKey = 'hunger' | 'fatigue' | 'happiness' | 'attention'

/** 所有维度键 */
export const NEED_KEYS = ['hunger', 'fatigue', 'happiness', 'attention'] as const

/**
 * 每维度的自然变化速率（单位/秒）。
 *
 * 正值 = 该需求上升，负值 = 下降。
 * 这些是基础速率（中性性格），性格 §9.6 通过 decayRates 调制。
 */
export interface NeedRates {
  /** 饥饿上升速率 (单位/秒) */
  readonly hunger: number
  /** 疲劳上升速率 (单位/秒) */
  readonly fatigue: number
  /** 愉悦回落速率 (单位/秒，负值表示下降) */
  readonly happiness: number
  /** 注意力下降速率 (单位/秒，负值表示下降) */
  readonly attention: number
}

/** 默认基础变化速率（中性宠物） */
export const DEFAULT_NEED_RATES: NeedRates = {
  // 饥饿：约 5 小时从 0 到 100 → 100 / 18000s ≈ 0.00556/s
  hunger: 0.00556,
  // 疲劳：约 8 小时从 0 到 100
  fatigue: 0.00347,
  // 愉悦：约 4 小时从 100 回落到 0
  happiness: -0.00694,
  // 注意力：约 30 分钟从 100 降到 0
  attention: -0.0556,
}

/**
 * 需求推进器。
 *
 * 维护一个 NeedsState，每次调用 advance() 按经过的真实秒数推进。
 * 推进器是无状态的纯函数——advance 返回新的 NeedsState。
 * 实际使用中由外部持有 state 并推进。
 */

/**
 * 钳制到 [0, 100]。
 */
export function clampNeed(value: number): number {
  if (value < 0) return 0
  if (value > 100) return 100
  return value
}

/**
 * 钳制所有维度到 [0, 100]。
 */
export function clampNeeds(state: NeedsState): NeedsState {
  return {
    hunger: clampNeed(state.hunger),
    fatigue: clampNeed(state.fatigue),
    happiness: clampNeed(state.happiness),
    attention: clampNeed(state.attention),
  }
}

/**
 * 按经过的真实时间推进需求 (§9.4 实时推进)。
 *
 * @param state 当前需求状态
 * @param elapsedSec 经过的真实秒数
 * @param rates 变化速率（已含性格调制）
 * @returns 推进后的需求状态（已钳制）
 */
export function advanceNeeds(
  state: NeedsState,
  elapsedSec: number,
  rates: NeedRates = DEFAULT_NEED_RATES,
): NeedsState {
  return clampNeeds({
    hunger: state.hunger + rates.hunger * elapsedSec,
    fatigue: state.fatigue + rates.fatigue * elapsedSec,
    happiness: state.happiness + rates.happiness * elapsedSec,
    attention: state.attention + rates.attention * elapsedSec,
  })
}

/**
 * 交互对需求的影响 (§9.4 高位触发 / §10 交互)。
 *
 * 抚摸：happiness ↑、attention ↑、fatigue 小幅 ↓
 * 点击：attention ↑
 * 喂食：hunger ↓、happiness ↑
 * 玩耍：happiness ↑、attention ↑、fatigue ↑、hunger 小幅 ↑
 *
 * @param state 当前需求状态
 * @param delta 各维度的变化量（可为部分维度）
 * @returns 变更后的需求状态（已钳制）
 */
export function applyNeedDelta(
  state: NeedsState,
  delta: Partial<Record<NeedKey, number>>,
): NeedsState {
  return clampNeeds({
    hunger: state.hunger + (delta.hunger ?? 0),
    fatigue: state.fatigue + (delta.fatigue ?? 0),
    happiness: state.happiness + (delta.happiness ?? 0),
    attention: state.attention + (delta.attention ?? 0),
  })
}

/**
 * 交互类型 → 需求增量映射 (§10 交互表, IR-008)。
 *
 * 喂食/给玩具的需求反馈由托盘/菜单回调单独处理（含饥饿等复合变化），
 * 本表覆盖直接抢占路径的三种交互：
 *   - petted  抚摸 → 愉悦↑ (§10 "愉悦↑")
 *   - clicked 点击 → 注意力↑ (§10 "注意力↑")
 *   - dragged 拖拽 → 愉悦小幅↓（被打搅）
 */
export const INTERACTION_NEED_DELTAS: Readonly<
  Record<string, Partial<Record<NeedKey, number>>>
> = {
  petted: { happiness: 8 },
  clicked: { attention: 10 },
  dragged: { happiness: -3 },
}

/**
 * 判断需求是否达到高位触发阈值 (§9.4 高位触发)。
 *
 * hunger 高 → 讨食 (beg_food)
 * fatigue 高 → 睡眠 (sleep)
 * happiness 低 → 无聊 (bored)
 * attention 低 → 求玩 (want_play)
 */
export function getHighNeeds(
  state: NeedsState,
  threshold = 70,
  lowThreshold = 30,
): {
  readonly hungry: boolean
  readonly tired: boolean
  readonly bored: boolean
  readonly wantsAttention: boolean
} {
  return {
    hungry: state.hunger >= threshold,
    tired: state.fatigue >= threshold,
    bored: state.happiness <= lowThreshold,
    wantsAttention: state.attention <= lowThreshold,
  }
}

/**
 * 需求对 FSM 转移权重的调制 (§9.3 需求驱动)。
 *
 * 饥饿高 → beg_food 权重 ↑
 * 疲劳高 → sleep 权重 ↑
 * 愉悦低 → bored 权重 ↑（如果该状态存在）
 * 注意力低 → want_play 权重 ↑
 *
 * 返回与 §9.3 倍率调制兼容的 weightOverrides 片段。
 *
 * @param state 当前需求状态
 * @returns 调制倍率表 (sourceState → targetState → multiplier)
 */
export function needWeightModifiers(
  state: NeedsState,
): Record<string, Record<string, number>> {
  const mods: Record<string, Record<string, number>> = {}

  // 饥饿越高 → idle_sit → beg_food 权重越高（如果有该状态）
  if (state.hunger > 50) {
    const factor = 1 + ((state.hunger - 50) / 50) * 3 // 50→1.0, 100→4.0
    mods['idle_sit'] = { ...(mods['idle_sit'] ?? {}), beg_food: factor }
  }

  // 疲劳越高 → idle_sit → sleep 权重越高
  if (state.fatigue > 50) {
    const factor = 1 + ((state.fatigue - 50) / 50) * 3
    mods['idle_sit'] = { ...(mods['idle_sit'] ?? {}), sleep: factor }
    mods['lie'] = { ...(mods['lie'] ?? {}), sleep: factor }
  }

  // 愉悦越低 → idle_sit → bored 权重越高（如果有该状态）
  if (state.happiness < 40) {
    const factor = 1 + ((40 - state.happiness) / 40) * 3
    mods['idle_sit'] = { ...(mods['idle_sit'] ?? {}), bored: factor }
  }

  // 注意力越低 → idle_sit → want_play 权重越高
  if (state.attention < 40) {
    const factor = 1 + ((40 - state.attention) / 40) * 3
    mods['idle_sit'] = { ...(mods['idle_sit'] ?? {}), want_play: factor }
  }

  return mods
}
