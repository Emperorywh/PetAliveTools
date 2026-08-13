/**
 * 视频精灵播放器 (§6.2)
 *
 * 在透明窗口中播放 WebM-alpha 片段，应用 CSS transform 管线
 * （translate/scale/scaleX）控制位置、尺度和方向，
 * 叠加全局呼吸缩放（§6.3）与可选接触阴影（§6.5）。
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
 *     └── sprite-layer (transform 管线)
 *           └── video (WebM-alpha)
 *
 * transform-origin 设为锚点位置，使锚点在缩放/镜像下保持固定（§6.2）。
 */
export class SpritePlayer {
  private readonly container: HTMLDivElement
  private readonly shadowLayer: HTMLDivElement
  private readonly spriteLayer: HTMLDivElement
  private readonly video: HTMLVideoElement

  private readonly anchorPoint: NormalizedPoint
  private basePoint: BasePoint
  private scaleHint: number
  private flip: boolean
  private shadowConfig: ContactShadowConfig
  private intrinsicSize: SpriteDimensions

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

    // 精灵层（CSS transform 管线）
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

  /**
   * 动态切换播放片段（由调度器驱动，§9）。
   *
   * @param src WebM-alpha 片段 URL（file:// 路径）
   * @param mirrored 是否水平镜像（仅对称宠物，§4.3）
   * @param loop 是否循环播放
   */
  playClip(src: string, mirrored: boolean, loop: boolean): void {
    this.video.loop = loop
    if (this.video.src !== src) {
      this.video.src = src
      this.video.play().catch((): void => {
        /* autoplay 或 CORS 可能失败，静默处理 */
      })
    }
    this.flip = mirrored
  }

  /** 销毁播放器，清理 DOM 和动画 */
  destroy(): void {
    this.stopBreathing()
    this.video.removeEventListener('loadedmetadata', this.handleLoadedMetadata)
    this.video.src = ''
    this.container.remove()
  }

  // ---- 内部实现 ----

  private readonly tick = (now: number): void => {
    const elapsed = now - this.startTime
    this.render(elapsed)
    this.rafId = requestAnimationFrame(this.tick)
  }

  /** 渲染一帧：更新精灵变换与阴影 */
  private render(elapsedMs: number): void {
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
