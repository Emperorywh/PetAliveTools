import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as path from 'node:path'
import * as os from 'node:os'
import { promises as fs } from 'node:fs'

import {
  ProfileManager,
  DEFAULT_PROFILE_NAME,
  sanitizeProfileId,
  loadNeedsStateOrDefault,
  saveNeedsState,
} from '../../src/main/persistence/profiles'
import { getProjectPaths } from '../../src/main/persistence/project-io'
import type { NeedsState } from '../../src/shared/types/needs-state'

let tmpDir: string
let petsRoot: string
let registryPath: string

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'petalive-profiles-'))
  petsRoot = path.join(tmpDir, 'pets')
  registryPath = path.join(tmpDir, 'profiles.json')
})

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true })
})

describe('sanitizeProfileId', () => {
  it('strips path separators and reserved characters', () => {
    expect(sanitizeProfileId('小橘')).toBe('小橘')
    expect(sanitizeProfileId('my/pet')).toBe('mypet')
    expect(sanitizeProfileId('a:b*c?')).toBe('abc')
  })

  it('collapses whitespace to underscores', () => {
    expect(sanitizeProfileId('  fluffy cat ')).toBe('fluffy_cat')
  })

  it('falls back to pet for empty/whitespace input', () => {
    expect(sanitizeProfileId('')).toBe('pet')
    expect(sanitizeProfileId('   ')).toBe('pet')
    expect(sanitizeProfileId('///')).toBe('pet')
  })
})

describe('ProfileManager.createProfile', () => {
  it('creates a valid §12.1 project directory', async () => {
    const manager = new ProfileManager(petsRoot, registryPath)
    const profile = await manager.createProfile('小橘')

    expect(profile.id).toBe('小橘')
    expect(profile.name).toBe('小橘')
    expect(profile.valid).toBe(true)

    const paths = getProjectPaths(profile.dir)
    for (const file of [
      paths.persona,
      paths.needsState,
      paths.behaviorConfig,
      paths.clipsMeta,
      paths.audioMeta,
    ]) {
      await expect(fs.access(file)).resolves.toBeUndefined()
    }
  })

  it('appends suffix on directory name conflict', async () => {
    const manager = new ProfileManager(petsRoot, registryPath)
    const a = await manager.createProfile('小白')
    const b = await manager.createProfile('小白')

    expect(a.id).toBe('小白')
    expect(b.id).toBe('小白-2')
    expect(a.dir).not.toBe(b.dir)
  })
})

describe('ProfileManager.listProfiles', () => {
  it('lists all profiles sorted by name with persona names', async () => {
    const manager = new ProfileManager(petsRoot, registryPath)
    await manager.createProfile('小黑')
    await manager.createProfile('小白')

    const profiles = await manager.listProfiles()
    expect(profiles).toHaveLength(2)
    // localeCompare zh → 小白 before 小黑
    expect(profiles[0]!.name).toBe('小白')
    expect(profiles[1]!.name).toBe('小黑')
    expect(profiles.every((p) => p.valid)).toBe(true)
  })

  it('returns empty array when no profiles exist', async () => {
    const manager = new ProfileManager(petsRoot, registryPath)
    expect(await manager.listProfiles()).toEqual([])
  })
})

describe('ProfileManager active profile registry', () => {
  it('persists active profile id across instances', async () => {
    let manager = new ProfileManager(petsRoot, registryPath)
    await manager.ensureRoot()
    const created = await manager.createProfile('小橘')
    await manager.setActiveProfile(created.id)
    expect(await manager.getActiveProfileId()).toBe(created.id)

    // 新实例读取同一注册表文件
    manager = new ProfileManager(petsRoot, registryPath)
    expect(await manager.getActiveProfileId()).toBe(created.id)
  })

  it('switchProfile updates the active pointer', async () => {
    const manager = new ProfileManager(petsRoot, registryPath)
    const a = await manager.createProfile('小白')
    const b = await manager.createProfile('小黑')

    await manager.switchProfile(a.id)
    expect(await manager.getActiveProfileId()).toBe(a.id)

    const switched = await manager.switchProfile(b.id)
    expect(switched.id).toBe(b.id)
    expect(await manager.getActiveProfileId()).toBe(b.id)
  })

  it('setActiveProfile throws for unknown id', async () => {
    const manager = new ProfileManager(petsRoot, registryPath)
    await manager.ensureRoot()
    await expect(manager.setActiveProfile('不存在')).rejects.toThrow(/not found/)
  })
})

