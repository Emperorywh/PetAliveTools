/**
 * 音频播放器 (AudioPlayer) — 渲染进程 (§11)
 *
 * 管理实际的声音播放，使用 HTML5 Audio API：
 *   - 环境声与动作触发声通过 <audio> 元素播放音频文件
 *   - embeddedAudio 片段通过视频元素内嵌音轨同步播放 (§11.1)
 *   - 全局音量与静音控制 (§11.2)
 *
 * 接收主进程 IPC 命令执行播放。
 * 运行于渲染进程。
 */

import { isAbsoluteUrl } from '../../shared/media-url'

/** 音频播放器配置 */
export interface AudioPlayerConfig {
  /** 音频文件基路径（项目 audio/ 目录的 URL） */
  readonly audioBaseUrl: string
  /** 初始音量 (0.0–1.0)，默认偏低 (§11.2) */
  readonly defaultVolume: number
}

/**
 * 音频播放器。
 *
 * 维护一个 <audio> 元素池以支持多个声效同时播放（环境声 + 动作声）。
 * 静音时所有声效均不发声。
 */
export class AudioPlayer {
  private muted = false
  private volume: number
  private readonly audioBaseUrl: string
  private readonly pool: HTMLAudioElement[] = []
  private readonly maxPoolSize = 8
  /** 各播放元素的音量增益（IR-016：setVolume 实时重算播放中元素音量） */
  private readonly gains = new WeakMap<HTMLAudioElement, number>()
  /** 当前启用内嵌音轨的视频元素（§4.8；音量调节实时联动, IR-016） */
  private embeddedVideo: HTMLVideoElement | null = null

  constructor(config: AudioPlayerConfig) {
    this.audioBaseUrl = config.audioBaseUrl
    this.volume = config.defaultVolume
  }

  /**
   * 播放一个音频文件。
   *
   * 从池中取一个空闲的 <audio> 元素播放，播毕自动归还。
   * 静音时不播放但仍消耗请求（避免积压）。
   *
   * @param file 音频文件 URL 或路径（file:// 绝对 URL 或相对于 audioBaseUrl 的文件名）
   * @param volumeGain 额外音量增益（0.0–1.0），与全局音量相乘
   */
  playSound(file: string, volumeGain = 1.0): void {
    if (this.muted) return

    const audio = this.acquireElement()
    // 主进程下发绝对 URL（petmedia:// 等）时直接使用；否则相对于 audioBaseUrl 解析
    audio.src = isAbsoluteUrl(file) ? file : `${this.audioBaseUrl}/${file}`
    this.gains.set(audio, volumeGain)
    audio.volume = Math.min(1, this.volume * volumeGain)

    audio.play().catch(() => {
      // 自动播放策略或文件缺失：静默处理，不崩溃
    })

    audio.addEventListener('ended', () => this.releaseElement(audio), { once: true })
  }

  /**
   * 启用内嵌音频：取消视频元素的静音并设置音量 (§11.1)。
   *
   * embeddedAudio=true 的片段播放时调用，
   * 使视频自身的音轨发声以实现音画同步。
   */
  enableEmbeddedAudio(video: HTMLVideoElement): void {
    this.embeddedVideo = video
    video.muted = this.muted
    video.volume = this.volume
  }

  /**
   * 禁用内嵌音频：将视频元素静音。
   *
   * embeddedAudio 片段播毕后调用，恢复常规静音状态。
   */
  disableEmbeddedAudio(video: HTMLVideoElement): void {
    if (this.embeddedVideo === video) this.embeddedVideo = null
    video.muted = true
  }

  /** 设置全局静音 (§11.2) */
  setMuted(muted: boolean): void {
    this.muted = muted
    if (muted) {
      // 立即停止所有正在播放的声效
      for (const audio of this.pool) {
        audio.pause()
        audio.currentTime = 0
      }
      // 内嵌音轨同步静音
      if (this.embeddedVideo) this.embeddedVideo.muted = true
    } else if (this.embeddedVideo) {
      this.embeddedVideo.muted = false
    }
  }

  /** 当前是否静音 */
  get isMuted(): boolean {
    return this.muted
  }

  /**
   * 设置全局音量 (0.0–1.0)。
   *
   * IR-016：实时作用于播放中的 <audio> 池元素与内嵌音轨视频，
   * 不再只影响之后播放的声响。
   */
  setVolume(volume: number): void {
    this.volume = Math.min(1, Math.max(0, volume))
    for (const audio of this.pool) {
      if (!audio.paused && !audio.ended) {
        audio.volume = Math.min(1, this.volume * (this.gains.get(audio) ?? 1))
      }
    }
    if (this.embeddedVideo) {
      this.embeddedVideo.volume = this.volume
    }
  }

  /** 当前音量 */
  get currentVolume(): number {
    return this.volume
  }

  // —— 内部 —— //

  /** 从池中获取或创建一个 <audio> 元素 */
  private acquireElement(): HTMLAudioElement {
    // 查找空闲元素（paused 或 ended）
    for (const audio of this.pool) {
      if (audio.paused || audio.ended) {
        audio.currentTime = 0
        return audio
      }
    }
    // 池未满则创建新元素
    if (this.pool.length < this.maxPoolSize) {
      const audio = new Audio()
      audio.preload = 'auto'
      this.pool.push(audio)
      return audio
    }
    // 池满：复用第一个元素（强制打断）
    const oldest = this.pool[0]
    oldest.pause()
    oldest.currentTime = 0
    return oldest
  }

  /** 归还元素到池（标记为可用） */
  private releaseElement(audio: HTMLAudioElement): void {
    audio.currentTime = 0
  }

  /** 清理资源 */
  dispose(): void {
    for (const audio of this.pool) {
      audio.pause()
      audio.src = ''
    }
    this.pool.length = 0
  }
}
