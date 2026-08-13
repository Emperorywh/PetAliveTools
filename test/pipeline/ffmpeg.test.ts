/**
 * FFmpeg 路径解析与命令构建测试 (§3.3, §5.2)
 *
 * 验证：
 * - ffmpeg 二进制路径解析（打包 / 开发 / 覆盖三种模式）
 * - 命令行参数构建（VP9 + alpha + 30fps + 归一化分辨率 + 比特率预设）
 * - 缩放滤镜构建
 * - 裁切参数
 * - 预设参数差异
 */
import { describe, it, expect } from 'vitest'
import * as path from 'node:path'

import {
  resolveFfmpegPath,
  validateFfmpegBinary,
  buildScaleFilter,
  buildFfmpegArgs,
  buildTranscodeCommand,
  type AppInfo,
  type TranscodeOptions
} from '../../src/main/pipeline/ffmpeg'
import { TRANSCODE_PRESETS, PIXEL_FORMAT, VIDEO_CODEC } from '../../src/shared/pipeline/presets'

// ── 辅助函数 ── //

function baseOptions(overrides?: Partial<TranscodeOptions>): TranscodeOptions {
  return {
    inputPath: 'C:/clips/input.mov',
    outputPath: 'C:/project/clips/walk_right_01.webm',
    preset: 'standard',
    resolutionTier: 'normal',
    srcWidth: 1920,
    srcHeight: 1080,
    scaleHint: 1.0,
    screenPercent: 0.15,
    ...overrides
  }
}

// ── resolveFfmpegPath (§3.3) ── //

describe('resolveFfmpegPath (§3.3)', () => {
  it('returns override path when specified', () => {
    const appInfo: AppInfo = {
      isPackaged: false,
      appPath: '/app',
      ffmpegPathOverride: '/custom/ffmpeg'
    }
    expect(resolveFfmpegPath(appInfo)).toBe('/custom/ffmpeg')
  })

  it('returns packaged path when isPackaged=true', () => {
    const appInfo: AppInfo = {
      isPackaged: true,
      appPath: 'C:/app'
    }
    const resolved = resolveFfmpegPath(appInfo)
    expect(resolved).toBe(path.join('C:/app', 'ffmpeg', 'ffmpeg.exe'))
    expect(resolved).toContain('ffmpeg.exe')
  })

  it('returns "ffmpeg" from PATH in development', () => {
    const appInfo: AppInfo = {
      isPackaged: false,
      appPath: '/dev/app'
    }
    expect(resolveFfmpegPath(appInfo)).toBe('ffmpeg')
  })

  it('override takes priority over packaged', () => {
    const appInfo: AppInfo = {
      isPackaged: true,
      appPath: '/app',
      ffmpegPathOverride: '/override/ffmpeg.exe'
    }
    expect(resolveFfmpegPath(appInfo)).toBe('/override/ffmpeg.exe')
  })
})

// ── validateFfmpegBinary ── //

describe('validateFfmpegBinary', () => {
  it('returns true in development environment (skips existence check)', async () => {
    const appInfo: AppInfo = {
      isPackaged: false,
      appPath: '/dev'
    }
    expect(await validateFfmpegBinary(appInfo)).toBe(true)
  })

  it('returns true when override is specified (skips existence check)', async () => {
    const appInfo: AppInfo = {
      isPackaged: true,
      appPath: '/app',
      ffmpegPathOverride: '/nonexistent/ffmpeg'
    }
    expect(await validateFfmpegBinary(appInfo)).toBe(true)
  })
})

// ── buildScaleFilter (§7.4) ── //

