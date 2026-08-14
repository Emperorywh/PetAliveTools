/**
 * 片段调度器 (§9 scheduler connects FSM to rendering)
 *
 * 调度器是编排核心：连接行为 FSM (TASK-009)、空间运动层 (TASK-010)
 * 与渲染层 (TASK-003)，驱动桌面宠物的运行时循环。
 *
 * 调度循环：
 *   1. FSM.step() 获取下一状态 (§9.3)
 *   2. 从资产库按状态选择片段变体 (§9.5 多变体, §5.5 占位兜底)
 *   3. 规划锚定中转 (§8 planStateTransition)
 *   4. 行走状态规划起止位置与时长 (§7.2 planWalk)
 *   5. 逐项执行播放队列 (lifecycle)
 *   6. 片段播毕 / 空闲间隔到期 → 回到 1
 *
 * 变体耗尽兜底 (§9.5 第 4 条)：回退最常见变体 + 拉长间隔。
 * 缺素材占位 (§5.5, §13)：缺失状态用 idle_sit 占位片段，不崩溃。
 *
 * 纯逻辑，无平台依赖；调度器本身不操作 DOM 或窗口，
 * 通过 TickResult 输出渲染命令供渲染层消费。
 */

import type { ClipMeta } from '../../shared/types/clip-meta'
import type { TrackFile } from '../../shared/types/track-file'
import type { MicroRandomConfig } from '../../shared/types/behavior-config'
import type { BehaviorConfig } from '../../shared/types/behavior-config'
import type { Personality } from '../../shared/types/persona'
import type { WorkAreaBounds } from '../../shared/spatial'
import type { WalkDirection } from '../../shared/spatial'
import { BehaviorFsm, type BehaviorState } from '../behavior/fsm'
import { selectClipForState, type VariantPicker } from '../behavior/state-lookup'
import {
  planStateTransition,
  resolveAnchorPose,
  ANCHOR_STATE,
  type AnchorPose,
  type PlanOptions,
} from '../behavior/anchor-transition'
import { isPlaceholderClip } from '../persistence/placeholder'
import {
  type SchedulingCycle,
  type PlaybackItem,
  createSchedulingCycle,
  currentItem,
  isCurrentItemDone,
  advanceQueue,
  completeCurrentItem,
} from './lifecycle'
import {
  type IdleScheduleConfig,
  type VariantTracker,
  createVariantTracker,
  recordVariantUse,
  scheduleIdle,
} from './idle-scheduler'
import {
  chooseWalkDirection,
  planWalk,
  directionAfterWalk,
} from './walk-planner'
import {
  effectiveRareActionProbability,
  shouldInsertRareAction,
  pickRareAction,
  generateRandomizationParams,
  jitteredPlaybackRate,
  jitteredIdleDuration,
  shuffleVariants,
  type RandomizationParams,
} from './randomization'
import { groundedWindowY, clampWindowX } from '../../shared/spatial'

/** 行走媒体时间上报失效阈值 (ms, IR-004)：超过则回退墙钟 */
const DEFAULT_MEDIA_TIME_STALE_MS = 300

// —— 调度器配置 —— //

/** 调度器配置 */
export interface ClipSchedulerConfig {
  /** 宠物对称性 (§4.3 persona.symmetrical) */
  readonly symmetrical: boolean
  /** 工作区边界 (§7.1) */
  readonly workArea: WorkAreaBounds
  /** 窗口宽度 (px, §6.1 固定窗口) */
  readonly windowWidth: number
  /** 精灵锚点在窗口内的 y (px, §6.2) */
  readonly spriteBaseY: number
  /** 片段显示宽度 (px, 含 scale, §7.2) */
  readonly displayedWidthPx: number
  /** 空闲调度配置 */
  readonly idleConfig: IdleScheduleConfig
  /** 锚定中转计划选项 (§8) */
  readonly planOptions: PlanOptions
  /** 随机源 */
  readonly rng: () => number
  /** 调度微随机化配置 (§9.5, IR-006)；缺省不启用微随机 */
  readonly microRandom?: MicroRandomConfig
  /** 性格 5 维（稀有动作概率好奇调制 §9.6, IR-006） */
  readonly personality?: Personality
  /** 稀有动作候选状态键（§4.4 C 招牌片段状态集合, IR-006） */
  readonly rareActions?: readonly string[]
  /** 出现位置 x 抖动幅度 (px, §9.5, IR-006)；0/缺省 = 不抖动 */
  readonly positionJitterPx?: number
  /** 行走媒体时间上报失效阈值 (ms, IR-004)；缺省 300 */
  readonly mediaTimeStaleMs?: number
}

