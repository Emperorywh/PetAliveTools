/**
 * 昼夜节律 (§9.3 节律, §9.4 需求模型)
 *
 * 节律作为 FSM 转移的驱动之一（§9.3 转移驱动：节律昼夜时段调制，
 * 夜间睡眠权重高）。
 *
 * 夜间效果：
 *   - sleep / lie 权重倍率增加（nightSleepBoost）
 *   - 环境活跃度降低（stand / walk / groom 权重倍率降低）
 *   - 疲劳累积速率加快（疲劳在夜间上升）
 *
 * 判定：当前小时在 [nightStartHour, nightEndHour) 夜间区间内时为夜间。
 * 跨午夜处理：如 nightStart=22, nightEnd=7 → 22:00–07:00 为夜间。
 *
 * 纯逻辑，无平台依赖。
 */

import type { RhythmConfig } from '../../shared/types/behavior-config'
import { type NeedRates } from './needs'

/**
 * 判断指定小时是否在夜间区间。
 *
 * 夜间区间 [nightStartHour, nightEndHour)：
 *   - nightStart < nightEnd → 同日区间（如 13–17）
 *   - nightStart > nightEnd → 跨午夜区间（如 22–7）
 *   - nightStart === nightEnd → 全天夜间（除非为 0）
 */
export function isNightTime(
  hour: number,
  config: RhythmConfig,
): boolean {
  const { nightStartHour, nightEndHour } = config
  if (nightStartHour === nightEndHour) {
    // 同小时 → 视为全天夜间
    return true
  }
  if (nightStartHour < nightEndHour) {
    // 同日区间
    return hour >= nightStartHour && hour < nightEndHour
  }
  // 跨午夜区间（如 22–7）
  return hour >= nightStartHour || hour < nightEndHour
}

/**
 * 获取当前小时。
 *
 * 测试可注入；运行时用 new Date().getHours()。
 */
export function currentHour(date: Date = new Date()): number {
  return date.getHours()
}

/**
 * 节律 → 转移权重倍率调制 (§9.3 节律)。
 *
 * 夜间：sleep/lie 权重 ↑（nightSleepBoost），活跃状态权重 ↓。
 * 白天：无调制（倍率 1.0）。
 *
 * @param isNight 当前是否夜间
 * @param config 节律配置
 * @returns weightOverrides 格式的调制表
 */
export function rhythmWeightModifiers(
  isNight: boolean,
  config: RhythmConfig,
): Record<string, Record<string, number>> {
  if (!isNight) return {}

  const boost = config.nightSleepBoost
  // 夜间活跃度降低
  const activityPenalty = 1 / (1 + (boost - 1) * 0.5) // boost=3.0 → ~0.5

  return {
    // 夜间睡眠权重大幅增加
    lie: { sleep: boost },
    idle_sit: { lie: boost * 0.8, sleep: boost, stand: activityPenalty, walk: activityPenalty },
    stand: { walk: activityPenalty, idle_sit: boost * 0.6 },
    // 行走时更倾向回静止
    walk: { stand: boost * 0.7 },
  }
}

/**
 * 节律 → 需求衰减速率调制 (§9.4 疲劳夜间上升)。
 *
 * 夜间疲劳累积更快。
 *
 * @param isNight 当前是否夜间
 * @param base 基础速率
 * @returns 调制后的速率
 */
export function rhythmNeedRates(
  isNight: boolean,
  base: NeedRates,
): NeedRates {
  if (!isNight) return base
  // 夜间疲劳累积加速 ×2
  return {
    ...base,
    fatigue: base.fatigue * 2,
  }
}

/**
 * 计算指定时间的节律调制结果（权重表 + 速率）。
 *
 * 便捷入口：传入小时和配置，返回夜间状态与对应的调制表。
 */
export interface RhythmModulation {
  /** 当前是否夜间 */
  readonly isNight: boolean
  /** 权重调制表 */
  readonly weightMods: Record<string, Record<string, number>>
  /** 调制后的需求速率（需外部再乘以性格速率） */
  readonly needRateFactor: number
}

/**
 * 计算节律调制 (§9.3 节律)。
 */
export function computeRhythmModulation(
  hour: number,
  config: RhythmConfig,
): RhythmModulation {
  const isNight = isNightTime(hour, config)
  return {
    isNight,
    weightMods: rhythmWeightModifiers(isNight, config),
    needRateFactor: isNight ? 2 : 1,
  }
}
