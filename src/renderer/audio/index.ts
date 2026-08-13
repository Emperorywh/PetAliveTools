/**
 * 音频模块 (audio) — 渲染进程
 *
 * 负责：实际声音播放 (AudioPlayer)、音量与静音控制 (§11.2)、
 * embeddedAudio 音画同步 (§4.8, §11.1)。
 * 参见 SPEC §11 (音频设计)。
 *
 * 运行于渲染进程。
 */

export { AudioPlayer } from './player'
export type { AudioPlayerConfig } from './player'