/** 默认调度器配置的基础参数 */
export function createDefaultSchedulerConfig(params: {
  readonly workArea: WorkAreaBounds
  readonly windowWidth: number
  readonly spriteBaseY: number
  readonly displayedWidthPx: number
  readonly symmetrical: boolean
}): Pick<
  ClipSchedulerConfig,
  'workArea' | 'windowWidth' | 'spriteBaseY' | 'displayedWidthPx' | 'symmetrical'
> {
  return params
}

// —— 调度器依赖 —— //

/** 调度器外部依赖（资产与时长） */
export interface ClipSchedulerDeps {
  /** 行为 FSM */
  readonly fsm: BehaviorFsm
  /** 已入库片段 */
  readonly clips: readonly ClipMeta[]
  /** 位移曲线表 (clip id → TrackFile, 仅行走片段) */
  readonly tracks: ReadonlyMap<string, TrackFile>
  /** 片段时长解析器 (clip id → 秒) */
  readonly getClipDurationSec: (clipId: string) => number
}

// —— 渲染命令 —— //

/** 渲染命令：渲染层需执行的动作 */
export type RenderCommand =
  | {
      kind: 'play'
      clip: ClipMeta
      loop: boolean
      mirrored: boolean
      /** 渲染锚定姿态 (§6.2 逐片段锚点对齐, IR-002) */
      anchor: AnchorPose
      /** 播放速率倍率 (§9.5, IR-006)；未启用微随机时恒 1.0 */
      playbackRate: number
    }
  | { kind: 'update_position'; x: number; y: number }
  | { kind: 'hold'; anchor: AnchorPose; durationMs: number }
  | {
      kind: 'fade_in'
      clip: ClipMeta
      durationMs: number
      mirrored: boolean
      /** 渲染锚定姿态 (§6.2, IR-002) */
      anchor: AnchorPose
      /** 播放速率倍率 (§9.5, IR-006) */
      playbackRate: number
    }
  | { kind: 'fade_out'; clip: ClipMeta; durationMs: number }
  | { kind: 'easing'; durationMs: number; reason: string }
  | { kind: 'idle'; clip: ClipMeta; intervalMs: number; mirrored: boolean }

// —— 调度器状态 —— //

/** 调度器阶段 */
export type SchedulerPhase = 'idle' | 'cycling'

/** 调度器内部状态 */
export interface SchedulerState {
  /** 当前阶段 */
  readonly phase: SchedulerPhase
  /** 当前调度周期（cycling 阶段） */
  readonly cycle: SchedulingCycle | null
  /** 上一次完成播放的目标片段（idle 阶段） */
  readonly lastClip: ClipMeta | null
  /** 上一次的目标 FSM 状态 */
  readonly fsmState: BehaviorState
  /** 当前锚定姿态 */
  readonly currentAnchor: AnchorPose
  /** 宠物当前 x (DIP) */
  readonly petX: number
  /** 宠物当前 y (DIP) */
  readonly petY: number
  /** 变体使用追踪器 */
  readonly variantTracker: VariantTracker
  /** 当前行走方向 (边缘转身连续性, §7.3) */
  readonly walkDirection: WalkDirection | null
  /** idle 阶段的间隔到期时间 (ms) */
  readonly idleUntilMs: number
  /** 占位片段提示：当前是否在播放占位片段 */
  readonly showingPlaceholder: boolean
}

// —— Tick 结果 —— //

/** 单次 tick 的结果 */
export interface TickResult {
  /** 更新后的调度器状态 */
  readonly state: SchedulerState
  /** 本次 tick 产生的渲染命令 */
  readonly commands: readonly RenderCommand[]
  /** 是否开始了新的调度周期 */
  readonly cycleStarted: boolean
  /** 是否完成了当前调度周期 */
  readonly cycleCompleted: boolean
  /** 当前宠物的 x 位置 */
  readonly petX: number
}

// —— 调度器 —— //

/**
 * 片段调度器。
 *
 * 纯逻辑状态机，通过 tick(nowMs) 推进。每次 tick 可能产生：
 *   - 渲染命令（play / hold / fade / easing / update_position / idle）
 *   - 新调度周期的开始
 *   - 当前周期的完成
 *
 * 调度器自身不持有定时器；调用方按帧或固定间隔调用 tick()。
 */
export class ClipScheduler {
  private state: SchedulerState
  /** 最近一次渲染端媒体时间上报 (IR-004 视频时钟) */
  private mediaTimeReport: { clipId: string; timeSec: number; atMs: number } | null = null
  /** 行走时钟回退警告去重（每个行走项只记一次） */
  private walkClockFallbackWarned = false
  /** §9.5 变体洗牌袋：state → 洗牌后待抽取变体 (IR-006) */
  private readonly variantDecks = new Map<string, ClipMeta[]>()
  /** 各状态最近一次抽取的片段 id（洗牌袋避免立即重复） */
  private readonly lastPickedClip = new Map<string, string>()
  /** 下一周期命令批次需附带一次位置同步（§9.5 位置 x 抖动, IR-006） */
  private pendingPositionSync = false

