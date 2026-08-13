/**
 * 行走调度规划 (§7.2, §9, §7.3)
 *
 * 从位移曲线规划行走的起止位置与时长：
 *   - 解析目标方向的行走片段（含对称宠物镜像，§4.3）
 *   - 由位移曲线 × scale 计算屏幕位移量 (§7.2)
 *   - 确定 startX / endX / durationSec
 *   - 检测是否会到达屏幕边缘 (§7.3)
 *
 * 行走子段 [moveStartSec, moveEndSec] 内窗口平移，起止站定段窗口静止 (§7.2)。
 * 调度层据此安排行走的起止位置与时长。
 *
 * 纯逻辑，无平台依赖。
 */

import type { ClipMeta } from '../../shared/types/clip-meta'
import type { TrackFile } from '../../shared/types/track-file'
import type { WorkAreaBounds } from '../../shared/spatial'
import {
  type WalkDirection,
  type EdgeSide,
  resolveDirectedClip,
  detectEdgeSide,
  oppositeDirection,
} from '../../shared/spatial'
import {
  type WalkWindowMapping,
  computeWalkScale,
  walkDisplacementScreenPx,
  walkScreenSpan,
} from '../../shared/spatial'

/** 行走方向选择结果 */
export interface WalkDirectionChoice {
  /** 选定的行进方向 */
  readonly direction: WalkDirection
  /** 是否因靠近边缘而强制换向 */
  readonly forcedByEdge: boolean
}

/**
 * 选择行走方向 (§7.3, §9)。
 *
 * - 宠物靠近左边缘 → 必须右行；靠近右边缘 → 必须左行
 * - 否则随机选择一个方向
 * - 仅考虑实际有可用片段的方向（含镜像）
 *
 * @param petX 宠物当前 x
 * @param bounds 工作区边界
 * @param clips 片段库
 * @param symmetrical 宠物对称性 (§4.3)
 * @param rng 随机源
 */
export function chooseWalkDirection(
  petX: number,
  bounds: WorkAreaBounds,
  clips: readonly ClipMeta[],
  symmetrical: boolean,
  rng: () => number = Math.random,
): WalkDirectionChoice {
  const atLeftEdge = detectEdgeSide(petX, bounds) === 'left'
  const atRightEdge = detectEdgeSide(petX, bounds) === 'right'

  if (atLeftEdge) {
    return { direction: 'right', forcedByEdge: true }
  }
  if (atRightEdge) {
    return { direction: 'left', forcedByEdge: true }
  }

  // 随机选择方向，但仅限有可用片段的方向
  const canRight = resolveDirectedClip(clips, 'walk', 'right', symmetrical) !== null
  const canLeft = resolveDirectedClip(clips, 'walk', 'left', symmetrical) !== null

  if (canRight && canLeft) {
    return { direction: rng() < 0.5 ? 'left' : 'right', forcedByEdge: false }
  }
  if (canRight) {
    return { direction: 'right', forcedByEdge: false }
  }
  return { direction: 'left', forcedByEdge: false }
}

/** 行走规划结果 */
export interface WalkPlan {
  /** 选定的行走片段 */
  readonly clip: ClipMeta
  /** 屏幕行进方向 */
  readonly direction: WalkDirection
  /** 是否镜像播放（仅对称宠物，§4.3） */
  readonly mirrored: boolean
  /** 行走开始时窗口 x (DIP) */
  readonly startX: number
  /** 行走结束时窗口 x (DIP) */
  readonly endX: number
  /** 行走子段起点 (秒) */
  readonly moveStartSec: number
  /** 行走子段终点 (秒) */
  readonly moveEndSec: number
  /** 片段总时长 (秒) = track.frameCount / track.fps */
  readonly clipDurationSec: number
  /** 行走映射 (供运行时逐帧采样窗口 x, §7.2) */
  readonly mapping: WalkWindowMapping
  /** 行走结束时是否到达屏幕边缘 */
  readonly wouldHitEdge: boolean
  /** 到达的边缘侧 */
  readonly edgeSide: EdgeSide | null
  /** 屏幕位移量绝对值 (px) */
  readonly screenSpanPx: number
}

/** 行走规划输入 */
export interface WalkPlanInput {
  /** 行走开始时宠物 x */
  readonly currentX: number
  /** 工作区边界 */
  readonly bounds: WorkAreaBounds
  /** 片段库 */
  readonly clips: readonly ClipMeta[]
  /** 行走片段的位移曲线 */
  readonly track: TrackFile
  /** 宠物对称性 (§4.3) */
  readonly symmetrical: boolean
  /** 片段在屏幕上的显示宽度 (px, 含 scale) */
  readonly displayedWidthPx: number
  /** 目标行进方向 */
  readonly direction: WalkDirection
  /** 同方向多变体选择器 (默认取第一个, §9.5) */
  readonly picker?: (candidates: readonly ClipMeta[]) => ClipMeta
}

/**
 * 规划一次行走 (§7.2, §9)。
 *
 * 从位移曲线计算屏幕位移量，确定 startX / endX / durationSec，
 * 检测边缘碰撞。无可用行走片段时返回 null。
 */
export function planWalk(input: WalkPlanInput): WalkPlan | null {
  const resolution = resolveDirectedClip(
    input.clips,
    'walk',
    input.direction,
    input.symmetrical,
    input.picker,
  )
  if (resolution === null) return null

  const { clip, mirrored } = resolution

  const moveStartSec = clip.moveStartSec ?? 0
  const moveEndSec = clip.moveEndSec ?? input.track.frameCount / input.track.fps

  if (!(moveStartSec < moveEndSec)) {
    // 无效行走子段：退化用全片段
  }

  const scale = computeWalkScale(input.displayedWidthPx, input.track)
  const sign: 1 | -1 = mirrored ? -1 : 1

  const mapping: WalkWindowMapping = {
    track: input.track,
    moveStartSec,
    moveEndSec,
    scale,
    sign,
    startX: input.currentX,
  }

  // 行走子段末尾的屏幕位移（含方向 sign）
  const endDisplacementPx = walkDisplacementScreenPx(mapping, moveEndSec)
  const endX = input.currentX + endDisplacementPx
  const span = walkScreenSpan(mapping)

  const clipDurationSec = input.track.frameCount / input.track.fps

  const edgeSide = detectEdgeSide(endX, input.bounds)

  return {
    clip,
    direction: input.direction,
    mirrored,
    startX: input.currentX,
    endX,
    moveStartSec,
    moveEndSec,
    clipDurationSec,
    mapping,
    wouldHitEdge: edgeSide !== null,
    edgeSide,
    screenSpanPx: span,
  }
}

/**
 * 行走结束后宠物应转向的方向 (§7.3)。
 *
 * 如果行走到达边缘，下一个行走应反方向；否则保持当前方向。
 */
export function directionAfterWalk(plan: WalkPlan): WalkDirection {
  if (plan.edgeSide !== null) {
    return oppositeDirection(plan.direction)
  }
  return plan.direction
}
