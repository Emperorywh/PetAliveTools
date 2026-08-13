import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as path from 'node:path'
import * as os from 'node:os'
import { promises as fs } from 'node:fs'

import {
  collectProjectFiles,
  exportProjectToZip,
  importProjectFromZip,
  findCommonRootDir,
  normalizeZipEntries,
  validateProjectEntries,
} from '../../src/main/persistence/backup'
import { createZipArchive, readZipArchive, type ZipEntry } from '../../src/main/persistence/zip'
import { createProject, saveProject, createDefaultPersona, getProjectPaths } from '../../src/main/persistence/project-io'
import type { ProjectData, ClipMeta, AudioMeta } from '../../src/shared/types/project'

let tmpDir: string

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'petalive-backup-'))
})

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true })
})

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

function testAudio(overrides: Partial<AudioMeta> = {}): AudioMeta {
  return {
    id: 'meow_02',
    file: 'meow_02.wav',
    label: '喵',
    category: 'action',
    cooldownSec: 3,
    maxPerHour: 10,
    ...overrides,
  }
}

/** 构建一个含片段文件与音频文件的完整项目 */
async function buildFullProject(dir: string, personaName: string): Promise<void> {
  const persona = createDefaultPersona(personaName)
  await createProject(dir, persona)

  const clip = testClip({ id: 'idle_sit_01', audio: 'meow_02' })
  const audio = testAudio()
  const data: ProjectData = {
    persona,
    needsState: { hunger: 35, fatigue: 25, happiness: 80, attention: 55 },
    behaviorConfig: {
      weightOverrides: {},
      rhythm: { nightStartHour: 22, nightEndHour: 7, nightSleepBoost: 3.0 },
      microRandom: { rateJitter: 0.05, idleJitterSec: 2, signatureProbability: 0.05 },
      shell: {
        displayId: null,
        screenPercent: 0.15,
        volume: 0.25,
        ambientFrequency: 1.0,
        autoLaunch: true,
        hideHotkey: 'CommandOrControl+Shift+H',
      },
    },
    clips: [clip],
    audio: [audio],
  }
  await saveProject(dir, data)

  // 写入引用的素材文件
  const paths = getProjectPaths(dir)
  await fs.writeFile(path.join(paths.clipsDir, 'idle_sit_01.webm'), Buffer.from([0, 1, 2, 3, 4, 5]))
  await fs.writeFile(path.join(paths.audioDir, 'meow_02.wav'), Buffer.from([9, 8, 7]))
}

describe('collectProjectFiles', () => {
  it('collects all files with forward-slash relative paths', async () => {
    const dir = path.join(tmpDir, 'proj')
    await buildFullProject(dir, '小橘')
    const files = await collectProjectFiles(dir)

    expect(files).toContain('persona.json')
    expect(files).toContain('clips.meta.json')
    expect(files).toContain('clips/idle_sit_01.webm')
    expect(files).toContain('audio/meow_02.wav')
  })
})

describe('exportProjectToZip', () => {
  it('creates a zip containing the full project directory', async () => {
    const dir = path.join(tmpDir, 'proj')
    await buildFullProject(dir, '小橘')
    const zipPath = path.join(tmpDir, 'export.zip')

    const result = await exportProjectToZip(dir, zipPath)
    expect(result.zipPath).toBe(zipPath)
    expect(result.fileCount).toBeGreaterThan(5)

    const entries = readZipArchive(await fs.readFile(zipPath))
    const names = entries.map((e) => e.name)
    expect(names).toContain('persona.json')
    expect(names).toContain('needs-state.json')
    expect(names).toContain('behavior-config.json')
    expect(names).toContain('clips.meta.json')
    expect(names).toContain('audio.meta.json')
    expect(names).toContain('clips/idle_sit_01.webm')
    expect(names).toContain('audio/meow_02.wav')
  })

  it('rejects directories without persona.json', async () => {
    const dir = path.join(tmpDir, 'notaproject')
    await fs.mkdir(dir, { recursive: true })
    await expect(exportProjectToZip(dir, path.join(tmpDir, 'x.zip'))).rejects.toThrow(
      /not a pet project directory/,
    )
  })
})