  constructor(
    private readonly deps: ClipSchedulerDeps,
    private readonly config: ClipSchedulerConfig,
    initialState?: Partial<SchedulerState>,
  ) {
    const startY = groundedWindowY(
      config.workArea.groundLine,
      config.spriteBaseY,
    )
    const startX = clampWindowX(
      config.workArea,
      Math.round(config.workArea.x + config.workArea.width / 2 - config.windowWidth / 2),
      config.windowWidth,
    )
    this.state = {
      phase: 'idle',
      cycle: null,
      lastClip: null,
      fsmState: deps.fsm.state,
      currentAnchor: deps.fsm.anchor,
      petX: startX,
      petY: startY,
      variantTracker: createVariantTracker(),
      walkDirection: null,
      idleUntilMs: 0,
      showingPlaceholder: false,
      ...initialState,
    }
  }

  /** 当前调度器状态快照 */
  get snapshot(): SchedulerState {
    return this.state
  }

  /** 当前宠物 x 位置 */
  get petX(): number {
    return this.state.petX
  }

  /**
   * 热更新 FSM 配置 (§9.3, IR-007)。
   *
   * 需求/节律随时间漂移时，用当前 needsState 与当前小时重算
   * weightOverrides 后调用，不打断当前调度周期、不重建调度器。
   */
  updateFsmConfig(config: BehaviorConfig): void {
    this.deps.fsm.updateConfig(config)
  }

  /**
   * 当前播放项是否为循环片段（需外部通知完成）。
   *
   * 循环片段的 durationMs = null，由调度器的空闲间隔控制何时切换。
   * 调用方据此决定是否调用 completeCurrentPlayback()。
   */
  get isPlayingLoop(): boolean {
    if (this.state.phase !== 'cycling' || !this.state.cycle) return false
    const item = currentItem(this.state.cycle.queue)
    return item !== null && item.durationMs === null
  }

  /**
   * 渲染端媒体时间上报 (IR-004 视频时钟)。
   *
   * 行走片段播放期间渲染端以 ~10Hz 上报 (clipId, video.currentTime)，
   * 行走位移采样优先使用该媒体时间，使窗口平移与画面内步态严格同步 (§7.2)。
   * 超过 mediaTimeStaleMs（默认 300ms）未收到上报则回退墙钟并记日志。
   *
   * @param clipId 正在播放的片段 id
   * @param timeSec 视频媒体时间 video.currentTime (秒)
   * @param nowMs 上报到达的时钟时间 (ms)
   */
  updateMediaTime(clipId: string, timeSec: number, nowMs: number): void {
    this.mediaTimeReport = { clipId, timeSec, atMs: nowMs }
  }

  /**
   * 推进调度器一个时间步。
   *
   * @param nowMs 当前时钟时间 (ms)
   * @returns tick 结果（含渲染命令）
   */
  tick(nowMs: number): TickResult {
    const commands: RenderCommand[] = []
    let cycleStarted = false
    let cycleCompleted = false

    if (this.state.phase === 'idle') {
      // 空闲等待：检查间隔是否到期
      if (nowMs >= this.state.idleUntilMs) {
        // 开始新调度周期
        const cycle = this.planNextCycle(nowMs)
        this.state = { ...this.state, phase: 'cycling', cycle }
        cycleStarted = true
        // 执行第一项
        const result = this.executeQueueItem(cycle, nowMs)
        commands.push(...result.commands)
        // §9.5 位置 x 抖动：与周期首个命令同批下发，位移与片段切换同帧 (IR-006)
        if (this.pendingPositionSync) {
          this.pendingPositionSync = false
          commands.push({ kind: 'update_position', x: this.state.petX, y: this.state.petY })
        }
        if (result.completed) {
          cycleCompleted = true
          this.state = this.transitionToIdle(cycle, nowMs)
        }
      } else {
        // 继续空闲：保活目标片段 (IR-014)
        // - 循环 lastClip 仍在循环播放 → 原样下发（渲染端同 src 循环为空操作）
        // - 非循环锚定片段 → 重播保活（IR-005 语义，避免冻末帧）
        // - walk/turn 结束帧 → 回当前锚定片段（原地重播行走会"太空步"）
        const clip = this.keepAliveClip()
        commands.push({
          kind: 'idle',
          clip,
          intervalMs: Math.max(0, this.state.idleUntilMs - nowMs),
          mirrored: false,
        })
      }
    } else if (this.state.phase === 'cycling' && this.state.cycle) {
      const cycle = this.state.cycle

      // 行走片段：逐帧更新位置（IR-004：优先媒体时间，失效回退墙钟）
      const item = currentItem(cycle.queue)
      if (item && item.walk && item.clip) {
        const elapsedSec = this.walkElapsedSec(item, cycle.queue.currentItemStartMs, nowMs)
        const newX = this.computeWalkX(item.walk, elapsedSec)
        if (Math.abs(newX - this.state.petX) > 0.01) {
          this.state = { ...this.state, petX: newX }
          commands.push({
            kind: 'update_position',
            x: newX,
            y: this.state.petY,
          })
        }
      }

      // 检查当前项是否完成
      if (isCurrentItemDone(cycle.queue, nowMs)) {
        const newQueue = advanceQueue(cycle.queue, nowMs)
        const updatedCycle = { ...cycle, queue: newQueue }
        this.state = { ...this.state, cycle: updatedCycle }

        if (newQueue.completed) {
          // 整个周期完成
          cycleCompleted = true
          this.state = this.transitionToIdle(updatedCycle, nowMs)
        } else {
          // 执行下一项
          const result = this.executeQueueItem(updatedCycle, nowMs)
          commands.push(...result.commands)
          if (result.completed) {
            cycleCompleted = true
            this.state = this.transitionToIdle(updatedCycle, nowMs)
          }
        }
      }
    }

    return {
      state: this.state,
      commands,
      cycleStarted,
      cycleCompleted,
      petX: this.state.petX,
    }
  }

