/**
 * 占位片段机制 (§5.5 缺素材兜底, §13 可靠性)
 *
 * 缺失关键状态片段时，用通用占位片段（端坐 idle_sit）临时顶替。
 * 同时提供缺失状态检测，供清单标红提醒使用。
 *
 * 运行于主进程，但逻辑为纯函数，可供测试直接调用。
 */

import type { ClipMeta } from '../../shared/types/project'

/** 占位片段 id 前缀，标识非真实素材 */
export const PLACEHOLDER_CLIP_ID = '__placeholder_idle_sit__'

/**
 * 创建占位片段 (§5.5)。
 *
 * 通用端坐 idle_sit 片段引用，用于任何缺少真实片段的状态。
 * 占位片段为无限循环，命中盒覆盖大部分精灵区域。
 */
export function createPlaceholderClip(): ClipMeta {
  return {
    id: PLACEHOLDER_CLIP_ID,
    state: 'idle_sit',
    category: 'basic',
    direction: 'none',
    anchor: 'sit',
    loop: true,
    loopInSec: 0,
    loopOutSec: 3,
    signature: false,
    variant: 1,
    prop: false,
    embeddedAudio: false,
    audio: null,
    scaleHint: 1.0,
    hitbox: [0.1, 0.05, 0.8, 0.9],
  }
}

/**
 * 为指定状态解析片段 (§5.5)。
 *
 * 有真实片段时返回第一个匹配的真实片段；
 * 无真实片段时返回占位片段。
 *
 * @param state 需要解析的 FSM 状态键
 * @param clips 已入库的片段元数据列表
 * @returns 真实片段或占位片段
 */
export function resolveClipForState(
  state: string,
  clips: readonly ClipMeta[],
): ClipMeta {
  const real = clips.find((c) => c.state === state)
  return real ?? createPlaceholderClip()
}

/**
 * 检测缺失的状态 (§5.5 清单标红提醒)。
 *
 * 对照必需状态列表与已入库片段，返回缺失的状态键。
 * 过滤掉占位片段本身。
 *
 * @param requiredStates 必需状态列表 (如 FSM 基础状态集合)
 * @param clips 已入库的片段元数据列表
 * @returns 缺失的状态键列表
 */
export function getMissingStates(
  requiredStates: readonly string[],
  clips: readonly ClipMeta[],
): string[] {
  const available = new Set(
    clips
      .filter((c) => c.id !== PLACEHOLDER_CLIP_ID)
      .map((c) => c.state),
  )
  return requiredStates.filter((s) => !available.has(s))
}

/**
 * 为一组必需状态构建片段解析表 (§5.5)。
 *
 * 对每个必需状态：有真实片段则用真实片段，否则用占位片段。
 * 返回 state → ClipMeta 映射。
 *
 * @param requiredStates 必需状态列表
 * @param clips 已入库的片段元数据列表
 * @returns state → ClipMeta 映射（含占位片段）
 */
export function buildClipLookup(
  requiredStates: readonly string[],
  clips: readonly ClipMeta[],
): Map<string, ClipMeta> {
  const lookup = new Map<string, ClipMeta>()
  for (const state of requiredStates) {
    lookup.set(state, resolveClipForState(state, clips))
  }
  return lookup
}

/**
 * 判断片段是否为占位片段。
 *
 * @param clip 待检测片段
 * @returns 是否为占位片段
 */
export function isPlaceholderClip(clip: ClipMeta): boolean {
  return clip.id === PLACEHOLDER_CLIP_ID
}
