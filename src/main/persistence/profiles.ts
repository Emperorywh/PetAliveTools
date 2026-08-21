/**
 * 多宠物 Profile 管理 (§12.2)
 *
 * 一个 profile = pets 根目录下的一个子目录（即一个 §12.1 pet 项目目录）。
 * 负责枚举、创建、删除 profile，以及维护「当前活跃 profile」注册表
 * （profiles.json：{ activeProfileId }），保证同一时刻只有一只宠物活跃。
 *
 * 需求状态（needs-state.json）保存在各 profile 自己的项目目录内，
 * 由调用方在切换前后读写，从而实现各宠物状态互相独立。
 *
 * 运行于主进程（与 vitest node 环境）。
 */

import { promises as fs } from 'node:fs'
import * as path from 'node:path'

import type { NeedsState } from '../../shared/types/needs-state'
import { validateNeedsState, defaultNeedsState } from '../../shared/schemas'
import type { ValidationErrors } from '../../shared/schemas'
import {
  createProject,
  createDefaultPersona,
  getProjectPaths,
  tryReadNeedsState,
  validateProject,
} from './project-io'
import { writeJsonAtomic } from './atomic-write'

/** 单个 profile 的摘要信息 */
export interface ProfileSummary {
  /** profile 标识 = 项目目录名 */
  readonly id: string
  /** 宠物名（persona.json 的 name） */
  readonly name: string
  /** 项目目录绝对路径 */
  readonly dir: string
  /** 项目数据是否通过 §12.1 校验 */
  readonly valid: boolean
}

/** 活跃 profile 注册表内容 */
interface ProfileRegistry {
  activeProfileId: string | null
}

/** 首次运行时创建的默认宠物名 */
export const DEFAULT_PROFILE_NAME = '宠物'

/**
 * 将宠物名净化为可安全用作目录名的 profile 标识。
 *
 * 去除路径分隔符与 Windows 保留字符，空白折叠为下划线，限长 60 字符。
 * 净化后为空时返回 "pet"。
 */