  /**
   * 强制标记当前播放项完成（用于 durationMs=null 的循环片段）。
   *
   * 当外部（空闲间隔到期）通知当前循环片段可以结束时调用。
   */
  completeCurrentPlayback(nowMs: number): TickResult {
    const commands: RenderCommand[] = []

    if (this.state.phase === 'cycling' && this.state.cycle) {
      const cycle = this.state.cycle
      const newQueue = completeCurrentItem(cycle.queue, nowMs)
      const updatedCycle = { ...cycle, queue: newQueue }
      this.state = { ...this.state, cycle: updatedCycle }

      if (newQueue.completed) {
        this.state = this.transitionToIdle(updatedCycle, nowMs)
      } else {
        const result = this.executeQueueItem(updatedCycle, nowMs)
        commands.push(...result.commands)
        if (result.completed) {
          this.state = this.transitionToIdle(updatedCycle, nowMs)
        }
      }
    }

    return {
      state: this.state,
      commands,
      cycleStarted: false,
      cycleCompleted: false,
      petX: this.state.petX,
    }
  }

  // —— 交互抢占 (§10) —— //

  /**
   * 交互抢占 (§10)：立即中断当前播放，播放交互/道具片段。
   *
   * 不推进 FSM——交互结束后从原 FSM 状态恢复调度。
   * 交互片段（petted/clicked/dragged）以及道具片段（eat/play）
   * 都经此入口触发。
   *
   * @param targetState 目标状态键（如 'petted', 'clicked', 'dragged', 'eat', 'play'）
   * @param nowMs 当前时钟时间 (ms)
   */
  preempt(targetState: string, nowMs: number): TickResult {
    const { clips, getClipDurationSec } = this.deps

    // 选择交互片段（无真实片段时回退占位，§5.5）
    const targetClip = selectClipForState(targetState, clips)

    // 规划锚定中转（从当前 FSM 状态/片段到交互状态）
    const plan = planStateTransition(
      { state: this.state.fsmState as string, clip: this.state.lastClip },
      { state: targetState, clip: targetClip },
      clips,
      this.config.planOptions,
    )

    const cycle = createSchedulingCycle({
      fromState: this.state.fsmState as string,
      toState: targetState,
      plan,
      targetClip,
      getClipDurationSec,
      nowMs,
      idleIntervalMs: 0,
      isPlaceholder: isPlaceholderClip(targetClip),
    })

    this.state = { ...this.state, phase: 'cycling', cycle }

    // 执行第一项
    const commands: RenderCommand[] = []
    const result = this.executeQueueItem(cycle, nowMs)
    commands.push(...result.commands)

    let cycleCompleted = false
    if (result.completed) {
      cycleCompleted = true
      this.state = this.transitionToIdlePreservingFsm(cycle, nowMs)
    }

    return {
      state: this.state,
      commands,
      cycleStarted: true,
      cycleCompleted,
      petX: this.state.petX,
    }
  }

