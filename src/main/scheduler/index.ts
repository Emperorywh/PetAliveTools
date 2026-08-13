/**
 * 调度衔接模块 (scheduler) — 片段调度与生命周期编排
 *
 * 负责：连接行为 FSM (§9) 与渲染层，管理片段生命周期循环
 * （选择 → 锚定中转 → 播放 → 下一个），行走调度 (§7.2)，
 * 空闲间隔调度 (§9.5)，变体耗尽兜底 (§9.5 第 4 条)，
 * 缺素材占位 (§5.5)。
 *
 * 调度器是 Phase 1b 运行时闭环的核心编排器 (§15)。
 *
 * 运行于主进程，逻辑为纯函数 / 纯状态机，可供测试直接调用。
 */

export { planWalk, chooseWalkDirection, directionAfterWalk } from './walk-planner'
export type { WalkPlan, WalkPlanInput, WalkDirectionChoice } from './walk-planner'

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
  SchedulerPhase,
  TickResult,
} from './clip-scheduler'

// —— TASK-013: 调度微随机化 —— //

export {
  jitteredPlaybackRate,
  syncedWalkDuration,
  jitteredIdleDuration,
  jitteredPositionX,
  shuffleVariants,
  shouldInsertRareAction,
  effectiveRareActionProbability,
  pickRareAction,
  generateRandomizationParams,
} from './randomization'
export type {
  RandomizationParams,
  RandomizationOptions,
} from './randomization'