describe('importProjectFromZip round-trip', () => {
  it('restores a project from an exported zip with correct data', async () => {
    const srcDir = path.join(tmpDir, 'src')
    await buildFullProject(srcDir, '小橘')
    const zipPath = path.join(tmpDir, '小橘.zip')
    await exportProjectToZip(srcDir, zipPath)

    const petsRoot = path.join(tmpDir, 'pets')
    const result = await importProjectFromZip(zipPath, petsRoot)

    expect(result.data.persona.name).toBe('小橘')
    expect(result.data.clips).toHaveLength(1)
    expect(result.data.clips[0]!.id).toBe('idle_sit_01')
    expect(result.data.audio).toHaveLength(1)
    expect(result.data.needsState.happiness).toBe(80)

    // 素材文件已解包
    const paths = getProjectPaths(result.projectDir)
    const clipData = await fs.readFile(path.join(paths.clipsDir, 'idle_sit_01.webm'))
    expect([...clipData]).toEqual([0, 1, 2, 3, 4, 5])
    const audioData = await fs.readFile(path.join(paths.audioDir, 'meow_02.wav'))
    expect([...audioData]).toEqual([9, 8, 7])
  })

  it('appends suffix on profile name conflict', async () => {
    const srcDir = path.join(tmpDir, 'src')
    await buildFullProject(srcDir, '小白')
    const zipPath = path.join(tmpDir, '小白.zip')
    await exportProjectToZip(srcDir, zipPath)

    const petsRoot = path.join(tmpDir, 'pets')
    await fs.mkdir(petsRoot, { recursive: true })
    await fs.mkdir(path.join(petsRoot, '小白'), { recursive: true }) // 占位

    const result = await importProjectFromZip(zipPath, petsRoot)
    expect(result.profileId).toBe('小白-2')
  })

  it('imports a zip with a single top-level directory by stripping it', async () => {
    const srcDir = path.join(tmpDir, 'src')
    await buildFullProject(srcDir, '小橘')

    // 手动构建带顶层目录的 zip
    const files = await collectProjectFiles(srcDir)
    const entries: ZipEntry[] = []
    for (const f of files) {
      entries.push({ name: `MyCat/${f}`, data: await fs.readFile(path.join(srcDir, f)) })
    }
    const zipPath = path.join(tmpDir, 'nested.zip')
    await fs.writeFile(zipPath, createZipArchive(entries))

    const petsRoot = path.join(tmpDir, 'pets')
    const result = await importProjectFromZip(zipPath, petsRoot)
    expect(result.data.persona.name).toBe('小橘')
    const paths = getProjectPaths(result.projectDir)
    await expect(fs.access(paths.persona)).resolves.toBeUndefined()
  })
})

