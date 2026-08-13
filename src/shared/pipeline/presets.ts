/**
 * 转码质量预设 (§5.2, §14)
 *
 * WebM(VP9-alpha) 无硬解可用、走软解 (§3.2)，比特率与分辨率
 * 直接决定体积、画质与解码开销。预设为"质量 vs 体积"的折中档位，
 * 覆盖 SPEC §5.2 列出的全部场景：
 *
 * - **standard**：日常片段的默认档，画质与体积平衡。
 * - **high**：招牌/高细节片段，更高比特率保留毛发质感。
 * - **sleep**：长循环片段（睡眠/趴卧），大幅降码率控制体积；
 *   静态画面冗余高，降码率对观感影响小 (§5.2、§14 磁盘预算)。
 *
 * 纯配置数据，无平台依赖（主进程转码管线与渲染预览共用）。
 */

/** 转码质量档位 */
export type TranscodePresetName = 'standard' | 'high' | 'sleep'

/** 转码分辨率档位（最大边长像素上限；等比缩放不裁切） */
export type ResolutionTier = 'compact' | 'normal' | 'large'

/** 单个质量预设的编码参数 */
export interface TranscodePreset {
  /** 预设标识 */
  readonly name: TranscodePresetName
  /** 目标视频比特率 (bits/s)，控制 WebM VP9 编码质量 */
  readonly videoBitrate: number
  /**
   * CRQ/CRF-like 质量约束（VP9 `-crf` / `-b:v` 组合）。
   * VP9 需同时给 `-b:v`（上限）和 `-crf`（目标质量 0–63，越低越好）；
   * 编码器按 CRF 调节，但不超过 -b:v 上限。
   */
  readonly crf: number
  /** 编码速度/质量权衡（VP9 `-deadline`，越慢压缩率越高） */
  readonly deadline: 'good' | 'best' | 'realtime'
  /** 每关键帧内 GOP 间距（帧数） */
  readonly gopSize: number
}

/** 分辨率档位定义：最大边长像素上限 */
export interface ResolutionPreset {
  readonly tier: ResolutionTier
  /** 最大边长（像素），输出不超过此值（等比缩放，不裁切） */
  readonly maxEdge: number
}

/**
 * 质量预设表 (§5.2)。
 *
 * 比特率值针对归一化小尺寸片段（§7.4：宠物肩高 12–18% 屏幕高度），
 * 此尺寸下 VP9-alpha 软解可控 (§14)。
 */
export const TRANSCODE_PRESETS: Readonly<Record<TranscodePresetName, TranscodePreset>> = {
  /** 默认：日常片段，平衡画质与体积 */
  standard: {
    name: 'standard',
    videoBitrate: 1_200_000,
    crf: 32,
    deadline: 'good',
    gopSize: 30
  },
  /** 高质量：招牌/高细节片段，更高比特率 */
  high: {
    name: 'high',
    videoBitrate: 2_500_000,
    crf: 28,
    deadline: 'good',
    gopSize: 30
  },
  /** 长循环（睡眠/趴卧）：大幅降码率，静态画面冗余高 (§5.2、§14) */
  sleep: {
    name: 'sleep',
    videoBitrate: 500_000,
    crf: 38,
    deadline: 'good',
    gopSize: 60
  }
} as const

/**
 * 分辨率档位表 (§14)。
 *
 * 目标屏幕高度百分比 (§7.4) 越小，归一化尺寸越小，软解开销越低。
 * - compact：最小启动集优先低开销（肩高 ~12%）
 * - normal：默认（肩高 ~15%）
 * - large：细节展示类片段（肩高 ~18%）
 */
export const RESOLUTION_PRESETS: Readonly<Record<ResolutionTier, ResolutionPreset>> = {
  compact: { tier: 'compact', maxEdge: 360 },
  normal: { tier: 'normal', maxEdge: 480 },
  large: { tier: 'large', maxEdge: 640 }
} as const

/** 统一目标帧率 (§5.2) */
export const TARGET_FPS = 30

