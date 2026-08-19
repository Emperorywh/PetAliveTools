/**
 * 原样片段调度器。
 *
 * 调度器只选择文件并等待渲染端的 ended 事件；它不读取视频时间、
 * 不修改播放速率、不镜像片段，也不根据视频内容移动窗口。
 * 行走位移由外壳按墙钟恒速驱动（§7.3），不依赖媒体时间。
 */

import type { ClipMeta } from '../../shared/types/clip-meta'
import type { MicroRandomConfig, BehaviorConfig } from '../../shared/types/behavior-config'
import type { Personality } from '../../shared/types/persona'
import type { NeedsState } from '../../shared/types/needs-state'
import { emotionCandidateGroups } from '../behavior/needs'
import { BehaviorFsm, type BehaviorState } from '../behavior/fsm'
import { selectClipForState, getClipVariants, type VariantPicker } from '../behavior/state-lookup'
import {
  planStateTransition,
  resolveAnchorPose,
  ANCHOR_STATE,
  clampPropFadeMs,
  DEFAULT_PROP_FADE_MS,
  type AnchorPose,
  type PlanOptions,
  type TransitionPlan,
  type TransitionStep,
} from '../behavior/anchor-transition'
import { isPlaceholderClip } from '../persistence/placeholder'
import {
  type SchedulingCycle,
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
  effectiveRareActionProbability,
  shouldInsertRareAction,
  pickRareAction,
  jitteredIdleDuration,
  shuffleVariants,
} from './randomization'

/** 情绪动作插入的默认冷却时长 (ms)：同一情绪动作两次插入的最小间隔 */
export const DEFAULT_EMOTION_COOLDOWN_MS = 180_000

/**
 * 调度配置保留行为随机性和锚定中转。
 * 与视频画面、分辨率、轨迹和桌面位移有关的配置已经移除。
 */
export interface ClipSchedulerConfig {
  readonly idleConfig: IdleScheduleConfig
  readonly planOptions: PlanOptions
  readonly rng: () => number
  readonly microRandom?: MicroRandomConfig
  readonly personality?: Personality
  readonly rareActions?: readonly string[]
  /** 需求状态提供者：非空时按 §9.4 阈值插入情绪动作（讨食/喝水/开心/无聊/求玩） */
  readonly needsProvider?: () => NeedsState | null
  /** 情绪动作冷却时长 ms，缺省 DEFAULT_EMOTION_COOLDOWN_MS */
  readonly emotionCooldownMs?: number
}

/**
 * 调度器只依赖行为状态机和直接扫描得到的片段列表。
 * 不再注入 TrackFile 或视频时长解析器。
 */
export interface ClipSchedulerDeps {
  readonly fsm: BehaviorFsm
  readonly clips: readonly ClipMeta[]
}

/**
 * 渲染命令只包含文件播放和界面过渡。
 * 已删除 update_position、mirrored 和 playbackRate 字段。
 */
export type RenderCommand =
  | { kind: 'play'; clip: ClipMeta; loop: boolean }
  | { kind: 'hold'; anchor: AnchorPose; durationMs: number }
  | { kind: 'fade_in'; clip: ClipMeta; durationMs: number }
  | { kind: 'fade_out'; clip: ClipMeta; durationMs: number }
  | { kind: 'easing'; durationMs: number; reason: string }
  | { kind: 'idle'; clip: ClipMeta; intervalMs: number }

/**
 * 调度器状态只描述行为与播放队列。
 * 不再保存宠物窗口坐标、行走方向或媒体时钟快照。
 */
export interface SchedulerState {
  readonly phase: 'idle' | 'cycling'
  readonly cycle: SchedulingCycle | null
  readonly lastClip: ClipMeta | null
  readonly fsmState: BehaviorState
  readonly currentAnchor: AnchorPose
  /** 当前朝向：walk/turn 片段方向驱动的连续朝向记忆（供行走位移方向使用） */
  readonly facing: 'left' | 'right'
  readonly variantTracker: VariantTracker
  readonly idleUntilMs: number
  readonly showingPlaceholder: boolean
}

/**
 * 单次调度推进结果。
 * 窗口位置字段已经移除，因为视频不再驱动桌面位移。
 */
export interface TickResult {
  readonly state: SchedulerState
  readonly commands: readonly RenderCommand[]
  readonly cycleStarted: boolean
  readonly cycleCompleted: boolean
}

/**
 * 连接行为 FSM 与原样文件播放器。
 * video play 项只能由 ended 事件或循环超时显式完成。
 */
