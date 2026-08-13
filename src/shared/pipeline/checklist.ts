/**
 * 清单状态计算 (§5.5)
 *
 * 对照 §4.4 拍摄清单与已入库片段，计算每个状态的变体数、
 * 缺失标记、最小启动集完成度。
 *
 * 纯函数，无平台依赖；渲染层清单视图与主进程占位机制共用。
 */

import type { ClipMeta } from '../types/clip-meta'
import {
  type ShootingListItem,
  type ShootingCategory,
  SHOOTING_LIST,
  SHOOTING_CATEGORIES,
  getStartupSetItems,
} from './shooting-list'

/** 单个清单条目的运行时状态 */
export interface ChecklistEntry {
  /** 对应的拍摄清单条目 */
  readonly item: ShootingListItem
  /** 已入库变体数 */
  readonly ingestedCount: number
  /** 建议变体数下限 */
  readonly suggestedCount: number
  /** 已入库变体数 ≥ 建议下限 */
  readonly satisfied: boolean
  /** 未入库任何变体（ingestedCount === 0）→ 标红 */
  readonly missing: boolean
}

/** 按大类别分组的清单状态 */
export interface ChecklistGroup {
  readonly category: ShootingCategory
  readonly label: string
  readonly subtitle: string
  readonly entries: readonly ChecklistEntry[]
}

/** 最小启动集完成度 */
export interface StartupSetStatus {
  /** 启动集全部条目 */
  readonly entries: readonly ChecklistEntry[]
  /** 已满足的条目数 */
  readonly satisfiedCount: number
  /** 总条目数 */
  readonly totalCount: number
  /** 是否全部完成 */
  readonly complete: boolean
  /** 缺失条目的状态键列表 */
  readonly missingStates: readonly string[]
}

/** 清单整体状态 */
export interface ChecklistStatus {
  /** 最小启动集（置顶） */
  readonly startupSet: StartupSetStatus
  /** 按类别分组的全部条目（含启动集条目在其各自类别中） */
  readonly groups: readonly ChecklistGroup[]
  /** 所有缺失状态键列表 */
  readonly allMissingStates: readonly string[]
}

/** 过滤掉占位片段 */
function realClips(clips: readonly ClipMeta[]): readonly ClipMeta[] {
  return clips.filter((c) => !c.id.startsWith('__placeholder_'))
}

/**
 * 统计某个状态已入库的真实变体数。
 */
export function countIngestedVariants(
  state: string,
  clips: readonly ClipMeta[],
): number {
  return realClips(clips).filter((c) => c.state === state).length
}

/**
 * 检查行走方向覆盖 (§4.3, §4.6)。
 *
 * 行走类条目需左 + 右两个方向各至少 1 段才满足最小启动集。
 */
export function hasWalkDirections(
  clips: readonly ClipMeta[],
): { hasLeft: boolean; hasRight: boolean } {
  const walkClips = realClips(clips).filter((c) => c.state === 'walk')
  return {
    hasLeft: walkClips.some((c) => c.direction === 'left'),
    hasRight: walkClips.some((c) => c.direction === 'right'),
  }
}

/** 为单条清单条目计算运行时状态 */
function buildEntry(
  item: ShootingListItem,
  clips: readonly ClipMeta[],
): ChecklistEntry {
  const ingestedCount = countIngestedVariants(item.state, clips)
  const suggestedCount = item.suggestedVariants
  return {
    item,
    ingestedCount,
    suggestedCount,
    satisfied: ingestedCount >= suggestedCount,
    missing: ingestedCount === 0,
  }
}

/**
 * 计算最小启动集完成度 (§4.6)。
 *
 * 行走 (walk) 条目需左+右双向各至少 1 段才算满足。
 */
export function computeStartupSet(
  clips: readonly ClipMeta[],
): StartupSetStatus {
  const startupItems = getStartupSetItems()
  const entries = startupItems.map((item) => {
    const entry = buildEntry(item, clips)
    // 启动集标准：每个状态至少 1 段即满足（变体建议数为丰富度目标，非启动门槛）
    // 行走条目需左+右双向各至少 1 段才算满足
    if (item.state === 'walk') {
      const { hasLeft, hasRight } = hasWalkDirections(clips)
      const walkSatisfied = hasLeft && hasRight
      return {
        ...entry,
        satisfied: walkSatisfied,
        missing: !hasLeft && !hasRight,
      }
    }
    return {
      ...entry,
      satisfied: entry.ingestedCount >= 1,
    }
  })

  const satisfiedCount = entries.filter((e) => e.satisfied).length
  const totalCount = entries.length
  const missingStates = entries.filter((e) => e.missing).map((e) => e.item.state)

  return {
    entries,
    satisfiedCount,
    totalCount,
    complete: satisfiedCount === totalCount,
    missingStates,
  }
}

/**
 * 计算清单整体状态 (§5.5)。
 *
 * 返回最小启动集状态 + 按四大类别分组的全部条目状态。
 */
export function buildChecklist(clips: readonly ClipMeta[]): ChecklistStatus {
  const startupSet = computeStartupSet(clips)

  const groups: ChecklistGroup[] = SHOOTING_CATEGORIES.map((catMeta) => {
    const items = SHOOTING_LIST.filter((item) => item.category === catMeta.id)
    const entries = items.map((item) => buildEntry(item, clips))
    return {
      category: catMeta.id,
      label: catMeta.label,
      subtitle: catMeta.subtitle,
      entries,
    }
  })

  const allMissingStates = groups
    .flatMap((g) => g.entries)
    .filter((e) => e.missing)
    .map((e) => e.item.state)

  return { startupSet, groups, allMissingStates }
}

/**
 * 查找指定状态的下个可用变体编号。
 *
 * 已有 N 个同状态变体时，返回 N+1（从 1 起，§5.4 variant）。
 */
export function nextVariantNumber(
  state: string,
  clips: readonly ClipMeta[],
): number {
  const count = countIngestedVariants(state, clips)
  return count + 1
}
