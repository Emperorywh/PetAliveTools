/**
 * 状态 → 片段解析 (§5.5 占位兜底, §4.4 过渡片段约定, §9.5 多变体)
 *
 * 在 persistence/placeholder 的占位机制之上补充：
 * - 变体感知：同状态多变体按 variant 升序整理，默认取最小编号，
 *   可注入变体选择器供调度器做随机抽取（TASK-013）。
 * - 过渡片段查找：state='transition' 的片段在文件名状态段编码两端端点，
 *   形如 `transition_sit_to_stand__none__01.webm`（坐→站起身）、
 *   `transition_lie_to_sit__none__01.webm`（趴卧→端坐起身）。
 *   端点 ∈ {sit, stand, lie, sleep, groom}，对应 §4.2 双锚定与 §8.2
 *   循环进出的配套过渡（§4.4 过渡项）；扫描时由 direct-media 推导为
 *   ClipMeta.transition 字段，本模块按该字段查找。
 *
 * 缺失状态回退通用占位片段（端坐 idle_sit，§5.5 / §13）。
 * 纯逻辑，无平台依赖。
 */

import type { ClipMeta, TransitionEndpoint } from '../../shared/types/clip-meta'
import { createPlaceholderClip } from '../persistence/placeholder'

/** 过渡片段的 state 键 (§4.4 拍摄清单「起身 / 趴下过渡」) */
export const TRANSITION_CLIP_STATE = 'transition'

export type { TransitionEndpoint } from '../../shared/types/clip-meta'

const ENDPOINTS: readonly TransitionEndpoint[] = ['sit', 'stand', 'lie', 'sleep', 'groom']

/** 变体选择器：从同状态变体列表中选出一个片段 (§9.5 多变体) */
export type VariantPicker = (variants: readonly ClipMeta[]) => ClipMeta

/** 过渡片段端点对 */
export interface TransitionClipEndpoints {
  readonly from: TransitionEndpoint
  readonly to: TransitionEndpoint
}

/**
 * 构造过渡片段状态键（导入入库时应遵循的约定）。
 */
export function transitionClipId(from: TransitionEndpoint, to: TransitionEndpoint): string {
  return `transition_${from}_to_${to}`
}

/**
 * 解析过渡片段的两端端点。
 *
 * 端点来自扫描时由文件名推导的 transition 字段（新命名
 * `transition_X_to_Y__dir__NN` 与旧命名 `transition_X_to_Y` 均可推导）。
 * 非 state='transition' 片段或无法推导端点时返回 null。
 */
export function parseTransitionClip(clip: ClipMeta): TransitionClipEndpoints | null {
  if (clip.state !== TRANSITION_CLIP_STATE) return null
  return clip.transition ?? null
}

/**
 * 查找连接两端的过渡片段 (§8.1 跨锚定, §8.2 循环进出)。
 *
 * 例如 findTransitionClip('sit', 'stand', clips) 找坐→站起身过渡，
 * findTransitionClip('lie', 'sit', clips) 找趴卧退出过渡。
 * 同一端点对存在多变体时取编号最小的；无匹配片段时返回 undefined（调用方走 §8.3 兜底）。
 */
export function findTransitionClip(
  from: TransitionEndpoint,
  to: TransitionEndpoint,
  clips: readonly ClipMeta[],
): ClipMeta | undefined {
  return clips
    .filter(
      (c) =>
        c.state === TRANSITION_CLIP_STATE &&
        c.transition?.from === from &&
        c.transition?.to === to,
    )
    .sort((a, b) => a.variant - b.variant)[0]
}

/**
 * 列出状态的全部变体，按 variant 升序 (§9.5 多变体)。
 */
export function getClipVariants(state: string, clips: readonly ClipMeta[]): ClipMeta[] {
  return clips
    .filter((c) => c.state === state)
    .sort((a, b) => a.variant - b.variant)
}

/**
 * 为状态解析片段 (§5.5)：有真实片段时按变体选择器取一个，
 * 无真实片段时回退通用占位片段（端坐）。
 *
 * @param state FSM 状态键
 * @param clips 已入库片段
 * @param pickVariant 变体选择器，缺省取最小编号变体
 */
export function selectClipForState(
  state: string,
  clips: readonly ClipMeta[],
  pickVariant: VariantPicker = pickLowestVariant,
): ClipMeta {
  const variants = getClipVariants(state, clips)
  if (variants.length === 0) return createPlaceholderClip()
  return pickVariant(variants)
}

/** 缺省变体选择器：最小编号（确定性，反循环随机化由调度器注入，TASK-013） */
function pickLowestVariant(variants: readonly ClipMeta[]): ClipMeta {
  return variants[0]
}

export { ENDPOINTS }
