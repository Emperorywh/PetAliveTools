/**
 * 文件选择与停留节奏随机化。
 *
 * 反循环感四策之一——微随机：在权重采样上叠加随机扰动。
 *
 * 包含：
 *   1. 静止时长抖动
 *   2. 片段顺序打乱 / 变体洗牌
 *   3. 稀有动作插入
 *
 * 变体耗尽兜底 (§9.5) 已在 idle-scheduler.ts 实现，
 * 本模块不重复；本模块专注于随机化参数的生成与钳制。
 *
 * 纯逻辑，无平台依赖。
 */

import type { MicroRandomConfig } from '../../shared/types/behavior-config'
import type { Personality } from '../../shared/types/persona'
import { personalitySignatureProbability } from '../behavior/personality'

// —— 静止时长抖动 —— //

/**
 * 生成带抖动的静止时长 (§9.5: idle duration jitter)。
 *
 * 在 [baseInterval - jitterMs, baseInterval + jitterMs] 范围内均匀采样。
 * 抖动以毫秒为单位，来自 idleJitterSec × 1000。
 *
 * @param baseIntervalMs 基础静止间隔（毫秒）
 * @param idleJitterSec 抖动范围（秒）
 * @param rng 随机源
 * @returns 带抖动的静止间隔（毫秒）
 */
export function jitteredIdleDuration(
  baseIntervalMs: number,
  idleJitterSec: number,
  rng: () => number,
): number {
  const jitterMs = idleJitterSec * 1000
  const delta = (rng() * 2 - 1) * jitterMs
  const result = baseIntervalMs + delta
  // 确保非负且有合理下限
  return Math.max(1000, result)
}

// —— 变体洗牌 —— //

/**
 * Fisher-Yates 变体洗牌 (§9.5: variant shuffling)。
 *
 * 使用 Fisher-Yates 算法洗牌数组，返回新数组。
 * 确定性：相同 rng 序列产生相同结果。
 *
 * @param items 待洗牌数组
 * @param rng 随机源
 * @returns 洗牌后的新数组
 */
export function shuffleVariants<T>(
  items: readonly T[],
  rng: () => number,
): T[] {
  const arr = [...items]
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[arr[i], arr[j]] = [arr[j], arr[i]]
  }
  return arr
}

// —— 稀有动作插入 —— //

/**
 * 判断是否应插入稀有动作 (§9.5: 3–8% probability)。
 *
 * @param probability 触发概率（已含性格调制后的概率）
 * @param rng 随机源
 * @returns 是否触发稀有动作
 */
export function shouldInsertRareAction(
  probability: number,
  rng: () => number,
): boolean {
  return rng() < probability
}

/**
 * 计算当前有效的稀有动作触发概率 (§9.5, §9.6)。
 *
 * 结合性格 curiosity 调制基础概率。
 * 钳制到 [3%, 8%] × 性格调制，最终钳制 [0, 15%]。
 *
 * @param config 微随机配置
 * @param personality 性格 5 维（可为 null 使用基础概率）
 * @returns 调制后的触发概率
 */
export function effectiveRareActionProbability(
  config: MicroRandomConfig,
  personality?: Personality,
): number {
  // 0 = explicitly disabled
  if (config.signatureProbability <= 0) return 0
  if (personality) {
    return personalitySignatureProbability(personality, config.signatureProbability)
  }
  // 钳制到 [3%, 8%]
  return Math.max(0.03, Math.min(0.08, config.signatureProbability))
}

/**
 * 从候选签名动作中随机选择一个（用于稀有动作插入）。
 *
 * @param signatures 候选签名动作状态键
 * @param rng 随机源
 * @returns 随机选择的签名动作键；无候选时返回 null
 */
export function pickRareAction(
  signatures: readonly string[],
  rng: () => number,
): string | null {
  if (signatures.length === 0) return null
  return signatures[Math.floor(rng() * signatures.length)]
}
