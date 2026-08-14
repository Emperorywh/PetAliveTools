/**
 * 音频编排协调器 (AudioCoordinator) — 主进程 (§11)
 *
 * 集中管理全部音频决策：
 *   - 环境声调度 (§11.1 节律随机，昼夜频率变化)
 *   - 动作触发声 (§11.1 抚摸/进食/玩耍等)
 *   - 冷却与速率限制 (§11.2)
 *   - 多采样轮播 (§11.2)
 *   - embeddedAudio 音画同步 (§11.1)
 *   - 全局静音与音量 (§11.2)
 *
 * 通过回调通知渲染进程执行实际播放，自身不操作 DOM。
 * 运行于主进程，决策逻辑为纯函数驱动。
 */

import type { ClipMeta } from '../../shared/types/clip-meta'
import type { AudioMeta } from '../../shared/types/audio-meta'
import type { RhythmConfig } from '../../shared/types/behavior-config'
import { isNightTime } from '../behavior/rhythm'
import {
  type AudioLibrary,
  type AudioSampleGroup,
  type RotationState,
  type CooldownState,
  type AmbientConfig,
  type AmbientScheduleState,
  buildAudioLibrary,
  getByCategory,
  createRotationState,
  pickNextSample,
  createCooldownState,
  tryPlay,
  resolveActionAudio,
  resolveClipAudio,
  DEFAULT_AMBIENT_CONFIG,
  computeNextAmbientIntervalSec,
  createAmbientScheduleState,
  shouldPlayAmbient,
  scheduleNextAmbient,
} from '../../shared/audio'
import {
  type AudioConfig,
  DEFAULT_AUDIO_CONFIG,
  clampVolume,
  updateAudioConfig,
} from '../../shared/audio'

/** 渲染进程播放指令 */
export type AudioPlayCommand =
  | { readonly kind: 'play'; readonly file: string; readonly volume: number }
  | { readonly kind: 'embedded_start' }
  | { readonly kind: 'embedded_stop' }

/** 发送到渲染进程的回调 */
export type SendToRenderer = (command: AudioPlayCommand) => void

/** 获取当前时间 (ms) */
type NowProvider = () => number

/** 获取当前小时 (用于昼夜判定) */
type HourProvider = () => number

/** 音频协调器配置 */
export interface AudioCoordinatorConfig {
  /** 节律配置 (§9.3, 用于昼夜判定) */
  readonly rhythmConfig: RhythmConfig
  /** 环境声配置 (§11.1) */
  readonly ambientConfig?: AmbientConfig
  /** 音频配置 (音量/静音/频率) */
  readonly audioConfig?: AudioConfig
  /** 随机源 (测试可注入) */
  readonly rng?: () => number
  /** 时间提供器 (测试可注入) */
  readonly now?: () => number
  /** 小时提供器 (测试可注入) */
  readonly hour?: () => number
}

/**
 * 音频编排协调器。
 *
 * 使用方式：
 *   const coord = new AudioCoordinator(library, config, sendToRenderer)
 *   coord.start()           // 启动环境声调度
 *   coord.onActionTriggered('petted', clip)  // 交互触发
 *   coord.setMuted(true)    // 全局静音
 *   coord.dispose()          // 清理
 */
export class AudioCoordinator {
  private library: AudioLibrary
  private config: AudioConfig
  private readonly ambientConfig: AmbientConfig
  private rhythmConfig: RhythmConfig
  private readonly rng: () => number
  private readonly now: NowProvider
  private readonly hour: HourProvider
  private readonly sendToRenderer: SendToRenderer

  private cooldownState: CooldownState = createCooldownState()
  private rotationState: RotationState = createRotationState()
  private ambientState: AmbientScheduleState | null = null
  private ambientTimer: ReturnType<typeof setInterval> | null = null
  private embeddedActive = false

  constructor(
    audioEntries: readonly AudioMeta[],
    config: AudioCoordinatorConfig,
    sendToRenderer: SendToRenderer,
  ) {
    this.library = buildAudioLibrary(audioEntries)
    this.config = config.audioConfig ?? DEFAULT_AUDIO_CONFIG
    this.ambientConfig = config.ambientConfig ?? DEFAULT_AMBIENT_CONFIG
    this.rhythmConfig = config.rhythmConfig
    this.rng = config.rng ?? Math.random
    this.now = config.now ?? Date.now
    this.hour = config.hour ?? (() => new Date().getHours())
    this.sendToRenderer = sendToRenderer
  }

  // —— 环境声调度 (§11.1) —— //

  /**
   * 启动环境声调度循环。
   *
   * 定期检查是否到了播放环境声的时间，并执行播放决策。
   */
  start(): void {
    if (this.ambientTimer) return
    const intervalSec = this.computeInterval()
    this.ambientState = createAmbientScheduleState(this.now(), intervalSec)
    // 每 5 秒检查一次（足够精确，不浪费 CPU）
    this.ambientTimer = setInterval(() => this.tickAmbient(), 5_000)
  }

  /** 停止环境声调度 */
  stop(): void {
    if (this.ambientTimer) {
      clearInterval(this.ambientTimer)
      this.ambientTimer = null
    }
  }

  /**
   * 单次环境声调度检查（可被外部定时器驱动）。
   *
   * 暴露为公开方法以便集成测试在不依赖 setInterval 的情况下驱动。
   */
  tickAmbient(): void {
    if (!this.ambientState || this.config.muted) return
    const nowMs = this.now()
    if (!shouldPlayAmbient(this.ambientState, nowMs)) return

    // 尝试播放环境声
    this.tryPlayAmbient(nowMs)

    // 调度下次
    const intervalSec = this.computeInterval()
    this.ambientState = scheduleNextAmbient(nowMs, intervalSec)
  }

