/**
 * 性格 5 维参数化 (§9.6)
 *
 * 5 维气质 (0–1)：liveliness / laziness / clinginess / timidity / curiosity
 *
 * 映射为：
 *   1. 转移权重调制 (§9.6 转移权重调制)
 *   2. 需求衰减速率 (§9.6 需求衰减速率)
 *   3. 交互反应修饰 (§9.6 交互反应)
 *   4. signature 触发频率 (§9.6 signature 触发频率)
 *
 * 纯逻辑，无平台依赖。
 */

import type { Personality } from '../../shared/types/persona'
import { type NeedRates, DEFAULT_NEED_RATES } from './needs'

/**
 * 性格 → 转移权重倍率调制 (§9.6 转移权重调制)。
 *
 * 返回与 BehaviorConfig.weightOverrides 格式兼容的调制表。
 * 这些调制是相对于 TRANSITION_WEIGHTS 基础权重的倍率。
 *
 * 映射规则 (§9.6)：
 *   - liveliness ↑ → walk/stand 权重 ↑、idle 权重 ↓
 *   - laziness ↑ → sleep/lie 权重 ↑、walk/stand 权重 ↓
 *   - timidity ↑ → 被抚摸相关状态权重 ↓、回静止态权重 ↑
 *   - curiosity ↑ → groom 权重 ↑
 *
 * clinginess 的求互动对象（want_play / called / beg_food）不在 FSM
 * 边表内（倍率只能调制已有边），clinginess 改经交互修饰
 * （personalityInteractionModifiers）与情绪插入调度起作用。
 */
export function personalityWeightModifiers(
  personality: Personality,
): Record<string, Record<string, number>> {
  const mods: Record<string, Record<string, number>> = {}
  const { liveliness, laziness, timidity, curiosity } = personality

  // liveliness: ↑→walk/stand↑, idle↓
  // 范围 [0,1]，中值 0.5 对应 1.0 倍率
  // liveliness=1.0 → walk 权重 ×1.5, liveliness=0.0 → ×0.5
  const walkBoost = 0.5 + liveliness
  const idlePenalty = 1.5 - liveliness

  mergeMod(mods, 'stand', 'walk', walkBoost)
  mergeMod(mods, 'idle_sit', 'stand', walkBoost)
  mergeMod(mods, 'idle_sit', 'lie', idlePenalty)

  // laziness: ↑→sleep/lie↑, walk/stand↓
  const sleepBoost = 0.5 + laziness * 1.5 // laziness=1.0 → ×2.0
  const lazyWalkPenalty = 1.5 - laziness // laziness=1.0 → ×0.5

  mergeMod(mods, 'lie', 'sleep', sleepBoost)
  mergeMod(mods, 'idle_sit', 'lie', (mods['idle_sit']?.['lie'] ?? 1) * sleepBoost)
  mergeMod(mods, 'stand', 'walk', (mods['stand']?.['walk'] ?? 1) * lazyWalkPenalty)

  // timidity: ↑→回静止态更快（idle/lie 权重 ↑）
  const timidRetreat = 0.5 + timidity
  mergeMod(mods, 'stand', 'idle_sit', timidRetreat)
  mergeMod(mods, 'walk', 'stand', timidRetreat)

  // curiosity: ↑→groom 权重 ↑
  mergeMod(mods, 'idle_sit', 'groom', 0.5 + curiosity)

  return mods
}

/** 合并倍率到调制表 */
function mergeMod(
  mods: Record<string, Record<string, number>>,
  source: string,
  target: string,
  multiplier: number,
): void {
  if (!mods[source]) mods[source] = {}
  mods[source][target] = multiplier
}

/**
 * 性格 → 需求衰减速率调制 (§9.6 需求衰减速率)。
 *
 * 映射规则 (§9.6)：
 *   - liveliness ↑ → 疲劳累积更快、愉悦回落更快
 *   - laziness ↑ → 疲劳累积更慢、愉悦回落更慢
 *   - clinginess ↑ → 注意力下降更快（更渴望关注）
 *
 * 返回调制后的 NeedRates，供 advanceNeeds 使用。
 *
 * @param personality 性格 5 维
 * @param base 基础速率（默认 DEFAULT_NEED_RATES）
 */
