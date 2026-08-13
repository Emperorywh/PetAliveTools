/**
 * 色键抠像预览 + 边缘放大检查 (§5.5)
 *
 * 导入流程的抠像质量闸门：并排显示源帧与抠像结果（棋盘格衬底显示
 * 透明区域），点击结果任意位置设定检查点，放大面板按最近邻放大
 * 显示该处边缘逐像素细节（可切换查看 alpha 蒙版），用于发现毛边、
 * 溢色、半透明绒毛损失等质量悬崖。
 *
 * 运行于渲染进程，色键运算直接调用 src/shared/pipeline 内核
 * （与主进程转码管线同一实现，预览即所得）。
 *
 * 手动验证入口：PETALIVE_VIEW=chroma-preview npm run dev
 * （主进程据此创建普通工具窗口加载 #chroma-preview 视图；
 *  demo 使用合成毛发场景，也可通过 update() 换成真实视频帧）。
 */

import {
  type ChromaKeyOptions,
  type EdgeProcessingOptions,
  type KeyedFrame,
  type RawFrame,
  applyChromaKey
} from '../../shared/pipeline'
import { computeZoomRect } from './zoom-inspect'

/** 预览状态 */
export interface ChromaKeyPreviewState {
  /** 源帧 */
  readonly source: RawFrame
  /** 空背景参考帧（配合 referenceAssist 启用减除辅助） */
  readonly referenceFrame: RawFrame | null
  /** 参考帧减除参数（null = 不启用；需同时提供 referenceFrame） */
  readonly referenceAssist: { tolerance: number; softness?: number; influence?: number } | null
  /** 色键选项 */
  readonly key: ChromaKeyOptions
  /** 边缘处理选项 */
  readonly edge: EdgeProcessingOptions
  /** 放大面板显示 alpha 蒙版（灰度）而非抠像结果 */
  readonly showAlphaMask: boolean
  /** 边缘检查点（源图像像素坐标，null = 画面中心） */
  readonly inspect: { x: number; y: number } | null
  /** 放大倍率 */
  readonly zoomFactor: number
  /** 取景框源尺寸（像素） */
  readonly zoomSize: number
}

/** 棋盘格衬底参数（显示透明区域） */
const CHECKER_SIZE = 8
const CHECKER_LIGHT = '#3a3f4a'
const CHECKER_DARK = '#2a2e36'
/** 检查点/取景框标注色 */
const MARKER_COLOR = '#ff4d6d'

/**
 * 色键抠像预览。
 *
 * 在容器内挂载三块画布（源帧 / 抠像结果 / 边缘放大），点击结果画布
 * 设定检查点。状态更新统一走 update()：重算色键并整体重绘。
 */
export class ChromaKeyPreview {
  private readonly container: HTMLElement
  private readonly sourceCanvas: HTMLCanvasElement
  private readonly resultCanvas: HTMLCanvasElement
  private readonly zoomCanvas: HTMLCanvasElement
  private readonly clickHandler: (event: MouseEvent) => void
  private state: ChromaKeyPreviewState
  private keyed: KeyedFrame | null = null
  private disposed = false

  constructor(container: HTMLElement, initialState: ChromaKeyPreviewState) {
    this.container = container
    this.state = initialState

    const { sourceCanvas, resultCanvas, zoomCanvas } = this.createPreviewDom()
    this.sourceCanvas = sourceCanvas
    this.resultCanvas = resultCanvas
    this.zoomCanvas = zoomCanvas

    this.clickHandler = (event) => {
      const rect = this.resultCanvas.getBoundingClientRect()
      const scaleX = this.state.source.width / rect.width
      const scaleY = this.state.source.height / rect.height
      const x = Math.floor((event.clientX - rect.left) * scaleX)
      const y = Math.floor((event.clientY - rect.top) * scaleY)
      this.setInspectPoint(x, y)
    }
    this.resultCanvas.addEventListener('click', this.clickHandler)

    this.render()
  }

