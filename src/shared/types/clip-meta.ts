/**
 * 直接播放片段的运行时描述。
 *
 * 这些字段由 clips/ 文件名与动作清单在加载时推导，不写入视频，
 * 也不再通过 clips.meta.json 持久化任何视频处理参数。
 */

/** 片段类别 (§5.4 category) */
export type ClipCategory = 'basic' | 'interactive' | 'signature' | 'emotion'

/** 方向 (§5.4 direction) */
export type ClipDirection = 'left' | 'right' | 'none'

/** 起止锚定 (§5.4 anchor)：sit=端坐, stand=站立, none=纯循环段 */
export type ClipAnchor = 'sit' | 'stand' | 'none'

/**
 * 过渡片段端点 (§4.4 过渡项)：
 * sit / stand 为双锚定 (§4.2)，lie / sleep / groom 为需配套进出过渡的循环片段 (§8.2)。
 */
export type TransitionEndpoint = 'sit' | 'stand' | 'lie' | 'sleep' | 'groom'

/** 过渡片段的两端端点，由文件名状态段 `transition_<from>_to_<to>` 推导 */
export interface TransitionClipEndpoints {
  readonly from: TransitionEndpoint
  readonly to: TransitionEndpoint
}

/** 命中盒 [x, y, w, h]，相对窗口归一化坐标 [0, 1] */
export type Hitbox = readonly [number, number, number, number]

/**
 * 片段运行时描述。
 *
 * fileName 指向原样复制的文件；其余字段只用于行为调度，
 * 不包含抠像、裁剪、循环入出点、缩放或位移轨迹数据。
 */
export interface ClipMeta {
  /** 唯一标识，等于不含扩展名的文件名 */
  readonly id: string
  /** clips/ 下的真实文件名，保留导入文件的扩展名 */
  readonly fileName: string
  /** FSM 状态键，如 "walk" / "idle_sit" (§9.1)；过渡片段固定为 "transition" */
  readonly state: string
  /**
   * 过渡片段端点（state === "transition" 时存在）。
   * 由文件名状态段 `transition_<from>_to_<to>` 推导，供锚定中转查找 (§8.1/§8.2)。
   */
  readonly transition?: TransitionClipEndpoints
  /** 片段类别 (§5.4) */
  readonly category: ClipCategory
  /** 方向 (§5.4) */
  readonly direction: ClipDirection
  /** 起止锚定 (§5.4) */
  readonly anchor: ClipAnchor
  /** 是否循环片段 */
  readonly loop: boolean
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
  /** 命中盒 [x, y, w, h]，归一化坐标 */
  readonly hitbox: Hitbox
}
