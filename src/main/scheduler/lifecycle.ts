/**
 * 片段生命周期管理 (§9, §8)
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
import type { WalkWindowMapping } from '../../shared/spatial'
import type { WalkDirection } from '../../shared/spatial'

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
  /** 镜像播放（仅对称宠物，§4.3） */
  readonly mirrored?: boolean
  /** 行走映射（仅行走目标片段，§7.2） */
  readonly walk?: WalkWindowMapping
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
 * transition / anchor 片段等 play 步骤的 durationMs 取自片段时长参数。
 * hold / easing / fade 步骤有明确时长。
 *
 * @param plan 转移计划
 * @param getClipDurationSec 片段时长解析器 (秒)
 * @param targetClip 目标片段的额外播放信息（镜像、行走映射）
 */
export function buildPlaybackQueue(
  plan: TransitionPlan,
  getClipDurationSec: (clipId: string) => number,
  targetExtra?: {
    readonly mirrored?: boolean
    readonly walk?: WalkWindowMapping
  },
): readonly PlaybackItem[] {
  const items: PlaybackItem[] = []
  for (const step of plan.steps) {
    items.push(stepToItem(step, getClipDurationSec, targetExtra, step.role === 'target'))
  }
  return items
}

function stepToItem(
  step: TransitionStep,
  getClipDurationSec: (clipId: string) => number,
  targetExtra?: { readonly mirrored?: boolean; readonly walk?: WalkWindowMapping },
  isTarget?: boolean,
): PlaybackItem {
  switch (step.kind) {
    case 'play': {
      const clip = step.clip!
      // 目标片段可能携带镜像 / 行走映射信息
      const mirrored = isTarget ? targetExtra?.mirrored : undefined
      const walk = isTarget ? targetExtra?.walk : undefined
      // 循环目标片段由调度器的 idle interval 控制时长，durationMs = null
      // 非目标 play 步骤（过渡片段、锚定片段）按片段时长执行
      if (isTarget && clip.loop) {
        return {
          kind: 'play',
          clip,
          durationMs: null,
          mirrored,
          walk,
          role: step.role,
        }
      }
      const durSec = getClipDurationSec(clip.id)
      return {
        kind: 'play',
        clip,
        durationMs: Math.round(durSec * 1000),
        mirrored,
        walk,
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
  /** 行走信息（仅行走目标） */
  readonly walkPlan?: {
    readonly direction: WalkDirection
    readonly mirrored: boolean
    readonly mapping: WalkWindowMapping
    readonly clipDurationSec: number
  }
  /** 空闲间隔 (ms)，仅循环目标片段 */
  readonly idleIntervalMs: number
  /** 是否使用了占位片段 */
  readonly isPlaceholder: boolean
  /** 是否使用了 §8.3 兜底 */
  readonly usedFallback: boolean
}

/**
 * 构建调度周期：将转移计划 + 目标信息组装为可执行的播放队列。
 */
export function createSchedulingCycle(params: {
  readonly fromState: string
  readonly toState: string
  readonly plan: TransitionPlan
  readonly targetClip: ClipMeta
  readonly getClipDurationSec: (clipId: string) => number
  readonly nowMs: number
  readonly walkPlan?: {
    readonly direction: WalkDirection
    readonly mirrored: boolean
    readonly mapping: WalkWindowMapping
    readonly clipDurationSec: number
  }
  readonly idleIntervalMs: number
  readonly isPlaceholder: boolean
}): SchedulingCycle {
  const items = buildPlaybackQueue(
    params.plan,
    params.getClipDurationSec,
    params.walkPlan
      ? { mirrored: params.walkPlan.mirrored, walk: params.walkPlan.mapping }
      : undefined,
  )
  const queue = initPlaybackQueue(items, params.nowMs)
  return {
    fromState: params.fromState,
    toState: params.toState,
    plan: params.plan,
    targetClip: params.targetClip,
    queue,
    walkPlan: params.walkPlan,
    idleIntervalMs: params.idleIntervalMs,
    isPlaceholder: params.isPlaceholder,
    usedFallback: params.plan.usedFallback,
  }
}
