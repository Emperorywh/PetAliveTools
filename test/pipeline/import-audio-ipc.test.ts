/**
 * 入库管线集成测试 (IR-010 / IR-012 / IR-013)
 *
 * - IR-010：embeddedAudio 转码保留音轨参数 + 音轨抽取参数
 * - IR-012：关键点校正后的 track.json 经 saveClip 写盘可回读
 * - IR-013：音频素材入库（拷贝 + audio.meta.json 追加 + schema 校验）
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'

// —— electron mock（捕获 ipcMain.handle 注册的处理器） —— //

const handleMap = new Map<string, (...args: unknown[]) => unknown>()

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn((channel: string, fn: (...args: unknown[]) => unknown) => {
      handleMap.set(channel, fn)
    }),
    on: vi.fn(),
  },
  dialog: {
    showOpenDialog: vi.fn(async () => ({ canceled: true, filePaths: [] })),
    showSaveDialog: vi.fn(async () => ({ canceled: true })),
  },
  app: {
    isPackaged: false,
    getAppPath: () => '/nonexistent-app',
  },
}))

import { registerImportIpcHandlers } from '../../src/main/pipeline/ipc-handlers'
import {
  buildImportFfmpegArgs,
  buildAudioExtractArgs,
  type ImportTranscodeOptions,
} from '../../src/main/pipeline/import-transcoder'
import { buildFfmpegArgs } from '../../src/main/pipeline/ffmpeg'
import { applyKeypointCorrections } from '../../src/shared/pipeline'
import type { ClipMeta } from '../../src/shared/types/clip-meta'
import type { TrackFile } from '../../src/shared/types/track-file'
import type { AudioMeta } from '../../src/shared/types/audio-meta'

// —— 辅助 —— //

let tmpDir: string

beforeEach(async () => {
  handleMap.clear()
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'petalive-ir-'))
})

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true })
})

/** 创建最小项目目录结构（§12.1） */
async function makeProject(): Promise<string> {
  const dir = path.join(tmpDir, 'pet-a')
  await fs.mkdir(path.join(dir, 'clips'), { recursive: true })
  await fs.mkdir(path.join(dir, 'audio'), { recursive: true })
  await fs.writeFile(path.join(dir, 'clips.meta.json'), '[]', 'utf-8')
  await fs.writeFile(path.join(dir, 'audio.meta.json'), '[]', 'utf-8')
  return dir
}

function clip(overrides: Partial<ClipMeta> & Pick<ClipMeta, 'id' | 'state'>): ClipMeta {
  return {
    category: 'basic',
    direction: 'none',
    anchor: 'stand',
    loop: false,
    loopInSec: null,
    loopOutSec: null,
    signature: false,
    variant: 1,
    prop: false,
    embeddedAudio: false,
    audio: null,
    scaleHint: 1.0,
    hitbox: [0.1, 0.05, 0.8, 0.9],
    ...overrides,
  }
}

function importOptions(overrides?: Partial<ImportTranscodeOptions>): ImportTranscodeOptions {
  return {
    inputPath: 'C:/src/raw.mov',
    outputPath: path.join(tmpDir, 'out.webm'),
    preset: 'standard',
    resolutionTier: 'normal',
    srcWidth: 1920,
    srcHeight: 1080,
    scaleHint: 1.0,
    screenPercent: 0.15,
    fps: 30,
    ...overrides,
  }
}

// —— IR-010 embeddedAudio 转码参数 —— //

describe('IR-010 embeddedAudio 转码参数', () => {
  it('默认剥除音轨 (-an)', () => {
    const args = buildImportFfmpegArgs(importOptions())
    expect(args).toContain('-an')
    expect(args).not.toContain('libopus')
  })

  it('keepAudio=true 时保留音轨（-c:a libopus，无 -an）', () => {
    const args = buildImportFfmpegArgs(importOptions({ keepAudio: true }))
    expect(args).not.toContain('-an')
    expect(args.join(' ')).toContain('-c:a libopus')
    expect(args.join(' ')).toContain('-b:a 96k')
  })

  it('通用转码路径 (transcoder.ts → buildFfmpegArgs) 同样支持 keepAudio', () => {
    const stripped = buildFfmpegArgs({
      inputPath: 'in.mov',
      outputPath: 'out.webm',
      preset: 'standard',
      resolutionTier: 'normal',
      srcWidth: 1280,
      srcHeight: 720,
      scaleHint: 1.0,
    })
    expect(stripped).toContain('-an')

    const kept = buildFfmpegArgs({
      inputPath: 'in.mov',
      outputPath: 'out.webm',
      preset: 'standard',
      resolutionTier: 'normal',
      srcWidth: 1280,
      srcHeight: 720,
      scaleHint: 1.0,
      keepAudio: true,
    })
    expect(kept).not.toContain('-an')
    expect(kept.join(' ')).toContain('-c:a libopus')
  })

  it('音轨抽取参数：-vn + libopus + 可选裁切区间', () => {
    const args = buildAudioExtractArgs('in.mov', 'audio/meow_01.webm', 1.5, 4.0)
    const s = args.join(' ')
    expect(s).toContain('-vn')
    expect(s).toContain('-c:a libopus')
    expect(s).toContain('-ss 00:00:01.500')
    expect(s).toContain('-to 00:00:04.000')
    expect(s).not.toContain('-an')

    const noTrim = buildAudioExtractArgs('in.mov', 'out.webm')
    expect(noTrim.join(' ')).not.toContain('-ss')
  })
})