  /**
   * 结束交互抢占 (§10)：停止当前循环交互片段，返回锚定态恢复调度。
   *
   * 用于 petted/dragged 等循环交互片段——这些片段 durationMs=null，
   * 需外部通知结束。clicked/eat/play 等有限时长片段自然结束后无需调用。
   *
   * @param nowMs 当前时钟时间 (ms)
   */
  endPreempt(nowMs: number): TickResult {
    if (this.state.phase === 'cycling' && this.state.cycle) {
      const cycle = this.state.cycle
      // 标记队列完成，跳过剩余步骤
      const completedCycle: SchedulingCycle = {
        ...cycle,
        queue: { ...cycle.queue, completed: true },
      }
      this.state = this.transitionToIdlePreservingFsm(completedCycle, nowMs)
    }

    return {
      state: this.state,
      commands: [],
      cycleStarted: false,
      cycleCompleted: false,
      petX: this.state.petX,
    }
  }

  // —— 内部方法 —— //

  /**
   * 规划下一个调度周期。
   *
   * 0. §9.5 稀有动作判定（先于此 FSM 步进：插入时不消耗 FSM 转移）
   * 1. FSM.step() 获取下一状态
   * 2. 选择目标片段（§9.5 变体洗牌 / 占位兜底）
   * 3. 规划锚定中转
   * 4. 行走状态规划起止位置
   * 5. §9.5 微随机：播放速率 / 空闲间隔抖动 / 出现位置 x 抖动
   * 6. 组装调度周期
   */
  private planNextCycle(nowMs: number): SchedulingCycle {
    const { fsm, clips, getClipDurationSec } = this.deps
    const micro = this.config.microRandom

    // 0. 稀有动作插入 (§9.5 第 2 条, IR-006)：概率受性格好奇调制 (§9.6)。
    //    命中时用稀有动作周期替换常规周期，FSM 状态保持不变（preserveFsm）。
    if (micro) {
      const rareProbability = effectiveRareActionProbability(micro, this.config.personality)
      if (shouldInsertRareAction(rareProbability, this.config.rng)) {
        const rareState = pickRareAction(this.config.rareActions ?? [], this.config.rng)
        if (rareState) {
          const rareCycle = this.planRareActionCycle(rareState, micro, nowMs)
          if (rareCycle) return rareCycle
        }
      }
    }

    // 1. FSM 推进一步
    const nextState = fsm.step()

    // 2. 选择目标片段（§9.5 变体洗牌抽取, IR-006）
    const picker = this.createVariantPicker()
    const targetClip = selectClipForState(nextState, clips, picker)
    const isPlaceholder = isPlaceholderClip(targetClip)

    // 记录变体使用
    if (!isPlaceholder) {
      this.state = {
        ...this.state,
        variantTracker: recordVariantUse(
          this.state.variantTracker,
          nextState,
          targetClip.variant,
        ),
      }
    }

    // 3. 空闲间隔（§9.5 静止时长抖动, IR-006）
    const idleSchedule = scheduleIdle(
      nextState,
      clips,
      this.state.variantTracker,
      this.config.idleConfig,
    )
    const idleIntervalMs = micro
      ? jitteredIdleDuration(idleSchedule.intervalMs, micro.idleJitterSec, this.config.rng)
      : idleSchedule.intervalMs

    // §9.5 微随机参数：播放速率 / 出现位置 x（IR-006）
    const rand: RandomizationParams | null = micro
      ? generateRandomizationParams({
          config: micro,
          personality: this.config.personality,
          baseIdleIntervalMs: idleSchedule.intervalMs,
          baseX: this.state.petX,
          positionJitterPx: this.config.positionJitterPx ?? 0,
          // 稀有动作已在步骤 0 判定，此处不再重复掷签
          rareActions: [],
          rng: this.config.rng,
        })
      : null
    const playbackRate = rand?.playbackRate

    // 4. 规划锚定中转
    const fromContext = {
      state: this.state.fsmState as string,
      clip: this.state.lastClip,
    }
    const toContext = {
      state: nextState as string,
      clip: targetClip,
    }
    const plan = planStateTransition(
      fromContext,
      toContext,
      clips,
      this.config.planOptions,
    )

    // 5. 行走规划
    let walkPlanInfo: SchedulingCycle['walkPlan']
    if (nextState === 'walk') {
      const directionChoice = this.state.walkDirection
        ? { direction: this.state.walkDirection, forcedByEdge: false }
        : chooseWalkDirection(
            this.state.petX,
            this.config.workArea,
            clips,
            this.config.symmetrical,
            this.config.rng,
          )

      const track = this.resolveTrack(targetClip)
      if (track) {
        const wp = planWalk({
          currentX: this.state.petX,
          bounds: this.config.workArea,
          clips,
          track,
          symmetrical: this.config.symmetrical,
          displayedWidthPx: this.config.displayedWidthPx,
          direction: directionChoice.direction,
        })
        if (wp) {
          walkPlanInfo = {
            direction: wp.direction,
            mirrored: wp.mirrored,
            mapping: wp.mapping,
            clipDurationSec: wp.clipDurationSec,
          }
          // 更新行走方向（供边缘转身连续性）
          this.state = {
            ...this.state,
            walkDirection: directionAfterWalk(wp),
          }
        }
      }
    } else if (nextState === 'turn') {
      // 转身后重置行走方向
      if (this.state.walkDirection) {
        const newDir = this.state.walkDirection === 'left' ? 'right' : 'left'
        this.state = { ...this.state, walkDirection: newDir }
      }
    }

    // §9.5 出现位置 x 抖动 (IR-006)：非行走/非道具/非占位周期起步时微移窗口，
    // 与周期首条播放命令同批下发（同帧切换，读作姿态小移位）；
    // 道具周期跳过（§8.4 淡化期间窗口位置保持不动）。
    if (
      rand &&
      (this.config.positionJitterPx ?? 0) > 0 &&
      nextState !== 'walk' &&
      nextState !== 'turn' &&
      !targetClip.prop &&
      !isPlaceholder
    ) {
      const jitteredX = clampWindowX(this.config.workArea, rand.positionX, this.config.windowWidth)
      if (jitteredX !== this.state.petX) {
        this.state = { ...this.state, petX: jitteredX }
        this.pendingPositionSync = true
      }
    }

    // 6. 更新状态
    this.state = {
      ...this.state,
      fsmState: nextState,
      currentAnchor: fsm.anchor,
      showingPlaceholder: isPlaceholder,
    }

    return createSchedulingCycle({
      fromState: this.state.fsmState === nextState ? this.state.fsmState : this.state.fsmState,
      toState: nextState as string,
      plan,
      targetClip,
      getClipDurationSec,
      nowMs,
      walkPlan: walkPlanInfo,
      playbackRate,
      idleIntervalMs,
      isPlaceholder,
    })
  }

