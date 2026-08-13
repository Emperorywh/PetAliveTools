import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as path from 'node:path'
import * as os from 'node:os'
import { promises as fs } from 'node:fs'

import {
  SettingsStore,
  mergeShellSettings,
  mergePersonality,
} from '../../src/main/shell/settings-store'
import { defaultShellSettings, validateShellSettings } from '../../src/shared/schemas'
import type { ShellSettings } from '../../src/shared/types/behavior-config'
import type { Personality } from '../../src/shared/types/persona'

let tmpDir: string

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'petalive-shell-test-'))
})

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true })
})

// ── mergeShellSettings (pure function) ── //

describe('mergeShellSettings (§12.4)', () => {
  const base = defaultShellSettings()

  it('preserves unchanged fields', () => {
    const merged = mergeShellSettings(base, { volume: 0.5 })
    expect(merged.volume).toBe(0.5)
    expect(merged.displayId).toBe(base.displayId)
    expect(merged.screenPercent).toBe(base.screenPercent)
    expect(merged.autoLaunch).toBe(base.autoLaunch)
    expect(merged.hideHotkey).toBe(base.hideHotkey)
  })

  it('clamps screenPercent to (0.01, 0.99)', () => {
    expect(mergeShellSettings(base, { screenPercent: 0 }).screenPercent).toBe(0.01)
    expect(mergeShellSettings(base, { screenPercent: 1.5 }).screenPercent).toBe(0.99)
    expect(mergeShellSettings(base, { screenPercent: 0.2 }).screenPercent).toBe(0.2)
  })

  it('clamps volume to [0, 1]', () => {
    expect(mergeShellSettings(base, { volume: -0.5 }).volume).toBe(0)
    expect(mergeShellSettings(base, { volume: 1.5 }).volume).toBe(1)
    expect(mergeShellSettings(base, { volume: 0.7 }).volume).toBe(0.7)
  })

  it('clamps ambientFrequency to >= 0.1', () => {
    expect(mergeShellSettings(base, { ambientFrequency: 0 }).ambientFrequency).toBe(0.1)
    expect(mergeShellSettings(base, { ambientFrequency: 2.0 }).ambientFrequency).toBe(2.0)
  })

  it('accepts displayId null and number', () => {
    expect(mergeShellSettings(base, { displayId: null }).displayId).toBeNull()
    expect(mergeShellSettings(base, { displayId: 12345 }).displayId).toBe(12345)
  })

  it('accepts autoLaunch boolean', () => {
    expect(mergeShellSettings(base, { autoLaunch: false }).autoLaunch).toBe(false)
    expect(mergeShellSettings(base, { autoLaunch: true }).autoLaunch).toBe(true)
  })

  it('accepts hideHotkey string', () => {
    expect(mergeShellSettings(base, { hideHotkey: 'Ctrl+Alt+P' }).hideHotkey).toBe('Ctrl+Alt+P')
  })

  it('handles NaN gracefully in screenPercent', () => {
    expect(mergeShellSettings(base, { screenPercent: NaN }).screenPercent).toBe(0.01)
  })
})

// ── mergePersonality (pure function) ── //

describe('mergePersonality (§9.6)', () => {
  const base: Personality = {
    liveliness: 0.5,
    laziness: 0.5,
    clinginess: 0.5,
    timidity: 0.5,
    curiosity: 0.5,
  }

  it('preserves unchanged dimensions', () => {
    const merged = mergePersonality(base, { liveliness: 0.9 })
    expect(merged.liveliness).toBe(0.9)
    expect(merged.laziness).toBe(0.5)
    expect(merged.clinginess).toBe(0.5)
    expect(merged.timidity).toBe(0.5)
    expect(merged.curiosity).toBe(0.5)
  })

  it('clamps each dimension to [0, 1]', () => {
    expect(mergePersonality(base, { liveliness: -0.5 }).liveliness).toBe(0)
    expect(mergePersonality(base, { liveliness: 1.5 }).liveliness).toBe(1)
  })

  it('updates multiple dimensions', () => {
    const merged = mergePersonality(base, { liveliness: 0.8, timidity: 0.2, curiosity: 0.9 })
    expect(merged.liveliness).toBe(0.8)
    expect(merged.timidity).toBe(0.2)
    expect(merged.curiosity).toBe(0.9)
    expect(merged.laziness).toBe(0.5)
  })
})

// ── validateShellSettings ── //

describe('validateShellSettings', () => {
  const valid = defaultShellSettings()

  it('accepts valid defaults', () => {
    expect(validateShellSettings(valid)).toHaveLength(0)
  })

  it('rejects missing shell object', () => {
    expect(validateShellSettings(null)).toHaveLength(1)
    expect(validateShellSettings(42)).toHaveLength(1)
  })

  it('rejects screenPercent out of range', () => {
    const errors = validateShellSettings({ ...valid, screenPercent: 0 })
    expect(errors.some((e) => e.includes('screenPercent'))).toBe(true)
  })

  it('rejects volume out of range', () => {
    const errors = validateShellSettings({ ...valid, volume: 1.5 })
    expect(errors.some((e) => e.includes('volume'))).toBe(true)
  })

  it('rejects non-boolean autoLaunch', () => {
    const errors = validateShellSettings({ ...valid, autoLaunch: 'yes' as unknown as boolean })
    expect(errors.some((e) => e.includes('autoLaunch'))).toBe(true)
  })

  it('rejects empty hideHotkey', () => {
    const errors = validateShellSettings({ ...valid, hideHotkey: '' })
    expect(errors.some((e) => e.includes('hideHotkey'))).toBe(true)
  })

  it('accepts displayId as number', () => {
    expect(validateShellSettings({ ...valid, displayId: 999 })).toHaveLength(0)
  })

  it('rejects non-number non-null displayId', () => {
    const errors = validateShellSettings({ ...valid, displayId: 'abc' as unknown as number })
    expect(errors.some((e) => e.includes('displayId'))).toBe(true)
  })
})

