/**
 * 位移曲线手动校正界面 (§5.3)
 *
 * 导入流程中行走片段的质量闸门：绘制跟踪生成的逐帧位移曲线，
 * 支持在停顿/变速处手动校正关键点（拖拽调整"该帧处的正确偏移"），
 * 并标注行走子段边界 moveStartSec / moveEndSec（起止站定段不参与
 * 平移，§7.2）。校正/标注结果导出为 track.json 与片段元数据字段。
 *
 * 曲线合并与子段检测逻辑全部委托 shared 内核
 * （applyKeypointCorrections / detectMoveSegment），本类只负责
 * DOM、画布与指针交互。
 *
 * 运行于渲染进程。手动验证入口见 walk-correction-demo.ts。
 */

import type { TrackFile, TrackKeypoint } from '../../shared/types/track-file'
import { applyKeypointCorrections, detectMoveSegment, frameToSec } from '../../shared/pipeline'

/** 校正界面状态（offsets 为跟踪原始曲线，关键点叠加其上） */
export interface WalkCorrectionState {
  /** 片段帧率 (§5.2) */
  readonly fps: number
  /** 帧数（= offsets.length） */
  readonly frameCount: number
  /** 跟踪生成的原始逐帧偏移 */
  readonly offsets: readonly number[]
  /** 手动校正关键点（按帧升序维护） */
  readonly keypoints: readonly TrackKeypoint[]
  /** 行走子段起点帧（含） */
  readonly moveStartFrame: number
  /** 行走子段终点帧（含） */
  readonly moveEndFrame: number
}

export interface WalkCorrectionOptions {
  /** 状态变更回调（供外层刷新读数/联动预览） */
  readonly onChange?: (state: WalkCorrectionState) => void
}

/** 画布逻辑尺寸与边距 */
const CANVAS_W = 760
const CANVAS_H = 300
const MARGIN = { left: 56, right: 20, top: 20, bottom: 40 }

/** 配色 */
const COLOR_BG = '#22252c'
const COLOR_GRID = '#33363f'
const COLOR_RAW = '#5b6270'
const COLOR_CURVE = '#7ec8ff'
const COLOR_MOVE_BAND = 'rgba(126, 200, 255, 0.10)'
const COLOR_MARKER = '#ff4d6d'
const COLOR_KEYPOINT = '#ffd166'
const COLOR_TEXT = '#aeb4c0'

/** 命中半径（px） */
const HIT_KEYPOINT_PX = 10
const HIT_MARKER_PX = 8

type DragTarget =
  | { kind: 'keypoint'; index: number }
  | { kind: 'moveStart' }
  | { kind: 'moveEnd' }
  | { kind: 'canvas' }

/**
 * 位移曲线校正视图。
 *
 * 交互：
 * - 点击曲线空白处 → 在该 (帧, 偏移) 添加关键点
 * - 拖拽关键点 → 同时调整帧与偏移（停顿/变速处修正）
 * - 双击关键点 → 删除
 * - 拖拽红色竖线 → 标注行走子段边界 moveStart / moveEnd
 */
export class WalkCorrectionView {
  private readonly container: HTMLElement
  private readonly canvas: HTMLCanvasElement
  private readonly options: WalkCorrectionOptions
  private state: WalkCorrectionState
  private drag: DragTarget | null = null
  private dragMoved = false
  private disposed = false

  constructor(
    container: HTMLElement,
    initialState: WalkCorrectionState,
    options: WalkCorrectionOptions = {}
  ) {
    this.container = container
    this.options = options
    this.state = initialState

    const { canvas } = this.createDom()
    this.canvas = canvas
    this.bindPointerEvents()

    this.render()
  }

  // ── 公共 API ── //

  /** 更新部分状态并重绘 */
  update(partial: Partial<WalkCorrectionState>): void {
    this.assertAlive()
    this.state = { ...this.state, ...partial }
    this.notify()
    this.render()
  }

  /** 添加（或替换同帧）关键点 */
  addKeypoint(frame: number, offset: number): void {
    const f = this.clampFrame(frame)
    const keypoints = this.state.keypoints.filter((k) => k.frame !== f)
    keypoints.push({ frame: f, offset })
    keypoints.sort((a, b) => a.frame - b.frame)
    this.update({ keypoints })
  }

