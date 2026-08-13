/**
 * 空闲调度与变体耗尽兜底 (§9.5, §9.1)
 *
 * 调度间隔策略：
 *   - 闲置状态（idle_sit / lie / sleep）使用较长间隔
 *   - 活跃状态（stand / groom）使用较短间隔
 *   - 循环片段按 intervalMs 持续播放，到时切换
 *
 * 变体耗尽兜底 (§9.5 第 4 条)：
 *   长时间闲置变体用尽时，回退最常见变体并拉长切换间隔。
 *   跟踪每个状态的变体使用次数，当所有变体均被使用达到阈值次后
 *   判定为耗尽，回退最常见变体并施加间隔倍率。
 *
 * 纯逻辑，无平台依赖。
 */

import type { ClipMeta } from '../../shared/types/clip-meta'
import { getClipVariants, type VariantPicker } from '../behavior/state-lookup'
import { createPlaceholderClip, isPlaceholderClip } from '../persistence/placeholder'

/** 空闲调度配置 */
export interface IdleScheduleConfig {
  /** 闲置状态的基础间隔 (ms)，如 idle_sit / lie / sleep */
  readonly idleIntervalMs: number
  /** 活跃状态的基础间隔 (ms)，如 stand / groom */
  readonly activeIntervalMs: number
  /** 变体耗尽时的间隔倍率 (如 1.5) */
  readonly exhaustionMultiplier: number
  /** 每个变体被使用多少次后判定为耗尽 */
  readonly exhaustionThreshold: number
}

/** 默认空闲调度配置 */
export const DEFAULT_IDLE_CONFIG: IdleScheduleConfig = {
  idleIntervalMs: 8_000,
  activeIntervalMs: 4_000,
  exhaustionMultiplier: 1.5,
  exhaustionThreshold: 3,
}

/** 闲置状态集合（使用长间隔） */
const IDLE_STATES: ReadonlySet<string> = new Set(['idle_sit', 'lie', 'sleep'])

/**
 * 判断状态是否为闲置状态（使用较长间隔）。
 */
export function isIdleState(state: string): boolean {
  return IDLE_STATES.has(state)
}

/**
 * 变体使用追踪器。
 *
 * state → 变体编号 → 使用次数。
 * 不可变数据结构，每次记录产生新实例。
 */
export interface VariantTracker {
  readonly usage: ReadonlyMap<string, ReadonlyArray<number>>
}

/** 创建空追踪器 */
export function createVariantTracker(): VariantTracker {
  return { usage: new Map() }
}

/**
 * 获取某状态某变体的已使用次数。
 */
export function variantUsageCount(
  tracker: VariantTracker,
  state: string,
  variant: number,
): number {
  const arr = tracker.usage.get(state)
  if (!arr) return 0
  return arr[variant - 1] ?? 0
}

/**
 * 记录一次变体使用（返回新追踪器，不可变）。
 */
export function recordVariantUse(
  tracker: VariantTracker,
  state: string,
  variant: number,
): VariantTracker {
  const arr = [...(tracker.usage.get(state) ?? [])]
  while (arr.length < variant) arr.push(0)
  arr[variant - 1] = (arr[variant - 1] ?? 0) + 1
  return {
    usage: new Map(tracker.usage).set(state, arr),
  }
}

/**
 * 判断某状态的变体是否已耗尽 (§9.5)。
 *
 * 当该状态有 ≥ 2 个变体，且所有变体的使用次数均 ≥ threshold 时，判定为耗尽。
 * 仅 1 个变体时不构成耗尽（无多变性可言）。
 */
export function isVariantExhausted(
  tracker: VariantTracker,
  state: string,
  clips: readonly ClipMeta[],
  threshold: number,
): boolean {
  const variants = getClipVariants(state, clips)
  if (variants.length < 2) return false
  return variants.every((c) => variantUsageCount(tracker, state, c.variant) >= threshold)
}

/**
 * 获取某状态使用次数最多的变体编号。
 *
 * 用于 §9.5 耗尽兜底：回退到最常见变体。
 * 平局取编号最小的。
 */
export function mostUsedVariant(
  tracker: VariantTracker,
  state: string,
  clips: readonly ClipMeta[],
): number {
  const variants = getClipVariants(state, clips)
  if (variants.length === 0) return 1
  let bestVariant = variants[0].variant
  let bestCount = variantUsageCount(tracker, state, bestVariant)
  for (const c of variants) {
    const count = variantUsageCount(tracker, state, c.variant)
    if (count > bestCount) {
      bestCount = count
      bestVariant = c.variant
    }
  }
  return bestVariant
}

/** 空闲调度结果 */
export interface IdleSchedule {
  /** 本次调度的间隔 (ms) */
  readonly intervalMs: number
  /** 选定的片段（含占位兜底，§5.5） */
  readonly clip: ClipMeta
  /** 是否因变体耗尽而回退 */
  readonly variantExhausted: boolean
  /** 是否使用了占位片段 */
  readonly isPlaceholder: boolean
}

/**
 * 为状态调度空闲片段与间隔 (§9.5)。
 *
 * - 闲置状态用长间隔，活跃状态用短间隔
 * - 多变体随机抽取 (§9.5 第 1 条)
 * - 变体耗尽时回退最常见变体 + 拉长间隔 (§9.5 第 4 条)
 * - 无真实片段时使用占位片段 (§5.5)
 *
 * @param state FSM 状态键
 * @param clips 片段库
 * @param tracker 变体追踪器
 * @param config 空闲调度配置
 * @param pickVariant 变体选择器（默认取最小编号）
 */
export function scheduleIdle(
  state: string,
  clips: readonly ClipMeta[],
  tracker: VariantTracker,
  config: IdleScheduleConfig = DEFAULT_IDLE_CONFIG,
  pickVariant: VariantPicker = (vs) => vs[0],
): IdleSchedule {
  const variants = getClipVariants(state, clips)

  // 无真实片段 → 占位兜底 (§5.5)
  if (variants.length === 0) {
    return {
      intervalMs: config.idleIntervalMs,
      clip: createPlaceholderClip(),
      variantExhausted: false,
      isPlaceholder: true,
    }
  }

  const baseInterval = isIdleState(state)
    ? config.idleIntervalMs
    : config.activeIntervalMs

  const exhausted = isVariantExhausted(tracker, state, clips, config.exhaustionThreshold)

  if (exhausted) {
    // §9.5 变体耗尽兜底：回退最常见变体 + 拉长间隔
    const target = mostUsedVariant(tracker, state, clips)
    const clip = variants.find((c) => c.variant === target) ?? variants[0]
    return {
      intervalMs: Math.round(baseInterval * config.exhaustionMultiplier),
      clip,
      variantExhausted: true,
      isPlaceholder: isPlaceholderClip(clip),
    }
  }

  // 正常多变体选择 (§9.5 第 1 条)
  const clip = pickVariant(variants)
  return {
    intervalMs: baseInterval,
    clip,
    variantExhausted: false,
    isPlaceholder: isPlaceholderClip(clip),
  }
}
