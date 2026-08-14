/**
 * 直接片段项目的备份 / 导入导出。
 *
 * pet 项目目录自包含（§12.1），导出 = 整个目录打包为 zip，
 * 导入 = 校验 zip 内数据后解包到 pets 根目录成为新 profile。
 *
 * 导入校验（写入磁盘之前全部通过才落盘）：
 * 1. zip 结构可解析，条目名安全（无 `..`、无绝对路径、无盘符）
 * 2. 四个应用配置 JSON 文件齐全，且通过 schema 校验
 * 3. clips/ 中的视频按文件名直接识别，audio.meta.json 引用的音频存在
 *
 * 运行于主进程（与 vitest node 环境）。
 */

import { promises as fs } from 'node:fs'
import * as path from 'node:path'

import type { ClipMeta, AudioMeta, Persona, NeedsState, BehaviorConfig } from '../../shared/types/project'
import {
  validatePersona,
  validateNeedsState,
  validateBehaviorConfig,
  validateAudioMetaArray,
} from '../../shared/schemas'
import type { ValidationErrors } from '../../shared/schemas'
import { createZipArchive, readZipArchive, type ZipEntry } from './zip'
import { getProjectPaths } from './project-io'
import { clipFromFileName, isDirectVideoFile } from '../../shared/direct-media'

// ── 导出 ── //

/** 导出结果 */
export interface ExportResult {
  /** zip 文件路径 */
  readonly zipPath: string
  /** 打包的文件数 */
  readonly fileCount: number
}

/**
 * 递归收集目录下全部文件的相对路径（正斜杠分隔，按路径排序）。
 */
export async function collectProjectFiles(projectDir: string): Promise<string[]> {
  const files: string[] = []

  async function walk(dir: string, prefix: string): Promise<void> {
    const dirents = await fs.readdir(dir, { withFileTypes: true })
    for (const dirent of dirents) {
      const rel = prefix === '' ? dirent.name : `${prefix}/${dirent.name}`
      if (dirent.isDirectory()) {
        await walk(path.join(dir, dirent.name), rel)
      } else if (dirent.isFile()) {
        files.push(rel)
      }
    }
  }

  await walk(projectDir, '')
  files.sort()
  return files
}

/**
 * 将整个 pet 项目目录导出为 zip (§12.3)。
 *
 * 打包目录下全部文件，包括 clips/ 中原样保存的视频。
 *
 * @param projectDir 项目目录
 * @param zipPath 输出 zip 路径
 */
export async function exportProjectToZip(
  projectDir: string,
  zipPath: string,
): Promise<ExportResult> {
  const paths = getProjectPaths(projectDir)

  // 必须是有效项目目录才导出
  try {
    await fs.access(paths.persona)
  } catch {
    throw new Error(`not a pet project directory (persona.json missing): ${projectDir}`)
  }

  const relatives = await collectProjectFiles(projectDir)
  const entries: ZipEntry[] = []
  for (const rel of relatives) {
    entries.push({ name: rel, data: await fs.readFile(path.join(projectDir, rel)) })
  }

  const zip = createZipArchive(entries)
  await fs.mkdir(path.dirname(zipPath), { recursive: true })
  await fs.writeFile(zipPath, zip)

  return { zipPath, fileCount: entries.length }
}

// ── 导入：条目名规范化与安全检查 ── //

/** 归一化并检查条目名安全；非法时返回 null */
function safeEntryName(name: string): string | null {
  // 统一分隔符
  const normalized = name.replace(/\\/g, '/')
  if (normalized === '') return null
  if (normalized.includes('\0')) return null
  if (normalized.startsWith('/') || /^[a-zA-Z]:/.test(normalized)) return null
  const parts = normalized.split('/')
  if (parts.some((p) => p === '' || p === '.' || p === '..')) return null
  return parts.join('/')
}

/**
 * 若全部条目共享同一个顶层目录（如 "MyCat/persona.json"），
 * 返回该目录名；否则返回 null。
 */
export function findCommonRootDir(names: readonly string[]): string | null {
  if (names.length === 0) return null
  const first = names[0]!.split('/')[0]!
  if (first === names[0]) return null // 根层就有文件 → 无公共目录
  return names.every((n) => n.startsWith(`${first}/`)) ? first : null
}

/** 导入条目：条目名已归一化、公共顶层目录已剥离 */
interface NormalizedEntry {
  readonly name: string
  readonly data: Buffer
}

/**
 * 归一化 zip 条目：安全检查 + 剥离公共顶层目录。
 * 任何非法条目名都会抛错（zip-slip 防护）。
 */
export function normalizeZipEntries(entries: readonly ZipEntry[]): NormalizedEntry[] {
  const safe = entries.map((e) => {
    const name = safeEntryName(e.name)
    if (name === null) throw new Error(`unsafe entry name in zip: "${e.name}"`)
    return { name, data: e.data }
  })

  const root = findCommonRootDir(safe.map((e) => e.name))
  if (root === null) return safe
  return safe
    .filter((e) => e.name !== `${root}/`)
    .map((e) => ({ name: e.name.slice(root.length + 1), data: e.data }))
}

// ── 导入：数据校验 ── //