  /**
   * 尝试播放一个环境声。
   *
   * 从环境声类别中随机选择，经冷却/速率限制检查后播放。
   * 所有环境声均在冷却中时跳过本次。
   */
  private tryPlayAmbient(nowMs: number): void {
    const ambientEntries = getByCategory(this.library, 'ambient')
    if (ambientEntries.length === 0) return

    // 尝试找到一个可播放的环境声
    // 随机打乱顺序，最多尝试全部条目
    const shuffled = [...ambientEntries]
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(this.rng() * (i + 1))
      ;[shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]
    }

    for (const entry of shuffled) {
      const result = tryPlay(this.cooldownState, entry.id, entry, nowMs)
      this.cooldownState = result.state
      if (result.allowed) {
        this.sendToRenderer({
          kind: 'play',
          file: entry.file,
          volume: this.config.volume,
        })
        return
      }
    }
    // 全部在冷却中 → 跳过本次
  }

  // —— 动作触发声 (§11.1) —— //

  /**
   * 交互/状态动作触发声 (§11.1)。
   *
   * 解析动作对应的音频，检查 embeddedAudio 例外 (§11.1)，
   * 经冷却/速率限制后通过回调播放。
   *
   * @param action 交互/状态键（如 'petted', 'eat', 'play'）
   * @param clip 关联片段（可为 null）
   */
  onActionTriggered(action: string, clip: ClipMeta | null): void {
    if (this.config.muted) return

    const resolution = resolveActionAudio(action, clip)

    // embeddedAudio：播放内嵌音轨 (§11.1)
    if (resolution.isEmbedded) {
      this.embeddedActive = true
      this.sendToRenderer({ kind: 'embedded_start' })
      return
    }

    if (!resolution.audioId) return

    this.playAudioId(resolution.audioId)
  }

  /**
   * 内嵌音频片段结束通知。
   *
   * 在 embeddedAudio 片段播毕后调用，通知渲染进程停止内嵌音频。
   */
  onEmbeddedAudioEnded(): void {
    if (this.embeddedActive) {
      this.embeddedActive = false
      this.sendToRenderer({ kind: 'embedded_stop' })
    }
  }

  /**
   * 按音频 id 或组前缀播放声效（经冷却/速率限制/多采样轮播）。
   */
  private playAudioId(audioId: string): void {
    const nowMs = this.now()
    const resolved = resolveClipAudio(this.library, audioId)

    if (!resolved) return

    let entry: AudioMeta | null = null

    if (resolved.kind === 'group') {
      // 多采样轮播 (§11.2)
      const group: AudioSampleGroup = resolved.group
      const pick = pickNextSample(this.rotationState, group, this.rng)
      this.rotationState = pick.state
      entry = pick.sample
    } else {
      entry = resolved.meta
    }

    if (!entry) return

    // 冷却/速率限制检查 (§11.2)
    const result = tryPlay(this.cooldownState, entry.id, entry, nowMs)
    this.cooldownState = result.state
    if (!result.allowed) return

    this.sendToRenderer({
      kind: 'play',
      file: entry.file,
      volume: this.config.volume,
    })
  }

  // —— 音量与静音 (§11.2) —— //

  /**
   * 更新音频素材库 (§11.1)。
   *
   * 在 profile 切换、导入片段或 zip 导入后调用，
   * 使协调器使用最新的 audio.meta.json 条目。
   */
  setLibrary(audioEntries: readonly AudioMeta[]): void {
    this.library = buildAudioLibrary(audioEntries)
  }

  /** 设置全局静音 (§11.2) */
  setMuted(muted: boolean): void {
    this.config = updateAudioConfig(this.config, { muted })
  }

  /** 切换静音 */
  toggleMute(): boolean {
    this.setMuted(!this.config.muted)
    return this.config.muted
  }

  /** 当前是否静音 */
  get isMuted(): boolean {
    return this.config.muted
  }

  /** 设置全局音量 (0.0–1.0) (§11.2) */
  setVolume(volume: number): void {
    this.config = updateAudioConfig(this.config, { volume: clampVolume(volume) })
  }

  /** 当前音量 */
  get volume(): number {
    return this.config.volume
  }

  /** 设置环境声频率倍率 (§11.1) */
  setAmbientFrequency(freq: number): void {
    this.config = updateAudioConfig(this.config, { ambientFrequency: freq })
  }

  /**
   * 更新昼夜节律配置 (§9.3, IR-015)。
   *
   * 项目 behavior-config.json 的 rhythm 设置在调度器重建/设置更新时下发，
   * 使环境声频率判定与 FSM 使用同一份昼夜时段定义。
   * 影响下一次环境声间隔计算（computeInterval）。
   */
  setRhythmConfig(rhythmConfig: RhythmConfig): void {
    this.rhythmConfig = rhythmConfig
  }

  // —— 内部 —— //

  /** 计算当前昼夜状态下的环境声间隔 */
  private computeInterval(): number {
    const isNight = isNightTime(this.hour(), this.rhythmConfig)
    const config: AmbientConfig = {
      ...this.ambientConfig,
      frequencyMultiplier: this.config.ambientFrequency,
    }
    return computeNextAmbientIntervalSec(config, isNight, this.rng)
  }

  /** 清理资源 */
  dispose(): void {
    this.stop()
  }
}
