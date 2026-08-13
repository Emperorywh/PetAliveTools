/**
 * 片段元数据 (ClipMeta)
 *
 * 参见 SPEC §5.4 (打标 schema)、§4.2 (锚定)、§4.7 (道具)。
 *
 * 每条记录描述一个 WebM-alpha 视频片段的元数据。
 * 跨进程共享类型。
 */

/** 片段类别 (§5.4 category) */
export type ClipCategory = 'basic' | 'interactive' | 'signature' | 'emotion'

/** 方向 (§5.4 direction) */
export type ClipDirection = 'left' | 'right' | 'none'

/** 起止锚定 (§5.4 anchor)：sit=端坐, stand=站立, none=纯循环段 */
export type ClipAnchor = 'sit' | 'stand' | 'none'

/** 命中盒 [x, y, w, h]，相对精灵归一化坐标 [0, 1] (§5.4 hitbox, §6.1) */
export type Hitbox = readonly [number, number, number, number]

/**
 * 片段元数据 (§5.4 schema)
 *
 * moveStartSec / moveEndSec / track 仅行走类片段需要 (§5.3、§7.2)。
 * 对称性是宠物级属性 (§4.3)，不在片段元数据中重复。
 */
export interface ClipMeta {
  /** 唯一标识，如 "walk_right_01" */
  readonly id: string
  /** FSM 状态键，如 "walk" / "idle_sit" (§9.1) */
  readonly state: string
  /** 片段类别 (§5.4) */
  readonly category: ClipCategory
  /** 方向 (§5.4) */
  readonly direction: ClipDirection
  /** 起止锚定 (§5.4) */
  readonly anchor: ClipAnchor
  /** 是否循环片段 */
  readonly loop: boolean
  /** 循环入点 (秒，浮点)；非循环片段为 null */
  readonly loopInSec: number | null
  /** 循环出点 (秒，浮点)；非循环片段为 null */
  readonly loopOutSec: number | null
  /** 个性招牌：低频偶发触发 (§4.4 C) */
  readonly signature: boolean
  /** 同状态变体编号，从 1 起 (§4.5) */
  readonly variant: number
  /** 道具类片段 (§4.7)：过渡走 §8.4 短淡入淡出 */
  readonly prop: boolean
  /** 保留内嵌音轨的发声片段 (§4.8)：播放时保留内嵌音轨，忽略 audio 字段 */
  readonly embeddedAudio: boolean
  /** 关联音频素材 id；embeddedAudio 时忽略 (§5.4) */
  readonly audio: string | null
  /** 尺度归一化缩放系数 (§7.4) */
  readonly scaleHint: number
  /** 命中盒 [x, y, w, h]，归一化坐标 (§5.4, §6.1) */
  readonly hitbox: Hitbox

  // —— 以下仅行走类片段 (§5.3、§7.2) —— //

  /** 行走子段起点 (秒)：此前为站定 (§5.3) */
  readonly moveStartSec?: number
  /** 行走子段终点 (秒)：此后为站定 (§5.3) */
  readonly moveEndSec?: number
  /** 逐帧位移曲线文件名 (§5.3)：如 "walk_right_01.track.json" */
  readonly track?: string
}
