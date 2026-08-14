/**
 * 行为引擎确定性状态机 (§9.1, §9.2, §13)
 *
 * Phase 1b 基础生命状态集合与主干 FSM：
 *   idle_sit(主锚定) / stand(副锚定) / walk / lie / sleep / groom / turn
 * 转移按 §9.2 边表 + §9.3 概率驱动（带权采样，随机源可注入）。
 * 需求模型 / 性格参数化 / 节律 / 交互抢占 / 反循环随机化属 TASK-012/013。
 *
 * 崩溃恢复 (§13)：重启后 FSM 重置回锚定态（idle_sit 主锚定）重新调度，
 * 不恢复中段姿态——构造函数即恢复语义，显式调用 resetToAnchor() 复位。
 *
 * 片段层面的锚定中转计划由 anchor-transition.ts 基于 FSM 决策生成。
 * 纯逻辑，无平台依赖。
 */

import type { BehaviorConfig } from '../../shared/types/behavior-config'
import {
  getOutgoingEdges,
  isTransitionAllowed,
  sampleWeightedEdge,
} from './transitions'
import type { AnchorPose } from './anchor-transition'

/** 基础生命状态集合 (§9.1 四大类展开之基础生命) */
export const BEHAVIOR_STATES = [
  'idle_sit',
  'stand',
  'walk',
  'lie',
  'sleep',
  'groom',
  'turn',
] as const

/** 基础生命状态键 */
export type BehaviorState = (typeof BEHAVIOR_STATES)[number]

/** 重启 / 崩溃恢复后的回落状态（主锚定端坐，§13） */
export const FSM_RECOVERY_STATE: BehaviorState = 'idle_sit'

/** FSM 构造选项 */
export interface BehaviorFsmOptions {
  /** FSM 权重覆盖配置 (§12.1 behavior-config.json) */
  readonly config?: BehaviorConfig
  /** 随机源，须返回 [0, 1)；缺省使用 Math.random */
  readonly rng?: () => number
}

/** FSM 显式状态快照 */
export interface FsmSnapshot {
  /** 当前状态 */
  readonly state: BehaviorState
  /** 当前锚定姿态（§8.1 双锚定） */
  readonly anchor: AnchorPose
  /** 已完成的状态转移次数 */
  readonly transitionCount: number
}

/** 定向转移结果 */
export interface TransitionResult {
  /** 是否成功 */
  readonly ok: boolean
  /** 转移后的状态（失败时为原状态） */
  readonly state: BehaviorState
  /** 失败原因 */
  readonly reason?: string
}

/**
 * 行为状态机。
 *
 * 状态只能沿 §9.2 边表转移；step() 按带权出边采样下一状态。
 */
export class BehaviorFsm {
  private config: BehaviorConfig | undefined
  private readonly rng: () => number
  private currentState: BehaviorState
  private currentAnchor: AnchorPose
  private transitionCount: number

  constructor(options: BehaviorFsmOptions = {}) {
    this.config = options.config
    this.rng = options.rng ?? Math.random
    // §13：重启（含崩溃后重启）始终从主锚定态开始
    this.currentState = FSM_RECOVERY_STATE
    this.currentAnchor = 'sit'
    this.transitionCount = 0
  }

  /**
   * 热更新 FSM 配置 (§9.3, IR-007)。
   *
   * 需求/节律随时间漂移时，用当前需求状态与当前小时重算 weightOverrides
   * 并热更新，无需重建调度器（不打断当前调度周期）。
   * 仅影响后续 step() 的权重解析；当前状态与锚定不变。
   */
  updateConfig(config: BehaviorConfig | undefined): void {
    this.config = config
  }

  /** 当前状态 */
  get state(): BehaviorState {
    return this.currentState
  }

  /** 当前锚定姿态 (§8.1) */
  get anchor(): AnchorPose {
    return this.currentAnchor
  }

  /** 状态快照 */
  get snapshot(): FsmSnapshot {
    return {
      state: this.currentState,
      anchor: this.currentAnchor,
      transitionCount: this.transitionCount,
    }
  }

  /**
   * 定向转移：仅当 from → to 是 §9.2 合法边且未被配置倍率关闭时生效。
   */
  transitionTo(target: BehaviorState): TransitionResult {
    if (!isTransitionAllowed(this.currentState, target, this.config)) {
      return {
        ok: false,
        state: this.currentState,
        reason: `illegal transition: ${this.currentState} -> ${target} (§9.2)`,
      }
    }
    return this.apply(target)
  }

  /**
   * 概率驱动转移 (§9.3)：按带权出边采样下一状态。
   *
   * 出边为空（如倍率全部为 0）时保持当前状态。
   *
   * @returns 转移后的状态
   */
  step(): BehaviorState {
    const edges = getOutgoingEdges(this.currentState, this.config)
    const picked = sampleWeightedEdge(edges, this.rng)
    if (picked === null) return this.currentState
    return this.apply(picked.target).state
  }

  /**
   * 崩溃恢复复位 (§13)：重置回主锚定态 idle_sit 重新调度。
   *
   * @returns 复位后的快照
   */
  resetToAnchor(): FsmSnapshot {
    this.currentState = FSM_RECOVERY_STATE
    this.currentAnchor = 'sit'
    this.transitionCount = 0
    return this.snapshot
  }

  private apply(target: BehaviorState): TransitionResult {
    this.currentState = target
    this.currentAnchor = STATE_ANCHOR_FOR[target]
    this.transitionCount += 1
    return { ok: true, state: target }
  }
}

/** 基础状态 → 锚定姿态 (§4.2 起止模板) */
export const STATE_ANCHOR_FOR: Readonly<Record<BehaviorState, AnchorPose>> = {
  idle_sit: 'sit',
  stand: 'stand',
  walk: 'stand',
  turn: 'stand',
  lie: 'sit',
  sleep: 'sit',
  groom: 'sit',
}