export function personalityNeedRates(
  personality: Personality,
  base: NeedRates = DEFAULT_NEED_RATES,
): NeedRates {
  const { liveliness, laziness, clinginess } = personality

  // liveliness ↑ → 疲劳累积快（活动多），happiness 回落快
  // liveliness 从 0→1, 调制因子 0.7→1.3
  const livelinessFactor = 0.7 + liveliness * 0.6

  // laziness ↑ → 疲劳累积慢、happiness 回落慢
  // laziness 从 0→1, 调制因子 1.3→0.7
  const lazinessFactor = 1.3 - laziness * 0.6

  // clinginess ↑ → attention 下降更快
  // clinginess 从 0→1, 调制因子 0.8→1.5
  const clinginessFactor = 0.8 + clinginess * 0.7

  return {
    hunger: base.hunger, // 饥饿不受性格影响
    fatigue: base.fatigue * livelinessFactor * lazinessFactor,
    // happiness 回落（负值）——liveliness 加快回落
    happiness: base.happiness * livelinessFactor,
    // attention 下降（负值）——clinginess 加快下降
    attention: base.attention * clinginessFactor,
  }
}

/**
 * 性格 → 交互反应修饰 (§9.6 交互反应)。
 *
 * 映射规则 (§9.6)：
 *   - clinginess ↑ → 被抚摸 happiness 增益 ↑
 *   - timidity ↑ → 被抚摸权重 ↓、被抚摸后更快回静止态
 *   - liveliness ↑ → 点击呼应 attention 增益 ↑
 *
 * 返回的修饰符供交互层 (TASK-012) 在处理交互时应用。
 */
export interface InteractionModifiers {
  /** 被抚摸的 happiness 增益倍率 */
  readonly petHappinessGain: number
  /** 被抚摸后回静止态的倾向 (0=正常, 1=最高) */
  readonly retreatTendency: number
  /** 点击呼应的 attention 增益倍率 */
  readonly clickAttentionGain: number
  /** 被抚摸权重倍率（影响是否进入 petted 状态） */
  readonly petWeightMultiplier: number
}

/**
 * 计算性格对交互的修饰 (§9.6 交互反应)。
 */
export function personalityInteractionModifiers(
  personality: Personality,
): InteractionModifiers {
  const { liveliness, clinginess, timidity } = personality

  // clinginess ↑ → 抚摸愉悦增益 ↑
  // clinginess=0.5 → ×1.0, clinginess=1.0 → ×1.5
  const petHappinessGain = 0.5 + clinginess

  // timidity ↑ → 抚摸后更快回静止态
  const retreatTendency = timidity

  // liveliness ↑ → 点击呼应 attention 增益 ↑
  const clickAttentionGain = 0.5 + liveliness

  // timidity ↑ → 被抚摸权重 ↓
  // timidity=0.5 → ×1.0, timidity=1.0 → ×0.5
  const petWeightMultiplier = 1.5 - timidity

  return {
    petHappinessGain,
    retreatTendency,
    clickAttentionGain,
    petWeightMultiplier,
  }
}

/**
 * 性格 → signature 动作触发频率调制 (§9.6 signature 触发频率)。
 *
 * 映射规则 (§9.6)：curiosity ↑ → 稀有动作概率 ↑。
 *
 * @param personality 性格 5 维
 * @param baseProbability 基础触发概率（如 0.03–0.08）
 * @returns 调制后的触发概率（钳制到 [0, 0.15]）
 */
export function personalitySignatureProbability(
  personality: Personality,
  baseProbability: number,
): number {
  const { curiosity } = personality
  // curiosity=0.5 → ×1.0, curiosity=1.0 → ×1.6, curiosity=0.0 → ×0.4
  const factor = 0.4 + curiosity * 1.2
  const adjusted = baseProbability * factor
  // 钳制到合理范围
  if (adjusted < 0) return 0
  if (adjusted > 0.15) return 0.15
  return adjusted
}
