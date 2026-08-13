/**
 * 冷却计时器与速率限制 (§11.2 防噪音)
 *
 * 每个声效有独立的冷却时间 (cooldownSec) 和单位时间上限 (maxPerHour)。
 * 播放后进入冷却；冷却期内同声效不可再次播放。
 * 单位时间上限防止短时间内频繁发声。
 *
 * 纯逻辑，无平台依赖。
 */

import type { AudioMeta } from '../types/audio-meta'

/** 冷却追踪状态 */
export interface CooldownState {
  /** audioId → 上次播放时间戳 (ms) */
  readonly lastPlayed: ReadonlyMap<string, number>
  /** audioId → 近期播放时间戳列表 (ms, 仅保留近 1 小时) */
  readonly playHistory: ReadonlyMap<string, readonly number[]>
}

/** 创建初始冷却状态 */
export function createCooldownState(): CooldownState {
  return {
    lastPlayed: new Map(),
    playHistory: new Map(),
  }
}

/** 清除已过期的播放历史 (仅保留 maxPerHour 窗口内的记录) */
function pruneHistory(
  history: readonly number[],
  nowMs: number,
  windowMs: number,
): number[] {
  const cutoff = nowMs - windowMs
  return history.filter((t) => t >= cutoff)
}

/**
 * 检查某声效是否可以播放 (§11.2)。
 *
 * 条件：
 *   1. 距上次播放超过冷却时间 (cooldownSec)
 *   2. 近 1 小时内播放次数未超过 maxPerHour
 *
 * @param state 冷却状态
 * @param audioId 声效 id
 * @param meta 声效元数据 (含 cooldownSec 与 maxPerHour)
 * @param nowMs 当前时间戳 (ms)
 * @param windowMs 速率限制窗口 (ms, 默认 1 小时)
 */
export function canPlay(
  state: CooldownState,
  audioId: string,
  meta: AudioMeta,
  nowMs: number,
  windowMs = 3_600_000,
): boolean {
  // 冷却检查
  const last = state.lastPlayed.get(audioId)
  if (last !== undefined) {
    const elapsedSec = (nowMs - last) / 1000
    if (elapsedSec < meta.cooldownSec) return false
  }

  // 速率限制检查
  const rawHistory = state.playHistory.get(audioId) ?? []
  const history = pruneHistory(rawHistory, nowMs, windowMs)
  if (history.length >= meta.maxPerHour) return false

  return true
}

/**
 * 记录一次播放，返回更新后的状态。
 *
 * 清理过期的历史记录。
 */
export function recordPlay(
  state: CooldownState,
  audioId: string,
  nowMs: number,
  windowMs = 3_600_000,
): CooldownState {
  const lastPlayed = new Map(state.lastPlayed)
  lastPlayed.set(audioId, nowMs)

  const playHistory = new Map(state.playHistory)
  const oldHistory = playHistory.get(audioId) ?? []
  const pruned = pruneHistory(oldHistory, nowMs, windowMs)
  pruned.push(nowMs)
  playHistory.set(audioId, pruned)

  return { lastPlayed, playHistory }
}

/**
 * 尝试播放：检查 + 记录原子操作 (§11.2)。
 *
 * 返回是否允许播放及更新后的状态。
 */
export function tryPlay(
  state: CooldownState,
  audioId: string,
  meta: AudioMeta,
  nowMs: number,
  windowMs = 3_600_000,
): { readonly allowed: boolean; readonly state: CooldownState } {
  if (canPlay(state, audioId, meta, nowMs, windowMs)) {
    return { allowed: true, state: recordPlay(state, audioId, nowMs, windowMs) }
  }
  return { allowed: false, state }
}

/**
 * 查询某声效的剩余冷却时间 (秒)。
 *
 * 返回 0 表示已可播放。
 */
export function remainingCooldownSec(
  state: CooldownState,
  audioId: string,
  meta: AudioMeta,
  nowMs: number,
): number {
  const last = state.lastPlayed.get(audioId)
  if (last === undefined) return 0
  const elapsedSec = (nowMs - last) / 1000
  return Math.max(0, meta.cooldownSec - elapsedSec)
}
