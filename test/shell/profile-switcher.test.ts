import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as path from 'node:path'
import * as os from 'node:os'
import { promises as fs } from 'node:fs'

import {
  ProfileSwitcher,
  type FileDialogs,
  type ProfileSwitcherHost,
} from '../../src/main/shell/profile-switcher'
import { ProfileManager, type ProfileSummary } from '../../src/main/persistence/profiles'
import { getProjectPaths } from '../../src/main/persistence/project-io'

let tmpDir: string
let petsRoot: string
let registryPath: string

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'petalive-switcher-'))
  petsRoot = path.join(tmpDir, 'pets')
  registryPath = path.join(tmpDir, 'profiles.json')
})

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true })
})

// ── ProfileSwitcher class (uses temp dirs + fake dialogs) ── //

function fakeDialogs(opts: { savePath?: string | null; openPath?: string | null }): FileDialogs {
  return {
    showSaveZipDialog: async () => opts.savePath ?? null,
    showOpenZipDialog: async () => opts.openPath ?? null,
  }
}

function captureHost(): ProfileSwitcherHost & {
  active: ProfileSummary | null
  changes: number
  notifications: string[]
} {
  const host = {
    active: null as ProfileSummary | null,
    changes: 0,
    notifications: [] as string[],
    onActiveProfileChanged(p: ProfileSummary | null) {
      host.active = p
    },
    onProfilesChanged() {
      host.changes++
    },
    onNotify(msg: string) {
      host.notifications.push(msg)
    },
  }
  return host
}

describe('ProfileSwitcher', () => {
  it('switchProfile updates active and notifies host', async () => {
    const manager = new ProfileManager(petsRoot, registryPath)
    const a = await manager.createProfile('小白')
    const b = await manager.createProfile('小黑')
    await manager.setActiveProfile(a.id)

    const host = captureHost()
    const switcher = new ProfileSwitcher(manager, fakeDialogs({}), host)
    await switcher.switchProfile(b.id)

    expect(await manager.getActiveProfileId()).toBe(b.id)
    expect(host.active?.id).toBe(b.id)
  })

  it('exportActiveProfile writes a zip and notifies', async () => {
    const manager = new ProfileManager(petsRoot, registryPath)
    const profile = await manager.ensureActiveProfile()
    const zipPath = path.join(tmpDir, 'export.zip')

    const host = captureHost()
    const switcher = new ProfileSwitcher(manager, fakeDialogs({ savePath: zipPath }), host)
    const result = await switcher.exportActiveProfile()

    expect(result).not.toBeNull()
    await expect(fs.access(zipPath)).resolves.toBeUndefined()
    expect(host.notifications.length).toBeGreaterThan(0)
    expect(result!.zipPath).toBe(zipPath)
    void profile
  })

  it('exportActiveProfile returns null when dialog cancelled', async () => {
    const manager = new ProfileManager(petsRoot, registryPath)
    await manager.ensureActiveProfile()
    const host = captureHost()
    const switcher = new ProfileSwitcher(manager, fakeDialogs({ savePath: null }), host)

    expect(await switcher.exportActiveProfile()).toBeNull()
  })

  it('deleteProfile removes directory and reassigns active when deleting active', async () => {
    const manager = new ProfileManager(petsRoot, registryPath)
    const a = await manager.createProfile('小白')
    const b = await manager.createProfile('小黑')
    await manager.setActiveProfile(a.id)

    const host = captureHost()
    const switcher = new ProfileSwitcher(manager, fakeDialogs({}), host)
    await switcher.deleteProfile(a.id)

    await expect(fs.access(a.dir)).rejects.toThrow()
    expect(await manager.getActiveProfileId()).toBe(b.id)
    expect(host.active?.id).toBe(b.id)
  })

  it('deleteProfile refuses when only one profile remains', async () => {
    const manager = new ProfileManager(petsRoot, registryPath)
    const a = await manager.createProfile('小白')
    await manager.setActiveProfile(a.id)

    const host = captureHost()
    const switcher = new ProfileSwitcher(manager, fakeDialogs({}), host)
    await switcher.deleteProfile(a.id)

    // 唯一宠物未被删除
    await expect(fs.access(a.dir)).resolves.toBeUndefined()
    expect(host.notifications.some((n) => n.includes('保留'))).toBe(true)
  })

  it('getMenuState returns current profiles + active id + mute flag + visibility', async () => {
    const manager = new ProfileManager(petsRoot, registryPath)
    const a = await manager.createProfile('小白')
    await manager.setActiveProfile(a.id)

    const host = captureHost()
    const switcher = new ProfileSwitcher(manager, fakeDialogs({}), host)
    const state = await switcher.getMenuState(true, false)

    expect(state.profiles).toHaveLength(1)
    expect(state.activeProfileId).toBe(a.id)
    expect(state.isMuted).toBe(true)
    expect(state.isPetVisible).toBe(false)
  })

  it('importProfile sets active when none was active', async () => {
    // 先导出一个项目 zip
    const srcManager = new ProfileManager(petsRoot, registryPath)
    await srcManager.ensureActiveProfile() // 创建默认宠物
    const active = await srcManager.getActiveProfile()
    const zipPath = path.join(tmpDir, 'round.zip')
    const { exportProjectToZip } = await import('../../src/main/persistence/backup')
    await exportProjectToZip(active!.dir, zipPath)

    // 新的 pets 根 + registry（无活跃宠物）
    const freshPets = path.join(tmpDir, 'pets2')
    const freshRegistry = path.join(tmpDir, 'registry2.json')
    const manager = new ProfileManager(freshPets, freshRegistry)
    await manager.ensureRoot()

    const host = captureHost()
    const switcher = new ProfileSwitcher(
      manager,
      fakeDialogs({ openPath: zipPath }),
      host,
    )
    const result = await switcher.importProfile()

    expect(result).not.toBeNull()
    expect(await manager.getActiveProfileId()).toBe(result!.profileId)
    expect(host.active?.id).toBe(result!.profileId)
    // 导入的项目应是有效的 §12.1 项目
    const paths = getProjectPaths(result!.projectDir)
    await expect(fs.access(paths.persona)).resolves.toBeUndefined()
  })
})
