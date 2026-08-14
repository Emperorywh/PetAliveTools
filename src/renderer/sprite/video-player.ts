/**
 * 视频精灵播放器 (§6.2)
 *
 * 在透明窗口中播放 WebM-alpha 片段，应用 CSS transform 管线
 * （translate/scale/scaleX）控制位置、尺度和方向，
 * 叠加全局呼吸缩放（§6.3）与可选接触阴影（§6.5）。
 *
 * 逐片段渲染参数 (IR-002)：每个播放指令携带锚定姿态 (§6.2)、
 * 尺度系数 (§7.4 scaleHint)、循环入/出点 (§5.3) 与播放速率 (§9.5)，
 * 切换片段时即时生效。
 *
 * 淡化与缓动 (IR-003)：道具片段 150–250ms 淡入淡出 (§8.4)，
 * 兜底缓动 60–120ms opacity 微缓动 (§8.3)，经精灵层 opacity 实现；
 * 淡化期间不做任何平移（窗口位置由主进程冻结）。
 *
 * 同片段重选 (IR-005)：非循环片段播毕后被再次选中时回到入点重播，
 * 不再冻结在末帧。
 *
 * 运行于渲染进程。
 */

import { breathingScale } from '../composition/breathing'
import {
  type AnchorType,
  type BasePoint,
  type NormalizedPoint,
  type SpriteDimensions,
  computeAnchorOffset,
  getAnchorPoint,
} from '../composition/anchor-alignment'
import {
  type ContactShadowConfig,
  DEFAULT_SHADOW_CONFIG,
  computeShadowStyle,
} from '../composition/contact-shadow'
import { buildTransform, type TransformParams } from '../composition/transform'
import type { PlayClipPayload } from '../../shared/types/play-command'
import {
  type LoopSegment,
  resolveLoopSegment,
  decideReplayAction,
  clampPlaybackRate,
  easingPlan,
} from './clip-playback'

/** 精灵播放器配置 */
export interface SpritePlayerConfig {
  /** 视频片段 URL（WebM-alpha） */
  clipSrc: string
  /** 锚定类型：sit | stand（§4.2） */
  anchorType: AnchorType
  /** 锚点坐标覆盖（可选，默认按 anchorType 取） */
  anchorPointOverride?: NormalizedPoint
  /** 基准坐标（窗口内，精灵锚点对齐的目标位置，§6.2） */
  basePoint: BasePoint
  /** 显示尺度系数 scaleHint（§7.4） */
  scaleHint: number
  /** 是否水平镜像（仅对称宠物，§4.3） */
  flip: boolean
  /** 接触阴影配置（§6.5），默认 DEFAULT_SHADOW_CONFIG */
  shadowConfig?: ContactShadowConfig
  /** 是否循环播放，默认 true */
  loop?: boolean
}

/**
 * 视频精灵播放器。
 *
 * 管理 <video> 元素的生命周期、CSS transform 管线、呼吸动画循环与接触阴影。
 *
 * DOM 结构：
 *   container (absolute, 填满窗口)
 *     ├── shadow-layer (接触阴影)
 *     └── sprite-layer (transform 管线 + opacity 淡化)
 *           └── video (WebM-alpha)
 *
 * transform-origin 设为锚点位置，使锚点在缩放/镜像下保持固定（§6.2）。
 */
export class SpritePlayer {
  private readonly container: HTMLDivElement
  private readonly shadowLayer: HTMLDivElement
  private readonly spriteLayer: HTMLDivElement
  private readonly video: HTMLVideoElement

  private anchorPoint: NormalizedPoint
  private basePoint: BasePoint
  private scaleHint: number
  private flip: boolean
  private shadowConfig: ContactShadowConfig
  private intrinsicSize: SpriteDimensions

  /** 当前片段的循环段 (§5.3)；null = 整文件循环或不循环 */
  private loopSegment: LoopSegment | null = null
  /** 兜底缓动的半程定时器 (§8.3) */
  private easingTimer: ReturnType<typeof setTimeout> | null = null