/** 像素格式：YUVA 4:2:0，VP9 + alpha 通道的标准格式 */
export const PIXEL_FORMAT = 'yuva420p'

/** 编码器：libvpx-vp9，支持 alpha */
export const VIDEO_CODEC = 'libvpx-vp9'

/**
 * 根据片段类别与循环属性推荐默认质量预设 (§5.2)。
 *
 * - 睡眠/趴卧等长循环 → sleep 档（降码率）
 * - 招牌/高细节 → high 档
 * - 其余 → standard 档
 */
export function recommendPreset(
  state: string,
  loop: boolean,
  signature: boolean
): TranscodePresetName {
  // 个性招牌动作：高码率保留细节（优先于降码率判断）
  if (signature) {
    return 'high'
  }
  // 长循环静态片段：睡眠、趴卧、理毛等 → 降码率
  if (loop && (state === 'sleep' || state === 'lie' || state === 'groom')) {
    return 'sleep'
  }
  return 'standard'
}

/**
 * 根据屏幕高度百分比计算目标分辨率边长 (§7.4)。
 *
 * scaleHint 记录该片段相对基准的缩放系数 (§7.4)；
 * screenPercent 为目标屏幕高度占比 (§7.4, 如 0.15 = 15%)。
 *
 * @param screenHeightPx 屏幕工作区高度（像素）
 * @param screenPercent 目标屏幕高度占比 (0–1)
 * @param scaleHint 片段尺度归一化系数 (>0)
 * @returns 目标最大边长（像素），向下取偶数（VP9 要求偶数尺寸）
 */
export function computeTargetEdge(
  screenHeightPx: number,
  screenPercent: number,
  scaleHint: number
): number {
  if (!Number.isFinite(screenHeightPx) || screenHeightPx <= 0) {
    throw new Error(`invalid screenHeightPx: ${screenHeightPx}`)
  }
  if (!Number.isFinite(screenPercent) || screenPercent <= 0 || screenPercent >= 1) {
    throw new Error(`invalid screenPercent: ${screenPercent} (expected 0–1 exclusive)`)
  }
  if (!Number.isFinite(scaleHint) || scaleHint <= 0) {
    throw new Error(`invalid scaleHint: ${scaleHint}`)
  }
  // 宠物肩高占屏幕高度的 screenPercent，片段整体（含头身尾）约为
  // 肩高的 ~1.5–2 倍高，取 1.6 作为片段整体高度估计系数
  const rawEdge = screenHeightPx * screenPercent * 1.6 * scaleHint
  // VP9 要求偶数尺寸
  return Math.max(2, Math.round(rawEdge / 2) * 2)
}

/**
 * 计算归一化缩放：给定源尺寸与目标最大边长，输出 ffmpeg scale 滤镜的目标尺寸。
 *
 * 等比缩放，不裁切；保证偶数尺寸。
 *
 * @returns `{ width, height }` 或 null（源已小于等于目标，无需缩放）
 */
export function computeScaleDimensions(
  srcWidth: number,
  srcHeight: number,
  maxEdge: number
): { width: number; height: number } | null {
  if (!Number.isFinite(srcWidth) || srcWidth <= 0) {
    throw new Error(`invalid srcWidth: ${srcWidth}`)
  }
  if (!Number.isFinite(srcHeight) || srcHeight <= 0) {
    throw new Error(`invalid srcHeight: ${srcHeight}`)
  }
  if (!Number.isFinite(maxEdge) || maxEdge <= 0) {
    throw new Error(`invalid maxEdge: ${maxEdge}`)
  }

  const longestEdge = Math.max(srcWidth, srcHeight)
  if (longestEdge <= maxEdge) {
    return null // 无需缩放
  }

  const ratio = maxEdge / longestEdge
  // 等比缩放，保证偶数（VP9 要求）
  const w = Math.max(2, Math.round((srcWidth * ratio) / 2) * 2)
  const h = Math.max(2, Math.round((srcHeight * ratio) / 2) * 2)
  return { width: w, height: h }
}