  /** 移动关键点（index 相对当前升序序列） */
  moveKeypoint(index: number, frame: number, offset: number): void {
    const keypoints = [...this.state.keypoints]
    if (index < 0 || index >= keypoints.length) return
    const f = this.clampFrame(frame)
    const others = keypoints.filter((_, i) => i !== index)
    if (others.some((k) => k.frame === f)) return
    keypoints[index] = { frame: f, offset }
    keypoints.sort((a, b) => a.frame - b.frame)
    this.update({ keypoints })
  }

  /** 删除关键点 */
  removeKeypoint(index: number): void {
    const keypoints = this.state.keypoints.filter((_, i) => i !== index)
    this.update({ keypoints })
  }

  /** 清空全部关键点（回到跟踪原始曲线） */
  resetKeypoints(): void {
    this.update({ keypoints: [] })
  }

  /** 标注行走子段起点帧 */
  setMoveStartFrame(frame: number): void {
    const f = Math.max(0, Math.min(frame, this.state.moveEndFrame - 1))
    this.update({ moveStartFrame: this.clampFrame(f) })
  }

  /** 标注行走子段终点帧 */
  setMoveEndFrame(frame: number): void {
    const f = Math.max(this.state.moveStartFrame + 1, Math.min(frame, this.state.frameCount - 1))
    this.update({ moveEndFrame: this.clampFrame(f) })
  }

  /** 从位移曲线自动检测行走子段边界（覆盖当前标注） */
  autoDetectMoveSegment(): void {
    const seg = detectMoveSegment(this.state.offsets, this.state.fps)
    if (seg) {
      this.update({ moveStartFrame: seg.moveStartFrame, moveEndFrame: seg.moveEndFrame })
    }
  }

  /** 校正后的逐帧偏移序列 */
  getCorrectedOffsets(): number[] {
    return applyKeypointCorrections(this.state.offsets, this.state.keypoints)
  }

  /** 导出 track.json 数据（校正曲线 + 关键点，§5.3） */
  exportTrackFile(): TrackFile {
    return {
      version: 1,
      fps: this.state.fps,
      frameCount: this.state.frameCount,
      offsets: this.getCorrectedOffsets(),
      keypoints: this.state.keypoints
    }
  }

  /** 行走子段边界（秒），供片段元数据 moveStartSec/moveEndSec (§5.4) */
  getMoveSegmentSecs(): { moveStartSec: number; moveEndSec: number } {
    return {
      moveStartSec: frameToSec(this.state.moveStartFrame, this.state.fps),
      moveEndSec: frameToSec(this.state.moveEndFrame, this.state.fps)
    }
  }

  getState(): WalkCorrectionState {
    return this.state
  }

  dispose(): void {
    this.disposed = true
    this.container.innerHTML = ''
  }

  // ── DOM 与事件 ── //

  private createDom(): { canvas: HTMLCanvasElement } {
    this.container.innerHTML = ''

    const root = document.createElement('div')
    root.className = 'wc-root'

    const canvas = document.createElement('canvas')
    canvas.className = 'wc-canvas'
    canvas.width = CANVAS_W
    canvas.height = CANVAS_H
    root.appendChild(canvas)

    const controls = document.createElement('div')
    controls.className = 'wc-controls'

    const makeButton = (label: string, onClick: () => void): HTMLButtonElement => {
      const btn = document.createElement('button')
      btn.type = 'button'
      btn.textContent = label
      btn.addEventListener('click', onClick)
      return btn
    }

    controls.appendChild(makeButton('自动检测行走子段', () => this.autoDetectMoveSegment()))
    controls.appendChild(makeButton('重置关键点', () => this.resetKeypoints()))

    const hint = document.createElement('span')
    hint.className = 'wc-hint'
    hint.textContent = '点击曲线添加关键点；拖拽调整（停顿/变速处）；双击删除；拖动红线标注行走子段'
    controls.appendChild(hint)

    root.appendChild(controls)
    this.container.appendChild(root)

    return { canvas }
  }

