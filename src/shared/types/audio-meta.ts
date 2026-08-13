/**
 * 音频素材元数据 (AudioMeta)
 *
 * 参见 SPEC §11 (音频设计)、§4.8 (音频采集规范)、§12.1 (audio.meta.json)。
 *
 * 音频与视频分离入库 (§11.1)。跨进程共享类型。
 */

/** 音频类别 (§11.1)：ambient=环境声(节律随机), action=动作触发声 */
export type AudioCategory = 'ambient' | 'action'

/**
 * 音频素材元数据
 *
 * 被 ClipMeta.audio 字段或行为引擎按 id 引用。
 */
export interface AudioMeta {
  /** 唯一标识，如 "meow_02" */
  readonly id: string
  /** 文件名，位于项目 audio/ 目录下 */
  readonly file: string
  /** 人类可读标签 */
  readonly label: string
  /** 类别 (§11.1) */
  readonly category: AudioCategory
  /** 冷却时间 (秒)：每次发声后冷却 (§11.2) */
  readonly cooldownSec: number
  /** 单位时间上限 (次/小时)：防噪音 (§11.2) */
  readonly maxPerHour: number
}
