/**
 * 转码编排 (§5.2, §3.3)
 *
 * 入库管线的最终环节：把色键抠像后（可选行走裁切）的 footage
 * 转码为运行时可直接播放的 WebM-alpha 片段。
 *
 * 输入：色键抠像后的 footage（TASK-005），可选行走裁切（TASK-006）。
 * 输出：项目 clips/ 目录下的 `<clip_id>.webm` (§12.1)。
 *
 * 转码参数由 presets (§5.2) + ffmpeg (§3.3) 模块定义；
 * 本模块负责编排：解析路径 → 构建命令 → 执行 → 报告结果。
 *
 * 运行于主进程。
 */

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { promises as fs } from 'node:fs'
import * as path from 'node:path'

import {
  type TranscodePresetName,
  type ResolutionTier,
  TARGET_FPS,
  recommendPreset
} from '../../shared/pipeline/presets'
import type { ClipMeta } from '../../shared/types/clip-meta'
import {
  type AppInfo,
  resolveFfmpegPath,
  buildFfmpegArgs,
  type TranscodeOptions,
  type FfmpegArgs
} from './ffmpeg'

/** 转码请求（由导入流程构造） */
export interface TranscodeRequest {
  /** 片段 id（输出文件名 = `<id>.webm`） */
  readonly clipId: string
  /** 输入 footage 路径（色键后、可选裁切后） */
  readonly inputPath: string
  /** 源视频宽度（像素） */
  readonly srcWidth: number
  /** 源视频高度（像素） */
  readonly srcHeight: number
  /** 质量预设名称（省略则按片段属性自动推荐） */
  readonly preset?: TranscodePresetName
  /** 分辨率档位（默认 normal） */
  readonly resolutionTier?: ResolutionTier
  /** 尺度归一化系数 (§7.4 scaleHint) */
  readonly scaleHint: number
  /** 屏幕高度占比 (§7.4，默认 0.15) */
  readonly screenPercent?: number
  /** 是否保留 alpha（默认 true） */
  readonly alpha?: boolean
  /** 可选裁切起点 (秒) */
  readonly trimStartSec?: number
  /** 可选裁切终点 (秒) */
  readonly trimEndSec?: number
  /** 目标帧率覆盖（默认 30 §5.2） */
  readonly fps?: number
}

/** 转码结果 */
export interface TranscodeResult {
  /** 输出文件路径 */
  readonly outputPath: string
  /** 使用的质量预设 */
  readonly preset: TranscodePresetName
  /** 实际执行的 ffmpeg 命令参数 */
  readonly args: FfmpegArgs
  /** ffmpeg stderr 日志（截断，用于诊断） */
  readonly stderr: string
}

/** 片段文件名：<clip_id>.webm (§12.1) */
export function clipFileName(clipId: string): string {
  return `${clipId}.webm`
}

/**
 * 从转码请求构建 TranscodeOptions。
 *
 * 如果 preset 未指定，按片段属性自动推荐 (§5.2)。
 */
export function buildTranscodeOptions(
  request: TranscodeRequest,
  clipsDir: string,
  clip?: ClipMeta
): TranscodeOptions {
  const preset = request.preset ?? (clip ? recommendPreset(clip.state, clip.loop, clip.signature) : 'standard')

  return {
    inputPath: request.inputPath,
    outputPath: path.join(clipsDir, clipFileName(request.clipId)),
    preset,
    resolutionTier: request.resolutionTier ?? 'normal',
    srcWidth: request.srcWidth,
    srcHeight: request.srcHeight,
    scaleHint: request.scaleHint,
    screenPercent: request.screenPercent ?? 0.15,
    alpha: request.alpha ?? true,
    trimStartSec: request.trimStartSec,
    trimEndSec: request.trimEndSec,
    fps: request.fps ?? TARGET_FPS
  }
}

/** 执行 ffmpeg 命令的选项 */
export interface ExecOptions {
  /** 超时毫秒（默认 300000 = 5 分钟） */
  readonly timeoutMs?: number
}

/** ffmpeg 进程退出码 */
const FFMPEG_SUCCESS = 0

/**
 * 转码片段为 WebM-alpha (§5.2)。
 *
 * 编排流程：
 * 1. 构建 ffmpeg 命令（路径解析 + 参数构建）
 * 2. 确保 clips/ 目录存在
 * 3. 执行 ffmpeg 进程
 * 4. 检查退出码，返回结果
 *
 * @param appInfo 应用环境信息（用于解析 ffmpeg 路径）
 * @param request 转码请求
 * @param clipsDir 项目 clips/ 目录
 * @param clip 可选的片段元数据（用于自动推荐预设）
 * @param screenHeightPx 屏幕高度（像素，用于 §7.4 归一化）
 * @returns 转码结果
 * @throws ffmpeg 非零退出码时抛出包含 stderr 的 Error
 */
export async function transcodeClip(
  appInfo: AppInfo,
  request: TranscodeRequest,
  clipsDir: string,
  clip?: ClipMeta,
  screenHeightPx?: number
): Promise<TranscodeResult> {
  const options = buildTranscodeOptions(request, clipsDir, clip)
  const executable = resolveFfmpegPath(appInfo)
  const args = buildFfmpegArgs(options, screenHeightPx)

  // 确保输出目录存在
  await fs.mkdir(clipsDir, { recursive: true })

  const { code, stderr } = await runFfmpeg(executable, args)

  if (code !== FFMPEG_SUCCESS) {
    throw new Error(
      `ffmpeg exited with code ${code}\n` +
      `command: ${executable} ${args.join(' ')}\n` +
      `stderr:\n${truncate(stderr, 2000)}`
    )
  }

  return {
    outputPath: options.outputPath,
    preset: options.preset,
    args,
    stderr: truncate(stderr, 4000)
  }
}

/**
 * 执行 ffmpeg 进程并等待退出。
 *
 * 收集 stderr 日志（ffmpeg 把进度/诊断写入 stderr）。
 */
function runFfmpeg(executable: string, args: FfmpegArgs, execOptions?: ExecOptions): Promise<{ code: number; stderr: string }> {
  return new Promise((resolve, reject) => {
    const proc: ChildProcessWithoutNullStreams = spawn(executable, [...args], {
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe']
    })

    let stderrChunks = ''
    const stderrBuf: Buffer[] = []

    proc.stdout.on('data', () => {
      // ffmpeg 正常输出到 stderr，stdout 通常为空；忽略
    })

    proc.stderr.on('data', (chunk: Buffer) => {
      stderrBuf.push(chunk)
    })

    proc.on('error', (err: Error) => {
      reject(new Error(`failed to spawn ffmpeg: ${err.message}`))
    })

    proc.on('close', (code: number | null) => {
      stderrChunks = Buffer.concat(stderrBuf).toString('utf-8')
      resolve({ code: code ?? -1, stderr: stderrChunks })
    })

    // 超时
    const timeoutMs = execOptions?.timeoutMs ?? 300_000
    if (timeoutMs > 0) {
      const timer = setTimeout(() => {
        proc.kill('SIGTERM')
        reject(new Error(`ffmpeg timed out after ${timeoutMs}ms`))
      }, timeoutMs)
      proc.on('close', () => clearTimeout(timer))
    }
  })
}

/** 截断字符串到指定长度 */
function truncate(s: string, maxLen: number): string {
  if (s.length <= maxLen) return s
  return s.slice(0, maxLen) + '\n...(truncated)'
}