describe('buildScaleFilter', () => {
  it('produces scale filter when source exceeds target', () => {
    const result = buildScaleFilter({
      srcWidth: 1920,
      srcHeight: 1080,
      scaleHint: 1.0,
      screenPercent: 0.15,
      resolutionTier: 'normal'
    }, 1080)

    expect(result.filterChain).toContain('scale=')
    expect(result.dimensions).not.toBeNull()
  })

  it('returns empty filterChain when no scaling needed', () => {
    const result = buildScaleFilter({
      srcWidth: 320,
      srcHeight: 180,
      scaleHint: 1.0,
      resolutionTier: 'normal'
    })

    expect(result.filterChain).toBe('')
    expect(result.dimensions).toBeNull()
  })

  it('falls back to resolution tier maxEdge when screenPercent/screenHeight not provided', () => {
    const result = buildScaleFilter({
      srcWidth: 1920,
      srcHeight: 1080,
      scaleHint: 1.0,
      resolutionTier: 'compact'
    })

    expect(result.dimensions).not.toBeNull()
    // compact maxEdge = 360, so width should be 360
    expect(result.dimensions!.width).toBe(360)
  })
})

// ── buildFfmpegArgs (§5.2) ── //

describe('buildFfmpegArgs (§5.2)', () => {
  it('includes all required VP9-alpha encoding parameters', () => {
    const args = buildFfmpegArgs(baseOptions())

    // -y overwrite
    expect(args).toContain('-y')
    // input
    expect(args).toContain('-i')
    expect(args[args.indexOf('-i') + 1]).toBe('C:/clips/input.mov')
    // video filter (scale + fps)
    expect(args).toContain('-vf')
    const vf = args[args.indexOf('-vf') + 1]
    expect(vf).toContain('fps=30')
    // codec
    expect(args).toContain('-c:v')
    expect(args[args.indexOf('-c:v') + 1]).toBe(VIDEO_CODEC)
    // pixel format (alpha)
    expect(args).toContain('-pix_fmt')
    expect(args[args.indexOf('-pix_fmt') + 1]).toBe(PIXEL_FORMAT)
    // bitrate
    expect(args).toContain('-b:v')
    // CRF
    expect(args).toContain('-crf')
    // deadline
    expect(args).toContain('-deadline')
    // GOP
    expect(args).toContain('-g')
    // no audio
    expect(args).toContain('-an')
    // auto-alt-ref 0 for alpha
    expect(args).toContain('-auto-alt-ref')
    expect(args[args.indexOf('-auto-alt-ref') + 1]).toBe('0')
    // output path
    expect(args[args.length - 1]).toBe('C:/project/clips/walk_right_01.webm')
  })

  it('uses VP9 codec (libvpx-vp9)', () => {
    const args = buildFfmpegArgs(baseOptions())
    expect(args[args.indexOf('-c:v') + 1]).toBe('libvpx-vp9')
  })

  it('uses yuva420p pixel format for alpha preservation', () => {
    const args = buildFfmpegArgs(baseOptions())
    expect(args[args.indexOf('-pix_fmt') + 1]).toBe('yuva420p')
  })

  it('targets 30fps (§5.2 unified frame rate)', () => {
    const args = buildFfmpegArgs(baseOptions())
    const vf = args[args.indexOf('-vf') + 1]
    expect(vf).toContain('fps=30')
  })

  it('applies scale filter for resolution normalization (§7.4)', () => {
    const args = buildFfmpegArgs(baseOptions(), 1080)
    const vf = args[args.indexOf('-vf') + 1]
    expect(vf).toContain('scale=')
  })

  it('includes scale+fps in single -vf comma-separated chain', () => {
    const args = buildFfmpegArgs(baseOptions(), 1080)
    const vf = args[args.indexOf('-vf') + 1]
    expect(vf).toMatch(/^scale=\d+:\d+,fps=30$/)
  })

  it('uses standard preset parameters by default', () => {
    const args = buildFfmpegArgs(baseOptions({ preset: 'standard' }))
    expect(args[args.indexOf('-b:v') + 1]).toBe(String(TRANSCODE_PRESETS.standard.videoBitrate))
    expect(args[args.indexOf('-crf') + 1]).toBe(String(TRANSCODE_PRESETS.standard.crf))
  })

  it('uses high preset parameters', () => {
    const args = buildFfmpegArgs(baseOptions({ preset: 'high' }))
    expect(args[args.indexOf('-b:v') + 1]).toBe(String(TRANSCODE_PRESETS.high.videoBitrate))
    expect(args[args.indexOf('-crf') + 1]).toBe(String(TRANSCODE_PRESETS.high.crf))
  })

  it('uses sleep preset parameters (lower bitrate, higher CRF)', () => {
    const args = buildFfmpegArgs(baseOptions({ preset: 'sleep' }))
    expect(args[args.indexOf('-b:v') + 1]).toBe(String(TRANSCODE_PRESETS.sleep.videoBitrate))
    expect(args[args.indexOf('-crf') + 1]).toBe(String(TRANSCODE_PRESETS.sleep.crf))
    expect(args[args.indexOf('-g') + 1]).toBe(String(TRANSCODE_PRESETS.sleep.gopSize))
  })

  it('high preset produces higher bitrate args than standard', () => {
    const highArgs = buildFfmpegArgs(baseOptions({ preset: 'high' }))
    const stdArgs = buildFfmpegArgs(baseOptions({ preset: 'standard' }))
    const highBitrate = Number(highArgs[highArgs.indexOf('-b:v') + 1])
    const stdBitrate = Number(stdArgs[stdArgs.indexOf('-b:v') + 1])
    expect(highBitrate).toBeGreaterThan(stdBitrate)
  })

  it('includes -y at the beginning for overwrite', () => {
    const args = buildFfmpegArgs(baseOptions())
    expect(args[0]).toBe('-y')
  })

  it('includes trim parameters when specified', () => {
    const args = buildFfmpegArgs(baseOptions({ trimStartSec: 1.5, trimEndSec: 5.5 }))
    expect(args).toContain('-ss')
    expect(args).toContain('-to')
    // -ss and -to should appear before -i
    const iIndex = args.indexOf('-i')
    expect(args.indexOf('-ss')).toBeLessThan(iIndex)
    expect(args.indexOf('-to')).toBeLessThan(iIndex)
  })

  it('formats trim times as HH:MM:SS.mmm', () => {
    const args = buildFfmpegArgs(baseOptions({ trimStartSec: 1.5, trimEndSec: 65.5 }))
    const ssValue = args[args.indexOf('-ss') + 1]
    const toValue = args[args.indexOf('-to') + 1]
    expect(ssValue).toBe('00:00:01.500')
    expect(toValue).toBe('00:01:05.500')
  })

  it('respects custom fps override', () => {
    const args = buildFfmpegArgs(baseOptions({ fps: 24 }))
    const vf = args[args.indexOf('-vf') + 1]
    expect(vf).toContain('fps=24')
  })

  it('does not include auto-alt-ref when alpha=false', () => {
    const args = buildFfmpegArgs(baseOptions({ alpha: false }))
    expect(args).not.toContain('-auto-alt-ref')
  })

  it('throws on unknown preset', () => {
    expect(() => buildFfmpegArgs(baseOptions({ preset: 'ultra' as never }))).toThrow(
      /unknown transcode preset/
    )
  })

  it('includes deadline from preset', () => {
    const args = buildFfmpegArgs(baseOptions({ preset: 'standard' }))
    expect(args[args.indexOf('-deadline') + 1]).toBe(TRANSCODE_PRESETS.standard.deadline)
  })

  it('output path is always the last argument', () => {
    const args = buildFfmpegArgs(baseOptions())
    expect(args[args.length - 1]).toBe('C:/project/clips/walk_right_01.webm')
  })
})

// ── buildTranscodeCommand ── //

describe('buildTranscodeCommand', () => {
  it('combines path resolution with args', () => {
    const appInfo: AppInfo = {
      isPackaged: true,
      appPath: 'C:/Program Files/PetAlive'
    }
    const cmd = buildTranscodeCommand(appInfo, baseOptions(), 1080)

    expect(cmd.executable).toContain('ffmpeg.exe')
    expect(cmd.args).toContain('-c:v')
    expect(cmd.args).toContain('-i')
  })

  it('uses PATH ffmpeg in development', () => {
    const appInfo: AppInfo = {
      isPackaged: false,
      appPath: '/dev'
    }
    const cmd = buildTranscodeCommand(appInfo, baseOptions(), 1080)
    expect(cmd.executable).toBe('ffmpeg')
  })
})
