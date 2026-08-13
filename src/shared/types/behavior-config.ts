/**
 * 行为引擎配置 (BehaviorConfig)
 *
 * 参见 SPEC §9.3 (转移驱动)、§9.5 (调度微随机化)、§12.1 (behavior-config.json)。
 *
 * FSM 权重覆盖、节律设置与微随机参数。跨进程共享类型。
 */

/** 节律设置：昼夜调制 (§9.3 节律) */
export interface RhythmConfig {
  /** 夜间开始小时 (0–23)，如 22 */
  readonly nightStartHour: number
  /** 夜间结束小时 (0–23)，如 7 */
  readonly nightEndHour: number
  /** 夜间睡眠权重增益倍率 (如 3.0 表示夜间 sleep 权重 ×3) */
  readonly nightSleepBoost: number
}

/** 调度微随机化参数 (§9.5) */
export interface MicroRandomConfig {
  /** 播放速率抖动幅度 (如 0.05 = ±5%) */
  readonly rateJitter: number
  /** 静止时长抖动 (秒) */
  readonly idleJitterSec: number
  /** 稀有动作触发概率 (如 0.03–0.08) */
  readonly signatureProbability: number
}

/**
 * FSM 权重覆盖与节律设置 (§12.1 behavior-config.json)
 *
 * weightOverrides: state → { targetState → 权重倍率 }
 * 未列出的 state/targetState 使用默认权重。
 */
export interface BehaviorConfig {
  /**
   * 权重覆盖：key = 源状态，value = { 目标状态 → 权重倍率 }
   * 例如 { "idle_sit": { "walk": 1.5 } } 提升 idle_sit→walk 的权重
   */
  readonly weightOverrides: Readonly<Record<string, Readonly<Record<string, number>>>>
  /** 昼夜节律设置 */
  readonly rhythm: RhythmConfig
  /** 调度微随机化参数 */
  readonly microRandom: MicroRandomConfig
}
