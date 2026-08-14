/**
 * FFmpeg 二进制解析与命令构建 (§3.3, §5.2)
 *
 * SPEC §3.3 要求打包 ffmpeg 二进制以供离线使用 (§5.2 入库一次性转码)。
 * 本模块负责：
 *
 * 1. **解析 ffmpeg 可执行文件路径**：打包后从 app 资源目录定位，
 *    开发时从 PATH 或自定义环境变量定位 (§3.3)。
 * 2. **构建 ffmpeg 命令行参数**：纯函数，易于测试，覆盖 SPEC §5.2
 *    的全部转码需求（VP9 + alpha、统一 30fps、归一化分辨率、比特率预设）。
 *
 * 运行于主进程（需要 child_process 与文件系统）。
 */

import * as path from 'node:path'
import { promises as fs, existsSync } from 'node:fs'

import {
  type TranscodePreset,
  type TranscodePresetName,
  type ResolutionTier,
  TRANSCODE_PRESETS,
  RESOLUTION_PRESETS,
  TARGET_FPS,
  PIXEL_FORMAT,
  VIDEO_CODEC,
  computeScaleDimensions,
  computeTargetEdge
} from '../../shared/pipeline/presets'

// ── 二进制路径解析 (§3.3) ── //

/** 开发/生产环境标记：app.isPackaged 的注入点 */
export interface AppInfo {
  /** 是否为打包环境 */
  readonly isPackaged: boolean
  /** Electron app 资源目录根（app.getAppPath()） */
  readonly appPath: string
  /** 打包环境的 process.resourcesPath（extraResources 落地目录, IR-011） */
  readonly resourcesPath?: string
  /** 可选：自定义 ffmpeg 路径覆盖（开发时通过环境变量注入） */
  readonly ffmpegPathOverride?: string
}

/**
 * vendor ffmpeg 二进制在资源目录下的相对路径（仅支持 win-x64, §3.2）。
 *
 * 仓库内位置：resources/ffmpeg/win-x64/ffmpeg.exe；
 * 打包后位置：<resourcesPath>/ffmpeg/win-x64/ffmpeg.exe（electron-builder
 * extraResources 从 resources/ffmpeg 拷贝到 resources/ffmpeg, IR-011/IR-018）。
 */
const FFMPEG_VENDOR_SUBPATH = path.join('ffmpeg', 'win-x64', 'ffmpeg.exe')

/**
 * 解析 ffmpeg 可执行文件绝对路径 (§3.3, IR-011)。
 *
 * 优先级：
 * 1. 显式覆盖 (FFMPEG_PATH → ffmpegPathOverride)
 * 2. 打包环境：`<resourcesPath>/ffmpeg/win-x64/ffmpeg.exe`（extraResources 交付）
 * 3. 开发环境：仓库 vendor 二进制 `<appPath>/resources/ffmpeg/win-x64/ffmpeg.exe`
 * 4. 兜底：`ffmpeg`（系统 PATH）
 *
 * @returns 可执行文件路径字符串（前三级为绝对路径，兜底为 'ffmpeg'）
 */
export function resolveFfmpegPath(appInfo: AppInfo): string {
  // 1. 显式覆盖
  if (appInfo.ffmpegPathOverride) {
    return appInfo.ffmpegPathOverride
  }

  // 2. 打包环境：extraResources 交付的 vendor 二进制
  if (appInfo.isPackaged) {
    const resourcesRoot = appInfo.resourcesPath ?? appInfo.appPath
    return path.join(resourcesRoot, FFMPEG_VENDOR_SUBPATH)
  }

  // 3. 开发环境：仓库 vendor 二进制存在时优先（离线确定性，§3.3）
  const vendored = path.join(appInfo.appPath, 'resources', FFMPEG_VENDOR_SUBPATH)
  if (existsSync(vendored)) {
    return vendored
  }

  // 4. 兜底：系统 PATH 中的 ffmpeg
  return 'ffmpeg'
}

/**
 * 验证 ffmpeg 可执行文件可达 (§3.3, IR-011)。
 *
 * 解析结果为绝对路径（vendor/打包/显式覆盖）时校验存在性——
 * 显式覆盖指向不存在的文件应尽早暴露而非 spawn 时才失败；
 * PATH 兜底（'ffmpeg' 等相对名）不做存在性检查（由 spawn 报错暴露）。
 */