describe('import validation failures (no files written)', () => {
  it('rejects corrupt persona.json without writing anything', async () => {
    const entries: ZipEntry[] = [
      { name: 'persona.json', data: Buffer.from('{ not valid json') },
      { name: 'needs-state.json', data: Buffer.from('{"hunger":50,"fatigue":30,"happiness":70,"attention":50}') },
      {
        name: 'behavior-config.json',
        data: Buffer.from(
          '{"weightOverrides":{},"rhythm":{"nightStartHour":22,"nightEndHour":7,"nightSleepBoost":3},"microRandom":{"rateJitter":0.05,"idleJitterSec":2,"signatureProbability":0.05},"shell":{"displayId":null,"screenPercent":0.15,"volume":0.25,"ambientFrequency":1,"autoLaunch":true,"hideHotkey":"CommandOrControl+Shift+H"}}',
        ),
      },
      { name: 'clips.meta.json', data: Buffer.from('[]') },
      { name: 'audio.meta.json', data: Buffer.from('[]') },
    ]
    const zipPath = path.join(tmpDir, 'bad.zip')
    await fs.writeFile(zipPath, createZipArchive(entries))

    const petsRoot = path.join(tmpDir, 'pets')
    await fs.mkdir(petsRoot, { recursive: true })
    await expect(importProjectFromZip(zipPath, petsRoot)).rejects.toThrow(/import validation failed/)
    // 校验失败时不产生任何目录
    await expect(fs.readdir(petsRoot)).resolves.toEqual([])
  })

  it('rejects when a required file is missing', async () => {
    const entries: ZipEntry[] = [
      { name: 'persona.json', data: Buffer.from('{"name":"小橘","symmetrical":true,"personality":{"liveliness":0.5,"laziness":0.5,"clinginess":0.5,"timidity":0.5,"curiosity":0.5}}') },
      { name: 'clips.meta.json', data: Buffer.from('[]') },
      { name: 'audio.meta.json', data: Buffer.from('[]') },
    ]
    const zipPath = path.join(tmpDir, 'missing.zip')
    await fs.writeFile(zipPath, createZipArchive(entries))

    const petsRoot = path.join(tmpDir, 'pets')
    await expect(importProjectFromZip(zipPath, petsRoot)).rejects.toThrow(/import validation failed/)
  })

  it('rejects when clips.meta.json references a missing clip file', () => {
    const entries = normalizeZipEntries([
      { name: 'persona.json', data: Buffer.from('{"name":"小橘","symmetrical":true,"personality":{"liveliness":0.5,"laziness":0.5,"clinginess":0.5,"timidity":0.5,"curiosity":0.5}}') },
      { name: 'needs-state.json', data: Buffer.from('{"hunger":50,"fatigue":30,"happiness":70,"attention":50}') },
      { name: 'behavior-config.json', data: Buffer.from('{"weightOverrides":{},"rhythm":{"nightStartHour":22,"nightEndHour":7,"nightSleepBoost":3},"microRandom":{"rateJitter":0.05,"idleJitterSec":2,"signatureProbability":0.05},"shell":{"displayId":null,"screenPercent":0.15,"volume":0.25,"ambientFrequency":1,"autoLaunch":true,"hideHotkey":"CommandOrControl+Shift+H"}}') },
      { name: 'clips.meta.json', data: Buffer.from('[{"id":"idle_sit_01","state":"idle_sit","category":"basic","direction":"none","anchor":"sit","loop":false,"loopInSec":null,"loopOutSec":null,"signature":false,"variant":1,"prop":false,"embeddedAudio":false,"audio":null,"scaleHint":1,"hitbox":[0.1,0.05,0.8,0.9]}]') },
      { name: 'audio.meta.json', data: Buffer.from('[]') },
    ])

    const errors = validateProjectEntries(entries)
    expect(errors.some((e) => e.includes('idle_sit_01.webm'))).toBe(true)
  })
})

describe('zip-slip protection', () => {
  it('rejects entry names with .. path traversal', () => {
    expect(() => normalizeZipEntries([{ name: '../escape.txt', data: Buffer.alloc(0) }])).toThrow(
      /unsafe entry name/,
    )
  })

  it('rejects absolute path entry names', () => {
    expect(() => normalizeZipEntries([{ name: '/etc/passwd', data: Buffer.alloc(0) }])).toThrow(
      /unsafe entry name/,
    )
  })
})

describe('findCommonRootDir', () => {
  it('detects a shared top-level directory', () => {
    expect(findCommonRootDir(['MyCat/persona.json', 'MyCat/clips/a.webm'])).toBe('MyCat')
  })

  it('returns null when files are at root', () => {
    expect(findCommonRootDir(['persona.json', 'clips/a.webm'])).toBeNull()
  })

  it('returns null when top-level dirs differ', () => {
    expect(findCommonRootDir(['A/persona.json', 'B/clips.json'])).toBeNull()
  })
})
