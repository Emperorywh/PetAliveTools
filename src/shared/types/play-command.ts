/**
 * 原样片段播放 IPC 载荷。
 *
 * 载荷只告诉渲染进程播放哪个文件以及是否整段循环；
 * 不再携带镜像、缩放、循环入出点、速率或行走轨迹参数。
 */

import type { Hitbox } from './clip-meta'

/**
 * 播放片段指令载荷 (`scheduler:play`)。
 */
export interface PlayClipPayload {
  /** 片段 id（自然播放结束时用于回报） */
  readonly clipId: string
  /** 项目内原样视频文件 URL */
  readonly clipUrl: string
  /** 是否整段循环片段 */
  readonly loop: boolean
  /** 命中盒 [x, y, w, h] 归一化坐标 */
  readonly hitbox: Hitbox
  /** 原始片段内嵌音轨随文件直接播放 */
  readonly embeddedAudio: boolean
}

/**
 * 道具淡入指令载荷 (`scheduler:fade-in`, §8.4)。
 *
 * 片段字段语义同 PlayClipPayload；durationMs 为淡化时长 (150–250ms)。
 */
export interface FadeInPayload {
  /** 片段播放参数（淡入目标片段） */
  readonly clip: PlayClipPayload
  /** 淡入时长 (ms, §8.4) */
  readonly durationMs: number
}

/**
 * 道具淡出指令载荷 (`scheduler:fade-out`, §8.4)。
 *
 * 渲染端对当前精灵做 opacity 渐变即可，无需重新加载片段；
 * clipId 用于日志/诊断。
 */
export interface FadeOutPayload {
  /** 淡出片段 id（当前正在播放的道具片段） */
  readonly clipId: string
  /** 淡出时长 (ms, §8.4) */
  readonly durationMs: number
}

/**
 * 兜底缓动指令载荷 (`scheduler:easing`, §8.3)。
 *
 * 缺过渡片段时的最后兜底：切换点 60–120ms 的 opacity 微缓动。
 */
export interface EasingPayload {
  /** 缓动时长 (ms, §8.3 钳制 60–120) */
  readonly durationMs: number
  /** 兜底原因（诊断用） */
  readonly reason: string
}
