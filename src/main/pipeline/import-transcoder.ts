/**
 * 导入转码：色键 + VP9-alpha 编码 (§5.1 + §5.2)
 *
 * 导入流程的最终环节：把用户选定的原始视频经色键抠像后转码为
 * WebM-alpha 片段，写入项目 clips/ 目录。
 *
 * 与 TASK-007 的 transcoder.ts 的区别：本模块在 ffmpeg 滤镜链中
 * 追加 chromakey 滤镜（§5.1），使色键抠像与 VP9-alpha 编码在
 * 单次 ffmpeg 调用中完成。路径解析、编码预设、参数构建复用
 * TASK-007 的 ffmpeg.ts 与 shared/pipeline/presets.ts。
 *
 * 运行于主进程。
 */

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { promises as fs } from 'node:fs'
import * as path from 'node:path'

import {
  type TranscodePresetName,
  type ResolutionTier,
  TRANSCODE_PRESETS,
  RESOLUTION_PRESETS,
  TARGET_FPS,
  PIXEL_FORMAT,
  VIDEO_CODEC,
  computeScaleDimensions,
  computeTargetEdge,
} from '../../shared/pipeline/presets'
import type { RgbColor } from '../../shared/pipeline/frame'
import {
  type AppInfo,
  resolveFfmpegPath,
} from './ffmpeg'
import type { ImportTranscodeRequest } from '../../shared/pipeline/import-flow'

// Re-export AppInfo for IPC handlers
export type { AppInfo } from './ffmpeg'

/** 导入转码选项 */
export interface ImportTranscodeOptions {
  readonly inputPath: string
  readonly outputPath: string
  readonly preset: TranscodePresetName
  readonly resolutionTier: ResolutionTier
  readonly srcWidth: number
  readonly srcHeight: number
  readonly scaleHint: number
  readonly screenPercent: number
  readonly fps: number
  readonly trimStartSec?: number
  readonly trimEndSec?: number
  readonly chromaKey?: {
    readonly referenceColor: RgbColor
    readonly tolerance: number
    readonly softness: number
  }
  /** 保留内嵌音轨 (§4.8 embeddedAudio, IR-010)：默认 false 剥除音轨 */
  readonly keepAudio?: boolean
}

/** 导入转码结果 */
export interface ImportTranscodeResult {
  readonly outputPath: string
  readonly preset: TranscodePresetName
  readonly args: readonly string[]
  readonly stderr: string
}

/**
 * 从导入转码请求构建完整选项。
 */
export function buildImportTranscodeOptions(
  request: ImportTranscodeRequest,
  clipsDir: string,
  preset: TranscodePresetName,
  resolutionTier: ResolutionTier = 'normal',
): ImportTranscodeOptions {
  return {
    inputPath: request.inputPath,
    outputPath: path.join(clipsDir, `${request.clipId}.webm`),
    preset,
    resolutionTier,
    srcWidth: request.srcWidth,
    srcHeight: request.srcHeight,
    scaleHint: request.scaleHint,
    screenPercent: 0.15,
    fps: TARGET_FPS,
    trimStartSec: request.trimStartSec,
    trimEndSec: request.trimEndSec,
    chromaKey: request.chromaKey,
    // §4.8 embeddedAudio (IR-010)：发声片段保留内嵌音轨保证音画同步
    keepAudio: request.keepAudio,
  }
}

/** RGB → ffmpeg hex 格式 (0xRRGGBB) */
function rgbToHex(c: RgbColor): string {
  const h = (n: number) => Math.round(n).toString(16).padStart(2, '0')
  return `0x${h(c.r)}${h(c.g)}${h(c.b)}`
}

/**
 * 构建 ffmpeg 参数数组（含 chromakey 滤镜）。
 *
 * 滤镜链顺序：chromakey → scale → fps
 * chromakey 必须在 scale 之前以保证全分辨率色键精度。
 */
