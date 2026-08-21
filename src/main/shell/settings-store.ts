/**
 * 设置持久化 (settings store) — §12.4
 *
 * 读写外壳设置（显示器/音量/节律频率/自启/快捷键）与性格参数，
 * 持久化到 behavior-config.json（shell 字段）与 persona.json。
 *
 * 运行于主进程。
 */

import { promises as fs } from 'node:fs'
import * as path from 'node:path'

import type { BehaviorConfig, ShellSettings } from '../../shared/types/behavior-config'
import type { Persona, Personality } from '../../shared/types/persona'
import {
  validateShellSettings,
  defaultShellSettings,
  defaultBehaviorConfig,
} from '../../shared/schemas'
import type { ValidationErrors } from '../../shared/schemas'
import { writeJsonAtomic } from '../persistence/atomic-write'

const FILE_BEHAVIOR_CONFIG = 'behavior-config.json'
const FILE_PERSONA = 'persona.json'

async function readJson(filePath: string): Promise<unknown> {
  const content = await fs.readFile(filePath, 'utf-8')
  return JSON.parse(content)
}

async function writeJson(filePath: string, data: unknown): Promise<void> {
  await writeJsonAtomic(filePath, data)
}

/**
 * 更新 ShellSettings（不可变，纯函数）。
 *
 * 输入经过钳制/验证，返回新的 ShellSettings。
 */
export function mergeShellSettings(
  base: ShellSettings,
  changes: Partial<ShellSettings>,
): ShellSettings {
  let merged: ShellSettings = { ...base }
  if (changes.displayId !== undefined) {
    merged = { ...merged, displayId: changes.displayId }
  }
  if (changes.volume !== undefined) {
    merged = { ...merged, volume: clamp(changes.volume, 0, 1) }
  }
  if (changes.ambientFrequency !== undefined) {
    merged = { ...merged, ambientFrequency: Math.max(0.1, changes.ambientFrequency) }
  }
  if (changes.autoLaunch !== undefined) {
    merged = { ...merged, autoLaunch: changes.autoLaunch }
  }
  if (changes.hideHotkey !== undefined) {
    merged = { ...merged, hideHotkey: changes.hideHotkey }
  }
  return merged
}

/**
 * 更新 Personality（不可变，纯函数）。
 *
 * 每个维度钳制到 [0, 1]。
 */
export function mergePersonality(
  base: Personality,
  changes: Partial<Personality>,
): Personality {
  return {
    liveliness: clampOptional(changes.liveliness, base.liveliness),
    laziness: clampOptional(changes.laziness, base.laziness),
    clinginess: clampOptional(changes.clinginess, base.clinginess),
    timidity: clampOptional(changes.timidity, base.timidity),
    curiosity: clampOptional(changes.curiosity, base.curiosity),
  }
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  return Math.min(Math.max(value, min), max)
}

function clampOptional(value: number | undefined, fallback: number): number {
  if (value === undefined) return fallback
  return clamp(value, 0, 1)
}

/** 验证并返回默认 Persona（当文件不存在时） */
function createDefaultPersona(): Persona {
  return {
    name: '宠物',
    personality: {
      liveliness: 0.5,
      laziness: 0.5,
      clinginess: 0.5,
      timidity: 0.5,
      curiosity: 0.5,
    },
  }
}

/**
 * 设置持久化管理器。
 *
 * 管理两个 JSON 文件：behavior-config.json（含 shell 设置）与 persona.json。
 * 文件不存在时使用默认值。
 *
 * 使用方式：
 *   const store = new SettingsStore(configDir)
 *   await store.load()
 *   store.getShell()
 *   await store.updateShell({ volume: 0.5 })
 *   await store.updatePersonality({ liveliness: 0.8 })
 */
export class SettingsStore {
  private behaviorConfig: BehaviorConfig | null = null
  private persona: Persona | null = null

  constructor(private readonly configDir: string) {}

  /** 配置文件目录 */
  get dir(): string {
    return this.configDir
  }

  /** behavior-config.json 路径 */
  get behaviorConfigPath(): string {
    return path.join(this.configDir, FILE_BEHAVIOR_CONFIG)
  }

  /** persona.json 路径 */
  get personaPath(): string {
    return path.join(this.configDir, FILE_PERSONA)
  }