  /** 在容器内创建三面板预览 DOM */
  private createPreviewDom(): {
    sourceCanvas: HTMLCanvasElement
    resultCanvas: HTMLCanvasElement
    zoomCanvas: HTMLCanvasElement
  } {
    this.container.innerHTML = ''

    const root = document.createElement('div')
    root.className = 'ckp-root'

    const makePanel = (label: string): HTMLCanvasElement => {
      const panel = document.createElement('div')
      panel.className = 'ckp-panel'
      const caption = document.createElement('div')
      caption.className = 'ckp-caption'
      caption.textContent = label
      const canvas = document.createElement('canvas')
      canvas.className = 'ckp-canvas'
      panel.appendChild(caption)
      panel.appendChild(canvas)
      root.appendChild(panel)
      return canvas
    }

    const sourceCanvas = makePanel('源帧（原始）')
    const resultCanvas = makePanel('抠像结果（点击设定边缘检查点）')
    const zoomCanvas = makePanel('边缘放大（最近邻）')
    this.container.appendChild(root)

    return { sourceCanvas, resultCanvas, zoomCanvas }
  }

  /** 更新部分状态并重绘（source/key/edge/referenceFrame 等任意子集） */
  update(partial: Partial<ChromaKeyPreviewState>): void {
    if (this.disposed) {
      throw new Error('ChromaKeyPreview is disposed')
    }
    this.state = { ...this.state, ...partial }
    this.render()
  }

  /** 设定边缘检查点（源图像像素坐标） */
  setInspectPoint(x: number, y: number): void {
    this.update({
      inspect: {
        x: Math.min(this.state.source.width - 1, Math.max(0, x)),
        y: Math.min(this.state.source.height - 1, Math.max(0, y))
      }
    })
  }

  /** 最近一次色键结果（供外层读取指标/写盘） */
  getResult(): KeyedFrame | null {
    return this.keyed
  }

  /** 重算色键并重绘全部画布 */
  render(): void {
    const { source } = this.state

    // 1. 色键运算（shared 内核）
    this.keyed = applyChromaKey(source, this.buildKeyOptions())

    // 2. 源帧
    drawFrame(this.sourceCanvas, source)

    // 3. 抠像结果（棋盘格衬底 + 检查框标注）
    drawCheckerboard(this.resultCanvas, source.width, source.height)
    drawFrameOver(this.resultCanvas, this.keyed.frame)
    this.drawInspectMarker()

    // 4. 边缘放大
    this.drawZoom()
  }

  /** 合成最终色键选项：referenceFrame 与 referenceAssist 同时提供才启用减除辅助 */
  private buildKeyOptions(): ChromaKeyOptions & { edge?: EdgeProcessingOptions | null } {
    const { key, referenceFrame, referenceAssist, edge } = this.state
    return {
      ...key,
      reference:
        referenceFrame && referenceAssist ? { frame: referenceFrame, ...referenceAssist } : null,
      edge
    }
  }

  /** 在结果画布上标注检查点与取景框 */
  private drawInspectMarker(): void {
    const ctx = this.resultCanvas.getContext('2d')
    if (!ctx) return
    const { inspect, zoomSize, source } = this.state
    const px = inspect?.x ?? Math.floor(source.width / 2)
    const py = inspect?.y ?? Math.floor(source.height / 2)
    const rect = computeZoomRect(px, py, zoomSize, source.width, source.height)

    ctx.strokeStyle = MARKER_COLOR
    ctx.fillStyle = MARKER_COLOR
    ctx.lineWidth = 1
    ctx.strokeRect(rect.x + 0.5, rect.y + 0.5, rect.w - 1, rect.h - 1)
    ctx.beginPath()
    ctx.arc(px, py, 2, 0, Math.PI * 2)
    ctx.fill()
  }

