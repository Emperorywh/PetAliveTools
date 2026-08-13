import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as path from 'node:path'
import * as os from 'node:os'
import { promises as fs } from 'node:fs'

import {
  getProjectPaths,
  createProject,
  loadProject,
  saveProject,
  validateProject,
  createDefaultPersona,
} from '../../src/main/persistence/project-io'
import type { ProjectData, ClipMeta, AudioMeta } from '../../src/shared/types/project'
import { defaultNeedsState, defaultBehaviorConfig } from '../../src/shared/schemas'

let tmpDir: string

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'petalive-test-'))
})

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true })
})

/** 创建测试用 ClipMeta */
function testClip(overrides: Partial<ClipMeta> = {}): ClipMeta {
  return {
    id: 'idle_sit_01',
    state: 'idle_sit',
    category: 'basic',
    direction: 'none',
    anchor: 'sit',
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

describe('getProjectPaths', () => {
  it('computes all file paths relative to root (§12.1)', () => {
    const paths = getProjectPaths('/pets/小橘')
    expect(paths.root).toBe('/pets/小橘')
    expect(paths.persona).toBe(path.join('/pets/小橘', 'persona.json'))
    expect(paths.needsState).toBe(path.join('/pets/小橘', 'needs-state.json'))
    expect(paths.behaviorConfig).toBe(path.join('/pets/小橘', 'behavior-config.json'))
    expect(paths.clipsDir).toBe(path.join('/pets/小橘', 'clips'))
    expect(paths.clipsMeta).toBe(path.join('/pets/小橘', 'clips.meta.json'))
    expect(paths.audioDir).toBe(path.join('/pets/小橘', 'audio'))
    expect(paths.audioMeta).toBe(path.join('/pets/小橘', 'audio.meta.json'))
  })
})

describe('createProject', () => {
  it('creates full directory structure with default files (§12.1)', async () => {
    const dir = path.join(tmpDir, 'mypet')
    const paths = await createProject(dir, createDefaultPersona('小橘'))

    // 目录结构
    for (const p of [paths.clipsDir, paths.audioDir]) {
      const stat = await fs.stat(p)
      expect(stat.isDirectory()).toBe(true)
    }

    // JSON 文件存在
    for (const p of [paths.persona, paths.needsState, paths.behaviorConfig, paths.clipsMeta, paths.audioMeta]) {
      const stat = await fs.stat(p)
      expect(stat.isFile()).toBe(true)
    }

    // clips.meta.json 和 audio.meta.json 为空数组
    const clipsMeta = JSON.parse(await fs.readFile(paths.clipsMeta, 'utf-8'))
    const audioMeta = JSON.parse(await fs.readFile(paths.audioMeta, 'utf-8'))
    expect(clipsMeta).toEqual([])
    expect(audioMeta).toEqual([])
  })

  it('writes persona with name and symmetrical', async () => {
    const dir = path.join(tmpDir, 'mypet')
    const paths = await createProject(dir, createDefaultPersona('阿黄'))
    const persona = JSON.parse(await fs.readFile(paths.persona, 'utf-8'))
    expect(persona.name).toBe('阿黄')
    expect(persona.symmetrical).toBe(true)
  })

  it('throws when directory already exists', async () => {
    const dir = path.join(tmpDir, 'mypet')
    await createProject(dir, createDefaultPersona('小橘'))
    await expect(createProject(dir, createDefaultPersona('小橘'))).rejects.toThrow('already exists')
  })
})

describe('loadProject', () => {
  it('round-trips data through create → load (§12.1)', async () => {
    const dir = path.join(tmpDir, 'mypet')
    await createProject(dir, createDefaultPersona('小橘'))
    const data = await loadProject(dir)

    expect(data.persona.name).toBe('小橘')
    expect(data.clips).toEqual([])
    expect(data.audio).toEqual([])
    // 默认值
    expect(data.needsState.hunger).toBe(50)
    expect(data.behaviorConfig.rhythm.nightStartHour).toBe(22)
  })

  it('round-trips full project data through save → load', async () => {
    const dir = path.join(tmpDir, 'mypet')
    await createProject(dir, createDefaultPersona('小橘'))

    const fullData: ProjectData = {
      persona: {
        name: '小橘',
        symmetrical: false,
        personality: { liveliness: 0.8, laziness: 0.3, clinginess: 0.6, timidity: 0.2, curiosity: 0.7 },
      },
      needsState: { hunger: 80, fatigue: 60, happiness: 90, attention: 40 },
      behaviorConfig: {
        weightOverrides: { idle_sit: { walk: 2.0 } },
        rhythm: { nightStartHour: 23, nightEndHour: 6, nightSleepBoost: 4.0 },
        microRandom: { rateJitter: 0.1, idleJitterSec: 3, signatureProbability: 0.08 },
      },
      clips: [
        testClip(),
        testClip({ id: 'walk_right_01', state: 'walk', direction: 'right', anchor: 'stand', moveStartSec: 0.5, moveEndSec: 5.0, track: 'walk_right_01.track.json' }),
        testClip({ id: 'sleep_01', state: 'sleep', loop: true, loopInSec: 0.0, loopOutSec: 4.0, anchor: 'none' }),
      ],
      audio: [
        { id: 'meow_01', file: 'meow_01.wav', label: '喵叫', category: 'action', cooldownSec: 30, maxPerHour: 5 },
      ],
    }

    await saveProject(dir, fullData)
    const loaded = await loadProject(dir)

    // 全部数据一致
    expect(loaded.persona).toEqual(fullData.persona)
    expect(loaded.needsState).toEqual(fullData.needsState)
    expect(loaded.behaviorConfig).toEqual(fullData.behaviorConfig)
    expect(loaded.clips).toEqual(fullData.clips)
    expect(loaded.audio).toEqual(fullData.audio)
  })

  it('throws on invalid project data', async () => {
    const dir = path.join(tmpDir, 'mypet')
    await createProject(dir, createDefaultPersona('小橘'))

    // 破坏 persona.json
    const paths = getProjectPaths(dir)
    await fs.writeFile(paths.persona, JSON.stringify({ name: '', symmetrical: true, personality: {} }), 'utf-8')

    await expect(loadProject(dir)).rejects.toThrow('validation failed')
  })
})

describe('saveProject', () => {
  it('rejects invalid data before writing', async () => {
    const dir = path.join(tmpDir, 'mypet')
    await createProject(dir, createDefaultPersona('小橘'))

    const badData = {
      persona: { name: '', symmetrical: true, personality: { liveliness: 5, laziness: 0.3, clinginess: 0.6, timidity: 0.2, curiosity: 0.7 } },
      needsState: { hunger: 50, fatigue: 30, happiness: 70, attention: 60 },
      behaviorConfig: defaultBehaviorConfig(),
      clips: [],
      audio: [],
    } as unknown as ProjectData

    await expect(saveProject(dir, badData)).rejects.toThrow('Cannot save invalid')
  })

  it('creates directories if missing', async () => {
    const dir = path.join(tmpDir, 'newpet')
    // 直接 save 到不存在的目录
    const data: ProjectData = {
      persona: { name: '小橘', symmetrical: true, personality: { liveliness: 0.5, laziness: 0.5, clinginess: 0.5, timidity: 0.5, curiosity: 0.5 } },
      needsState: defaultNeedsState(),
      behaviorConfig: defaultBehaviorConfig(),
      clips: [],
      audio: [],
    }
    await saveProject(dir, data)
    const paths = getProjectPaths(dir)
    expect((await fs.stat(paths.clipsDir)).isDirectory()).toBe(true)
    expect((await fs.stat(paths.audioDir)).isDirectory()).toBe(true)
  })
})

describe('validateProject', () => {
  it('returns empty errors for a valid project', async () => {
    const dir = path.join(tmpDir, 'mypet')
    await createProject(dir, createDefaultPersona('小橘'))
    const errors = await validateProject(dir)
    expect(errors).toHaveLength(0)
  })

  it('returns errors for missing files', async () => {
    const dir = path.join(tmpDir, 'empty')
    await fs.mkdir(dir, { recursive: true })
    const errors = await validateProject(dir)
    expect(errors.some((e) => e.includes('persona.json: file not found'))).toBe(true)
    expect(errors.some((e) => e.includes('clips.meta.json: file not found'))).toBe(true)
    expect(errors.some((e) => e.includes('clips/: directory not found'))).toBe(true)
  })

  it('returns errors for invalid content', async () => {
    const dir = path.join(tmpDir, 'mypet')
    await createProject(dir, createDefaultPersona('小橘'))
    const paths = getProjectPaths(dir)
    await fs.writeFile(paths.clipsMeta, JSON.stringify([{ bad: true }]), 'utf-8')

    const errors = await validateProject(dir)
    expect(errors.some((e) => e.includes('clips[0]:'))).toBe(true)
  })
})

describe('sample project integration', () => {
  it('creates, validates, and loads a sample project with test clips', async () => {
    const dir = path.join(tmpDir, 'sample-pet')

    // 创建
    await createProject(dir, createDefaultPersona('测试猫'))

    // 写入完整数据
    const data: ProjectData = {
      persona: {
        name: '测试猫',
        symmetrical: true,
        personality: { liveliness: 0.6, laziness: 0.4, clinginess: 0.7, timidity: 0.3, curiosity: 0.8 },
      },
      needsState: defaultNeedsState(),
      behaviorConfig: defaultBehaviorConfig(),
      clips: [
        testClip({ id: 'idle_sit_01', state: 'idle_sit' }),
        testClip({ id: 'stand_01', state: 'stand', anchor: 'stand', direction: 'none' }),
        testClip({
          id: 'walk_right_01',
          state: 'walk',
          direction: 'right',
          anchor: 'stand',
          moveStartSec: 0.5,
          moveEndSec: 5.0,
          track: 'walk_right_01.track.json',
        }),
        testClip({
          id: 'sleep_01',
          state: 'sleep',
          loop: true,
          loopInSec: 0.0,
          loopOutSec: 4.0,
          anchor: 'none',
        }),
      ],
      audio: [
        { id: 'purr_01', file: 'purr_01.wav', label: '呼噜', category: 'ambient', cooldownSec: 60, maxPerHour: 2 },
      ] as AudioMeta[],
    }

    await saveProject(dir, data)

    // 验证
    const errors = await validateProject(dir)
    expect(errors).toHaveLength(0)

    // 加载
    const loaded = await loadProject(dir)
    expect(loaded.clips).toHaveLength(4)
    expect(loaded.audio).toHaveLength(1)
    expect(loaded.persona.name).toBe('测试猫')
  })
})