  /**
   * 规划稀有动作插入周期 (§9.5 第 2 条, IR-006)。
   *
   * 复用交互抢占式周期语义：播放稀有动作片段后回锚定态，
   * 全程不推进 FSM（preserveFsm），FSM 决策路径不受插入影响。
   * 无对应真实片段时返回 null（落回常规调度）。
   */
  private planRareActionCycle(
    rareState: string,
    micro: MicroRandomConfig,
    nowMs: number,
  ): SchedulingCycle | null {
    const { clips, getClipDurationSec } = this.deps

    const targetClip = selectClipForState(rareState, clips, this.createVariantPicker())
    if (isPlaceholderClip(targetClip)) return null

    const plan = planStateTransition(
      { state: this.state.fsmState as string, clip: this.state.lastClip },
      { state: rareState, clip: targetClip },
      clips,
      this.config.planOptions,
    )

    return createSchedulingCycle({
      fromState: this.state.fsmState as string,
      toState: rareState,
      plan,
      targetClip,
      getClipDurationSec,
      nowMs,
      playbackRate: jitteredPlaybackRate(micro.rateJitter, this.config.rng),
      idleIntervalMs: 0,
      isPlaceholder: false,
      preserveFsm: true,
    })
  }

  /**
   * 执行播放队列中当前项，产生渲染命令。
   */
  private executeQueueItem(
    cycle: SchedulingCycle,
    nowMs: number,
  ): { commands: RenderCommand[]; completed: boolean } {
    const commands: RenderCommand[] = []
    const item = currentItem(cycle.queue)

    if (item === null) {
      return { commands, completed: true }
    }

    switch (item.kind) {
      case 'play': {
        const clip = item.clip!
        commands.push({
          kind: 'play',
          clip,
          loop: clip.loop,
          mirrored: item.mirrored ?? false,
          anchor: this.renderAnchorFor(item, cycle),
          playbackRate: item.playbackRate ?? 1,
        })
        // 播放片段后更新锚定
        const anchor = resolveAnchorPose(cycle.toState, clip)
        this.state = { ...this.state, currentAnchor: anchor }
        break
      }
      case 'hold':
        commands.push({
          kind: 'hold',
          anchor: item.anchor!,
          durationMs: item.durationMs!,
        })
        break
      case 'fade_in':
        commands.push({
          kind: 'fade_in',
          clip: item.clip!,
          durationMs: item.durationMs!,
          mirrored: item.mirrored ?? false,
          anchor: this.renderAnchorFor(item, cycle),
          playbackRate: item.playbackRate ?? 1,
        })
        break
      case 'fade_out':
        commands.push({
          kind: 'fade_out',
          clip: item.clip!,
          durationMs: item.durationMs!,
        })
        break
      case 'easing':
        commands.push({
          kind: 'easing',
          durationMs: item.durationMs!,
          reason: item.reason ?? 'fallback easing',
        })
        break
    }

    // 检查此项是否瞬时完成（durationMs = 0 或队列只有一项且已完成）
    const completed = isCurrentItemDone(cycle.queue, nowMs)
    return { commands, completed }
  }