export async function validateFfmpegBinary(appInfo: AppInfo): Promise<boolean> {
  const resolved = resolveFfmpegPath(appInfo)
  if (!path.isAbsolute(resolved)) {
    return true // PATH 兜底跳过存在性校验
  }
  try {
    await fs.access(resolved, fs.constants.X_OK)
    return true
  } catch {
    return false
  }
}

// ── 转码参数构建 (§5.2) ── //

/** 转码选项（转码管线的输入配置） */
export interface TranscodeOptions {
  /** 输入文件路径（色键抠像后、可选行走裁切后的 footage） */
  readonly inputPath: string
  /** 输出文件路径（WebM-alpha 片段，写入项目 clips/ 目录 §12.1） */
  readonly outputPath: string
  /** 质量预设名称 */
  readonly preset: TranscodePresetName
  /** 分辨率档位（最大边长上限） */
  readonly resolutionTier: ResolutionTier
  /** 源视频宽度（像素）；用于计算缩放滤镜 */
  readonly srcWidth: number
  /** 源视频高度（像素） */
  readonly srcHeight: number
  /**
   * 尺度归一化系数 (§7.4 scaleHint)：片段间归一化缩放比。
   * 影响目标分辨率计算。
   */
  readonly scaleHint: number
  /**
   * 屏幕高度占比 (§7.4)：宠物肩高占屏幕高度的百分比 (如 0.15)。
   * 与 scaleHint 共同决定目标分辨率。
   */
  readonly screenPercent?: number
  /** 是否保留 alpha 通道（默认 true，色键抠像输出） */
  readonly alpha?: boolean
  /** 可选裁切起点 (秒)；仅转码 [trimStart, trimEnd] 区间 */
  readonly trimStartSec?: number
  /** 可选裁切终点 (秒) */
  readonly trimEndSec?: number
  /** 统一目标帧率覆盖（默认 30fps §5.2） */
  readonly fps?: number
  /**
   * 保留内嵌音轨 (§4.8 embeddedAudio, IR-010)。
   *
   * 默认 false：入库时剥除音轨 (`-an`)，音视频分离入库 (§11.1)。
   * true：保留音轨并转码为 Opus (`-c:a libopus`)，供发声片段音画同步。
   */
  readonly keepAudio?: boolean
}

/** ffmpeg 缩放滤镜参数 */
export interface ScaleFilterResult {
  /** 完整的 `-vf` 滤镜链字符串（如 "scale=320:180"） */
  readonly filterChain: string
  /** 缩放后尺寸；null = 不缩放 */
  readonly dimensions: { width: number; height: number } | null
}

/**
 * 构建缩放滤镜参数 (§7.4 归一化分辨率, §5.2 统一分辨率)。
 *
 * 如果 screenPercent + scaleHint 已指定，优先用 §7.4 归一化逻辑
 * 计算目标边长；否则用分辨率档位的 maxEdge 作为上限。
 *
 * VP9 要求偶数尺寸，由 computeScaleDimensions 保证。
 */
export function buildScaleFilter(
  options: Pick<TranscodeOptions, 'srcWidth' | 'srcHeight' | 'scaleHint' | 'screenPercent' | 'resolutionTier'>,
  screenHeightPx?: number
): ScaleFilterResult {
  const preset = RESOLUTION_PRESETS[options.resolutionTier]
  let maxEdge: number

  if (options.screenPercent !== undefined && screenHeightPx !== undefined) {
    // §7.4 归一化：按屏幕占比 + scaleHint 计算
    maxEdge = computeTargetEdge(
      screenHeightPx,
      options.screenPercent,
      options.scaleHint
    )
  } else {
    // 退化为分辨率档位上限
    maxEdge = preset.maxEdge
  }

  const dims = computeScaleDimensions(
    options.srcWidth,
    options.srcHeight,
    maxEdge
  )

  if (dims === null) {
    return { filterChain: '', dimensions: null }
  }

  return {
    filterChain: `scale=${dims.width}:${dims.height}`,
    dimensions: dims
  }
}