export function buildImportFfmpegArgs(
  options: ImportTranscodeOptions,
  screenHeightPx?: number,
): readonly string[] {
  const preset = TRANSCODE_PRESETS[options.preset]
  if (!preset) {
    throw new Error(`unknown transcode preset: ${options.preset}`)
  }

  const args: string[] = ['-y']

  // 可选裁切（seek）
  if (options.trimStartSec !== undefined) {
    args.push('-ss', formatTime(options.trimStartSec))
  }
  if (options.trimEndSec !== undefined && options.trimStartSec !== undefined) {
    args.push('-to', formatTime(options.trimEndSec))
  }

  args.push('-i', options.inputPath)

  // ── 滤镜链 ── //
  const vfParts: string[] = []

  // chromakey 滤镜 (§5.1)
  if (options.chromaKey) {
    const { referenceColor, tolerance, softness } = options.chromaKey
    const color = rgbToHex(referenceColor)
    // ffmpeg chromakey: similarity ≈ tolerance, blend ≈ softness
    vfParts.push(`chromakey=${color}:${tolerance.toFixed(4)}:${softness.toFixed(4)}`)
  }

  // 分辨率归一化 (§7.4)
  const maxEdge = screenHeightPx !== undefined
    ? computeTargetEdge(screenHeightPx, options.screenPercent, options.scaleHint)
    : RESOLUTION_PRESETS[options.resolutionTier].maxEdge
  const dims = computeScaleDimensions(options.srcWidth, options.srcHeight, maxEdge)
  if (dims) {
    vfParts.push(`scale=${dims.width}:${dims.height}`)
  }

  // 统一帧率
  vfParts.push(`fps=${options.fps}`)

  if (vfParts.length > 0) {
    args.push('-vf', vfParts.join(','))
  }

  // ── 视频编码 ── //
  args.push('-c:v', VIDEO_CODEC)
  args.push('-pix_fmt', PIXEL_FORMAT)
  args.push('-b:v', String(preset.videoBitrate))
  args.push('-crf', String(preset.crf))
  args.push('-deadline', preset.deadline)
  args.push('-g', String(preset.gopSize))

  // §4.8 embeddedAudio (IR-010)：保留音轨转 Opus；其余片段剥除音轨 (§11.1)
  if (options.keepAudio) {
    args.push('-c:a', 'libopus', '-b:a', '96k')
  } else {
    args.push('-an')
  }

  // 确保 alpha
  args.push('-auto-alt-ref', '0')

  // ── 输出 ── //
  args.push(options.outputPath)

  return args
}

/** 格式化秒为 ffmpeg 时间格式 */
function formatTime(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = seconds % 60
  const pad2 = (n: number) => (n < 10 ? `0${n}` : String(n))
  return `${pad2(h)}:${pad2(m)}:${s.toFixed(3).padStart(6, '0')}`
}

/**
 * 执行导入转码 (§5.1 + §5.2)。
 *
 * 编排流程：解析路径 → 构建命令 → 确保目录 → 执行 → 报告结果。
 *
 * @param appInfo 应用环境（ffmpeg 路径解析）
 * @param request 导入转码请求（含色键参数）
 * @param clipsDir 项目 clips/ 目录
 * @param preset 质量预设
 * @param screenHeightPx 屏幕高度（像素，§7.4）
 */
export async function transcodeImport(
  appInfo: AppInfo,
  request: ImportTranscodeRequest,
  clipsDir: string,
  preset: TranscodePresetName,
  screenHeightPx?: number,
): Promise<ImportTranscodeResult> {
  const options = buildImportTranscodeOptions(request, clipsDir, preset)
  const executable = resolveFfmpegPath(appInfo)
  const args = buildImportFfmpegArgs(options, screenHeightPx)

  await fs.mkdir(clipsDir, { recursive: true })

  const { code, stderr } = await runFfmpeg(executable, args)

  if (code !== 0) {
    throw new Error(
      `ffmpeg exited with code ${code}\n` +
      `command: ${executable} ${args.join(' ')}\n` +
      `stderr:\n${truncate(stderr, 2000)}`,
    )
  }

  return {
    outputPath: options.outputPath,
    preset: options.preset,
    args,
    stderr: truncate(stderr, 4000),
  }
}