  /** 放大面板：取景框内容最近邻放大（或显示 alpha 蒙版灰度） */
  private drawZoom(): void {
    const ctx = this.zoomCanvas.getContext('2d')
    if (!ctx || !this.keyed) return
    const { source, zoomFactor, zoomSize, showAlphaMask, inspect } = this.state
    const px = inspect?.x ?? Math.floor(source.width / 2)
    const py = inspect?.y ?? Math.floor(source.height / 2)
    const rect = computeZoomRect(px, py, zoomSize, source.width, source.height)

    // 抠像结果/蒙版先画到与源同尺寸的离屏画布，再最近邻放大取景框
    const off = document.createElement('canvas')
    off.width = source.width
    off.height = source.height
    if (showAlphaMask) {
      drawAlphaMask(off, this.keyed.alpha, source.width, source.height)
    } else {
      drawCheckerboard(off, source.width, source.height)
      drawFrameOver(off, this.keyed.frame)
    }

    const scaledW = rect.w * zoomFactor
    const scaledH = rect.h * zoomFactor
    if (this.zoomCanvas.width !== scaledW || this.zoomCanvas.height !== scaledH) {
      this.zoomCanvas.width = scaledW
      this.zoomCanvas.height = scaledH
    }
    ctx.imageSmoothingEnabled = false
    ctx.clearRect(0, 0, scaledW, scaledH)
    ctx.drawImage(off, rect.x, rect.y, rect.w, rect.h, 0, 0, scaledW, scaledH)

    // 检查点十字线
    ctx.strokeStyle = 'rgba(255, 77, 109, 0.7)'
    ctx.lineWidth = 1
    const cx = (px - rect.x + 0.5) * zoomFactor
    const cy = (py - rect.y + 0.5) * zoomFactor
    ctx.beginPath()
    ctx.moveTo(cx, 0)
    ctx.lineTo(cx, scaledH)
    ctx.moveTo(0, cy)
    ctx.lineTo(scaledW, cy)
    ctx.stroke()
  }

  dispose(): void {
    this.disposed = true
    this.resultCanvas.removeEventListener('click', this.clickHandler)
    this.container.innerHTML = ''
  }
}

/** 把帧画到画布（尺寸对齐帧，替换全部像素） */
function drawFrame(canvas: HTMLCanvasElement, frame: RawFrame): void {
  canvas.width = frame.width
  canvas.height = frame.height
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  ctx.putImageData(new ImageData(new Uint8ClampedArray(frame.data), frame.width, frame.height), 0, 0)
}

/** 在既有衬底上叠加绘制帧（alpha 合成） */
function drawFrameOver(canvas: HTMLCanvasElement, frame: RawFrame): void {
  if (canvas.width !== frame.width || canvas.height !== frame.height) {
    canvas.width = frame.width
    canvas.height = frame.height
  }
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  const off = document.createElement('canvas')
  off.width = frame.width
  off.height = frame.height
  const offCtx = off.getContext('2d')
  if (!offCtx) return
  offCtx.putImageData(
    new ImageData(new Uint8ClampedArray(frame.data), frame.width, frame.height),
    0,
    0
  )
  ctx.drawImage(off, 0, 0)
}

/** 画棋盘格衬底（表示透明区域），并把画布尺寸对齐到 w×h */
function drawCheckerboard(canvas: HTMLCanvasElement, w: number, h: number): void {
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w
    canvas.height = h
  }
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  ctx.fillStyle = CHECKER_DARK
  ctx.fillRect(0, 0, w, h)
  ctx.fillStyle = CHECKER_LIGHT
  for (let y = 0; y < h; y += CHECKER_SIZE) {
    for (let x = 0; x < w; x += CHECKER_SIZE) {
      if ((x / CHECKER_SIZE + y / CHECKER_SIZE) % 2 === 0) {
        ctx.fillRect(x, y, CHECKER_SIZE, CHECKER_SIZE)
      }
    }
  }
}

/** 把 alpha 蒙版画成灰度图 */
function drawAlphaMask(canvas: HTMLCanvasElement, alpha: Uint8Array, w: number, h: number): void {
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w
    canvas.height = h
  }
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  const data = new Uint8ClampedArray(w * h * 4)
  for (let i = 0; i < alpha.length; i++) {
    data[i * 4] = alpha[i]
    data[i * 4 + 1] = alpha[i]
    data[i * 4 + 2] = alpha[i]
    data[i * 4 + 3] = 255
  }
  ctx.putImageData(new ImageData(data, w, h), 0, 0)
}
