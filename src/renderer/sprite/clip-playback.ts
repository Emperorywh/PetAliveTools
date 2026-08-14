/**
 * 片段播放决策纯逻辑 (IR-002 / IR-003 / IR-005)
 *
 * 从 SpritePlayer 抽出的可测决策函数：
 *   - 循环段解析 (§5.3 loopInSec/loopOutSec, IR-002)
 *   - 同 src 重选动作决策 (IR-005 冻末帧修复)
 *   - 淡化/缓动时序参数 (§8.3/§8.4, IR-003)
 *
 * 纯函数，无 DOM 依赖，供单测直接断言。
 */

/** 循环段（秒）：[inSec, outSec) 区间循环 */
export interface LoopSegment {
  readonly inSec: number
  readonly outSec: number
}

/**
 * 解析有效循环段 (§5.3, IR-002)。
 *
 * 仅当 loop=true 且 0 ≤ inSec < outSec 时返回循环段；
 * 否则返回 null（整文件循环或不循环）。
 */
export function resolveLoopSegment(
  loop: boolean,
  loopInSec: number | null,
  loopOutSec: number | null,
): LoopSegment | null {
  if (!loop) return null
  if (loopInSec === null || loopOutSec === null) return null
  if (!(loopInSec >= 0) || !(loopOutSec > loopInSec)) return null
  return { inSec: loopInSec, outSec: loopOutSec }
}

/** 同 src 重选动作 (IR-005) */
export type ReplayAction =
  /** 切到新片段：加载并播放 */
  | 'load'
  /** 同片段重选且已播毕/暂停：回到循环入点（或 0）重播 */
  | 'restart'
  /** 同片段且仍在播放（或循环中）：无需动作 */
  | 'none'

/**
 * 决策同 src 重选时的播放动作 (IR-005)。
 *
 * 修复"调度器连续两次选中同一非循环片段时冻结在末帧"：
 *   - src 变化 → load（加载新片段）
 *   - src 相同且循环（整文件或循环段）→ none（video.loop / 循环段维护自行维持）
 *   - src 相同且非循环：
 *       - 已播毕或暂停 → restart（seek 回入点并 play）
 *       - 仍在播放中 → none（避免 fade_in → play 同片段序列中段重卷，IR-003）
 *
 * @param sameSrc 新旧片段 URL 是否相同
 * @param loop 是否循环片段
 * @param paused 视频当前是否暂停（含播毕）
 * @param ended 视频当前是否已播毕
 */
export function decideReplayAction(
  sameSrc: boolean,
  loop: boolean,
  paused: boolean,
  ended: boolean,
): ReplayAction {
  if (!sameSrc) return 'load'
  if (loop) return 'none'
  if (paused || ended) return 'restart'
  return 'none'
}

/**
 * 淡化时序 (§8.4, IR-003)。
 *
 * opacity 渐变参数：fade_in 从 0 → 1，fade_out 从 1 → 0，
 * 时长由调度器给定（钳制在 §8.4 150–250ms 由调度侧保证）。
 */
export interface FadePlan {
  readonly fromOpacity: number
  readonly toOpacity: number
  readonly durationMs: number
}

/** 构造淡入计划 (§8.4) */
export function fadeInPlan(durationMs: number): FadePlan {
  return { fromOpacity: 0, toOpacity: 1, durationMs: Math.max(0, durationMs) }
}

/** 构造淡出计划 (§8.4) */
export function fadeOutPlan(durationMs: number): FadePlan {
  return { fromOpacity: 1, toOpacity: 0, durationMs: Math.max(0, durationMs) }
}

/**
 * 兜底缓动时序 (§8.3, IR-003)。
 *
 * 缺过渡片段时的切换点微缓动：opacity 先降到谷底再恢复，
 * 半程各 durationMs/2。谷底 0.7 保证可感知但不闪烁。
 */
export interface EasingPlan {
  readonly dipOpacity: number
  readonly halfMs: number
}

/** 构造兜底缓动计划 (§8.3：60–120ms) */
export function easingPlan(durationMs: number): EasingPlan {
  return { dipOpacity: 0.7, halfMs: Math.max(0, durationMs) / 2 }
}

/** 钳制播放速率到安全范围 (§9.5 ±5% 之外的异常值防护) */
export function clampPlaybackRate(rate: number): number {
  if (!Number.isFinite(rate) || rate <= 0) return 1
  return Math.min(2, Math.max(0.5, rate))
}
