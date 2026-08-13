/**
 * 边缘转身与方向镜像 (§7.3, §4.3)
 *
 * 到达屏幕左右边界 → 播放"转身"片段（起止于站立锚定）→ 改变朝向
 * 继续行走。不对称宠物必须已拍转身片段；缺失则停在边界等下次调度
 * （兜底，§7.3）。
 *
 * 方向与镜像 (§4.3)：对称性为宠物级属性（persona.json symmetrical）。
 * - 对称宠物可只拍一个方向、运行时镜像（scaleX(-1)，§6.2）；
 *   镜像后画面反向，位移曲线随之反向（sign = −1，§7.2）。
 * - 不对称宠物禁止镜像，必须实拍两个方向的片段。
 *
 * 纯计算，无平台依赖。
 */

import type { ClipMeta, ClipDirection } from '../types/clip-meta'
import type { WorkAreaBounds } from './ground-line'

/** 行走方向（屏幕语义） */
export type WalkDirection = 'left' | 'right'

/** 触发的屏幕边界侧 */
export type EdgeSide = 'left' | 'right'

/** 边缘检测默认余量：宠物足部距边界小于此值即视为到边 (px) */
export const DEFAULT_EDGE_MARGIN_PX = 8

/** 反方向 */
export function oppositeDirection(direction: WalkDirection): WalkDirection {
  return direction === 'left' ? 'right' : 'left'
}

/**
 * 检测宠物是否到达屏幕边界 (§7.3)。
 *
 * @param petX 宠物锚点（足部中心）的屏幕 x
 * @param bounds 工作区边界（含地面线，§7.1）
 * @param margin 距边界余量（默认 8px）
 * @returns 触发的边界侧；未到边返回 null
 */
export function detectEdgeSide(
  petX: number,
  bounds: WorkAreaBounds,
  margin: number = DEFAULT_EDGE_MARGIN_PX
): EdgeSide | null {
  if (!Number.isFinite(petX)) {
    throw new Error(`invalid petX: ${petX}`)
  }
  if (!Number.isFinite(margin) || margin < 0) {
    throw new Error(`invalid margin: ${margin}`)
  }
  if (petX <= bounds.x + margin) {
    return 'left'
  }
  if (petX >= bounds.x + bounds.width - margin) {
    return 'right'
  }
  return null
}

/** 到达边界后应转向的行进方向：左边界 → 右行，右边界 → 左行 */
export function directionAfterEdge(side: EdgeSide): WalkDirection {
  return side === 'left' ? 'right' : 'left'
}

/** 片段经镜像/直选后满足目标方向的解析结果 */
export interface DirectionResolution {
  /** 实际使用的片段 */
  readonly clip: ClipMeta
  /** 是否镜像播放（scaleX(-1)，仅对称宠物，§4.3） */
  readonly mirrored: boolean
}

const DIRECTIONS: readonly WalkDirection[] = ['left', 'right']

function isWalkDirection(d: ClipDirection): d is WalkDirection {
  return (DIRECTIONS as readonly string[]).includes(d)
}

/**
 * 解析某状态在目标方向上的片段 (§4.3 方向与镜像)。
 *
 * - 存在 direction === 目标 的片段 → 直接使用；
 * - 否则若宠物对称且存在反方向片段 → 镜像使用（mirrored = true）；
 * - 否则返回 null：不对称宠物必须实拍该方向（禁止镜像）。
 *
 * @param clips 片段库
 * @param state 目标状态键（如 'walk' / 'turn'）
 * @param direction 目标屏幕行进方向
 * @param symmetrical 宠物对称性（persona.json，§4.3）
 * @param picker 同状态同方向多变体的选择器（默认取第一个，§9.5 多变体）
 */
export function resolveDirectedClip(
  clips: readonly ClipMeta[],
  state: string,
  direction: WalkDirection,
  symmetrical: boolean,
  picker: (candidates: readonly ClipMeta[]) => ClipMeta = (cs) => cs[0]
): DirectionResolution | null {
  const direct = clips.filter((c) => c.state === state && c.direction === direction)
  if (direct.length > 0) {
    return { clip: picker(direct), mirrored: false }
  }

  if (symmetrical) {
    const mirroredClip = clips.find(
      (c) => c.state === state && isWalkDirection(c.direction) && c.direction !== direction
    )
    if (mirroredClip) {
      return { clip: mirroredClip, mirrored: true }
    }
  }

  return null
}

/**
 * 边缘转身计划 (§7.3)。
 *
 * 到边 → 换向。换向需要：
 * - 转身片段（state='turn'，起止于站立锚定）：缺失且宠物不对称 →
 *   停在边界等下次调度（兜底）；对称宠物转身片段同样允许镜像。
 * - 换向后的行进片段（walk）：按 §4.3 镜像策略解析。
 */
export interface EdgeTurnPlan {
  /** 触发的边界侧 */
  readonly side: EdgeSide
  /** 转向后的行进方向 */
  readonly nextDirection: WalkDirection
  /** 转身片段解析；缺失为 null */
  readonly turn: DirectionResolution | null
  /** 换向后行走片段解析；不对称且缺反方向片段为 null */
  readonly walk: DirectionResolution | null
  /**
   * 是否可继续行走：false = 缺关键素材，停在边界等下次调度（兜底）。
   * （转身片段缺失时对称宠物可直接镜像换向，非硬阻塞。）
   */
  readonly canProceed: boolean
}

/**
 * 边缘转身决策 (§7.3)。
 *
 * @returns 未到边界返回 null；到边界返回转身计划
 */
export function planEdgeTurn(
  petX: number,
  bounds: WorkAreaBounds,
  clips: readonly ClipMeta[],
  symmetrical: boolean,
  margin: number = DEFAULT_EDGE_MARGIN_PX
): EdgeTurnPlan | null {
  const side = detectEdgeSide(petX, bounds, margin)
  if (side === null) {
    return null
  }

  const nextDirection = directionAfterEdge(side)
  const turn = resolveDirectedClip(clips, 'turn', nextDirection, symmetrical)
  const walk = resolveDirectedClip(clips, 'walk', nextDirection, symmetrical)

  return { side, nextDirection, turn, walk, canProceed: walk !== null }
}
