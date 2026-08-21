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
 * 睡眠中的疲劳恢复速率 (单位/秒)。
 *
 * 清醒时疲劳单调上升（基础约 0.0035/s，性格/夜间调制），睡眠是唯一
 * 恢复路径。恢复速率取累积速率的 ~14 倍（0.05/s ≈ 3 单位/分钟）：
 * 从 100 睡回 0 约需 33 分钟累计睡眠，跌出 50 以上的嗜睡增益区
 * 约需 10 分钟，保证观察尺度内可见"睡足回活跃"的循环，而不是
 * 疲劳钉死 100 后永久嗜睡。
 */
export const SLEEP_FATIGUE_RECOVERY_RATE = 0.05

/**
 * 睡眠态的需求速率：疲劳改为固定速率恢复（下降），其余维度按自然速率推进。
 *
 * 恢复不乘性格/夜间倍率——夜间疲劳累积 ×2 只作用于清醒时段，
 * 睡眠恢复保持恒定，避免"越夜越睡不着"的反直觉叠加。
 */
export function sleepingNeedRates(rates: NeedRates): NeedRates {
  return { ...rates, fatigue: -SLEEP_FATIGUE_RECOVERY_RATE }
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
 * 喂食：hunger ↓、happiness ↑
 * 玩耍：happiness ↑、attention ↑、fatigue ↑、hunger 小幅 ↑
 * （鼠标交互不切换片段，也不产生需求反馈）
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
 * 疲劳高 → 入睡路径权重 ↑：lie→sleep 直达边，以及 idle_sit→lie
 * （§9.2 中 idle_sit 没有直达 sleep 的边，必经 lie；倍率只能调制
 * 已有边、不能造边，"想睡"的增益因此落在躺卧这一步上）。
 *
 * 情绪类动作（beg_food / drink / bored / want_play / happy）不在 FSM
 * 边表内，由调度器经 emotionCandidateGroups 插入触发，不在此处调制权重。
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

  // 疲劳越高 → 越早躺卧入睡（lie→sleep 增益 + idle_sit→lie 引导）
  if (state.fatigue > 50) {
    const factor = 1 + ((state.fatigue - 50) / 50) * 3
    mods['idle_sit'] = { lie: factor }
    mods['lie'] = { sleep: factor }
  }

  return mods
}

// —— §9.4 情绪动作插入触发 —— //

/** 需求高位阈值：hunger ≥ 此值触发讨食/喝水 */
export const EMOTION_HIGH_THRESHOLD = 70
/** 需求低位阈值：happiness/attention ≤ 此值触发无聊/求玩 */
export const EMOTION_LOW_THRESHOLD = 30
/** 满足感高位阈值：happiness ≥ 此值触发开心 */
export const EMOTION_HAPPY_THRESHOLD = 85

/**
 * 按当前需求推导情绪动作候选组（按优先级排序，组内任选其一）。
 *
 * 情绪动作不在 FSM 边表内（倍率不能造边），由调度器在空闲调度点
 * 插入触发：饥饿高位 → 讨食/喝水；愉悦极高 → 开心；
 * 愉悦低位 → 无聊；注意力低位 → 求玩。疲劳高位走 FSM 的 sleep
 * 权重增益，不在此列。
 *
 * 纯逻辑，无平台依赖。
 */
export function emotionCandidateGroups(
  state: NeedsState,
  thresholds: {
    readonly high?: number
    readonly low?: number
    readonly happy?: number
  } = {},
): readonly (readonly string[])[] {
  const high = thresholds.high ?? EMOTION_HIGH_THRESHOLD
  const low = thresholds.low ?? EMOTION_LOW_THRESHOLD
  const happy = thresholds.happy ?? EMOTION_HAPPY_THRESHOLD
  const groups: (readonly string[])[] = []
  if (state.hunger >= high) groups.push(['beg_food', 'drink'])
  if (state.happiness >= happy) groups.push(['happy'])
  if (state.happiness <= low) groups.push(['bored'])
  if (state.attention <= low) groups.push(['want_play'])
  return groups
}