/** 校验 zip 内项目数据；返回错误列表（空 = 有效） */
export function validateProjectEntries(
  entries: readonly NormalizedEntry[],
): ValidationErrors {
  const errors: ValidationErrors = []
  const byName = new Map(entries.map((e) => [e.name, e.data]))

  // 1. 必需文件齐全
  const required = [
    'persona.json',
    'needs-state.json',
    'behavior-config.json',
    'audio.meta.json',
  ] as const
  for (const file of required) {
    if (!byName.has(file)) errors.push(`${file}: missing from archive`)
  }
  if (errors.length > 0) return errors

  // 2. JSON 解析 + schema 校验
  const parsed = new Map<string, unknown>()
  const validators: Array<[string, (d: unknown) => ValidationErrors]> = [
    ['persona.json', validatePersona],
    ['needs-state.json', validateNeedsState],
    ['behavior-config.json', validateBehaviorConfig],
    ['audio.meta.json', validateAudioMetaArray],
  ]
  for (const [file, validate] of validators) {
    let raw: unknown
    try {
      raw = JSON.parse(byName.get(file)!.toString('utf-8'))
    } catch (err) {
      errors.push(`${file}: failed to parse — ${(err as Error).message}`)
      continue
    }
    parsed.set(file, raw)
    errors.push(...validate(raw))
  }
  if (errors.length > 0) return errors

  // 3. 可直接播放的 clips/ 文件名必须能识别；旧轨迹和说明文件会被忽略
  for (const entry of entries.filter((candidate) => candidate.name.startsWith('clips/'))) {
    const fileName = entry.name.slice('clips/'.length)
    if (fileName && isDirectVideoFile(fileName) && clipFromFileName(fileName) === null) {
      errors.push(`${entry.name}: unsupported or unrecognized direct clip name`)
    }
  }
  const audio = parsed.get('audio.meta.json') as AudioMeta[]
  for (const entry of audio) {
    if (!byName.has(`audio/${entry.file}`)) {
      errors.push(`audio/${entry.file}: referenced by audio.meta.json but missing`)
    }
  }

  return errors
}

// ── 导入 ── //

/** 导入结果 */
export interface ImportResult {
  /** 新 profile 标识（= 项目目录名） */
  readonly profileId: string
  /** 解包出的项目目录 */
  readonly projectDir: string
  /** 解包文件数 */
  readonly fileCount: number
  /** 校验通过的项目数据（含片段数等，供调用方展示） */
  readonly data: {
    readonly persona: Persona
    readonly needsState: NeedsState
    readonly behaviorConfig: BehaviorConfig
    readonly clips: readonly ClipMeta[]
    readonly audio: readonly AudioMeta[]
  }
}

/** 为导入项目生成 pets 根下唯一的目录名 */
async function uniqueImportId(petsRoot: string, base: string): Promise<string> {
  let id = base
  let suffix = 2
  for (;;) {
    try {
      await fs.access(path.join(petsRoot, id))
      id = `${base}-${suffix++}`
    } catch {
      return id
    }
  }
}

/**
 * 从 zip 导入 pet 项目 (§12.3)。
 *
 * 全部校验通过后才写入磁盘；任一校验失败抛错且不产生任何文件。
 * 目录名冲突时自动追加 -2、-3… 后缀。
 *
 * @param zipPath zip 文件路径
 * @param petsRoot 目标 pets 根目录（导入后成为新 profile）
 * @param baseId 可选的目录名基数（默认取 persona.name 净化值）
 */
export async function importProjectFromZip(
  zipPath: string,
  petsRoot: string,
  baseId?: string,
): Promise<ImportResult> {
  const zip = await fs.readFile(zipPath)
  const entries = normalizeZipEntries(readZipArchive(zip))

  const errors = validateProjectEntries(entries)
  if (errors.length > 0) {
    throw new Error(`import validation failed:\n  ${errors.join('\n  ')}`)
  }

  const byName = new Map(entries.map((e) => [e.name, e.data]))
  const persona = JSON.parse(byName.get('persona.json')!.toString('utf-8')) as Persona

  const base = baseId !== undefined && baseId !== '' ? baseId : sanitizeImportId(persona.name)
  await fs.mkdir(petsRoot, { recursive: true })
  const profileId = await uniqueImportId(petsRoot, base)
  const projectDir = path.join(petsRoot, profileId)

  // 解包（条目名已通过安全检查，路径被限制在项目目录内）
  for (const entry of entries) {
    const target = path.join(projectDir, ...entry.name.split('/'))
    if (!target.startsWith(projectDir + path.sep) && target !== projectDir) {
      throw new Error(`entry escapes project directory: ${entry.name}`)
    }
    await fs.mkdir(path.dirname(target), { recursive: true })
    await fs.writeFile(target, entry.data)
  }

  return {
    profileId,
    projectDir,
    fileCount: entries.length,
    data: {
      persona,
      needsState: JSON.parse(byName.get('needs-state.json')!.toString('utf-8')) as NeedsState,
      behaviorConfig: JSON.parse(byName.get('behavior-config.json')!.toString('utf-8')) as BehaviorConfig,
      clips: entries
        .filter((entry) => entry.name.startsWith('clips/'))
        .map((entry) => clipFromFileName(entry.name.slice('clips/'.length)))
        .filter((clip): clip is ClipMeta => clip !== null),
      audio: JSON.parse(byName.get('audio.meta.json')!.toString('utf-8')) as AudioMeta[],
    },
  }
}

/** 导入用目录名净化（与 profile 创建一致的规则） */
function sanitizeImportId(name: string): string {
  const cleaned = name
    .replace(/[\\/:*?"<>|]/g, '')
    .replace(/\s+/g, '_')
    .replace(/^[._]+|[._]+$/g, '')
    .slice(0, 60)
  return cleaned === '' ? 'pet' : cleaned
}
