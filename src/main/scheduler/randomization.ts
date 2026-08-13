/**
 * 调度微随机化 (§9.5)
 *
 * 反循环感四策之一——微随机：在权重采样上叠加随机扰动。
 *
 * 包含：
 *   1. 播放速率 ±5%，行走位移曲线随速率同步缩放 (§7.2, §9.5)
 *   2. 静止时长抖动 (idle duration jitter)
 *   3. 出现位置 x 抖动 (position x jitter)
 *   4. 片段顺序打乱 / 变体洗牌 (variant shuffling)
 *   5. 稀有动作插入 (rare action insertion at 3–8%)
 *
 * 变体耗尽兜底 (§9.5) 已在 idle-scheduler.ts 实现，
 * 本模块不重复；本模块专注于随机化参数的生成与钳制。
 *
 * 纯逻辑，无平台依赖。
 */

import type { MicroRandomConfig } from '../../shared/types/behavior-config'
import type { Personality } from '../../shared/types/persona'
import { personalitySignatureProbability } from '../behavior/personality'

// —— 播放速率抖动 —— //

/**
 * 生成带抖动的播放速率 (§9.5: ±5%)。
 *
 * 在 [1 - rateJitter, 1 + rateJitter] 范围内均匀采样。
 * 行走片段的位移曲线按此速率同步缩放，避免滑步 (§7.2)。
 *
 * @param rateJitter 抖动幅度（如 0.05 = ±5%）
 * @param rng 随机源
 * @returns 播放速率倍率（如 0.97 或 1.04）
 */
export function jitteredPlaybackRate(
  rateJitter: number,
  rng: () => number,
): number {
  const delta = (rng() * 2 - 1) * rateJitter // [-rateJitter, +rateJitter]
  return 1 + delta
}

/**
 * 将播放速率与行走位移曲线同步缩放。
 *
 * §7.2 要求：窗口平移与画面内步态严格同步。
 * 当播放速率变化时，播放时长 = 片段时长 / rate，
 * 对应的位移采样也需要按 rate 缩放时间轴。
 *
 * @param originalDurationSec 原始片段时长（秒）
 * @param rate 播放速率倍率
 * @returns 实际播放时长（秒）= originalDurationSec / rate
 */
export function syncedWalkDuration(
  originalDurationSec: number,
  rate: number,
): number {
  return originalDurationSec / rate
}

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

// —— 位置 x 抖动 —— //

/**
 * 生成带抖动的出现位置 x (§9.5: position x jitter)。
 *
 * 在 [baseX - maxJitterPx, baseX + maxJitterPx] 范围内均匀采样。
 * 用于宠物在锚定态停留时位置的微扰，避免每次完全一致。
 *
 * @param baseX 基础 x 位置
 * @param maxJitterPx 最大抖动像素
 * @param rng 随机源
 * @returns 带抖动的 x 位置
 */
export function jitteredPositionX(
  baseX: number,
  maxJitterPx: number,
  rng: () => number,
): number {
  const delta = (rng() * 2 - 1) * maxJitterPx
  return baseX + delta
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

// —— 随机化参数集合 —— //

/**
 * 一次调度周期所需的随机化参数。
 *
 * 由调度器在规划下一个调度周期时生成。
 */
export interface RandomizationParams {
  /** 播放速率倍率 (1 ± rateJitter) */
  readonly playbackRate: number
  /** 带抖动的静止间隔 (ms) */
  readonly idleIntervalMs: number
  /** 带抖动的出现位置 x */
  readonly positionX: number
  /** 是否插入稀有动作 */
  readonly insertRareAction: boolean
  /** 选择的稀有动作键（insertRareAction=false 时为 null） */
  readonly rareAction: string | null
  /** 使用的稀有动作概率 */
  readonly rareActionProbability: number
}

/** 随机化生成选项 */
export interface RandomizationOptions {
  /** 微随机配置 */
  readonly config: MicroRandomConfig
  /** 性格 5 维（用于稀有动作概率调制） */
  readonly personality?: Personality
  /** 基础静止间隔 (ms) */
  readonly baseIdleIntervalMs: number
  /** 基础 x 位置 */
  readonly baseX: number
  /** 位置 x 抖动最大像素 */
  readonly positionJitterPx: number
  /** 候选稀有动作状态键 */
  readonly rareActions: readonly string[]
  /** 随机源 */
  readonly rng: () => number
}

/**
 * 一次性生成下一个调度周期的全部随机化参数 (§9.5)。
 *
 * 统一入口，确保所有随机参数在一次调用中生成，
 * 调度器只需持有返回的 RandomizationParams。
 */
export function generateRandomizationParams(
  opts: RandomizationOptions,
): RandomizationParams {
  const { config, rng } = opts

  const playbackRate = jitteredPlaybackRate(config.rateJitter, rng)
  const idleIntervalMs = jitteredIdleDuration(
    opts.baseIdleIntervalMs,
    config.idleJitterSec,
    rng,
  )
  const positionX = jitteredPositionX(opts.baseX, opts.positionJitterPx, rng)

  const rareActionProbability = effectiveRareActionProbability(config, opts.personality)
  const insertRareAction = shouldInsertRareAction(rareActionProbability, rng)
  const rareAction = insertRareAction
    ? pickRareAction(opts.rareActions, rng)
    : null

  return {
    playbackRate,
    idleIntervalMs,
    positionX,
    insertRareAction: insertRareAction && rareAction !== null,
    rareAction,
    rareActionProbability,
  }
}
