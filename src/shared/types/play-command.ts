/**
 * 调度播放 IPC 载荷 (IR-002 / IR-003 / IR-004 / IR-010)
 *
 * `scheduler:play` / `scheduler:fade-in` 等渲染指令的结构化载荷，
 * 替代早期的 (clipUrl, mirrored, loop, hitbox) 位置参数形式。
 *
 * 载荷携带渲染端逐片段所需的全部信息：
 *   - 锚定姿态 (§6.2)：逐片段锚点对齐，避免端坐↔站立切换纵向跳动
 *   - 尺度系数 (§7.4)：scaleHint 渲染时统一应用
 *   - 循环入/出点 (§5.3)：loopInSec/loopOutSec 无缝循环段
 *   - 播放速率 (§9.5)：微随机速率抖动（IR-006），未启用时恒 1.0
 *   - embeddedAudio (§4.8)：渲染端据此决定初始 muted（IR-010）
 *   - walk 标记 (IR-004)：行走片段播放期间开启媒体时间上报
 *
 * 跨进程共享类型。
 */

import type { Hitbox } from './clip-meta'

/** 渲染端锚定姿态（§4.2 双锚定） */
export type RenderAnchor = 'sit' | 'stand'

/**
 * 播放片段指令载荷 (`scheduler:play`)。
 */
export interface PlayClipPayload {
  /** 片段 id（IR-004 媒体时间上报关联键） */
  readonly clipId: string
  /** 片段文件 file:// URL */
  readonly clipUrl: string
  /** 是否水平镜像（仅对称宠物，§4.3） */
  readonly mirrored: boolean
  /** 是否循环片段 */
  readonly loop: boolean
  /** 命中盒 [x, y, w, h] 归一化坐标 (§5.4/§6.1) */
  readonly hitbox: Hitbox
  /** 锚定姿态 (§6.2)：逐片段锚点对齐 */
  readonly anchor: RenderAnchor
  /** 尺度系数 (§7.4 scaleHint) */
  readonly scaleHint: number
  /** 循环入点 (秒)；非循环片段为 null (§5.3) */
  readonly loopInSec: number | null
  /** 循环出点 (秒)；非循环片段为 null (§5.3) */
  readonly loopOutSec: number | null
  /** 播放速率倍率 (§9.5 微随机, IR-006)；未启用时恒 1.0 */
  readonly playbackRate: number
  /** 保留内嵌音轨 (§4.8)：渲染端据此决定初始 muted (IR-010) */
  readonly embeddedAudio: boolean
  /** 是否行走片段（行走期间渲染端 ~10Hz 上报媒体时间，IR-004） */
  readonly walk: boolean
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