  private rafId: number | null = null
  private startTime = 0

  constructor(parent: HTMLElement, config: SpritePlayerConfig) {
    this.anchorPoint = config.anchorPointOverride ?? getAnchorPoint(config.anchorType)
    this.basePoint = config.basePoint
    this.scaleHint = config.scaleHint
    this.flip = config.flip
    this.shadowConfig = config.shadowConfig ?? DEFAULT_SHADOW_CONFIG
    this.intrinsicSize = { width: 0, height: 0 }

    // ---- DOM 结构搭建 ----

    this.container = document.createElement('div')
    this.container.id = 'pet-container'
    Object.assign(this.container.style, {
      position: 'absolute',
      left: '0',
      top: '0',
      width: '100%',
      height: '100%',
      overflow: 'visible',
      pointerEvents: 'none',
    })

    // 接触阴影层（§6.5）
    this.shadowLayer = document.createElement('div')
    this.shadowLayer.id = 'contact-shadow'
    Object.assign(this.shadowLayer.style, {
      position: 'absolute',
      borderRadius: '50%',
      background: 'radial-gradient(ellipse, rgba(0,0,0,0.4) 0%, rgba(0,0,0,0) 70%)',
      pointerEvents: 'none',
      willChange: 'transform, opacity',
    })
    this.container.appendChild(this.shadowLayer)

    // 精灵层（CSS transform 管线 + opacity 淡化）
    this.spriteLayer = document.createElement('div')
    this.spriteLayer.id = 'sprite-layer'
    Object.assign(this.spriteLayer.style, {
      position: 'absolute',
      left: '0',
      top: '0',
      transformOrigin: `${this.anchorPoint.x * 100}% ${this.anchorPoint.y * 100}%`,
      willChange: 'transform',
    })
    this.container.appendChild(this.spriteLayer)

    // 视频元素（WebM-alpha 播放）
    this.video = document.createElement('video')
    this.video.src = config.clipSrc
    this.video.loop = config.loop ?? true
    this.video.muted = true
    this.video.playsInline = true
    this.video.autoplay = true
    this.video.style.display = 'block'
    this.spriteLayer.appendChild(this.video)

    parent.appendChild(this.container)

    // 视频元数据加载后获取固有尺寸，重新计算偏移与阴影
    this.video.addEventListener('loadedmetadata', this.handleLoadedMetadata)
    // 循环段兜底监听（§5.3）：rAF 循环外的第二道保险
    this.video.addEventListener('timeupdate', this.handleTimeUpdate)

    // 初始渲染
    this.render(0)
  }

  // ---- 公共 API ----

  /** 启动呼吸动画循环（§6.3） */
  startBreathing(): void {
    if (this.rafId !== null) return
    this.startTime = performance.now()
    this.rafId = requestAnimationFrame(this.tick)
  }