export class ClipScheduler {
  private state: SchedulerState
  private readonly variantDecks = new Map<string, ClipMeta[]>()
  private readonly lastPickedClip = new Map<string, string>()
  /** 情绪动作冷却：state → 上次插入时刻 (ms) */
  private readonly lastEmotionAtMs = new Map<string, number>()

  constructor(
    private readonly deps: ClipSchedulerDeps,
    private readonly config: ClipSchedulerConfig,
    initialState?: Partial<SchedulerState>,
  ) {
    this.state = {
      phase: 'idle',
      cycle: null,
      lastClip: null,
      fsmState: deps.fsm.state,
      currentAnchor: deps.fsm.anchor,
      facing: 'right',
      variantTracker: createVariantTracker(),
      idleUntilMs: 0,
      showingPlaceholder: false,
      ...initialState,
    }
  }

  /**
   * 返回不可变状态快照。
   * 主进程用它核对 ended 事件是否属于当前片段。
   */
  get snapshot(): SchedulerState {
    return this.state
  }

  /**
   * 判断当前是否正在播放整段循环片段。
   * 非循环视频即使 durationMs 为 null，也不会被循环超时逻辑误判。
   */
  get isPlayingLoop(): boolean {
    const item = this.state.cycle ? currentItem(this.state.cycle.queue) : null
    return item?.kind === 'play' && item.clip?.loop === true
  }

  /**
   * 热更新行为权重而不中断当前文件。
   * 更新只影响后续状态选择。
   */
  updateFsmConfig(config: BehaviorConfig): void {
    this.deps.fsm.updateConfig(config)
  }

  /**
   * 推进固定时长的 hold/fade/easing 步骤。
   * 视频步骤不按墙钟推断时长，必须等待 ended 通知。
   */
  tick(nowMs: number): TickResult {
    const commands: RenderCommand[] = []
    let cycleStarted = false
    let cycleCompleted = false

    if (this.state.phase === 'idle') {
      if (nowMs >= this.state.idleUntilMs) {
        const cycle = this.planNextCycle(nowMs)
        this.state = { ...this.state, phase: 'cycling', cycle }
        cycleStarted = true
        const result = this.executeQueueItem(cycle, nowMs)
        commands.push(...result.commands)
        if (result.completed) {
          cycleCompleted = true
          this.state = this.transitionToIdle(cycle, nowMs)
        }
      } else {
        commands.push({
          kind: 'idle',
          clip: this.keepAliveClip(),
          intervalMs: Math.max(0, this.state.idleUntilMs - nowMs),
        })
      }
    } else if (this.state.cycle && isCurrentItemDone(this.state.cycle.queue, nowMs)) {
      const advanced = this.advanceCurrentCycle(this.state.cycle, nowMs)
      commands.push(...advanced.commands)
      cycleCompleted = advanced.completed
    }

    return { state: this.state, commands, cycleStarted, cycleCompleted }
  }

  /**
   * 完成当前视频步骤。
   * 非循环文件由 ended 事件调用，循环文件由外壳的整段循环停留策略调用。
   */
  completeCurrentPlayback(nowMs: number): TickResult {
    if (this.state.phase !== 'cycling' || !this.state.cycle) {
      return this.result([], false, false)
    }

    const cycle = this.state.cycle
    const queue = completeCurrentItem(cycle.queue, nowMs)
    const updated = { ...cycle, queue }
    this.state = { ...this.state, cycle: updated }
    if (queue.completed) {
      this.state = this.transitionToIdle(updated, nowMs)
      return this.result([], false, true)
    }

    const executed = this.executeQueueItem(updated, nowMs)
    if (executed.completed) {
      this.state = this.transitionToIdle(updated, nowMs)
    }
    return this.result(executed.commands, false, executed.completed)
  }

  /**
   * 立即切换到交互动作片段。
   * 交互片段同样按原文件完整播放。
   */
  preempt(targetState: string, nowMs: number): TickResult {
    const targetClip = selectClipForState(targetState, this.deps.clips)
    const plan = planStateTransition(
      { state: this.state.fsmState, clip: this.state.lastClip },
      { state: targetState, clip: targetClip },
      this.deps.clips,
      this.config.planOptions,
    )
    const cycle = createSchedulingCycle({
      fromState: this.state.fsmState,
      toState: targetState,
      plan,
      targetClip,
      nowMs,
      idleIntervalMs: 0,
      isPlaceholder: isPlaceholderClip(targetClip),
      preserveFsm: true,
    })
    this.state = { ...this.state, phase: 'cycling', cycle }
    const executed = this.executeQueueItem(cycle, nowMs)
    if (executed.completed) this.state = this.transitionToIdlePreservingFsm(cycle, nowMs)
    return this.result(executed.commands, true, executed.completed)
  }