  private bindPointerEvents(): void {
    this.canvas.addEventListener('pointerdown', (e) => {
      const pos = this.eventToPlot(e)
      if (!pos) return
      this.canvas.setPointerCapture(e.pointerId)
      this.dragMoved = false
      this.drag = this.hitTest(pos.px, pos.py)
    })

    this.canvas.addEventListener('pointermove', (e) => {
      if (!this.drag) return
      const pos = this.eventToPlot(e)
      if (!pos) return
      this.dragMoved = true
      if (this.drag.kind === 'keypoint') {
        this.moveKeypoint(this.drag.index, pos.frame, pos.offset)
      } else if (this.drag.kind === 'moveStart') {
        this.setMoveStartFrame(pos.frame)
      } else if (this.drag.kind === 'moveEnd') {
        this.setMoveEndFrame(pos.frame)
      }
    })

    this.canvas.addEventListener('pointerup', (e) => {
      const drag = this.drag
      this.drag = null
      if (!drag) return
      const pos = this.eventToPlot(e)
      if (!pos) return
      // 点击（未拖动）空白处 → 添加关键点
      if (drag.kind === 'canvas' && !this.dragMoved) {
        this.addKeypoint(pos.frame, pos.offset)
      }
    })

    this.canvas.addEventListener('dblclick', (e) => {
      const pos = this.eventToPlot(e)
      if (!pos) return
      const hit = this.hitTest(pos.px, pos.py)
      if (hit.kind === 'keypoint') {
        this.removeKeypoint(hit.index)
      }
    })
  }

  /** 指针事件 → 画布像素坐标 + 曲线数据坐标（超出绘图区返回 null） */
  private eventToPlot(e: MouseEvent): {
    px: number
    py: number
    frame: number
    offset: number
  } | null {
    const rect = this.canvas.getBoundingClientRect()
    const scaleX = CANVAS_W / rect.width
    const scaleY = CANVAS_H / rect.height
    const px = (e.clientX - rect.left) * scaleX
    const py = (e.clientY - rect.top) * scaleY

    const plot = this.plotArea()
    if (px < plot.x || px > plot.x + plot.w || py < plot.y || py > plot.y + plot.h) {
      return null
    }

    return {
      px,
      py,
      frame: this.xToFrame(px),
      offset: this.yToOffset(py)
    }
  }

  /** 命中检测：关键点 → 行走子段边界线 → 空白 */
  private hitTest(px: number, py: number): DragTarget {
    const keypoints = this.state.keypoints
    for (let i = keypoints.length - 1; i >= 0; i--) {
      const kx = this.frameToX(keypoints[i].frame)
      const ky = this.offsetToY(keypoints[i].offset)
      if (Math.hypot(px - kx, py - ky) <= HIT_KEYPOINT_PX) {
        return { kind: 'keypoint', index: i }
      }
    }
    if (Math.abs(px - this.frameToX(this.state.moveStartFrame)) <= HIT_MARKER_PX) {
      return { kind: 'moveStart' }
    }
    if (Math.abs(px - this.frameToX(this.state.moveEndFrame)) <= HIT_MARKER_PX) {
      return { kind: 'moveEnd' }
    }
    return { kind: 'canvas' }
  }

  private notify(): void {
    this.options.onChange?.(this.state)
  }

  private assertAlive(): void {
    if (this.disposed) {
      throw new Error('WalkCorrectionView is disposed')
    }
  }

  private clampFrame(frame: number): number {
    return Math.max(0, Math.min(Math.round(frame), this.state.frameCount - 1))
  }

  // ── 坐标映射 ── //

  private plotArea(): { x: number; y: number; w: number; h: number } {
    return {
      x: MARGIN.left,
      y: MARGIN.top,
      w: CANVAS_W - MARGIN.left - MARGIN.right,
      h: CANVAS_H - MARGIN.top - MARGIN.bottom
    }
  }

  /** 偏移值域：原始与校正曲线的包络，含 0 与 10% 余量 */
  private offsetRange(): { min: number; max: number } {
    const values = [...this.state.offsets, ...this.getCorrectedOffsets(), 0]
    let min = Math.min(...values)
    let max = Math.max(...values)
    if (max - min < 1e-9) {
      min -= 1
      max += 1
    }
    const pad = (max - min) * 0.1
    return { min: min - pad, max: max + pad }
  }

  private frameToX(frame: number): number {
    const p = this.plotArea()
    const denom = Math.max(1, this.state.frameCount - 1)
    return p.x + (frame / denom) * p.w
  }

  private offsetToY(offset: number): number {
    const p = this.plotArea()
    const { min, max } = this.offsetRange()
    return p.y + p.h - ((offset - min) / (max - min)) * p.h
  }

  private xToFrame(x: number): number {
    const p = this.plotArea()
    const denom = Math.max(1, this.state.frameCount - 1)
    return ((x - p.x) / p.w) * denom
  }

  private yToOffset(y: number): number {
    const p = this.plotArea()
    const { min, max } = this.offsetRange()
    return min + ((p.y + p.h - y) / p.h) * (max - min)
  }

  // ── 绘制 ── //

