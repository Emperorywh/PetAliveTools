/**
 * 行走位移 (§7.3 行走移动)
 *
 * FSM 进入 walk 状态播放行走片段时，外壳按墙钟恒速水平移动宠物窗口：
 *   - 方向来自片段的左右标记（或调度器朝向记忆），速度为常量；
 *   - 位移由墙钟时间驱动，不读取视频时间，也不逐帧跟踪画面脚步；
 *   - 每次更新钳制到当前工作区可见范围，抵达边缘即停在边缘。
 *
 * 纯计算，无平台依赖；Electron 窗口操作由主进程 walk-controller 执行。
 */

/** 行走方向：跟随片段左右标记 */
export type WalkDirection = 'left' | 'right'

/** 默认行走速度 (DIP 像素/秒)：观感接近桌面宠物常见步速 */
export const DEFAULT_WALK_VELOCITY_PX_PER_SEC = 60

/** 行走位移状态（不可变；每次更新产生新实例） */
export interface WalkMotion {
  /** 位移起始时钟 (ms) */
  readonly startMs: number
  /** 起始窗口 x (DIP) */
  readonly originX: number
  /** 行走方向 */
  readonly direction: WalkDirection
  /** 速度 (DIP 像素/秒)，恒定不改速率 */
  readonly velocityPxPerSec: number
  /** 可见范围 [minX, maxX]（工作区对窗口左上角的钳制区间） */
  readonly minX: number
  readonly maxX: number
}

/**
 * 创建行走位移。
 * bounds 为窗口 x 的可见钳制区间（工作区 x … 工作区右缘 − 窗口宽）。
 */
export function createWalkMotion(params: {
  readonly startMs: number
  readonly originX: number
  readonly direction: WalkDirection
  readonly velocityPxPerSec?: number
  readonly minX: number
  readonly maxX: number
}): WalkMotion {
  const velocity = params.velocityPxPerSec ?? DEFAULT_WALK_VELOCITY_PX_PER_SEC
  if (!Number.isFinite(velocity) || velocity <= 0) {
    throw new Error(`invalid walk velocity: ${velocity}`)
  }
  if (params.maxX < params.minX) {
    throw new Error(`invalid walk bounds: [${params.minX}, ${params.maxX}]`)
  }
  return {
    startMs: params.startMs,
    originX: params.originX,
    direction: params.direction,
    velocityPxPerSec: velocity,
    minX: params.minX,
    maxX: params.maxX,
  }
}

/**
 * 计算某时刻的窗口 x（钳制到可见范围）。
 * 纯墙钟推算，不依赖视频播放进度。
 */
export function walkXAt(motion: WalkMotion, nowMs: number): number {
  const elapsedSec = Math.max(0, nowMs - motion.startMs) / 1000
  const distance = motion.velocityPxPerSec * elapsedSec
  const raw =
    motion.direction === 'left' ? motion.originX - distance : motion.originX + distance
  return Math.min(Math.max(raw, motion.minX), motion.maxX)
}

/**
 * 判断是否已抵达可见范围边缘（继续行走也不会再移动）。
 */
export function hasReachedWalkBound(motion: WalkMotion, nowMs: number): boolean {
  const x = walkXAt(motion, nowMs)
  return motion.direction === 'left' ? x <= motion.minX : x >= motion.maxX
}