  /**
   * 立即抢占播放调用方指定的具体片段（导入向导的桌面调试预览）。
   *
   * 与交互 preempt 的区别：目标片段显式给定（用于检查具体变体文件），
   * 且不做转移规划——播放队列只有这一个 play 步骤，点击后立即呈现
   * 该文件本身。周期完成后同样经 preserveFsm 回到锚定态，
   * 不打断 FSM 决策路径。
   */
  preemptClip(clip: ClipMeta, nowMs: number): TickResult {
    const plan: TransitionPlan = {
      from: this.state.fsmState,
      to: clip.state,
      steps: [{ kind: 'play', role: 'target', clip }],
      crossAnchor: false,
      anchors: { from: this.state.currentAnchor, to: resolveAnchorPose(clip.state, clip) },
      usedFallback: false,
    }
    const cycle = createSchedulingCycle({
      fromState: this.state.fsmState,
      toState: clip.state,
      plan,
      targetClip: clip,
      nowMs,
      idleIntervalMs: 0,
      isPlaceholder: isPlaceholderClip(clip),
      preserveFsm: true,
    })
    this.state = { ...this.state, phase: 'cycling', cycle }
    const executed = this.executeQueueItem(cycle, nowMs)
    if (executed.completed) this.state = this.transitionToIdlePreservingFsm(cycle, nowMs)
    return this.result(executed.commands, true, executed.completed)
  }

  /**
   * 结束循环交互并回到当前锚定状态。
   * 不对正在使用的媒体文件做任何修改。
   */
  endPreempt(nowMs: number): TickResult {
    if (this.state.phase === 'cycling' && this.state.cycle) {
      const cycle = {
        ...this.state.cycle,
        queue: { ...this.state.cycle.queue, completed: true },
      }
      this.state = this.transitionToIdlePreservingFsm(cycle, nowMs)
    }
    return this.result([], false, false)
  }

  /**
   * 规划下一个普通行为周期。
   * 微随机只保留变体、空闲时长与稀有动作，不再改变视频速率或位置。
   * 插入优先级：稀有招牌动作 → 需求驱动的情绪动作 → FSM 概率转移。
   */
  private planNextCycle(nowMs: number): SchedulingCycle {
    const micro = this.config.microRandom
    if (micro) {
      const probability = effectiveRareActionProbability(micro, this.config.personality)
      if (shouldInsertRareAction(probability, this.config.rng)) {
        const state = pickRareAction(this.config.rareActions ?? [], this.config.rng)
        const rare = state ? this.planInsertedActionCycle(state, nowMs) : null
        if (rare) return rare
      }
    }

    const emotion = this.planEmotionCycle(nowMs)
    if (emotion) return emotion

    const fromState = this.state.fsmState
    const nextState = this.deps.fsm.step()
    const targetClip = this.selectTargetClip(nextState)
    const isPlaceholder = isPlaceholderClip(targetClip)
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

    const idle = scheduleIdle(
      nextState,
      this.deps.clips,
      this.state.variantTracker,
      this.config.idleConfig,
    )
    const idleIntervalMs = micro
      ? jitteredIdleDuration(idle.intervalMs, micro.idleJitterSec, this.config.rng)
      : idle.intervalMs
    const plan = planStateTransition(
      { state: fromState, clip: this.state.lastClip },
      { state: nextState, clip: targetClip },
      this.deps.clips,
      this.config.planOptions,
    )
    this.state = {
      ...this.state,
      fsmState: nextState,
      currentAnchor: this.deps.fsm.anchor,
      showingPlaceholder: isPlaceholder,
    }
    return createSchedulingCycle({
      fromState,
      toState: nextState,
      plan,
      targetClip,
      nowMs,
      idleIntervalMs,
      isPlaceholder,
    })
  }