  private render(): void {
    const ctx = this.canvas.getContext('2d')
    if (!ctx) return

    const p = this.plotArea()
    const { offsets, frameCount, fps } = this.state
    const corrected = this.getCorrectedOffsets()
    const range = this.offsetRange()

    ctx.fillStyle = COLOR_BG
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H)

    // 行走子段底色带 (§7.2 平移区间)
    const sx = this.frameToX(this.state.moveStartFrame)
    const ex = this.frameToX(this.state.moveEndFrame)
    ctx.fillStyle = COLOR_MOVE_BAND
    ctx.fillRect(sx, p.y, ex - sx, p.h)

    // 水平网格 + 偏移刻度（左）
    ctx.strokeStyle = COLOR_GRID
    ctx.lineWidth = 1
    ctx.font = '11px sans-serif'
    ctx.fillStyle = COLOR_TEXT
    ctx.textAlign = 'right'
    ctx.textBaseline = 'middle'
    const gridCount = 4
    for (let i = 0; i <= gridCount; i++) {
      const v = range.min + ((range.max - range.min) * i) / gridCount
      const gy = this.offsetToY(v)
      ctx.beginPath()
      ctx.moveTo(p.x, gy + 0.5)
      ctx.lineTo(p.x + p.w, gy + 0.5)
      ctx.stroke()
      ctx.fillText(v.toFixed(1), p.x - 6, gy)
    }

    // 时间轴刻度（秒，§5.3 统一秒制）
    const durationSec = frameCount / fps
    const tickStep = durationSec > 8 ? 2 : 1
    ctx.textAlign = 'center'
    ctx.textBaseline = 'top'
    for (let t = 0; t <= durationSec + 1e-9; t += tickStep) {
      const tx = this.frameToX(t * fps)
      ctx.fillStyle = COLOR_TEXT
      ctx.fillText(`${t}s`, tx, p.y + p.h + 8)
      ctx.strokeStyle = COLOR_GRID
      ctx.beginPath()
      ctx.moveTo(tx + 0.5, p.y)
      ctx.lineTo(tx + 0.5, p.y + p.h)
      ctx.stroke()
    }

    // 原始曲线（暗）→ 校正后曲线（亮）
    this.drawPolyline(ctx, offsets, COLOR_RAW, 1)
    this.drawPolyline(ctx, corrected, COLOR_CURVE, 2)

    // 行走子段边界线与标注
    const secs = this.getMoveSegmentSecs()
    this.drawMoveMarker(ctx, this.state.moveStartFrame, `moveStart ${secs.moveStartSec.toFixed(2)}s`)
    this.drawMoveMarker(ctx, this.state.moveEndFrame, `moveEnd ${secs.moveEndSec.toFixed(2)}s`)

    // 关键点
    for (const k of this.state.keypoints) {
      const kx = this.frameToX(k.frame)
      const ky = this.offsetToY(k.offset)
      ctx.beginPath()
      ctx.arc(kx, ky, 5, 0, Math.PI * 2)
      ctx.fillStyle = COLOR_KEYPOINT
      ctx.fill()
      ctx.strokeStyle = '#1e2128'
      ctx.lineWidth = 1.5
      ctx.stroke()
    }
  }

  private drawPolyline(
    ctx: CanvasRenderingContext2D,
    offsets: readonly number[],
    color: string,
    width: number
  ): void {
    if (offsets.length === 0) return
    ctx.strokeStyle = color
    ctx.lineWidth = width
    ctx.beginPath()
    offsets.forEach((o, i) => {
      const x = this.frameToX(i)
      const y = this.offsetToY(o)
      if (i === 0) {
        ctx.moveTo(x, y)
      } else {
        ctx.lineTo(x, y)
      }
    })
    ctx.stroke()
  }

  private drawMoveMarker(ctx: CanvasRenderingContext2D, frame: number, label: string): void {
    const p = this.plotArea()
    const x = Math.round(this.frameToX(frame)) + 0.5
    ctx.strokeStyle = COLOR_MARKER
    ctx.lineWidth = 1.5
    ctx.beginPath()
    ctx.moveTo(x, p.y)
    ctx.lineTo(x, p.y + p.h)
    ctx.stroke()

    ctx.fillStyle = COLOR_MARKER
    ctx.font = '11px sans-serif'
    ctx.textAlign = x < CANVAS_W / 2 ? 'left' : 'right'
    ctx.textBaseline = 'top'
    ctx.fillText(label, x + (x < CANVAS_W / 2 ? 4 : -4), p.y + 4)
  }
}