// ── SettingsStore persistence ── //

describe('SettingsStore persistence', () => {
  it('uses defaults when no config files exist', async () => {
    const store = new SettingsStore(tmpDir)
    await store.load()

    expect(store.getShell()).toEqual(defaultShellSettings())
    expect(store.getPersonality()).toEqual({
      liveliness: 0.5, laziness: 0.5, clinginess: 0.5, timidity: 0.5, curiosity: 0.5,
    })
  })

  it('persists shell settings to behavior-config.json', async () => {
    const store = new SettingsStore(tmpDir)
    await store.load()

    const updated = await store.updateShell({ volume: 0.6, screenPercent: 0.2 })
    expect(updated.volume).toBe(0.6)
    expect(updated.screenPercent).toBe(0.2)

    // Re-read from disk
    const store2 = new SettingsStore(tmpDir)
    await store2.load()
    expect(store2.getShell().volume).toBe(0.6)
    expect(store2.getShell().screenPercent).toBe(0.2)
    expect(store2.getShell().autoLaunch).toBe(true) // unchanged
  })

  it('persists personality to persona.json', async () => {
    const store = new SettingsStore(tmpDir)
    await store.load()

    const updated = await store.updatePersonality({ liveliness: 0.9, curiosity: 0.3 })
    expect(updated.liveliness).toBe(0.9)
    expect(updated.curiosity).toBe(0.3)

    // Re-read from disk
    const store2 = new SettingsStore(tmpDir)
    await store2.load()
    expect(store2.getPersonality().liveliness).toBe(0.9)
    expect(store2.getPersonality().curiosity).toBe(0.3)
    expect(store2.getPersonality().laziness).toBe(0.5) // unchanged
  })

  it('persists autoLaunch toggle to behavior-config.json', async () => {
    const store = new SettingsStore(tmpDir)
    await store.load()

    await store.updateShell({ autoLaunch: false })

    const store2 = new SettingsStore(tmpDir)
    await store2.load()
    expect(store2.getShell().autoLaunch).toBe(false)
  })

  it('persists hideHotkey to behavior-config.json', async () => {
    const store = new SettingsStore(tmpDir)
    await store.load()

    await store.updateShell({ hideHotkey: 'CommandOrControl+Alt+P' })

    const store2 = new SettingsStore(tmpDir)
    await store2.load()
    expect(store2.getShell().hideHotkey).toBe('CommandOrControl+Alt+P')
  })

  it('persists displayId to behavior-config.json', async () => {
    const store = new SettingsStore(tmpDir)
    await store.load()

    await store.updateShell({ displayId: 45678 })

    const store2 = new SettingsStore(tmpDir)
    await store2.load()
    expect(store2.getShell().displayId).toBe(45678)
  })

  it('loads existing behavior-config.json without shell (uses default shell)', async () => {
    // Write behavior-config.json without shell field
    const configPath = path.join(tmpDir, 'behavior-config.json')
    await fs.writeFile(configPath, JSON.stringify({
      weightOverrides: {},
      rhythm: { nightStartHour: 22, nightEndHour: 7, nightSleepBoost: 3.0 },
      microRandom: { rateJitter: 0.05, idleJitterSec: 2, signatureProbability: 0.05 },
    }), 'utf-8')

    const store = new SettingsStore(tmpDir)
    await store.load()
    // shell should get defaults
    expect(store.getShell().autoLaunch).toBe(true)
    expect(store.getShell().volume).toBe(0.25)
  })

  it('updateName persists to persona.json', async () => {
    const store = new SettingsStore(tmpDir)
    await store.load()
    await store.updateName('咪咪')

    const store2 = new SettingsStore(tmpDir)
    await store2.load()
    expect(store2.getPersona().name).toBe('咪咪')
  })

  it('round-trips all shell fields', async () => {
    const store = new SettingsStore(tmpDir)
    await store.load()

    const custom: Partial<ShellSettings> = {
      displayId: 111,
      screenPercent: 0.18,
      volume: 0.42,
      ambientFrequency: 1.7,
      autoLaunch: false,
      hideHotkey: 'Ctrl+Alt+H',
    }
    await store.updateShell(custom)

    const store2 = new SettingsStore(tmpDir)
    await store2.load()
    const shell = store2.getShell()
    expect(shell.displayId).toBe(111)
    expect(shell.screenPercent).toBe(0.18)
    expect(shell.volume).toBe(0.42)
    expect(shell.ambientFrequency).toBe(1.7)
    expect(shell.autoLaunch).toBe(false)
    expect(shell.hideHotkey).toBe('Ctrl+Alt+H')
  })
})