// —— IR-012 行走校正关键点持久化 —— //

describe('IR-012 行走校正关键点持久化', () => {
  it('saveClip 写盘的 track.json 含校正后 offsets 与 keypoints', async () => {
    const projectDir = await makeProject()
    registerImportIpcHandlers({})
    const saveClip = handleMap.get('import:saveClip')!

    // 模拟向导校正：原始曲线 + 2 个关键点 → exportTrackFile 语义
    const rawOffsets = Array.from({ length: 90 }, (_, i) => i * 2)
    const keypoints = [
      { frame: 20, offset: 30 },
      { frame: 60, offset: 150 },
    ]
    const corrected = applyKeypointCorrections(rawOffsets, keypoints)
    const trackFile: TrackFile = {
      version: 1,
      fps: 30,
      frameCount: 90,
      sourceWidth: 320,
      offsets: corrected,
      keypoints,
    }
    const walkClip = clip({
      id: 'walk_01',
      state: 'walk',
      moveStartSec: 0.5,
      moveEndSec: 2.0,
      track: 'walk_01.track.json',
    })

    await saveClip({}, projectDir, walkClip, trackFile)

    // 读盘断言：校正结果完整持久化
    const raw = JSON.parse(
      await fs.readFile(path.join(projectDir, 'clips', 'walk_01.track.json'), 'utf-8'),
    ) as TrackFile
    expect(raw.keypoints).toEqual(keypoints)
    expect(raw.offsets).toEqual(corrected)
    // 与未校正曲线不同（证明写入的是校正后曲线）
    expect(raw.offsets).not.toEqual(rawOffsets)

    // clips.meta.json 同步更新
    const clips = JSON.parse(
      await fs.readFile(path.join(projectDir, 'clips.meta.json'), 'utf-8'),
    ) as ClipMeta[]
    expect(clips).toHaveLength(1)
    expect(clips[0]!.id).toBe('walk_01')
  })
})

// —— IR-013 音频素材入库 —— //

describe('IR-013 音频素材入库', () => {
  const meta: AudioMeta = {
    id: 'meow_01',
    file: 'meow_01.webm',
    label: '叫声 01',
    category: 'action',
    cooldownSec: 20,
    maxPerHour: 60,
  }

  it('saveAudio 拷贝文件到 audio/ 并追加 audio.meta.json', async () => {
    const projectDir = await makeProject()
    const srcAudio = path.join(tmpDir, 'source.webm')
    await fs.writeFile(srcAudio, 'fake-audio-bytes', 'utf-8')

    registerImportIpcHandlers({})
    const saveAudio = handleMap.get('import:saveAudio')!

    const result = (await saveAudio({}, projectDir, meta, srcAudio)) as {
      audioId: string
      audioCount: number
    }
    expect(result.audioId).toBe('meow_01')
    expect(result.audioCount).toBe(1)

    // 文件已拷贝
    const copied = await fs.readFile(path.join(projectDir, 'audio', 'meow_01.webm'), 'utf-8')
    expect(copied).toBe('fake-audio-bytes')

    // audio.meta.json 已追加
    const audioMeta = JSON.parse(
      await fs.readFile(path.join(projectDir, 'audio.meta.json'), 'utf-8'),
    ) as AudioMeta[]
    expect(audioMeta).toHaveLength(1)
    expect(audioMeta[0]).toEqual(meta)
  })

  it('重复音频 id 被 schema 校验拒绝', async () => {
    const projectDir = await makeProject()
    const srcAudio = path.join(tmpDir, 'source.webm')
    await fs.writeFile(srcAudio, 'bytes', 'utf-8')

    registerImportIpcHandlers({})
    const saveAudio = handleMap.get('import:saveAudio')!

    await saveAudio({}, projectDir, meta, srcAudio)
    await expect(saveAudio({}, projectDir, meta, srcAudio)).rejects.toThrow(/duplicate id/)
  })

  it('音频入库后触发 onClipSaved 钩子（活跃目录热加载）', async () => {
    const projectDir = await makeProject()
    const srcAudio = path.join(tmpDir, 'source.webm')
    await fs.writeFile(srcAudio, 'bytes', 'utf-8')

    const onClipSaved = vi.fn()
    registerImportIpcHandlers({ onClipSaved })
    const saveAudio = handleMap.get('import:saveAudio')!

    await saveAudio({}, projectDir, meta, srcAudio)
    expect(onClipSaved).toHaveBeenCalledWith(projectDir)
  })
})
