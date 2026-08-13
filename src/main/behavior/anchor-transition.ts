/**
 * 动作连续性：锚定姿态中转机制 (§8)
 *
 * §8.1 双锚定：状态切换不直接 A→B，而是经锚定（端坐/站立）中转：
 *   当前片段 → [收尾到锚定] → 锚定(可短暂停留) → [目标片段从锚定起始] → 目标动作
 *   - 同锚定切换（如端坐→理毛）：直接经该锚定中转。
 *   - 跨锚定切换（如端坐→行走）：先播放过渡片段换锚定再进入目标。
 * §8.2 循环片段（理毛/睡眠/趴卧）：进入/退出经独立过渡片段：
 *   锚定 → 进入过渡(趴下) → 循环 → 退出过渡(起身) → 锚定。
 * §8.3 兜底过渡：锚定中转不可用（缺过渡片段）时，在切换点加 60–120ms
 *   极短淡入/位置缓动，不依赖额外素材。
 * §8.4 道具类片段（prop: true）：不走锚定中转，进/出用 150–250ms 淡入淡出，
 *   淡化期间窗口位置保持不动；播放完毕先回锚定再调度下一动作。
 *
 * 本模块输出"转移计划"——供调度器 (TASK-011) 顺序执行的步骤列表；
 * 不负责片段播放与窗口位移本身。
 * 纯逻辑，无平台依赖。
 */

import type { ClipMeta } from '../../shared/types/clip-meta'
import type { BehaviorState } from './fsm'
import { findTransitionClip, selectClipForState } from './state-lookup'
import type { TransitionEndpoint } from './state-lookup'

/** 锚定姿态 (§4.2 双锚定：端坐主锚定 / 站立副锚定) */
export type AnchorPose = 'sit' | 'stand'

/** 基础生命状态 → 中转锚定 (§4.2 起止模板) */
export const STATE_ANCHORS: Readonly<Record<BehaviorState, AnchorPose>> = {
  idle_sit: 'sit',
  stand: 'stand',
  walk: 'stand',
  turn: 'stand',
  lie: 'sit',
  sleep: 'sit',
  groom: 'sit',
}

/** 锚定姿态 → 对应的锚定状态片段 */
export const ANCHOR_STATE: Readonly<Record<AnchorPose, BehaviorState>> = {
  sit: 'idle_sit',
  stand: 'stand',
}

/** 需经独立过渡片段进出的循环状态 (§8.2) */
export const LOOP_FRAGMENT_STATES: ReadonlySet<string> = new Set(['lie', 'sleep', 'groom'])

/** 判断是否为循环片段状态（进入/退出须经过渡，§8.2） */
export function isLoopFragmentState(state: string): boolean {
  return LOOP_FRAGMENT_STATES.has(state)
}

/**
 * 解析任意状态的中转锚定。
 *
 * 基础生命状态查 §4.2 起止模板；其余状态（互动/情绪等）取片段
 * 标注的锚定；无标注时回落主锚定端坐。
 */
export function resolveAnchorPose(state: string, clip: ClipMeta): AnchorPose {
  if (state in STATE_ANCHORS) return STATE_ANCHORS[state as BehaviorState]
  return clip.anchor === 'stand' ? 'stand' : 'sit'
}

// —— §8.3 / §8.4 时长边界 —— //

/** §8.3 兜底缓动时长范围 (ms) */
export const FALLBACK_EASING_MS_RANGE = [60, 120] as const
/** §8.3 兜底缓动默认时长 (ms) */
export const DEFAULT_FALLBACK_EASING_MS = 90
/** §8.4 道具淡入淡出时长范围 (ms) */
export const PROP_FADE_MS_RANGE = [150, 250] as const
/** §8.4 道具淡入淡出默认时长 (ms) */
export const DEFAULT_PROP_FADE_MS = 200

function clampToRange(ms: number, range: readonly [number, number]): number {
  return Math.min(Math.max(ms, range[0]), range[1])
}

/** 兜底缓动时长钳制到 §8.3 规定的 60–120ms（设置微调入口） */
export function clampFallbackEasingMs(ms: number): number {
  return clampToRange(ms, FALLBACK_EASING_MS_RANGE)
}

/** 道具淡入淡出时长钳制到 §8.4 规定的 150–250ms（设置微调入口） */
export function clampPropFadeMs(ms: number): number {
  return clampToRange(ms, PROP_FADE_MS_RANGE)
}

// —— 转移计划 —— //

