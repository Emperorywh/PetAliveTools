/**
 * 行走位移映射 (§7.2)
 *
 * 行走片段入库时已完成跟踪裁切（宠物在片段内近似居中、足部锁定
 * 地面线，§5.3），屏幕位移完全由窗口平移提供：
 *   window.x = startX + sign × displacement(t) × scale
 *
 * - displacement(t)：track.json 逐帧位移曲线按播放时间采样；
 *   时间轴为媒体时间（video.currentTime），播放速率 ±5% 抖动时
 *   采样自然同步，窗口平移与画面内步态严格同步、脚爪不滑步 (§9.5)。
 * - sign：片段朝向与屏幕行进方向一致为 +1；镜像播放（对称宠物，
 *   §4.3）为 −1——镜像后画面反向，位移曲线必须随之反向。
 * - scale：屏幕像素 / 曲线像素 = 片段显示宽度 / track.sourceWidth
 *   （跟踪在降采样帧上进行，§5.5）。
 * - 平移仅作用于行走子段 [moveStartSec, moveEndSec]；起止站定段
 *   窗口保持静止，且子段入口以 moveStart 处曲线值为基准（门控后
 *   位移从 0 连续开始，站定段微小跟踪漂移不会引起跳变）。
 *
 * 纯计算，无平台依赖。
 */

import type { TrackFile } from '../types/track-file'

/** 行走窗口映射参数 */
export interface WalkWindowMapping {
  /** 位移曲线 (track.json) */
  readonly track: TrackFile
  /** 行走子段起点（秒，ClipMeta.moveStartSec；缺省 0） */
  readonly moveStartSec: number
  /** 行走子段终点（秒，ClipMeta.moveEndSec；缺省片段时长） */
  readonly moveEndSec: number
  /** 屏幕像素 / 曲线像素（见 computeWalkScale） */
  readonly scale: number
  /** 屏幕行进方向与片段朝向的关系：镜像播放为 −1 */
  readonly sign: 1 | -1
  /** 行走起始时的窗口 x（窗口坐标，DIP） */
  readonly startX: number
}

/**
 * 采样位移曲线在媒体时间 t 处的值（曲线像素）。
 *
 * 相邻帧线性插值；t 超出片段范围时钳制到端点帧值。
 */
export function sampleDisplacementAt(track: TrackFile, tSec: number): number {
  const { fps, offsets, frameCount } = track
  if (offsets.length === 0) {
    throw new Error('cannot sample displacement from empty track')
  }

  const frameFloat = Math.min(Math.max(tSec * fps, 0), frameCount - 1)
  const lo = Math.floor(frameFloat)
  const hi = Math.min(lo + 1, frameCount - 1)
  const frac = frameFloat - lo
  return offsets[lo] + (offsets[hi] - offsets[lo]) * frac
}

/**
 * 计算行走平移比例：屏幕像素 / 曲线像素 (§7.2)。
 *
 * @param displayedWidthPx 片段在屏幕上的显示宽度（含渲染 scale）
 * @param track 位移曲线（sourceWidth 记录曲线像素空间）
 */
export function computeWalkScale(displayedWidthPx: number, track: TrackFile): number {
  if (!Number.isFinite(displayedWidthPx) || displayedWidthPx <= 0) {
    throw new Error(`invalid displayedWidthPx: ${displayedWidthPx}`)
  }
  return displayedWidthPx / track.sourceWidth
}

/**
 * 行走子段门控后的位移（曲线像素，相对子段入口）。
 *
 * - t ≤ moveStartSec：0（站定段窗口静止）
 * - moveStartSec < t < moveEndSec：sample(t) − sample(moveStart)
 * - t ≥ moveEndSec：保持 moveEnd 处的位移
 */
export function walkDisplacementPx(
  track: TrackFile,
  tSec: number,
  moveStartSec: number,
  moveEndSec: number
): number {
  if (!(moveStartSec < moveEndSec)) {
    throw new Error(`invalid move segment: [${moveStartSec}, ${moveEndSec}]`)
  }
  if (tSec <= moveStartSec) {
    return 0
  }
  const endValue = sampleDisplacementAt(track, moveEndSec)
  if (tSec >= moveEndSec) {
    return endValue - sampleDisplacementAt(track, moveStartSec)
  }
  return sampleDisplacementAt(track, tSec) - sampleDisplacementAt(track, moveStartSec)
}

/**
 * 行走子段内的屏幕位移量（屏幕像素，含方向 sign）。
 */
export function walkDisplacementScreenPx(mapping: WalkWindowMapping, tSec: number): number {
  const d = walkDisplacementPx(
    mapping.track,
    tSec,
    mapping.moveStartSec,
    mapping.moveEndSec
  )
  return mapping.sign * d * mapping.scale
}

/**
 * 行走映射主公式 (§7.2)：window.x = startX + sign × displacement(t) × scale。
 *
 * 站定段（子段外）恒为 startX。
 */
export function walkWindowX(mapping: WalkWindowMapping, tSec: number): number {
  return mapping.startX + walkDisplacementScreenPx(mapping, tSec)
}

/**
 * 单次播放的屏幕跨度标定 (§7.2)：位移曲线末值 × scale。
 *
 * 调度层据此安排行走的起止位置与时长（§9）。
 * 返回绝对值（正数），方向由调用方的 sign 决定。
 */
export function walkScreenSpan(mapping: WalkWindowMapping): number {
  const d = walkDisplacementPx(
    mapping.track,
    mapping.moveEndSec,
    mapping.moveStartSec,
    mapping.moveEndSec
  )
  return Math.abs(d) * mapping.scale
}
