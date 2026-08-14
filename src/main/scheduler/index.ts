/**
 * 原样片段调度与生命周期编排入口。
 *
 * 负责：连接行为 FSM (§9) 与渲染层，管理片段生命周期循环
 * （选择 → 锚定中转 → 完整播放 → 下一个），
 * 空闲间隔调度 (§9.5)，变体耗尽兜底 (§9.5 第 4 条)，
 * 缺素材占位 (§5.5)。
 *
 * 调度器是 Phase 1b 运行时闭环的核心编排器 (§15)。
 *
 * 运行于主进程，逻辑为纯函数 / 纯状态机，可供测试直接调用。
 */

export {
  createVariantTracker,
  recordVariantUse,
  variantUsageCount,
  isVariantExhausted,
  mostUsedVariant,
  scheduleIdle,
  isIdleState,
  DEFAULT_IDLE_CONFIG,
} from './idle-scheduler'
export type {
  IdleScheduleConfig,
  VariantTracker,
  IdleSchedule,
} from './idle-scheduler'

export {
  buildPlaybackQueue,
  initPlaybackQueue,
  currentItem,
  isCurrentItemDone,
  advanceQueue,
  completeCurrentItem,
  createSchedulingCycle,
} from './lifecycle'
export type {
  PlaybackItemKind,
  PlaybackItem,
  PlaybackQueue,
  SchedulingCycle,
} from './lifecycle'

export { ClipScheduler } from './clip-scheduler'
export type {
  ClipSchedulerConfig,
  ClipSchedulerDeps,
  RenderCommand,
  SchedulerState,
  TickResult,
} from './clip-scheduler'

// —— TASK-013: 调度微随机化 —— //

export {
  jitteredIdleDuration,
  shuffleVariants,
  shouldInsertRareAction,
  effectiveRareActionProbability,
  pickRareAction,
} from './randomization'
