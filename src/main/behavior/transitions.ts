/**
 * FSM 转移边表与加权采样 (§9.2 状态机主干, §9.3 转移驱动)
 *
 * §9.2 主干邻接（文字状态机图）：
 *   [sleep] ⇄ [lie] ⇄ [idle_sit] ⇄ [stand] → [walk] → 边缘 → [turn] → [walk]
 *   [idle_sit] → [groom]（按概率偶发，结束后回锚定）
 * 补充 walk → stand（行走结束站定，附录 A 行走起止锚定为站立）。
 *
 * §9.3 概率转移：每个状态一组带权出边，权重可被 BehaviorConfig.weightOverrides
 * 以倍率调制（倍率只能调制已有边，不能创造新边）。需求/节律/交互/微随机驱动
 * 属 TASK-013，本模块只提供概率驱动所需的权重解析与确定性采样。
 *
 * 采样随机源可注入（rng），相同随机序列下结果完全确定（确定性状态机）。
 * 纯逻辑，无平台依赖。
 */

import type { BehaviorState } from './fsm'
import type { BehaviorConfig } from '../../shared/types/behavior-config'

/** 加权出边 */
export interface WeightedEdge {
  /** 目标状态 */
  readonly target: BehaviorState
  /** 生效权重（> 0） */
  readonly weight: number
}

/**
 * 默认转移权重表 (§9.2, §9.3)
 *
 * 权重体现基础生命节律：静止类状态出边多、锚定态为枢纽、
 * groom 为低频偶发（§4.4 选拍）、turn 主要由行走边缘触发。
 */
export const TRANSITION_WEIGHTS: Readonly<
  Record<BehaviorState, Readonly<Partial<Record<BehaviorState, number>>>>
> = {
  sleep: { lie: 1 },
  lie: { idle_sit: 3, sleep: 2 },
  idle_sit: { lie: 2, stand: 3, groom: 1 },
  stand: { idle_sit: 4, walk: 4 },
  walk: { stand: 4, turn: 1 },
  turn: { walk: 1 },
  groom: { idle_sit: 1 },
}

/**
 * 取状态的邻接目标列表（按边表声明顺序）。
 */
export function getNeighbors(state: BehaviorState): readonly BehaviorState[] {
  return Object.keys(TRANSITION_WEIGHTS[state]) as BehaviorState[]
}

/**
 * 判断 from → to 是否为合法转移边 (§9.2)。
 *
 * weightOverrides 只能调制已有边的权重（§9.3 权重调制），
 * 不能创造边表之外的新边。
 */
export function isTransitionAllowed(
  from: BehaviorState,
  to: BehaviorState,
  config?: BehaviorConfig,
): boolean {
  if (TRANSITION_WEIGHTS[from]?.[to] === undefined) return false
  return effectiveWeight(from, to, config) > 0
}

/**
 * 解析状态的生效带权出边 (§9.3)。
 *
 * 应用 weightOverrides 倍率后过滤权重 ≤ 0 的边（倍率 0 = 关闭该转移）。
 * 未知 state 返回空数组。
 */
export function getOutgoingEdges(
  state: BehaviorState,
  config?: BehaviorConfig,
): WeightedEdge[] {
  const table = TRANSITION_WEIGHTS[state]
  if (!table) return []
  const edges: WeightedEdge[] = []
  for (const target of Object.keys(table) as BehaviorState[]) {
    const weight = effectiveWeight(state, target, config)
    if (weight > 0) edges.push({ target, weight })
  }
  return edges
}

/** 单边生效权重 = 基础权重 × 配置倍率 */
function effectiveWeight(
  from: BehaviorState,
  to: BehaviorState,
  config?: BehaviorConfig,
): number {
  const base = TRANSITION_WEIGHTS[from]?.[to]
  if (base === undefined) return 0
  const multiplier = config?.weightOverrides?.[from]?.[to]
  return multiplier === undefined ? base : base * multiplier
}

/**
 * mulberry32 种子随机源：为 FSM 提供可复现的随机序列。
 *
 * 相同 seed 产生相同序列，保证行为可测试、可回放。
 */
export function createSeededRandom(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * 按权重采样一条出边 (§9.3 概率转移)。
 *
 * rng 须返回 [0, 1) 均匀随机数。边列表为空或总权重 ≤ 0 时返回 null
 * （调用方保持当前状态）。
 */
export function sampleWeightedEdge(
  edges: readonly WeightedEdge[],
  rng: () => number,
): WeightedEdge | null {
  if (edges.length === 0) return null
  const total = edges.reduce((sum, e) => sum + e.weight, 0)
  if (total <= 0) return null
  let remaining = rng() * total
  for (const edge of edges) {
    remaining -= edge.weight
    if (remaining < 0) return edge
  }
  return edges[edges.length - 1]
}
