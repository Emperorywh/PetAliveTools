/**
 * 音频模块 (audio) — 主进程
 *
 * 负责：音频编排协调（环境声调度、动作触发声、冷却/速率限制、多采样轮播、
 * embeddedAudio 音画同步、全局静音/音量）。
 * 参见 SPEC §11 (音频设计)、§4.8 (音频采集规范)。
 *
 * 运行于主进程。
 */

export { AudioCoordinator } from './audio-coordinator'
export type {
  AudioCoordinatorConfig,
  AudioPlayCommand,
  SendToRenderer,
} from './audio-coordinator'
