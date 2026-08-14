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

/**
 * 文件选择与停留节奏随机化参数。
 * 播放速率抖动已删除，原始片段始终以 1.0 倍速播放。
 */
export interface MicroRandomConfig {
  /** 静止时长抖动 (秒) */
  readonly idleJitterSec: number
  /** 稀有动作触发概率 (如 0.03–0.08) */
  readonly signatureProbability: number
}

/**
 * 外壳设置 (§12.4 设置面板)
 *
 * 显示器选择、音量、节律频率、开机自启与快捷键配置。
 * 存储于 behavior-config.json 的 `shell` 字段。
 */
export interface ShellSettings {
  /** 选定显示器 ID（null = 主显示器，§6.4） */
  readonly displayId: number | null
  /** 音频音量 (0–1，§11.2) */
  readonly volume: number
  /** 环境声频率倍率 (§11.1 频率可调，默认 1.0) */
  readonly ambientFrequency: number
  /** 开机自启 (§12.4，默认 true) */
  readonly autoLaunch: boolean
  /** 隐藏安全阀快捷键 accelerator (§10，默认 "CommandOrControl+Shift+H") */
  readonly hideHotkey: string
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
  /** 外壳设置 (§12.4) */
  readonly shell: ShellSettings
}