export function sanitizeProfileId(name: string): string {
  const cleaned = name
    .replace(/[\\/:*?"<>|]/g, '')
    .replace(/\s+/g, '_')
    .replace(/^[._]+|[._]+$/g, '')
    .slice(0, 60)
  return cleaned === '' ? 'pet' : cleaned
}

/** 读取并解析注册表，文件不存在或损坏时返回空注册表 */
async function readRegistry(registryPath: string): Promise<ProfileRegistry> {
  try {
    const raw = JSON.parse(await fs.readFile(registryPath, 'utf-8'))
    if (
      typeof raw === 'object' &&
      raw !== null &&
      (raw['activeProfileId'] === null || typeof raw['activeProfileId'] === 'string')
    ) {
      return { activeProfileId: raw['activeProfileId'] }
    }
  } catch {
    // 文件缺失/损坏 → 视为无活跃 profile
  }
  return { activeProfileId: null }
}

/** 写入注册表（原子写：进程被杀不会留下截断的半截文件） */
async function writeRegistry(registryPath: string, registry: ProfileRegistry): Promise<void> {
  await fs.mkdir(path.dirname(registryPath), { recursive: true })
  await writeJsonAtomic(registryPath, registry)
}

/**
 * 多宠物 Profile 管理器 (§12.2)。
 *
 * 使用方式：
 *   const manager = new ProfileManager(petsRoot, registryPath)
 *   await manager.ensureRoot()
 *   const active = await manager.ensureActiveProfile()
 *   await manager.switchProfile('小白')
 */
export class ProfileManager {
  private activeProfileId: string | null = null
  private registryLoaded = false

  constructor(
    private readonly petsRoot: string,
    private readonly registryPath: string,
  ) {}

  /** pets 根目录 */
  get root(): string {
    return this.petsRoot
  }

  /** 注册表文件路径 */
  get registry(): string {
    return this.registryPath
  }

  /** 确保 pets 根目录存在 */
  async ensureRoot(): Promise<void> {
    await fs.mkdir(this.petsRoot, { recursive: true })
  }

  /** 确保注册表已加载 */
  private async ensureRegistry(): Promise<void> {
    if (!this.registryLoaded) {
      const registry = await readRegistry(this.registryPath)
      this.activeProfileId = registry.activeProfileId
      this.registryLoaded = true
    }
  }

  /** 当前活跃 profile 标识（未加载注册表时先加载；可能为 null） */
  async getActiveProfileId(): Promise<string | null> {
    await this.ensureRegistry()
    return this.activeProfileId
  }

  /** 根据 id 计算 profile 目录路径 */
  profileDir(id: string): string {
    return path.join(this.petsRoot, id)
  }

  /**
   * 列出全部 profile。
   *
   * 扫描 pets 根目录下的子目录，读取 persona.json 获取宠物名，
   * 并运行 §12.1 项目校验标记 valid。目录缺失 persona.json 时
   * valid=false、name 回退为目录名。
   */
  async listProfiles(): Promise<ProfileSummary[]> {
    await this.ensureRoot()
    const dirents = await fs.readdir(this.petsRoot, { withFileTypes: true })

    const summaries: ProfileSummary[] = []
    for (const dirent of dirents) {
      if (!dirent.isDirectory()) continue
      const dir = path.join(this.petsRoot, dirent.name)
      const paths = getProjectPaths(dir)

      let name = dirent.name
      try {
        const persona = JSON.parse(await fs.readFile(paths.persona, 'utf-8'))
        if (typeof persona['name'] === 'string' && persona['name'] !== '') {
          name = persona['name']
        }
      } catch {
        // persona.json 缺失或损坏 → 使用目录名
      }

      const errors: ValidationErrors = await validateProject(dir)
      summaries.push({ id: dirent.name, name, dir, valid: errors.length === 0 })
    }

    // 按名字稳定排序，托盘菜单顺序可预期
    summaries.sort((a, b) => a.name.localeCompare(b.name, 'zh'))
    return summaries
  }

  /**
   * 创建新 profile（完整 §12.1 项目结构 + 默认数据）。
   *
   * 目录名冲突时自动追加 -2、-3… 后缀。
   *
   * @param name 宠物名（净化后作为目录名）
   * @returns 新 profile 摘要
   */
  async createProfile(name: string): Promise<ProfileSummary> {
    await this.ensureRoot()
    const baseId = sanitizeProfileId(name)

    // 目录名唯一化
    let id = baseId
    let suffix = 2
    while (await exists(this.profileDir(id))) {
      id = `${baseId}-${suffix++}`
    }

    const dir = this.profileDir(id)
    await createProject(dir, createDefaultPersona(name))
    return { id, name, dir, valid: true }
  }

  /**
   * 删除 profile 及其项目目录。
   *
   * 安全约束：目录必须是有效的 §12.1 项目（含 persona.json），
   * 拒绝删除任意非项目目录，防止误删。
   * 删除的是活跃 profile 时，注册表自动改指向首个剩余 profile（无则置 null）。
   *
   * @param id profile 标识
   */
  async deleteProfile(id: string): Promise<void> {
    await this.ensureRegistry()
    const dir = this.profileDir(id)
    const paths = getProjectPaths(dir)

    // 只删除确认是 pet 项目的目录
    try {
      await fs.access(paths.persona)
    } catch {
      throw new Error(`refusing to delete non-project directory: ${dir}`)
    }

    await fs.rm(dir, { recursive: true, force: true })

    if (this.activeProfileId === id) {
      const remaining = await this.listProfiles()
      this.activeProfileId = remaining.length > 0 ? remaining[0]!.id : null
      await writeRegistry(this.registryPath, { activeProfileId: this.activeProfileId })
    }
  }

  /**
   * 设置活跃 profile（§12.2：同一时刻只有一只）。
   *
   * @param id 必须对应已存在的 profile 目录
   */
  async setActiveProfile(id: string): Promise<ProfileSummary> {
    await this.ensureRegistry()
    const dir = this.profileDir(id)
    try {
      await fs.access(dir)
    } catch {
      throw new Error(`profile not found: ${id}`)
    }
    this.activeProfileId = id
    await writeRegistry(this.registryPath, { activeProfileId: id })
    return this.summarize(id, dir)
  }

  /**
   * 切换活跃 profile：与 setActiveProfile 相同，语义上供运行时切换调用。
   * 切换前后对 needs-state 的保存/加载由调用方负责。
   */
  async switchProfile(id: string): Promise<ProfileSummary> {
    return await this.setActiveProfile(id)
  }

  /** 当前活跃 profile 摘要（无活跃或目录已不存在时为 null） */
  async getActiveProfile(): Promise<ProfileSummary | null> {
    const id = await this.getActiveProfileId()
    if (id === null) return null
    const dir = this.profileDir(id)
    try {
      await fs.access(dir)
    } catch {
      return null
    }
    return this.summarize(id, dir)
  }

  /**
   * 确保存在一个活跃 profile：
   * - 无任何 profile 时创建默认 profile 并设为活跃（首次运行）
   * - 注册表指向不存在的目录时改指首个剩余 profile
   * - 完全没有 profile 且创建被并发抢先时回退到首个剩余
   *
   * @returns 活跃 profile 摘要；pets 根为空且无法创建时为 null
   */
  async ensureActiveProfile(): Promise<ProfileSummary> {
    await this.ensureRoot()
    let active = await this.getActiveProfile()
    if (active === null) {
      const profiles = await this.listProfiles()
      if (profiles.length === 0) {
        active = await this.createProfile(DEFAULT_PROFILE_NAME)
      } else {
        active = profiles[0]!
      }
      active = await this.setActiveProfile(active.id)
    }
    return active
  }

  /** 构造单个 profile 的摘要（读取 persona 名 + 校验） */
  private async summarize(id: string, dir: string): Promise<ProfileSummary> {
    const paths = getProjectPaths(dir)
    let name = id
    try {
      const persona = JSON.parse(await fs.readFile(paths.persona, 'utf-8'))
      if (typeof persona['name'] === 'string' && persona['name'] !== '') {
        name = persona['name']
      }
    } catch {
      // persona.json 缺失或损坏 → 使用目录名
    }
    const errors = await validateProject(dir)
    return { id, name, dir, valid: errors.length === 0 }
  }
}

// ── 需求状态按 profile 读写 (§12.2 状态独立) ── //

/**
 * 读取 profile 项目目录中的 needs-state.json。
 *
 * 文件缺失或无效时返回默认需求状态（不抛错——崩溃恢复场景 §13），
 * 并尽力把默认值回写磁盘，修复被写坏的文件（如进程退出时的 0 字节截断）。
 */
export async function loadNeedsStateOrDefault(projectDir: string): Promise<NeedsState> {
  const paths = getProjectPaths(projectDir)
  const state = await tryReadNeedsState(paths.needsState)
  if (state !== null) return state

  const fallback = defaultNeedsState()
  try {
    await saveNeedsState(projectDir, fallback)
  } catch {
    /* 回写失败不阻塞启动，下次保存自然修复 */
  }
  return fallback
}

/** 将需求状态写入 profile 项目目录（写前验证，原子落盘） */
export async function saveNeedsState(projectDir: string, state: NeedsState): Promise<void> {
  const errors = validateNeedsState(state)
  if (errors.length > 0) {
    throw new Error(`cannot save invalid needs-state:\n  ${errors.join('\n  ')}`)
  }
  const paths = getProjectPaths(projectDir)
  await fs.mkdir(projectDir, { recursive: true })
  await writeJsonAtomic(paths.needsState, state)
}

async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p)
    return true
  } catch {
    return false
  }
}