  /** 停止呼吸动画循环 */
  stopBreathing(): void {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId)
      this.rafId = null
    }
  }

  /** 设置接触阴影可见性（§6.5 toggle） */
  setShadowVisible(visible: boolean): void {
    this.shadowConfig = { ...this.shadowConfig, visible }
    this.updateShadow()
  }

  /** 切换水平镜像（仅对称宠物，§4.3） */
  setFlip(flip: boolean): void {
    this.flip = flip
  }

  /** 更新基准坐标（精灵锚点对齐的目标位置） */
  setBasePoint(basePoint: BasePoint): void {
    this.basePoint = basePoint
  }

  /** 视频元素（嵌入式音轨控制 §4.8 / 媒体时间上报 IR-004 用） */
  get videoElement(): HTMLVideoElement {
    return this.video
  }

  /**
   * 动态切换播放片段（由调度器驱动，§9；结构化载荷 IR-002）。
   *
   * 逐片段应用锚定姿态 (§6.2)、尺度系数 (§7.4)、循环段 (§5.3)
   * 与播放速率 (§9.5)；同 src 重选按 IR-005 决策重播或跳过。
   *
   * @param payload 播放载荷（含 clipUrl/mirrored/loop/anchor/scaleHint/循环点/速率）
   */
  playClip(payload: PlayClipPayload): void {
    // 新播放指令复位淡化状态（§8.4 淡出后接锚定片段应立即全显）
    this.cancelFadeAndEasing()
    this.spriteLayer.style.opacity = '1'

    const sameSrc = this.video.src === payload.clipUrl
    const action = decideReplayAction(
      sameSrc,
      payload.loop,
      this.video.paused,
      this.video.ended,
    )

    this.applyClipPayload(payload)

    if (action === 'load') {
      this.video.src = payload.clipUrl
      this.video.currentTime = this.loopSegment?.inSec ?? 0
      this.video.play().catch((): void => {
        /* autoplay 或 CORS 可能失败，静默处理 */
      })
    } else if (action === 'restart') {
      // IR-005：同片段重选且已播毕 → 回入点重播，不再冻末帧
      this.video.currentTime = this.loopSegment?.inSec ?? 0
      this.video.play().catch((): void => {
        /* 静默处理 */
      })
    }
    // 'none'：同片段仍在播放（或循环维持中），仅更新渲染参数
  }

  /**
   * 道具淡入 (§8.4, IR-003)：装载片段并从 opacity 0 渐变到 1。
   *
   * 淡化期间窗口位置保持不动（主进程保证不平移，本层不做位移）。
   *
   * @param payload 淡入目标片段的播放载荷
   * @param durationMs 淡入时长 (ms, 150–250)
   */
  fadeInClip(payload: PlayClipPayload, durationMs: number): void {
    this.cancelFadeAndEasing()
    this.applyClipPayload(payload)

    if (this.video.src !== payload.clipUrl) {
      this.video.src = payload.clipUrl
    }
    this.video.currentTime = this.loopSegment?.inSec ?? 0
    this.video.play().catch((): void => {
      /* 静默处理 */
    })

    // opacity 0 → 1：先瞬时置 0，强制 reflow 后挂 transition
    this.setOpacityImmediate(0)
    this.startOpacityTransition(1, durationMs)
  }

  /**
   * 道具淡出 (§8.4, IR-003)：当前精灵 opacity 渐变到 0。
   *
   * 视频继续播放至片段切换（后续 play 命令复位 opacity）。
   */
  fadeOut(durationMs: number): void {
    this.cancelFadeAndEasing()
    this.startOpacityTransition(0, durationMs)
  }

  /**
   * 兜底缓动 (§8.3, IR-003)：切换点 60–120ms opacity 微缓动。
   *
   * opacity 先降到谷底再恢复，半程各 durationMs/2。
   */
  playEasing(durationMs: number): void {
    this.cancelFadeAndEasing()
    const plan = easingPlan(durationMs)
    this.startOpacityTransition(plan.dipOpacity, plan.halfMs)
    this.easingTimer = setTimeout(() => {
      this.easingTimer = null
      this.startOpacityTransition(1, plan.halfMs)
    }, plan.halfMs)
  }

  /** 销毁播放器，清理 DOM 和动画 */
  destroy(): void {
    this.stopBreathing()
    this.cancelFadeAndEasing()
    this.video.removeEventListener('loadedmetadata', this.handleLoadedMetadata)
    this.video.removeEventListener('timeupdate', this.handleTimeUpdate)
    this.video.src = ''
    this.container.remove()
  }

  // ---- 内部实现 ----

  /**
   * 应用逐片段渲染参数 (IR-002)。
   *
   * 锚点变化时重算 transform-origin，使缩放/镜像围绕新锚点进行 (§6.2)；
   * 循环段有效时改由 timeupdate/rAF 维护 [loopInSec, loopOutSec) 循环 (§5.3)，
   * 否则退回整文件循环。
   */
  private applyClipPayload(payload: PlayClipPayload): void {
    this.anchorPoint = getAnchorPoint(payload.anchor)
    this.spriteLayer.style.transformOrigin =
      `${this.anchorPoint.x * 100}% ${this.anchorPoint.y * 100}%`
    this.scaleHint = payload.scaleHint
    this.flip = payload.mirrored
    this.video.playbackRate = clampPlaybackRate(payload.playbackRate)

    this.loopSegment = resolveLoopSegment(payload.loop, payload.loopInSec, payload.loopOutSec)
    this.video.loop = payload.loop && this.loopSegment === null
  }

  /** 瞬时设置 opacity（无过渡） */
  private setOpacityImmediate(value: number): void {
    this.spriteLayer.style.transition = 'none'
    this.spriteLayer.style.opacity = String(value)
  }

  /** 以线性过渡渐变 opacity 到目标值 */
  private startOpacityTransition(target: number, durationMs: number): void {
    // 强制 reflow，使此前的瞬时 opacity 生效后再挂过渡
    void this.spriteLayer.offsetHeight
    this.spriteLayer.style.transition = `opacity ${Math.max(0, durationMs)}ms linear`
    this.spriteLayer.style.opacity = String(target)
  }

  /** 取消进行中的缓动半程定时器 */
  private cancelFadeAndEasing(): void {
    if (this.easingTimer !== null) {
      clearTimeout(this.easingTimer)
      this.easingTimer = null
    }
    this.spriteLayer.style.transition = 'none'
  }

  /** 循环段维护 (§5.3)：到达出点时 seek 回入点（timeupdate 兜底通道） */
  private readonly handleTimeUpdate = (): void => {
    this.enforceLoopSegment()
  }

  /** 循环段维护 (§5.3)：到达出点时 seek 回入点 */
  private enforceLoopSegment(): void {
    const seg = this.loopSegment
    if (!seg || this.video.paused) return
    if (this.video.currentTime >= seg.outSec) {
      this.video.currentTime = seg.inSec
    }
  }

  private readonly tick = (now: number): void => {
    const elapsed = now - this.startTime
    this.render(elapsed)
    this.rafId = requestAnimationFrame(this.tick)
  }

  /** 渲染一帧：维护循环段、更新精灵变换与阴影 */
  private render(elapsedMs: number): void {
    // rAF 通道循环段维护（§5.3，帧级精度；timeupdate 为兜底）
    this.enforceLoopSegment()

    const breathing = breathingScale(elapsedMs)
    const offset = computeAnchorOffset(this.anchorPoint, this.intrinsicSize, this.basePoint)

    const params: TransformParams = {
      translateX: offset.x,
      translateY: offset.y,
      scale: this.scaleHint,
      flip: this.flip,
      breathing,
    }
    this.spriteLayer.style.transform = buildTransform(params)

    // 阴影随呼吸联动（随 scale 缩放，§6.5）
    const effectiveWidth = this.intrinsicSize.width * this.scaleHint * breathing
    this.renderShadow(effectiveWidth)
  }

  /** 仅更新阴影（不经过呼吸循环时使用） */
  private updateShadow(): void {
    const effectiveWidth = this.intrinsicSize.width * this.scaleHint
    this.renderShadow(effectiveWidth)
  }

  /** 渲染接触阴影位置与样式 */
  private renderShadow(effectiveWidth: number): void {
    const style = computeShadowStyle(effectiveWidth, this.shadowConfig)
    // 阴影中心对齐基准坐标（精灵锚点 = 足部/臀部着地点）
    const shadowX = this.basePoint.x - style.width / 2
    const shadowY = this.basePoint.y - style.height / 2
    this.shadowLayer.style.width = `${style.width}px`
    this.shadowLayer.style.height = `${style.height}px`
    this.shadowLayer.style.left = `${shadowX}px`
    this.shadowLayer.style.top = `${shadowY}px`
    this.shadowLayer.style.opacity = String(style.opacity)
  }

  private readonly handleLoadedMetadata = (): void => {
    const w = this.video.videoWidth
    const h = this.video.videoHeight
    if (w > 0 && h > 0) {
      this.intrinsicSize = { width: w, height: h }
      this.video.style.width = `${w}px`
      this.video.style.height = `${h}px`
    }
  }
}