  /**
   * 按当前需求规划情绪动作周期 (§9.4 情绪表达)。
   *
   * 情绪动作（讨食/喝水/开心/无聊/求玩）不在 FSM 边表内，
   * 在空闲调度点按需求阈值插入，带每动作冷却，避免同一情绪反复刷屏。
   * 组内（如讨食/喝水）在有真实片段的候选中随机取一。
   */
  private planEmotionCycle(nowMs: number): SchedulingCycle | null {
    const needs = this.config.needsProvider?.() ?? null
    if (!needs) return null
    const cooldownMs = this.config.emotionCooldownMs ?? DEFAULT_EMOTION_COOLDOWN_MS
    for (const states of emotionCandidateGroups(needs)) {
      const available = states.filter((state) => {
        const last = this.lastEmotionAtMs.get(state) ?? -Infinity
        if (nowMs - last < cooldownMs) return false
        return getClipVariants(state, this.deps.clips).length > 0
      })
      if (available.length === 0) continue
      const state = available[Math.floor(this.config.rng() * available.length)]!
      const cycle = this.planInsertedActionCycle(state, nowMs)
      if (cycle) {
        this.lastEmotionAtMs.set(state, nowMs)
        return cycle
      }
    }
    return null
  }

  /**
   * 为目标状态选择片段，带朝向连续性 (§9.5 方向变体)。
   *
   * walk / turn 优先选择与当前朝向同向的左右片段，使"转身后行走方向"
   * 与画面一致；无同向片段时退回任意方向片段。选中带方向的片段后
   * 朝向随之更新（转身片段无方向信息时翻转朝向）。
   * 其余状态沿用变体洗牌选择器。
   */
  private selectTargetClip(state: string): ClipMeta {
    if (state !== 'walk' && state !== 'turn') {
      return selectClipForState(state, this.deps.clips, this.createVariantPicker())
    }
    const variants = getClipVariants(state, this.deps.clips)
    if (variants.length === 0) return selectClipForState(state, this.deps.clips)
    const directional = variants.filter((v) => v.direction === 'left' || v.direction === 'right')
    let pool =
      directional.length > 0
        ? directional.filter((v) => v.direction === this.state.facing)
        : variants
    if (pool.length === 0) pool = directional
    const picked = pool[Math.floor(this.config.rng() * pool.length)]!
    if (picked.direction === 'left' || picked.direction === 'right') {
      this.state = { ...this.state, facing: picked.direction }
    } else if (state === 'turn') {
      this.state = { ...this.state, facing: this.state.facing === 'left' ? 'right' : 'left' }
    }
    return picked
  }

  /**
   * 构造不推进 FSM 的插入动作周期（稀有招牌 / 情绪表达共用）。
   * 插入动作也按原始片段完整播放；道具类（sig_ 招牌）目标
   * 追加 §8.4 淡出回锚定步骤。
   */
  private planInsertedActionCycle(state: string, nowMs: number): SchedulingCycle | null {
    const targetClip = selectClipForState(state, this.deps.clips, this.createVariantPicker())
    if (isPlaceholderClip(targetClip)) return null
    const plan = planStateTransition(
      { state: this.state.fsmState, clip: this.state.lastClip },
      { state, clip: targetClip },
      this.deps.clips,
      this.config.planOptions,
    )
    const steps: readonly TransitionStep[] = targetClip.prop
      ? [
          ...plan.steps,
          {
            kind: 'fade_out',
            role: 'return_to_anchor',
            clip: targetClip,
            durationMs: clampPropFadeMs(
              this.config.planOptions.propFadeMs ?? DEFAULT_PROP_FADE_MS,
            ),
            holdPosition: true,
          },
        ]
      : plan.steps
    return createSchedulingCycle({
      fromState: this.state.fsmState,
      toState: state,
      plan: { ...plan, steps },
      targetClip,
      nowMs,
      idleIntervalMs: 0,
      isPlaceholder: false,
      preserveFsm: true,
    })
  }

  /**
   * 执行当前队列项并生成最小渲染命令。
   * play 命令不附带任何媒体处理参数。
   */
  private executeQueueItem(
    cycle: SchedulingCycle,
    nowMs: number,
  ): { commands: RenderCommand[]; completed: boolean } {
    const item = currentItem(cycle.queue)
    if (!item) return { commands: [], completed: true }
    const commands: RenderCommand[] = []
    switch (item.kind) {
      case 'play': {
        const clip = item.clip!
        commands.push({ kind: 'play', clip, loop: clip.loop })
        this.state = {
          ...this.state,
          currentAnchor: resolveAnchorPose(cycle.toState, clip),
        }
        break
      }
      case 'hold':
        commands.push({ kind: 'hold', anchor: item.anchor!, durationMs: item.durationMs! })
        break
      case 'fade_in':
        commands.push({ kind: 'fade_in', clip: item.clip!, durationMs: item.durationMs! })
        break
      case 'fade_out':
        commands.push({ kind: 'fade_out', clip: item.clip!, durationMs: item.durationMs! })
        break
      case 'easing':
        commands.push({
          kind: 'easing',
          durationMs: item.durationMs!,
          reason: item.reason ?? 'fallback easing',
        })
        break
    }
    return { commands, completed: isCurrentItemDone(cycle.queue, nowMs) }
  }

