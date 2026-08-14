import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as path from 'node:path'
import * as os from 'node:os'
import { promises as fs } from 'node:fs'

import {
  buildProfileMenuSection,
  buildTrayTemplate,
  ProfileSwitcher,
  type TrayMenuState,
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

function makeProfile(overrides: Partial<ProfileSummary> = {}): ProfileSummary {
  return {
    id: '小白',
    name: '小白',
    dir: '/pets/小白',
    valid: true,
    ...overrides,
  }
}

const noopCallbacks = {
  onSwitchProfile: () => {},
  onImportProfile: () => {},
  onExportProfile: () => {},
  onDeleteProfile: () => {},
}

describe('buildProfileMenuSection', () => {
  it('marks the active profile as checked radio item', () => {
    const profiles = [makeProfile({ id: 'a', name: '小白' }), makeProfile({ id: 'b', name: '小黑' })]
    const items = buildProfileMenuSection(profiles, 'b', noopCallbacks)

    const switchMenu = items[0]!.submenu as Array<{ label: string; type?: string; checked?: boolean }>
    expect(switchMenu[0]).toMatchObject({ label: '小白', type: 'radio', checked: false })
    expect(switchMenu[1]).toMatchObject({ label: '小黑', type: 'radio', checked: true })
  })

  it('shows disabled placeholder when no profiles', () => {
    const items = buildProfileMenuSection([], null, noopCallbacks)
    const switchMenu = items[0]!.submenu as Array<{ label: string; enabled?: boolean }>
    expect(switchMenu).toHaveLength(1)
    expect(switchMenu[0]!.label).toBe('暂无宠物')
    expect(switchMenu[0]!.enabled).toBe(false)
  })

  it('disables delete when only one profile', () => {
    const items = buildProfileMenuSection(
      [makeProfile({ id: 'a', name: '小白' })],
      'a',
      noopCallbacks,
    )
    const deleteItem = items.find((i) => i.label === '删除宠物')!
    expect(deleteItem.enabled).toBe(false)
  })

  it('includes export/import items', () => {
    const items = buildProfileMenuSection(
      [makeProfile({ id: 'a', name: '小白' })],
      'a',
      noopCallbacks,
    )
    expect(items.find((i) => i.label?.includes('导出'))).toBeDefined()
    expect(items.find((i) => i.label === '导入宠物…')).toBeDefined()
  })
})

describe('buildTrayTemplate', () => {
  it('composes full menu with feed/toy/mute + profile section + quit', () => {
    const state: TrayMenuState = {
      profiles: [makeProfile({ id: 'a', name: '小白' })],
      activeProfileId: 'a',
      isMuted: false,
      isPetVisible: true,
    }
    const labels = buildTrayTemplate(state, {
      ...noopCallbacks,
      onFeed: () => {},
      onToy: () => {},
      onToggleMute: () => {},
      onToggleHide: () => {},
      onSettings: () => {},
      onAbout: () => {},
      onImportWizard: () => {},
    }).map((i) => i.label)

    expect(labels).toContain('喂食')
    expect(labels).toContain('给玩具')
    expect(labels).toContain('静音')
    expect(labels).toContain('导入片段…')
    expect(labels).toContain('切换宠物')
    expect(labels).toContain('隐藏')
    expect(labels).toContain('设置')
    expect(labels).toContain('关于')
  })

  it('toggles mute label based on state', () => {
    const muted = buildTrayTemplate(
      { profiles: [], activeProfileId: null, isMuted: true, isPetVisible: true },
      {
        ...noopCallbacks,
        onFeed: () => {},
        onToy: () => {},
        onToggleMute: () => {},
        onToggleHide: () => {},
        onSettings: () => {},
        onAbout: () => {},
        onImportWizard: () => {},
      },
    )
    expect(muted.some((i) => i.label === '取消静音')).toBe(true)
  })

  it('shows 展示 instead of 隐藏 when pet is hidden', () => {
    const menu = buildTrayTemplate(
      { profiles: [], activeProfileId: null, isMuted: false, isPetVisible: false },
      {
        ...noopCallbacks,
        onFeed: () => {},
        onToy: () => {},
        onToggleMute: () => {},
        onToggleHide: () => {},
        onSettings: () => {},
        onAbout: () => {},
        onImportWizard: () => {},
      },
    )
    expect(menu.some((i) => i.label === '展示')).toBe(true)
    expect(menu.some((i) => i.label === '隐藏')).toBe(false)
  })
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