  /**
   * 空闲阶段保活目标片段 (IR-014)。
   *
   * - 无 lastClip（启动初期）→ idle_sit 锚定片段
   * - lastClip 为 walk/turn（结束于站立姿态的运动片段）→ 当前锚定片段：
   *   原地重播行走画面而窗口不平移会产生"太空步"，回锚定片段则姿态连续
   * - 其余（循环片段仍在循环 / 非循环锚定片段待重播）→ lastClip 原样
   */
  private keepAliveClip(): ClipMeta {
    const last = this.state.lastClip
    if (!last) return selectClipForState('idle_sit', this.deps.clips)
    if (last.state === 'walk' || last.state === 'turn') {
      return selectClipForState(ANCHOR_STATE[this.state.currentAnchor], this.deps.clips)
    }
    return last
  }

  /**
   * 计算播放项的渲染锚定姿态 (§6.2 逐片段锚点对齐, IR-002)。
   *
   * - 片段显式标注 sit/stand 锚定时以其为准 (§5.4 anchor)
   * - 目标片段 anchor='none'（纯循环段）时按其状态的锚定解析 (§4.2 起止模板)
   * - 过渡/锚定片段 anchor='none' 时延续当前锚定——过渡片段首帧
   *   与前一片段姿态衔接，锚定不变保证切换瞬间无纵向跳动
   */
  private renderAnchorFor(item: PlaybackItem, cycle: SchedulingCycle): AnchorPose {
    const clip = item.clip!
    if (clip.anchor === 'sit' || clip.anchor === 'stand') return clip.anchor
    if (item.role === 'target') return resolveAnchorPose(cycle.toState, clip)
    return this.state.currentAnchor
  }

  /**
   * 行走位移采样的时钟源 (IR-004)。
   *
   * 优先使用渲染端上报的媒体时间（video.currentTime）：窗口平移与实际
   * 显示帧严格同步，视频加载/解码延迟与播放速率抖动 (§9.5) 天然被吸收。
   * 上报缺失或超过 mediaTimeStaleMs 未更新时回退墙钟并记日志（每项一次）。
   */
  private walkElapsedSec(item: PlaybackItem, itemStartMs: number, nowMs: number): number {
    const staleMs = this.config.mediaTimeStaleMs ?? DEFAULT_MEDIA_TIME_STALE_MS
    const report = this.mediaTimeReport
    if (report && item.clip && report.clipId === item.clip.id && nowMs - report.atMs <= staleMs) {
      this.walkClockFallbackWarned = false
      return report.timeSec
    }
    if (!this.walkClockFallbackWarned) {
      this.walkClockFallbackWarned = true
      console.warn(
        `[scheduler] walk media time unavailable for "${item.clip?.id ?? '?'}", ` +
          `falling back to wall clock (IR-004)`,
      )
    }
    return (nowMs - itemStartMs) / 1000
  }

  /**
   * 调度周期完成后进入空闲阶段。
   *
   * preserveFsm 周期（§9.5 稀有动作插入）完成后保持 FSM 状态，
   * 经抢占式收尾回到锚定态 (IR-006)。
   */
  private transitionToIdle(cycle: SchedulingCycle, nowMs: number): SchedulerState {
    if (cycle.preserveFsm) {
      return this.transitionToIdlePreservingFsm(cycle, nowMs)
    }
    const clip = cycle.targetClip

    // 行走结束后更新 petX 到终点
    let petX = this.state.petX
    if (cycle.walkPlan) {
      // 使用行走映射计算终点
      const { mapping, clipDurationSec } = cycle.walkPlan
      petX = this.computeWalkX(mapping, clipDurationSec)
      petX = clampWindowX(this.config.workArea, petX, this.config.windowWidth)
    }

    return {
      ...this.state,
      phase: 'idle',
      cycle: null,
      lastClip: clip,
      fsmState: cycle.toState as BehaviorState,
      currentAnchor: resolveAnchorPose(cycle.toState, clip),
      petX,
      idleUntilMs: nowMs + cycle.idleIntervalMs,
      showingPlaceholder: cycle.isPlaceholder,
    }
  }

