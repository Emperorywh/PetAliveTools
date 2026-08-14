/**
 * 原样视频片段播放器。
 *
 * 播放器只把导入文件交给 HTMLVideoElement：不抠像、不裁剪、不镜像、
 * 不修改速率，也不读取 currentTime 驱动窗口移动。
 */

import type { PlayClipPayload } from '../../shared/types/play-command'
import { decideReplayAction } from './clip-playback'

/**
 * 播放器配置只保留片段自然结束通知。
 * 循环片段由 video.loop 整段循环，因此不会触发结束通知。
 */
export interface SpritePlayerConfig {
  readonly onClipEnded?: (clipId: string) => void
}

/**
 * 使用单个 video 元素直接播放项目片段。
 * 淡入淡出只作用于容器透明度，不会改写媒体文件或采样视频帧。
 */
export class SpritePlayer {
  private readonly container: HTMLDivElement
  private readonly video: HTMLVideoElement
  private currentClipId: string | null = null
  private transitionTimer: ReturnType<typeof setTimeout> | null = null

  constructor(
    host: HTMLElement,
    private readonly config: SpritePlayerConfig = {},
  ) {
    this.container = document.createElement('div')
    this.container.className = 'sprite-player'
    Object.assign(this.container.style, {
      position: 'absolute',
      inset: '0',
      overflow: 'hidden',
      opacity: '1',
    })

    this.video = document.createElement('video')
    this.video.autoplay = true
    this.video.playsInline = true
    this.video.muted = true
    this.video.preload = 'auto'
    Object.assign(this.video.style, {
      width: '100%',
      height: '100%',
      objectFit: 'contain',
      display: 'block',
      pointerEvents: 'none',
    })
    this.video.addEventListener('ended', this.handleEnded)

    this.container.appendChild(this.video)
    host.appendChild(this.container)
  }

  /**
   * 暴露原生 video 元素仅供全局音量与静音控制。
   * 调用方不得用它采样帧或驱动窗口位移。
   */
  get videoElement(): HTMLVideoElement {
    return this.video
  }

  /**
   * 直接播放载荷指定的完整文件。
   * 相同片段仍在播放时保持当前播放，播毕后重选才从头开始。
   */
  playClip(payload: PlayClipPayload): void {
    this.cancelTransition()
    this.container.style.opacity = '1'
    const sameSrc = this.video.src === payload.clipUrl
    const action = decideReplayAction(
      sameSrc,
      payload.loop,
      this.video.paused,
      this.video.ended,
    )

    this.currentClipId = payload.clipId
    this.video.loop = payload.loop

    if (action === 'load') {
      this.video.src = payload.clipUrl
      void this.video.play().catch(() => {})
    } else if (action === 'restart') {
      this.video.currentTime = 0
      void this.video.play().catch(() => {})
    }
  }

  /**
   * 装载完整片段并做容器淡入。
   * 媒体本身仍按原文件、原速率播放。
   */
  fadeInClip(payload: PlayClipPayload, durationMs: number): void {
    this.playClip(payload)
    this.setOpacityImmediate(0)
    void this.container.offsetHeight
    this.container.style.transition = `opacity ${Math.max(0, durationMs)}ms linear`
    this.container.style.opacity = '1'
  }

  /**
   * 对当前播放器容器做淡出。
   * 该效果不会改变视频像素或生成新媒体文件。
   */
  fadeOut(durationMs: number): void {
    this.cancelTransition()
    this.container.style.transition = `opacity ${Math.max(0, durationMs)}ms linear`
    this.container.style.opacity = '0'
  }

  /**
   * 在片段切换时做短暂透明度缓动。
   * 这是窗口合成效果，与视频处理无关。
   */
  playEasing(durationMs: number): void {
    this.cancelTransition()
    const halfMs = Math.max(0, durationMs / 2)
    this.container.style.transition = `opacity ${halfMs}ms linear`
    this.container.style.opacity = '0.85'
    this.transitionTimer = setTimeout(() => {
      this.transitionTimer = null
      this.container.style.transition = `opacity ${halfMs}ms linear`
      this.container.style.opacity = '1'
    }, halfMs)
  }

  /**
   * 销毁播放器并解除事件监听。
   * 原始视频文件不受影响。
   */
  destroy(): void {
    this.cancelTransition()
    this.video.removeEventListener('ended', this.handleEnded)
    this.video.src = ''
    this.container.remove()
  }

  /**
   * 非循环片段自然结束时通知调度器推进。
   * 不上报 currentTime，也不计算任何位移。
   */
  private readonly handleEnded = (): void => {
    if (this.video.loop || !this.currentClipId) return
    this.config.onClipEnded?.(this.currentClipId)
  }

  /**
   * 立即设置容器透明度并清除旧过渡。
   * 用于淡入开始帧。
   */
  private setOpacityImmediate(value: number): void {
    this.container.style.transition = 'none'
    this.container.style.opacity = String(value)
  }

  /**
   * 清理尚未完成的透明度定时器。
   * 片段切换时避免旧动画干扰新文件播放。
   */
  private cancelTransition(): void {
    if (this.transitionTimer !== null) {
      clearTimeout(this.transitionTimer)
      this.transitionTimer = null
    }
    this.container.style.transition = 'none'
  }
}
