/**
 * 行走逐帧跟踪 (§5.3)
 *
 * 在抠像后的行走片段上逐帧追踪宠物：
 * - 质心：alpha 加权平均坐标（软边像素按不透明度计入权重）
 * - 足部：最深的前景行（行覆盖率 ≥ 阈值），作为地面锁定参考
 *
 * 输出的逐帧质心序列供两处消费：x 方向驱动跟踪裁切
 * （track-crop.ts）与位移曲线（displacement-curve.ts），
 * 两者由同一质心序列派生，保证"裁切跟随"与"窗口平移"一致。
 *
 * 纯像素运算，无平台依赖；输入为 TASK-005 色键输出的
 * KeyedFrame / AlphaMask（满足 TrackableAlpha 结构）。
 */

/** 可跟踪的 alpha 数据：KeyedFrame 与 AlphaMask 均满足此结构 */
export interface TrackableAlpha {
  readonly width: number
  readonly height: number
  readonly alpha: Uint8Array | Uint8ClampedArray
}

/** 单帧跟踪结果 */
export interface WalkFrameTrack {
  readonly frameIndex: number
  /** 前景质心 x（像素，含亚像素精度） */
  readonly centroidX: number
  /** 前景质心 y（像素，含亚像素精度） */
  readonly centroidY: number
  /** 足部纵坐标：最深前景行的行号（整数像素） */
  readonly feetY: number
  /** 本帧是否检出足够前景；false 时坐标沿用上一帧（首帧用画面底边中点） */
  readonly foreground: boolean
}

/** 跟踪选项 */
export interface WalkTrackerOptions {
  /** 前景判定 alpha 阈值（0–255，默认 128）：行覆盖统计只计高于阈值的像素 */
  readonly alphaThreshold?: number
  /** 质心/足部时间平滑半径（帧，默认 2；0 = 不平滑）。中心化滑动均值 */
  readonly smoothingRadius?: number
  /** 行被计为前景的覆盖率下限（0..1，默认 0.05）：过滤散噪行 */
  readonly footRowCoverage?: number
}

export const DEFAULT_ALPHA_THRESHOLD = 128
export const DEFAULT_SMOOTHING_RADIUS = 2
export const DEFAULT_FOOT_ROW_COVERAGE = 0.05

/** 单帧未平滑跟踪测量 */
interface FrameMeasurement {
  readonly centroidX: number
  readonly centroidY: number
  readonly feetY: number
  readonly foreground: boolean
}

/**
 * 测量单帧：alpha 加权质心 + 最深前景行。
 *
 * 空帧（总权重不足一个像素）返回 foreground=false。
 */
function measureFrame(alpha: TrackableAlpha, threshold: number, rowCoverage: number): FrameMeasurement {
  const { width, height } = alpha

  let weightSum = 0
  let sumX = 0
  let sumY = 0
  // 每行前景覆盖（alpha 加权，占行宽比例）
  const rowWeights = new Float64Array(height)

  for (let y = 0; y < height; y++) {
    const rowOffset = y * width
    let rowWeight = 0
    for (let x = 0; x < width; x++) {
      const a = alpha.alpha[rowOffset + x]
      if (a > threshold) {
        const w = a / 255
        rowWeight += w
        weightSum += w
        sumX += x * w
        sumY += y * w
      }
    }
    rowWeights[y] = rowWeight / width
  }

  if (weightSum < 1e-6) {
    return { centroidX: 0, centroidY: 0, feetY: 0, foreground: false }
  }

  // 足部：最深的前景行（覆盖率 ≥ rowCoverage）
  const minRowWeight = rowCoverage * (threshold / 255)
  let feetY = 0
  for (let y = height - 1; y >= 0; y--) {
    if (rowWeights[y] >= minRowWeight) {
      feetY = y
      break
    }
  }

  return {
    centroidX: sumX / weightSum,
    centroidY: sumY / weightSum,
    feetY,
    foreground: true
  }
}

/**
 * 跟踪单帧（不平滑）。空帧时坐标取画面底部中点，foreground=false。
 */
export function trackWalkFrame(
  alpha: TrackableAlpha,
  frameIndex: number,
  options: WalkTrackerOptions = {}
): WalkFrameTrack {
  const threshold = options.alphaThreshold ?? DEFAULT_ALPHA_THRESHOLD
  const rowCoverage = options.footRowCoverage ?? DEFAULT_FOOT_ROW_COVERAGE
  const m = measureFrame(alpha, threshold, rowCoverage)

  if (!m.foreground) {
    return {
      frameIndex,
      centroidX: alpha.width / 2,
      centroidY: alpha.height - 1,
      feetY: alpha.height - 1,
      foreground: false
    }
  }

  return {
    frameIndex,
    centroidX: m.centroidX,
    centroidY: m.centroidY,
    feetY: m.feetY,
    foreground: true
  }
}

/**
 * 逐帧跟踪整段行走片段 (§5.3)。
 *
 * 1. 逐帧测量质心与足部行；空帧（抠像失败/宠物出画）沿用上一帧
 *    坐标并标记 foreground=false，保持序列连续供裁切与曲线消费；
 * 2. 中心化滑动均值平滑（半径 smoothingRadius），抑制逐帧抖动——
 *    裁切与位移曲线共用平滑结果，二者仍严格一致。
 */
export function trackWalkFrames(
  alphas: readonly TrackableAlpha[],
  options: WalkTrackerOptions = {}
): WalkFrameTrack[] {
  if (alphas.length === 0) {
    return []
  }

  const threshold = options.alphaThreshold ?? DEFAULT_ALPHA_THRESHOLD
  const rowCoverage = options.footRowCoverage ?? DEFAULT_FOOT_ROW_COVERAGE

  // 逐帧测量（含空帧沿用）
  const measured: FrameMeasurement[] = []
  let last: MeasurementCarry = {
    centroidX: alphas[0].width / 2,
    centroidY: alphas[0].height - 1,
    feetY: alphas[0].height - 1
  }

  for (let i = 0; i < alphas.length; i++) {
    const m = measureFrame(alphas[i], threshold, rowCoverage)
    if (m.foreground) {
      last = { centroidX: m.centroidX, centroidY: m.centroidY, feetY: m.feetY }
      measured.push({ ...m })
    } else {
      measured.push({ ...last, foreground: false })
    }
  }

  // 平滑（foreground 标记不参与平滑）
  const radius = options.smoothingRadius ?? DEFAULT_SMOOTHING_RADIUS
  return measured.map((m, i) => ({
    frameIndex: i,
    centroidX: smoothAt(measured, i, radius, (e) => e.centroidX),
    centroidY: smoothAt(measured, i, radius, (e) => e.centroidY),
    feetY: Math.round(smoothAt(measured, i, radius, (e) => e.feetY)),
    foreground: m.foreground
  }))
}

/** 空帧沿用坐标的载体 */
interface MeasurementCarry {
  readonly centroidX: number
  readonly centroidY: number
  readonly feetY: number
}

/** 中心化滑动均值（半径 r：窗口 [i-r, i+r]） */
function smoothAt(
  data: readonly FrameMeasurement[],
  index: number,
  radius: number,
  pick: (m: FrameMeasurement) => number
): number {
  if (radius <= 0) {
    return pick(data[index])
  }
  const from = Math.max(0, index - radius)
  const to = Math.min(data.length - 1, index + radius)
  let sum = 0
  for (let i = from; i <= to; i++) {
    sum += pick(data[i])
  }
  return sum / (to - from + 1)
}