  /**
   * 交互抢占结束后进入空闲阶段（不修改 fsmState）。
   *
   * 交互片段结束后返回当前锚定态的片段作为 lastClip，
   * 保持 fsmState 不变以便从原 FSM 状态恢复正常调度。
   */
  private transitionToIdlePreservingFsm(cycle: SchedulingCycle, nowMs: number): SchedulerState {
    const anchor = resolveAnchorPose(cycle.toState, cycle.targetClip)
    const anchorState = ANCHOR_STATE[anchor]
    const anchorClip = selectClipForState(anchorState, this.deps.clips)

    return {
      ...this.state,
      phase: 'idle',
      cycle: null,
      lastClip: anchorClip,
      // fsmState 不变：交互结束后从原 FSM 状态恢复
      currentAnchor: anchor,
      idleUntilMs: nowMs,
      showingPlaceholder: false,
    }
  }

  /**
   * 计算行走映射在指定媒体时间的窗口 x。
   */
  private computeWalkX(mapping: NonNullable<PlaybackItem['walk']>, elapsedSec: number): number {
    return (
      mapping.startX +
      // walkWindowX would be ideal but we need to import it
      mapping.sign *
        this.walkDisplacementPx(mapping, elapsedSec) *
        mapping.scale
    )
  }

  /** 行走子段门控后的位移（曲线像素） */
  private walkDisplacementPx(
    mapping: NonNullable<PlaybackItem['walk']>,
    tSec: number,
  ): number {
    const { track, moveStartSec, moveEndSec } = mapping
    if (tSec <= moveStartSec) return 0
    const endFrame = Math.min(moveEndSec * track.fps, track.frameCount - 1)
    const startFrame = Math.min(moveStartSec * track.fps, track.frameCount - 1)
    const endValue = track.offsets[Math.floor(endFrame)] ?? track.offsets[track.offsets.length - 1]
    if (tSec >= moveEndSec) {
      return endValue - (track.offsets[Math.floor(startFrame)] ?? 0)
    }
    // 线性插值
    const frameFloat = Math.min(Math.max(tSec * track.fps, 0), track.frameCount - 1)
    const lo = Math.floor(frameFloat)
    const hi = Math.min(lo + 1, track.frameCount - 1)
    const frac = frameFloat - lo
    const sampleValue = track.offsets[lo] + (track.offsets[hi] - track.offsets[lo]) * frac
    return sampleValue - (track.offsets[Math.floor(startFrame)] ?? 0)
  }

  /**
   * 创建变体选择器 (§9.5 多变体, IR-006)。
   *
   * 启用微随机时使用洗牌袋（shuffle bag）：每个状态维护一袋洗牌后的变体，
   * 抽尽重洗；重洗后若首张与上次抽取相同则换到袋底，避免立即重复。
   * 未启用微随机时保持原均匀随机抽取。
   */
  private createVariantPicker(): VariantPicker {
    return (variants: readonly ClipMeta[]): ClipMeta => {
      if (variants.length <= 1) return variants[0]
      if (!this.config.microRandom) {
        const idx = Math.floor(this.config.rng() * variants.length)
        return variants[idx]
      }

      const key = variants[0].state
      let deck = this.variantDecks.get(key)
      if (!deck || deck.length === 0) {
        deck = shuffleVariants(variants, this.config.rng)
        const lastId = this.lastPickedClip.get(key)
        if (deck.length > 1 && lastId !== undefined && deck[0].id === lastId) {
          deck.push(deck.shift()!)
        }
        this.variantDecks.set(key, deck)
      }
      const picked = deck.shift()!
      this.lastPickedClip.set(key, picked.id)
      return picked
    }
  }

  /**
   * 解析片段的位移曲线。
   */
  private resolveTrack(clip: ClipMeta): TrackFile | undefined {
    if (!clip.track) return undefined
    return this.deps.tracks.get(clip.id)
  }

  /**
   * 崩溃恢复：重置回主锚定态 (§13)。
   */
  reset(nowMs: number): SchedulerState {
    this.deps.fsm.resetToAnchor()
    const startY = groundedWindowY(
      this.config.workArea.groundLine,
      this.config.spriteBaseY,
    )
    const startX = clampWindowX(
      this.config.workArea,
      Math.round(
        this.config.workArea.x + this.config.workArea.width / 2 - this.config.windowWidth / 2,
      ),
      this.config.windowWidth,
    )
    this.state = {
      phase: 'idle',
      cycle: null,
      lastClip: null,
      fsmState: this.deps.fsm.state,
      currentAnchor: this.deps.fsm.anchor,
      petX: startX,
      petY: startY,
      variantTracker: createVariantTracker(),
      walkDirection: null,
      idleUntilMs: nowMs,
      showingPlaceholder: false,
    }
    return this.state
  }
}