/** ffmpeg 参数数组（不含可执行文件路径本身） */
export type FfmpegArgs = readonly string[]

/**
 * 构建完整的 ffmpeg 命令行参数数组 (§5.2)。
 *
 * 生成的参数覆盖 SPEC §5.2 全部转码需求：
 * - `-i <input>`：输入文件
 * - `-vf scale=W:H`：分辨率归一化 (§7.4)
 * - `-c:v libvpx-vp9`：VP9 编码器
 * - `-pix_fmt yuva420p`：保留 alpha 通道
 * - `-r 30`：统一 30fps (§5.2)
 * - `-b:v` / `-crf` / `-deadline`：比特率/质量预设 (§5.2)
 * - `-g`：GOP
 *
 * @param options 转码选项
 * @param screenHeightPx 屏幕高度（像素），用于 §7.4 归一化；省略则退化为分辨率档位
 * @returns ffmpeg 参数数组
 */
export function buildFfmpegArgs(
  options: TranscodeOptions,
  screenHeightPx?: number
): FfmpegArgs {
  const preset: TranscodePreset = TRANSCODE_PRESETS[options.preset]
  if (!preset) {
    throw new Error(`unknown transcode preset: ${options.preset}`)
  }

  const fps = options.fps ?? TARGET_FPS
  const preserveAlpha = options.alpha ?? true

  const args: string[] = []

  // — 输入 — //
  // -y: 覆盖输出
  args.push('-y')

  // 可选裁切（在 -i 之前用 -ss/-to 做快速 seek）
  if (options.trimStartSec !== undefined) {
    args.push('-ss', formatTime(options.trimStartSec))
  }
  if (options.trimEndSec !== undefined && options.trimStartSec !== undefined) {
    args.push('-to', formatTime(options.trimEndSec))
  }

  args.push('-i', options.inputPath)

  // — 滤镜链 — //
  const scale = buildScaleFilter(options, screenHeightPx)
  const vfParts: string[] = []
  if (scale.filterChain) {
    vfParts.push(scale.filterChain)
  }
  // 统一帧率：fps 滤镜在 scale 之后
  vfParts.push(`fps=${fps}`)

  args.push('-vf', vfParts.join(','))

  // — 视频编码 — //
  args.push('-c:v', VIDEO_CODEC)
  args.push('-pix_fmt', PIXEL_FORMAT)
  args.push('-b:v', String(preset.videoBitrate))
  args.push('-crf', String(preset.crf))
  args.push('-deadline', preset.deadline)
  args.push('-g', String(preset.gopSize))

  // — 音频 — //
  // §4.8 embeddedAudio (IR-010)：保留音轨转 Opus，保证发声片段音画同步；
  // 其余片段入库时剥除音轨 (§11.1 音视频分离)
  if (options.keepAudio) {
    args.push('-c:a', 'libopus', '-b:a', '96k')
  } else {
    args.push('-an')
  }

  // — alpha 模式 — //
  if (preserveAlpha) {
    // libvpx-vp9 默认保留 alpha，显式声明确保
    args.push('-auto-alt-ref', '0')
  }

  // — 输出 — //
  args.push(options.outputPath)

  return args
}

/**
 * 格式化秒数为 ffmpeg 时间格式 (HH:MM:SS.mmm)。
 *
 * 用于 -ss / -to 的精确 seek 参数。
 */
function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) {
    throw new Error(`invalid time: ${seconds}`)
  }
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = seconds % 60
  return `${pad2(h)}:${pad2(m)}:${s.toFixed(3).padStart(6, '0')}`
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n)
}

/** 解析后的转码命令（可执行文件 + 参数） */
export interface FfmpegCommand {
  /** ffmpeg 可执行文件路径 */
  readonly executable: string
  /** 命令行参数 */
  readonly args: FfmpegArgs
}

/**
 * 构建完整的 ffmpeg 转码命令（可执行文件 + 参数）。
 *
 * 便捷封装，合并路径解析与参数构建。
 */
export function buildTranscodeCommand(
  appInfo: AppInfo,
  options: TranscodeOptions,
  screenHeightPx?: number
): FfmpegCommand {
  return {
    executable: resolveFfmpegPath(appInfo),
    args: buildFfmpegArgs(options, screenHeightPx)
  }
}
