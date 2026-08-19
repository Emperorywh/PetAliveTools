/**
 * 命中盒检测与缓冲带 (§6.1)
 *
 * 命中盒由片段元数据 hitbox 字段定义，格式为 [x, y, w, h]，
 * 归一化坐标 [0, 1]，相对精灵包围盒 (§5.4, §6.1)。
 *
 * 缓冲带 (§6.1)：命中盒外扩 8–12px 作为"提前激活区"，
 * 光标进入缓冲带即切换为可交互态，缓解穿透切换抖动 (§16 风险 8)。
 *
 * 纯计算，无平台依赖。
 */

import type { Hitbox } from '../types/clip-meta'

/** 像素矩形（窗口局部坐标系） */
export interface PixelRect {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

// —— 缓冲带常量 (§6.1) —— //

/** 缓冲带最小像素 (§6.1) */
export const BUFFER_PX_MIN = 8
/** 缓冲带最大像素 (§6.1) */
export const BUFFER_PX_MAX = 12
/** 缓冲带默认像素（取中间值 10px） */
export const DEFAULT_BUFFER_PX = 10

/**
 * 窗口默认命中区域：文件名无法携带逐片段命中盒时的统一取值。
 * 该区域只用于鼠标交互与窗口摆放钳制，不处理视频像素。
 */
export const DEFAULT_HITBOX: Hitbox = [0.1, 0.05, 0.8, 0.9]

/**
 * 默认命中区域在给定窗口尺寸下的像素包围盒（窗口局部坐标）。
 * 渲染进程命中盒初始化与主进程拖拽/行走钳制的公共口径。
 */
export function defaultHitboxPx(windowWidth: number, windowHeight: number): PixelRect {
  return hitboxToPixels(DEFAULT_HITBOX, { x: 0, y: 0, width: windowWidth, height: windowHeight })
}

/**
 * 将缓冲带像素值钳制到 §6.1 规定的 8–12px 范围。
 */
export function clampBufferPx(px: number): number {
  if (!Number.isFinite(px)) return DEFAULT_BUFFER_PX
  return Math.min(Math.max(px, BUFFER_PX_MIN), BUFFER_PX_MAX)
}

/**
 * 将归一化命中盒 [x, y, w, h] 转换为窗口像素坐标 (§5.4, §6.1)。
 *
 * @param hitbox 归一化命中盒
 * @param spriteRect 精灵在窗口内的像素包围盒
 */
export function hitboxToPixels(hitbox: Hitbox, spriteRect: PixelRect): PixelRect {
  return {
    x: spriteRect.x + hitbox[0] * spriteRect.width,
    y: spriteRect.y + hitbox[1] * spriteRect.height,
    width: hitbox[2] * spriteRect.width,
    height: hitbox[3] * spriteRect.height,
  }
}

/**
 * 将像素矩形向外扩展 bufferPx（四边各加 bufferPx）。
 */
export function expandRect(rect: PixelRect, bufferPx: number): PixelRect {
  return {
    x: rect.x - bufferPx,
    y: rect.y - bufferPx,
    width: rect.width + 2 * bufferPx,
    height: rect.height + 2 * bufferPx,
  }
}

/**
 * 判断点是否在像素矩形内（含边界）。
 */
export function isPointInRect(px: number, py: number, rect: PixelRect): boolean {
  return (
    px >= rect.x &&
    px <= rect.x + rect.width &&
    py >= rect.y &&
    py <= rect.y + rect.height
  )
}

/**
 * 判断点是否在核心命中盒内（§6.1 实际命中区域）。
 */
export function isPointInHitbox(px: number, py: number, hitboxPx: PixelRect): boolean {
  return isPointInRect(px, py, hitboxPx)
}

/**
 * 判断点是否在缓冲带内（命中盒 + 外扩 bufferPx，§6.1 提前激活区）。
 *
 * 缓冲带像素自动钳制到 8–12px (§6.1)。
 */
export function isPointInBufferZone(
  px: number,
  py: number,
  hitboxPx: PixelRect,
  bufferPx: number = DEFAULT_BUFFER_PX,
): boolean {
  const clamped = clampBufferPx(bufferPx)
  const expanded = expandRect(hitboxPx, clamped)
  return isPointInRect(px, py, expanded)
}

/**
 * 判断点是否在缓冲带内但不在核心命中盒内（仅缓冲带区域）。
 *
 * 用于区分"进入提前激活区"与"已到达实际命中盒"。
 */
export function isPointInBufferOnly(
  px: number,
  py: number,
  hitboxPx: PixelRect,
  bufferPx: number = DEFAULT_BUFFER_PX,
): boolean {
  return (
    !isPointInHitbox(px, py, hitboxPx) &&
    isPointInBufferZone(px, py, hitboxPx, bufferPx)
  )
}