/** 步骤类型 */
export type TransitionStepKind =
  | 'play' // 播放片段（锚定中转路径 / 目标片段）
  | 'fade_in' // §8.4 道具淡入
  | 'fade_out' // §8.4 道具淡出
  | 'easing' // §8.3 兜底缓动
  | 'hold' // §8.1 锚定短暂停留

/** 步骤在中转机制中的角色 */
export type StepRole =
  | 'cross_anchor' // §8.1 跨锚定过渡片段（坐↔站）
  | 'enter_loop' // §8.2 循环进入过渡
  | 'exit_loop' // §8.2 循环退出过渡
  | 'return_to_anchor' // §8.4 道具淡出后回锚定
  | 'fallback' // §8.3 兜底
  | 'anchor_hold' // §8.1 锚定停留
  | 'target' // 目标片段

/** 转移计划中的单步 */
export interface TransitionStep {
  readonly kind: TransitionStepKind
  readonly role: StepRole
  /** 涉及的片段（play / fade 步骤） */
  readonly clip?: ClipMeta
  /** 涉及的锚定（hold 步骤） */
  readonly anchor?: AnchorPose
  /** 时长 ms（easing / hold / fade 步骤） */
  readonly durationMs?: number
  /** §8.4：淡化期间窗口位置保持不动 */
  readonly holdPosition?: boolean
  /** 兜底原因（easing 步骤） */
  readonly reason?: string
}

/** 转移计划：调度器按序执行的步骤列表 */
export interface TransitionPlan {
  /** 起始状态 */
  readonly from: string
  /** 目标状态 */
  readonly to: string
  /** 步骤列表 */
  readonly steps: readonly TransitionStep[]
  /** 是否发生跨锚定（§8.1） */
  readonly crossAnchor: boolean
  /** 起始/目标中转锚定 */
  readonly anchors: { readonly from: AnchorPose; readonly to: AnchorPose }
  /** 是否使用了 §8.3 兜底（缺过渡片段） */
  readonly usedFallback: boolean
}

/** 转移一侧的上下文 */
export interface PlanContext {
  /** FSM 状态键 */
  readonly state: string
  /** 实际播放的片段；缺省由状态解析（含占位兜底） */
  readonly clip?: ClipMeta | null
}

/** 转移计划选项 */
export interface PlanOptions {
  /** §8.3 兜底缓动时长 ms（钳制到 60–120） */
  readonly easingMs?: number
  /** §8.4 道具淡入淡出时长 ms（钳制到 150–250） */
  readonly propFadeMs?: number
  /** §8.1 锚定停留时长 ms；> 0 时在跨锚定后插入 hold 步骤 */
  readonly holdAnchorMs?: number
}

/**
 * 规划状态转移的播放步骤 (§8)。
 *
 * @param current 当前上下文（状态 + 实际片段）
 * @param target 目标上下文
 * @param clips 已入库片段（查找过渡片段与锚定片段）
 * @param options 时长选项
 */