/** 执行 ffmpeg 进程并等待退出 */
function runFfmpeg(
  executable: string,
  args: readonly string[],
  timeoutMs = 300_000,
): Promise<{ code: number; stderr: string }> {
  return new Promise((resolve, reject) => {
    const proc: ChildProcessWithoutNullStreams = spawn(executable, [...args], {
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    const stderrBuf: Buffer[] = []

    proc.stdout.on('data', () => {})

    proc.stderr.on('data', (chunk: Buffer) => {
      stderrBuf.push(chunk)
    })

    proc.on('error', (err: Error) => {
      reject(new Error(`failed to spawn ffmpeg: ${err.message}`))
    })

    proc.on('close', (code: number | null) => {
      const stderr = Buffer.concat(stderrBuf).toString('utf-8')
      resolve({ code: code ?? -1, stderr })
    })

    if (timeoutMs > 0) {
      const timer = setTimeout(() => {
        proc.kill('SIGTERM')
        reject(new Error(`ffmpeg timed out after ${timeoutMs}ms`))
      }, timeoutMs)
      proc.on('close', () => clearTimeout(timer))
    }
  })
}

/**
 * 构建音轨抽取的 ffmpeg 参数 (§4.8, IR-010)。
 *
 * `-vn` 丢弃视频流，音轨转 Opus 96k；可选裁切与片段裁剪区间一致。
 */
export function buildAudioExtractArgs(
  inputPath: string,
  outputPath: string,
  trimStartSec?: number,
  trimEndSec?: number,
): readonly string[] {
  const args: string[] = ['-y']
  if (trimStartSec !== undefined) {
    args.push('-ss', formatTime(trimStartSec))
  }
  if (trimEndSec !== undefined && trimStartSec !== undefined) {
    args.push('-to', formatTime(trimEndSec))
  }
  args.push('-i', inputPath)
  args.push('-vn') // 仅音轨
  args.push('-c:a', 'libopus', '-b:a', '96k')
  args.push(outputPath)
  return args
}

/**
 * 从视频抽取音轨为独立音频素材 (§4.8, IR-010/IR-013 联动)。
 *
 * 输出 WebM/Opus 到项目 audio/ 目录，供动作触发声/环境声引用 (§11.1)。
 * 与转码共用 ffmpeg 路径解析 (IR-011)。
 *
 * @param appInfo 应用环境（ffmpeg 路径解析）
 * @param inputPath 源视频路径
 * @param outputPath 输出音频路径（项目 audio/ 下，.webm）
 * @param trimStartSec 可选裁切起点（秒，与片段裁剪一致）
 * @param trimEndSec 可选裁切终点（秒）
 */
export async function extractAudioTrack(
  appInfo: AppInfo,
  inputPath: string,
  outputPath: string,
  trimStartSec?: number,
  trimEndSec?: number,
): Promise<void> {
  const executable = resolveFfmpegPath(appInfo)
  const args = buildAudioExtractArgs(inputPath, outputPath, trimStartSec, trimEndSec)

  await fs.mkdir(path.dirname(outputPath), { recursive: true })

  const { code, stderr } = await runFfmpeg(executable, args)
  if (code !== 0) {
    throw new Error(
      `ffmpeg audio extraction exited with code ${code}\n` +
        `command: ${executable} ${args.join(' ')}\n` +
        `stderr:\n${truncate(stderr, 2000)}`,
    )
  }
}

function truncate(s: string, maxLen: number): string {
  if (s.length <= maxLen) return s
  return s.slice(0, maxLen) + '\n...(truncated)'
}
