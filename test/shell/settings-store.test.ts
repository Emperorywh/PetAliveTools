import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { promises as fs } from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

import {
  SettingsStore,
  mergePersonality,
  mergeShellSettings,
} from '../../src/main/shell/settings-store'
import {
  defaultShellSettings,
  validateShellSettings,
} from '../../src/shared/schemas/behavior-config'
import { defaultPersonality } from '../../src/shared/schemas/persona'

let temporaryDir: string

beforeEach(async () => {
  temporaryDir = await fs.mkdtemp(path.join(os.tmpdir(), 'petalive-settings-'))
})

afterEach(async () => {
  await fs.rm(temporaryDir, { recursive: true, force: true })
})

/**
 * 外壳设置不再包含会改变视频显示尺度的选项。
 * 测试只覆盖显示器选择、音频和系统外壳设置。
 */
describe('外壳设置', () => {
  it('默认设置没有视频尺度字段', () => {
    const settings = defaultShellSettings()

    expect(validateShellSettings(settings)).toEqual([])
    expect(settings).not.toHaveProperty('screenPercent')
  })

  it('合并设置时钳制音量和环境声频率', () => {
    const base = defaultShellSettings()

    expect(mergeShellSettings(base, { volume: 2 }).volume).toBe(1)
    expect(mergeShellSettings(base, { volume: -1 }).volume).toBe(0)
    expect(mergeShellSettings(base, { ambientFrequency: 0 }).ambientFrequency).toBe(0.1)
    expect(mergeShellSettings(base, { displayId: 7 }).displayId).toBe(7)
  })

  it('性格维度仍限制在零到一之间', () => {
    const merged = mergePersonality(defaultPersonality(), {
      liveliness: 2,
      curiosity: -1,
    })

    expect(merged.liveliness).toBe(1)
    expect(merged.curiosity).toBe(0)
  })

  it('设置持久化不会写入视频处理配置', async () => {
    const store = new SettingsStore(temporaryDir)
    await store.load()
    await store.updateShell({ volume: 0.6, displayId: 3 })
    await store.updatePersonality({ curiosity: 0.8 })

    const behavior = JSON.parse(await fs.readFile(
      path.join(temporaryDir, 'behavior-config.json'),
      'utf-8',
    )) as Record<string, unknown>
    const persona = JSON.parse(await fs.readFile(
      path.join(temporaryDir, 'persona.json'),
      'utf-8',
    )) as Record<string, unknown>

    expect(behavior).not.toHaveProperty('screenPercent')
    expect(behavior['shell']).not.toHaveProperty('screenPercent')
    expect(behavior['microRandom']).not.toHaveProperty('rateJitter')
    expect(persona).not.toHaveProperty('symmetrical')
  })

  it('重新加载后保留允许的设置', async () => {
    const first = new SettingsStore(temporaryDir)
    await first.load()
    await first.updateShell({ volume: 0.7, autoLaunch: false })

    const second = new SettingsStore(temporaryDir)
    await second.load()

    expect(second.getShell().volume).toBe(0.7)
    expect(second.getShell().autoLaunch).toBe(false)
  })
})
