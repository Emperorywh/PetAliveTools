/**
 * 原样片段生命周期管理。
 *
 * 管理 Clip 生命周期循环：选择 → 转移计划 → 执行步骤 → 播放 → 下一个。
 *
 * 调度器在每次调度周期中将一个 TransitionPlan 的步骤展开为一个
 * "播放队列" (PlaybackQueue)，逐项执行。队列项是渲染层需执行的动作
 * （播放片段 / 锚定停留 / 兜底缓动 / 道具淡入淡出），每项有明确的
 * 持续时间或终止条件。
 *
 * 同锚定片段直接切换不经中间步骤，保证无视觉硬切 (§8.1)。
 *
 * 纯逻辑，无平台依赖。
 */

import type { ClipMeta } from '../../shared/types/clip-meta'
import type {
  TransitionPlan,
  TransitionStep,
  AnchorPose,
} from '../behavior/anchor-transition'

// —— 播放队列项 —— //

/** 播放队列项类型 */
export type PlaybackItemKind =
  | 'play' // 播放片段
  | 'hold' // 锚定停留 (§8.1)
  | 'fade_in' // 道具淡入 (§8.4)
  | 'fade_out' // 道具淡出 (§8.4)
  | 'easing' // 兜底缓动 (§8.3)

/** 播放队列项（渲染层需执行的动作） */
export interface PlaybackItem {
  readonly kind: PlaybackItemKind
  /** 涉及的片段（play / fade 步骤） */
  readonly clip?: ClipMeta
  /** 涉及的锚定（hold 步骤） */
  readonly anchor?: AnchorPose
  /** 持续时间 ms（有明确时长的步骤）；null = 播放至片段结束 */
  readonly durationMs: number | null
  /** §8.4：淡化期间窗口位置保持不动 */
  readonly holdPosition?: boolean
  /** 兜底原因（easing 步骤） */
  readonly reason?: string
  /** 在转移计划中的角色（调试用） */
  readonly role?: string
}

/** 播放队列 */
export interface PlaybackQueue {
  /** 队列项列表 */
  readonly items: readonly PlaybackItem[]
  /** 当前正在执行的项索引 */
  readonly currentIndex: number
  /** 当前项开始的时钟时间 (ms) */
  readonly currentItemStartMs: number
  /** 队列是否已全部执行完毕 */
  readonly completed: boolean
}

/**
 * 将转移计划步骤转换为播放队列项。
 *
 * 所有视频 play 步骤都等待渲染端 ended 事件；程序不探测视频时长。
 * hold / easing / fade 步骤仍有明确的界面持续时间。
 *
 * @param plan 转移计划
 */
export function buildPlaybackQueue(
  plan: TransitionPlan,
): readonly PlaybackItem[] {
  const items: PlaybackItem[] = []
  for (const step of plan.steps) {
    items.push(stepToItem(step))
  }
  return items
}

function stepToItem(
  step: TransitionStep,
): PlaybackItem {
  switch (step.kind) {
    case 'play': {
      const clip = step.clip!
      return {
        kind: 'play',
        clip,
        durationMs: null,
        role: step.role,
      }
    }
    case 'hold':
      return {
        kind: 'hold',
        anchor: step.anchor,
        durationMs: step.durationMs!,
        role: step.role,
      }
    case 'fade_in':
      return {
        kind: 'fade_in',
        clip: step.clip,
        durationMs: step.durationMs!,
        holdPosition: step.holdPosition,
        role: step.role,
      }
    case 'fade_out':
      return {
        kind: 'fade_out',
        clip: step.clip,
        durationMs: step.durationMs!,
        holdPosition: step.holdPosition,
        role: step.role,
      }
    case 'easing':
      return {
        kind: 'easing',
        durationMs: step.durationMs!,
        reason: step.reason,
        role: step.role,
      }
  }
}

/**
 * 初始化播放队列。
 */
export function initPlaybackQueue(
  items: readonly PlaybackItem[],
  nowMs: number,
): PlaybackQueue {
  if (items.length === 0) {
    return { items, currentIndex: 0, currentItemStartMs: nowMs, completed: true }
  }
  return { items, currentIndex: 0, currentItemStartMs: nowMs, completed: false }
}

/**
 * 获取当前正在执行的项。
 */
export function currentItem(queue: PlaybackQueue): PlaybackItem | null {
  if (queue.completed) return null
  return queue.items[queue.currentIndex] ?? null
}

/**
 * 判断当前项是否已完成。
 *
 * - durationMs = null 的 play 项由外部（调度器）标记完成
 * - 其余项按 now - start >= durationMs 判断
 */
export function isCurrentItemDone(queue: PlaybackQueue, nowMs: number): boolean {
  const item = currentItem(queue)
  if (item === null) return true
  if (item.durationMs === null) return false
  return nowMs - queue.currentItemStartMs >= item.durationMs
}

/**
 * 推进到下一项。
 *
 * 已是最后一项时标记为 completed。
 */
export function advanceQueue(queue: PlaybackQueue, nowMs: number): PlaybackQueue {
  const nextIndex = queue.currentIndex + 1
  if (nextIndex >= queue.items.length) {
    return { ...queue, completed: true }
  }
  return {
    ...queue,
    currentIndex: nextIndex,
    currentItemStartMs: nowMs,
  }
}

/**
 * 强制标记当前项完成（用于 durationMs=null 的 play 项由外部控制）。
 */
export function completeCurrentItem(queue: PlaybackQueue, nowMs: number): PlaybackQueue {
  return advanceQueue(queue, nowMs)
}

// —— 调度周期 —— //

/** 一个完整的调度周期（从当前状态到目标状态的转移 + 目标片段播放） */
export interface SchedulingCycle {
  /** 起始 FSM 状态 */
  readonly fromState: string
  /** 目标 FSM 状态 */
  readonly toState: string
  /** 转移计划 */
  readonly plan: TransitionPlan
  /** 目标片段 */
  readonly targetClip: ClipMeta
  /** 播放队列 */
  readonly queue: PlaybackQueue
  /** 空闲间隔 (ms)，仅循环目标片段 */
  readonly idleIntervalMs: number
  /** 是否使用了占位片段 */
  readonly isPlaceholder: boolean
  /** 是否使用了 §8.3 兜底 */
  readonly usedFallback: boolean
  /**
   * 完成后保持 FSM 状态不变（§9.5 稀有动作插入 / 交互抢占式周期）。
   *
   * true 时调度器在周期完成后经 transitionToIdlePreservingFsm 回到
   * 锚定态，不推进 fsmState——FSM 决策路径不受插入动作影响。
   */
  readonly preserveFsm?: boolean
}

/**
 * 构建调度周期：将转移计划 + 目标信息组装为可执行的播放队列。
 */
export function createSchedulingCycle(params: {
  readonly fromState: string
  readonly toState: string
  readonly plan: TransitionPlan
  readonly targetClip: ClipMeta
  readonly nowMs: number
  readonly idleIntervalMs: number
  readonly isPlaceholder: boolean
  /** 完成后保持 FSM 状态（稀有动作插入，§9.5） */
  readonly preserveFsm?: boolean
}): SchedulingCycle {
  const items = buildPlaybackQueue(params.plan)
  const queue = initPlaybackQueue(items, params.nowMs)
  return {
    fromState: params.fromState,
    toState: params.toState,
    plan: params.plan,
    targetClip: params.targetClip,
    queue,
    idleIntervalMs: params.idleIntervalMs,
    isPlaceholder: params.isPlaceholder,
    usedFallback: params.plan.usedFallback,
    preserveFsm: params.preserveFsm,
  }
}