export function planStateTransition(
  current: PlanContext,
  target: PlanContext,
  clips: readonly ClipMeta[],
  options: PlanOptions = {},
): TransitionPlan {
  const curClip = current.clip ?? selectClipForState(current.state, clips)
  const tgtClip = target.clip ?? selectClipForState(target.state, clips)
  const easingMs = clampFallbackEasingMs(options.easingMs ?? DEFAULT_FALLBACK_EASING_MS)
  const propFadeMs = clampPropFadeMs(options.propFadeMs ?? DEFAULT_PROP_FADE_MS)

  const steps: TransitionStep[] = []
  let usedFallback = false
  let curState = current.state
  let curAnchor: AnchorPose = resolveAnchorPose(curState, curClip)

  // §8.4 道具当前片段：淡出回锚定，窗口位置不动；先回锚定再调度下一动作
  if (curClip.prop) {
    steps.push({
      kind: 'fade_out',
      role: 'return_to_anchor',
      clip: curClip,
      durationMs: propFadeMs,
      holdPosition: true,
    })
    if (target.state === ANCHOR_STATE[curAnchor]) {
      // 目标即锚定态：淡出后直接进入目标片段
      steps.push({ kind: 'play', role: 'target', clip: tgtClip })
      return finish(current.state, target.state, steps, false, curAnchor, curAnchor, false)
    }
    const anchorClip = selectClipForState(ANCHOR_STATE[curAnchor], clips)
    steps.push({ kind: 'play', role: 'return_to_anchor', clip: anchorClip })
    curState = ANCHOR_STATE[curAnchor]
  }

  // §8.2 循环当前片段：经退出过渡（起身）回主锚定
  if (isLoopFragmentState(curState)) {
    const exitClip = findTransitionClip(curState as TransitionEndpoint, 'sit', clips)
    if (exitClip) {
      steps.push({ kind: 'play', role: 'exit_loop', clip: exitClip })
    } else {
      steps.push({
        kind: 'easing',
        role: 'fallback',
        durationMs: easingMs,
        reason: `missing loop-exit transition clip: ${curState} -> sit`,
      })
      usedFallback = true
    }
    curState = ANCHOR_STATE.sit
    curAnchor = 'sit'
  }

  const fromAnchor = curAnchor

  // §8.4 道具目标片段：不走锚定中转，直接淡入
  if (tgtClip.prop) {
    const propAnchor = resolveAnchorPose(target.state, tgtClip)
    steps.push({
      kind: 'fade_in',
      role: 'target',
      clip: tgtClip,
      durationMs: propFadeMs,
      holdPosition: true,
    })
    steps.push({ kind: 'play', role: 'target', clip: tgtClip })
    return finish(current.state, target.state, steps, false, fromAnchor, propAnchor, usedFallback)
  }

  // §8.2 循环目标片段：锚定 → 进入过渡（趴下） → 循环
  if (isLoopFragmentState(target.state)) {
    if (curAnchor !== 'sit') {
      usedFallback = addAnchorToAnchor(steps, curAnchor, 'sit', clips, easingMs) || usedFallback
      addOptionalHold(steps, 'sit', options)
    }
    const enterClip = findTransitionClip('sit', target.state as TransitionEndpoint, clips)
    if (enterClip) {
      steps.push({ kind: 'play', role: 'enter_loop', clip: enterClip })
    } else {
      steps.push({
        kind: 'easing',
        role: 'fallback',
        durationMs: easingMs,
        reason: `missing loop-enter transition clip: sit -> ${target.state}`,
      })
      usedFallback = true
    }
    steps.push({ kind: 'play', role: 'target', clip: tgtClip })
    return finish(current.state, target.state, steps, fromAnchor !== 'sit', fromAnchor, 'sit', usedFallback)
  }

  // §8.1 常规路径：同锚定直接切换；跨锚定先经过渡片段（起身/坐下）
  const tgtAnchor = resolveAnchorPose(target.state, tgtClip)
  if (curAnchor !== tgtAnchor) {
    usedFallback = addAnchorToAnchor(steps, curAnchor, tgtAnchor, clips, easingMs) || usedFallback
    addOptionalHold(steps, tgtAnchor, options)
  }
  steps.push({ kind: 'play', role: 'target', clip: tgtClip })
  return finish(current.state, target.state, steps, curAnchor !== tgtAnchor, fromAnchor, tgtAnchor, usedFallback)
}

/** 跨锚定过渡步骤 (§8.1)：过渡片段起止于两端锚定；缺失时 §8.3 兜底 */
function addAnchorToAnchor(
  steps: TransitionStep[],
  from: AnchorPose,
  to: AnchorPose,
  clips: readonly ClipMeta[],
  easingMs: number,
): boolean {
  const clip = findTransitionClip(from, to, clips)
  if (clip) {
    steps.push({ kind: 'play', role: 'cross_anchor', clip })
    return false
  }
  steps.push({
    kind: 'easing',
    role: 'fallback',
    durationMs: easingMs,
    reason: `missing cross-anchor transition clip: ${from} -> ${to}`,
  })
  return true
}

/** §8.1 锚定可短暂停留：holdAnchorMs > 0 时插入 hold 步骤 */
function addOptionalHold(steps: TransitionStep[], anchor: AnchorPose, options: PlanOptions): void {
  if (options.holdAnchorMs !== undefined && options.holdAnchorMs > 0) {
    steps.push({
      kind: 'hold',
      role: 'anchor_hold',
      anchor,
      durationMs: options.holdAnchorMs,
    })
  }
}

function finish(
  from: string,
  to: string,
  steps: TransitionStep[],
  crossAnchor: boolean,
  fromAnchor: AnchorPose,
  toAnchor: AnchorPose,
  usedFallback: boolean,
): TransitionPlan {
  return { from, to, steps, crossAnchor, anchors: { from: fromAnchor, to: toAnchor }, usedFallback }
}