  /** 加载配置（文件不存在时使用默认值） */
  async load(): Promise<void> {
    // behavior-config.json
    try {
      const raw = await readJson(this.behaviorConfigPath)
      this.behaviorConfig = ensureBehaviorConfig(raw)
    } catch {
      this.behaviorConfig = defaultBehaviorConfig()
    }

    // persona.json
    try {
      const raw = await readJson(this.personaPath)
      this.persona = ensurePersona(raw)
    } catch {
      this.persona = createDefaultPersona()
    }
  }

  /** 确保已加载，未加载时使用默认值 */
  private ensureLoaded(): void {
    if (!this.behaviorConfig) this.behaviorConfig = defaultBehaviorConfig()
    if (!this.persona) this.persona = createDefaultPersona()
  }

  /** 获取当前 shell 设置 */
  getShell(): ShellSettings {
    this.ensureLoaded()
    return this.behaviorConfig!.shell
  }

  /** 获取当前性格 */
  getPersonality(): Personality {
    this.ensureLoaded()
    return this.persona!.personality
  }

  /** 获取完整 BehaviorConfig */
  getBehaviorConfig(): BehaviorConfig {
    this.ensureLoaded()
    return this.behaviorConfig!
  }

  /** 获取完整 Persona */
  getPersona(): Persona {
    this.ensureLoaded()
    return this.persona!
  }

  /**
   * 更新 shell 设置并持久化。
   *
   * @returns 更新后的 ShellSettings
   */
  async updateShell(changes: Partial<ShellSettings>): Promise<ShellSettings> {
    this.ensureLoaded()
    const newShell = mergeShellSettings(this.behaviorConfig!.shell, changes)
    const errors: ValidationErrors = validateShellSettings(newShell)
    if (errors.length > 0) {
      throw new Error(`Invalid shell settings:\n  ${errors.join('\n  ')}`)
    }
    this.behaviorConfig = { ...this.behaviorConfig!, shell: newShell }
    await writeJson(this.behaviorConfigPath, this.behaviorConfig)
    return newShell
  }

  /**
   * 更新性格参数并持久化到 persona.json。
   *
   * @returns 更新后的 Personality
   */
  async updatePersonality(changes: Partial<Personality>): Promise<Personality> {
    this.ensureLoaded()
    const newPersonality = mergePersonality(this.persona!.personality, changes)
    this.persona = { ...this.persona!, personality: newPersonality }
    await writeJson(this.personaPath, this.persona)
    return newPersonality
  }

  /**
   * 更新宠物名字并持久化。
   */
  async updateName(name: string): Promise<string> {
    this.ensureLoaded()
    this.persona = { ...this.persona!, name }
    await writeJson(this.personaPath, this.persona)
    return name
  }
}

/**
 * 确保原始数据是有效的 BehaviorConfig（补全 shell 字段）。
 */
function ensureBehaviorConfig(raw: unknown): BehaviorConfig {
  if (typeof raw !== 'object' || raw === null) return defaultBehaviorConfig()
  const obj = raw as Record<string, unknown>

  // shell 字段校验
  const shellErrors = validateShellSettings(obj['shell'])
  const shell =
    shellErrors.length > 0 ? defaultShellSettings() : (obj['shell'] as ShellSettings)

  return {
    weightOverrides:
      typeof obj['weightOverrides'] === 'object' && obj['weightOverrides'] !== null
        ? (obj['weightOverrides'] as BehaviorConfig['weightOverrides'])
        : {},
    rhythm:
      typeof obj['rhythm'] === 'object' && obj['rhythm'] !== null
        ? (obj['rhythm'] as BehaviorConfig['rhythm'])
        : defaultBehaviorConfig().rhythm,
    microRandom:
      typeof obj['microRandom'] === 'object' && obj['microRandom'] !== null
        ? (obj['microRandom'] as BehaviorConfig['microRandom'])
        : defaultBehaviorConfig().microRandom,
    shell,
  }
}

/**
 * 确保原始数据是有效的 Persona。
 */
function ensurePersona(raw: unknown): Persona {
  if (typeof raw !== 'object' || raw === null) return createDefaultPersona()
  const obj = raw as Record<string, unknown>
  const personality = obj['personality']
  return {
    name: typeof obj['name'] === 'string' ? obj['name'] : '宠物',
    personality:
      typeof personality === 'object' && personality !== null
        ? (personality as Personality)
        : createDefaultPersona().personality,
  }
}