describe('ProfileManager.ensureActiveProfile', () => {
  it('creates default profile on first run', async () => {
    const manager = new ProfileManager(petsRoot, registryPath)
    const active = await manager.ensureActiveProfile()

    expect(active.name).toBe(DEFAULT_PROFILE_NAME)
    expect(active.valid).toBe(true)
    expect(await manager.getActiveProfileId()).toBe(active.id)
  })

  it('returns existing active profile without creating new one', async () => {
    const manager = new ProfileManager(petsRoot, registryPath)
    const first = await manager.ensureActiveProfile()
    const second = await manager.ensureActiveProfile()

    expect(second.id).toBe(first.id)
    expect(await manager.listProfiles()).toHaveLength(1)
  })
})

describe('ProfileManager.deleteProfile', () => {
  it('removes the project directory', async () => {
    const manager = new ProfileManager(petsRoot, registryPath)
    const a = await manager.createProfile('小白')
    const b = await manager.createProfile('小黑')
    await manager.setActiveProfile(a.id)

    await manager.deleteProfile(b.id)
    await expect(fs.access(b.dir)).rejects.toThrow()
    expect(await manager.listProfiles()).toHaveLength(1)
  })

  it('reassigns active to first remaining when deleting active', async () => {
    const manager = new ProfileManager(petsRoot, registryPath)
    const a = await manager.createProfile('小白')
    const b = await manager.createProfile('小黑')
    await manager.setActiveProfile(a.id)

    await manager.deleteProfile(a.id)
    expect(await manager.getActiveProfileId()).not.toBe(a.id)
    expect(await manager.getActiveProfileId()).toBe(b.id)
  })

  it('refuses to delete a non-project directory', async () => {
    const manager = new ProfileManager(petsRoot, registryPath)
    await fs.mkdir(path.join(petsRoot, 'junk'), { recursive: true })

    await expect(manager.deleteProfile('junk')).rejects.toThrow(/non-project/)
  })
})

describe('needs-state per-profile independence (§12.2)', () => {
  it('loadNeedsStateOrDefault returns default when missing', async () => {
    const dir = path.join(tmpDir, 'empty')
    await fs.mkdir(dir, { recursive: true })
    const state = await loadNeedsStateOrDefault(dir)
    expect(state.hunger).toBe(50)
    expect(state.happiness).toBe(70)
  })

  it('saveNeedsState / loadNeedsState round-trips per directory', async () => {
    const manager = new ProfileManager(petsRoot, registryPath)
    const a = await manager.createProfile('小白')
    const b = await manager.createProfile('小黑')

    const stateA: NeedsState = { hunger: 10, fatigue: 20, happiness: 90, attention: 40 }
    const stateB: NeedsState = { hunger: 80, fatigue: 60, happiness: 30, attention: 70 }

    await saveNeedsState(a.dir, stateA)
    await saveNeedsState(b.dir, stateB)

    // 切换后读取各自的值，互不影响
    expect(await loadNeedsStateOrDefault(a.dir)).toEqual(stateA)
    expect(await loadNeedsStateOrDefault(b.dir)).toEqual(stateB)
  })

  it('saveNeedsState rejects invalid values', async () => {
    const dir = path.join(tmpDir, 'bad')
    await fs.mkdir(dir, { recursive: true })
    await expect(
      saveNeedsState(dir, { hunger: 200, fatigue: 20, happiness: 50, attention: 50 }),
    ).rejects.toThrow(/invalid needs-state/)
  })
})
