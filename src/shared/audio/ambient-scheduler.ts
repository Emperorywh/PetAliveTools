/**
 * 环境声调度 (§11.1 节律随机环境声)
 *
 * 环境声按昼夜节律随机偶发：
 *   - 白天频率较高（间隔短）
 *   - 夜间安静（间隔长）
 *   - 频率/音量可调
 *
 * 与 rhythm 模块（§9.3）配合：使用 isNightTime 判定昼夜。
 * 调度是随机间隔驱动，不是固定周期。
 *
 * 纯逻辑，无平台依赖。
 */

/** 环境声调度配置 */
export interface AmbientConfig {
  /** 白天间隔范围 (秒)：[最小, 最大] */
  readonly dayIntervalSec: readonly [number, number]
  /** 夜间间隔范围 (秒)：[最小, 最大] */
  readonly nightIntervalSec: readonly [number, number]
  /** 频率倍率 (§11.1 频率可调)：> 1 更频繁，< 1 更稀疏 */
  readonly frequencyMultiplier: number
}

/** 默认环境声配置：白天 30–120s，夜间 120–600s */
export const DEFAULT_AMBIENT_CONFIG: AmbientConfig = {
  dayIntervalSec: [30, 120],
  nightIntervalSec: [120, 600],
  frequencyMultiplier: 1.0,
}

/**
 * 计算下次环境声间隔 (秒)。
 *
 * 根据昼夜状态在对应区间内随机取值，
 * 再除以频率倍率（倍率↑ → 间隔↓ → 更频繁）。
 *
 * @param config 环境声配置
 * @param isNight 当前是否夜间
 * @param rng 随机源（测试可注入）
 */
export function computeNextAmbientIntervalSec(
  config: AmbientConfig,
  isNight: boolean,
  rng: () => number = Math.random,
): number {
  const range = isNight ? config.nightIntervalSec : config.dayIntervalSec
  const [minSec, maxSec] = range
  const rawInterval = minSec + rng() * (maxSec - minSec)
  // 频率倍率除法：倍率 2.0 → 间隔减半
  const adjusted = rawInterval / config.frequencyMultiplier
  // 钳制最小 5 秒，避免极端值
  return Math.max(5, adjusted)
}

/**
 * 环境声调度状态。
 *
 * 调用方持有此状态，每次 tick 时检查是否到达下次播放时间。
 */
export interface AmbientScheduleState {
  /** 下次环境声播放时间 (ms) */
  readonly nextPlayMs: number
}

/** 创建初始调度状态：从指定时间开始等待一个间隔 */
export function createAmbientScheduleState(
  nowMs: number,
  firstIntervalSec: number,
): AmbientScheduleState {
  return { nextPlayMs: nowMs + firstIntervalSec * 1000 }
}

/**
 * 判断是否到了播放环境声的时间。
 */
export function shouldPlayAmbient(
  state: AmbientScheduleState,
  nowMs: number,
): boolean {
  return nowMs >= state.nextPlayMs
}

/**
 * 调度推进：计算下次播放时间。
 *
 * 在播放（或因无可用声效而跳过）后调用。
 */
export function scheduleNextAmbient(
  nowMs: number,
  intervalSec: number,
): AmbientScheduleState {
  return { nextPlayMs: nowMs + intervalSec * 1000 }
}