  /**
   * 推进当前周期并执行下一项。
   * 周期结束时统一转回空闲状态。
   */
  private advanceCurrentCycle(
    cycle: SchedulingCycle,
    nowMs: number,
  ): { commands: readonly RenderCommand[]; completed: boolean } {
    const queue = advanceQueue(cycle.queue, nowMs)
    const updated = { ...cycle, queue }
    this.state = { ...this.state, cycle: updated }
    if (queue.completed) {
      this.state = this.transitionToIdle(updated, nowMs)
      return { commands: [], completed: true }
    }
    const executed = this.executeQueueItem(updated, nowMs)
    if (executed.completed) this.state = this.transitionToIdle(updated, nowMs)
    return { commands: executed.commands, completed: executed.completed }
  }

  /**
   * 普通周期完成后进入空闲阶段。
   * 不再计算行走终点或修改窗口坐标。
   */
  private transitionToIdle(cycle: SchedulingCycle, nowMs: number): SchedulerState {
    if (cycle.preserveFsm) return this.transitionToIdlePreservingFsm(cycle, nowMs)
    return {
      ...this.state,
      phase: 'idle',
      cycle: null,
      lastClip: cycle.targetClip,
      fsmState: cycle.toState as BehaviorState,
      currentAnchor: resolveAnchorPose(cycle.toState, cycle.targetClip),
      idleUntilMs: nowMs + cycle.idleIntervalMs,
      showingPlaceholder: cycle.isPlaceholder,
    }
  }

  /**
   * 插入动作完成后回到原 FSM 锚定片段。
   * 只切换文件，不处理视频内容。
   */
  private transitionToIdlePreservingFsm(
    cycle: SchedulingCycle,
    nowMs: number,
  ): SchedulerState {
    const anchor = resolveAnchorPose(cycle.toState, cycle.targetClip)
    const anchorClip = selectClipForState(ANCHOR_STATE[anchor], this.deps.clips)
    return {
      ...this.state,
      phase: 'idle',
      cycle: null,
      lastClip: anchorClip,
      currentAnchor: anchor,
      idleUntilMs: nowMs,
      showingPlaceholder: false,
    }
  }

  /**
   * 空闲保活时避免重复播放行走或转身文件。
   * 这只选择另一个原始片段，不做画面稳定或位移补偿。
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
   * 创建同状态片段的洗牌选择器。
   * 随机化只改变选择哪个文件，不改变文件播放方式。
   */
  private createVariantPicker(): VariantPicker {
    return (variants) => {
      if (variants.length <= 1) return variants[0]
      if (!this.config.microRandom) {
        return variants[Math.floor(this.config.rng() * variants.length)]
      }
      const key = variants[0].state
      let deck = this.variantDecks.get(key)
      if (!deck || deck.length === 0) {
        deck = shuffleVariants(variants, this.config.rng)
        const lastId = this.lastPickedClip.get(key)
        if (deck.length > 1 && lastId && deck[0].id === lastId) deck.push(deck.shift()!)
        this.variantDecks.set(key, deck)
      }
      const picked = deck.shift()!
      this.lastPickedClip.set(key, picked.id)
      return picked
    }
  }

  /**
   * 崩溃恢复时重置行为调度状态。
   * 不触碰项目中的任何视频文件。
   */
  reset(nowMs: number): SchedulerState {
    this.deps.fsm.resetToAnchor()
    this.state = {
      phase: 'idle',
      cycle: null,
      lastClip: null,
      fsmState: this.deps.fsm.state,
      currentAnchor: this.deps.fsm.anchor,
      facing: 'right',
      variantTracker: createVariantTracker(),
      idleUntilMs: nowMs,
      showingPlaceholder: false,
    }
    return this.state
  }

  /**
   * 统一构造返回值，避免各分支重复状态快照。
   * 返回值中不再包含窗口坐标。
   */
  private result(
    commands: readonly RenderCommand[],
    cycleStarted: boolean,
    cycleCompleted: boolean,
  ): TickResult {
    return { state: this.state, commands, cycleStarted, cycleCompleted }
  }
}
