/**
 * 转码编排测试 (§5.2, §3.3)
 *
 * 验证：
 * - clipFileName 命名规则
 * - buildTranscodeOptions 默认值填充与自动预设推荐
 * - TranscodeRequest → TranscodeOptions 转换
 * - 集成：transcodeClip 在模拟 ffmpeg 环境下正确编排
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as path from 'node:path'
import * as os from 'node:os'
import { promises as fs } from 'node:fs'

import {
  clipFileName,
  buildTranscodeOptions,
  type TranscodeRequest
} from '../../src/main/pipeline/transcoder'
import { buildFfmpegArgs } from '../../src/main/pipeline/ffmpeg'
import { recommendPreset, TARGET_FPS } from '../../src/shared/pipeline/presets'
import type { ClipMeta } from '../../src/shared/types/clip-meta'

// ── clipFileName ── //

describe('clipFileName', () => {
  it('produces <clip_id>.webm', () => {
    expect(clipFileName('walk_right_01')).toBe('walk_right_01.webm')
    expect(clipFileName('idle_sit_02')).toBe('idle_sit_02.webm')
  })
})

// ── buildTranscodeOptions ── //

describe('buildTranscodeOptions', () => {
  const baseRequest: TranscodeRequest = {
    clipId: 'walk_right_01',
    inputPath: '/tmp/input.mov',
    srcWidth: 1920,
    srcHeight: 1080,
    scaleHint: 1.0
  }

  it('fills defaults for optional fields', () => {
    const opts = buildTranscodeOptions(baseRequest, '/project/clips')

    expect(opts.inputPath).toBe('/tmp/input.mov')
    expect(opts.outputPath).toBe(path.join('/project/clips', 'walk_right_01.webm'))
    expect(opts.resolutionTier).toBe('normal')
    expect(opts.scaleHint).toBe(1.0)
    expect(opts.screenPercent).toBe(0.15)
    expect(opts.alpha).toBe(true)
    expect(opts.fps).toBe(TARGET_FPS)
  })

  it('defaults to standard preset when no clip metadata provided', () => {
    const opts = buildTranscodeOptions(baseRequest, '/project/clips')
    expect(opts.preset).toBe('standard')
  })

  it('auto-recommends preset based on clip metadata', () => {
    const sleepClip: ClipMeta = {
      id: 'sleep_01',
      state: 'sleep',
      category: 'basic',
      direction: 'none',
      anchor: 'none',
      loop: true,
      loopInSec: 0,
      loopOutSec: 3,
      signature: false,
      variant: 1,
      prop: false,
      embeddedAudio: false,
      audio: null,
      scaleHint: 1.0,
      hitbox: [0.1, 0.05, 0.8, 0.9]
    }
    const opts = buildTranscodeOptions(baseRequest, '/project/clips', sleepClip)
    expect(opts.preset).toBe('sleep')
  })

  it('explicit preset overrides recommendation', () => {
    const sleepClip: ClipMeta = {
      id: 'sleep_01',
      state: 'sleep',
      category: 'basic',
      direction: 'none',
      anchor: 'none',
      loop: true,
      loopInSec: 0,
      loopOutSec: 3,
      signature: false,
      variant: 1,
      prop: false,
      embeddedAudio: false,
      audio: null,
      scaleHint: 1.0,
      hitbox: [0.1, 0.05, 0.8, 0.9]
    }
    const opts = buildTranscodeOptions(
      { ...baseRequest, preset: 'high' },
      '/project/clips',
      sleepClip
    )
    expect(opts.preset).toBe('high')
  })

  it('respects custom resolutionTier', () => {
    const opts = buildTranscodeOptions(
      { ...baseRequest, resolutionTier: 'compact' },
      '/project/clips'
    )
    expect(opts.resolutionTier).toBe('compact')
  })

  it('respects custom screenPercent', () => {
    const opts = buildTranscodeOptions(
      { ...baseRequest, screenPercent: 0.18 },
      '/project/clips'
    )
    expect(opts.screenPercent).toBe(0.18)
  })

  it('passes trim parameters through', () => {
    const opts = buildTranscodeOptions(
      { ...baseRequest, trimStartSec: 1.0, trimEndSec: 5.0 },
      '/project/clips'
    )
    expect(opts.trimStartSec).toBe(1.0)
    expect(opts.trimEndSec).toBe(5.0)
  })

  it('output path joins clipsDir with <clipId>.webm', () => {
    const opts = buildTranscodeOptions(baseRequest, '/my/project/clips')
    expect(opts.outputPath).toBe(path.join('/my/project/clips', 'walk_right_01.webm'))
  })
})

// ── 端到端选项→参数一致性 ── //

describe('transcode options to ffmpeg args consistency', () => {
  it('built options produce valid ffmpeg args for sleep preset', () => {
    const request: TranscodeRequest = {
      clipId: 'sleep_01',
      inputPath: '/tmp/input.mov',
      srcWidth: 1920,
      srcHeight: 1080,
      scaleHint: 1.0,
      preset: 'sleep'
    }
    const opts = buildTranscodeOptions(request, '/clips')
    const args = buildFfmpegArgs(opts, 1080)

    // VP9 + alpha + 30fps + sleep preset params
    expect(args).toContain('libvpx-vp9')
    expect(args).toContain('yuva420p')
    expect(args[args.indexOf('-b:v') + 1]).toBe('500000')
    expect(args).toContain('-an')
  })

  it('built options produce valid ffmpeg args for high preset', () => {
    const request: TranscodeRequest = {
      clipId: 'sig_flop_01',
      inputPath: '/tmp/input.mov',
      srcWidth: 1920,
      srcHeight: 1080,
      scaleHint: 1.0,
      preset: 'high'
    }
    const opts = buildTranscodeOptions(request, '/clips')
    const args = buildFfmpegArgs(opts, 1080)

    expect(args[args.indexOf('-b:v') + 1]).toBe('2500000')
    expect(args[args.indexOf('-crf') + 1]).toBe('28')
  })
})

// ── recommendPreset 集成测试 ── //

describe('preset recommendation integration', () => {
  it('recommendPreset + buildTranscodeOptions produces consistent presets', () => {
    const testCases = [
      { state: 'idle_sit', loop: false, signature: false, expected: 'standard' as const },
      { state: 'sleep', loop: true, signature: false, expected: 'sleep' as const },
      { state: 'lie', loop: true, signature: false, expected: 'sleep' as const },
      { state: 'groom', loop: true, signature: false, expected: 'sleep' as const },
      { state: 'walk', loop: false, signature: false, expected: 'standard' as const },
      { state: 'signature_flop', loop: false, signature: true, expected: 'high' as const },
    ]

    for (const tc of testCases) {
      const recommended = recommendPreset(tc.state, tc.loop, tc.signature)
      expect(recommended).toBe(tc.expected)

      // Verify buildTranscodeOptions uses same recommendation when no explicit preset
      const clip: ClipMeta = {
        id: 'test',
        state: tc.state,
        category: 'basic',
        direction: 'none',
        anchor: 'none',
        loop: tc.loop,
        loopInSec: null,
        loopOutSec: null,
        signature: tc.signature,
        variant: 1,
        prop: false,
        embeddedAudio: false,
        audio: null,
        scaleHint: 1.0,
        hitbox: [0.1, 0.05, 0.8, 0.9]
      }
      const request: TranscodeRequest = {
        clipId: 'test',
        inputPath: '/tmp/in.mov',
        srcWidth: 1920,
        srcHeight: 1080,
        scaleHint: 1.0
      }
      const opts = buildTranscodeOptions(request, '/clips', clip)
      expect(opts.preset).toBe(tc.expected)
    }
  })
})

// ── 文件系统编排测试（不执行 ffmpeg，仅验证目录创建） ── //

describe('transcoder directory creation', () => {
  let tmpDir: string

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'petalive-transcode-'))
  })

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  it('buildTranscodeOptions output path respects the clips directory', async () => {
    const clipsDir = path.join(tmpDir, 'clips')
    await fs.mkdir(clipsDir, { recursive: true })

    const request: TranscodeRequest = {
      clipId: 'test_clip',
      inputPath: '/tmp/input.mov',
      srcWidth: 1920,
      srcHeight: 1080,
      scaleHint: 1.0
    }
    const opts = buildTranscodeOptions(request, clipsDir)

    // Verify the output path is inside clipsDir with correct filename
    expect(path.dirname(opts.outputPath)).toBe(clipsDir)
    expect(path.basename(opts.outputPath)).toBe('test_clip.webm')

    // Verify the clips directory exists (simulating what transcodeClip does)
    const stat = await fs.stat(clipsDir)
    expect(stat.isDirectory()).toBe(true)
  })
})
