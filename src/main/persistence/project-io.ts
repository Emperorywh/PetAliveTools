/**
 * Pet 项目目录 I/O。
 *
 * clips/ 中的视频是唯一片段来源：加载时直接扫描文件名并构造内存描述，
 * 不再读取或写入 clips.meta.json，也不会探测或处理视频内容。
 */

import { promises as fs } from 'node:fs'
import * as path from 'node:path'

import type { ProjectData, Persona, NeedsState, BehaviorConfig, ClipMeta, AudioMeta } from '../../shared/types/project'
import { clipFromFileName, isDirectVideoFile } from '../../shared/direct-media'
import { writeJsonAtomic } from './atomic-write'
import {
  validatePersona,
  validateNeedsState,
  validateBehaviorConfig,
  validateAudioMetaArray,
  defaultPersonality,
  defaultNeedsState,
  defaultBehaviorConfig,
} from '../../shared/schemas'
import type { ValidationErrors } from '../../shared/schemas'

// ── 文件名常量 ── //

const FILE_PERSONA = 'persona.json'
const FILE_NEEDS_STATE = 'needs-state.json'
const FILE_BEHAVIOR_CONFIG = 'behavior-config.json'
const FILE_AUDIO_META = 'audio.meta.json'
const DIR_CLIPS = 'clips'
const DIR_AUDIO = 'audio'

// ── 路径 ── //

/** 项目目录内各文件/子目录的路径集合 */
export interface ProjectPaths {
  readonly root: string
  readonly persona: string
  readonly needsState: string
  readonly behaviorConfig: string
  readonly clipsDir: string
  readonly audioDir: string
  readonly audioMeta: string
}

/** 根据项目根目录计算所有文件路径 */
export function getProjectPaths(projectDir: string): ProjectPaths {
  return {
    root: projectDir,
    persona: path.join(projectDir, FILE_PERSONA),
    needsState: path.join(projectDir, FILE_NEEDS_STATE),
    behaviorConfig: path.join(projectDir, FILE_BEHAVIOR_CONFIG),
    clipsDir: path.join(projectDir, DIR_CLIPS),
    audioDir: path.join(projectDir, DIR_AUDIO),
    audioMeta: path.join(projectDir, FILE_AUDIO_META),
  }
}

// ── JSON 辅助 ── //

async function readJson(filePath: string): Promise<unknown> {
  const content = await fs.readFile(filePath, 'utf-8')
  return JSON.parse(content)
}

/**
 * 读取 needs-state.json，缺失、截断或校验失败时返回 null（§13 崩溃恢复）。
 *
 * needs-state 是运行时状态而非用户配置：文件被写坏时业务上允许丢失并
 * 回退默认值，不应让整个项目加载失败。纯读取，不做任何回写。
 */
export async function tryReadNeedsState(
  needsStatePath: string,
): Promise<NeedsState | null> {
  try {
    const raw: unknown = JSON.parse(await fs.readFile(needsStatePath, 'utf-8'))
    if (validateNeedsState(raw).length === 0) {
      return raw as NeedsState
    }
  } catch {
    /* 缺失/损坏 → null，由调用方决定回退 */
  }
  return null
}

async function writeJson(filePath: string, data: unknown): Promise<void> {
  await writeJsonAtomic(filePath, data)
}

// ── 创建 ── //

/**
 * 创建新的 pet 项目目录 (§12.1)。
 *
 * 创建完整目录结构与配置文件；视频片段只存放在 clips/ 目录。
 * 如果目录已存在则抛出错误。
 *
 * @param projectDir 项目根目录路径
 * @param persona 宠物 Persona（可使用 defaultPersonality）
 */
export async function createProject(
  projectDir: string,
  persona: Persona,
): Promise<ProjectPaths> {
  const paths = getProjectPaths(projectDir)

  // 确保目录不存在
  try {
    await fs.access(projectDir)
    throw new Error(`Project directory already exists: ${projectDir}`)
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
  }

  // 创建目录结构
  await fs.mkdir(projectDir, { recursive: true })
  await fs.mkdir(paths.clipsDir, { recursive: true })
  await fs.mkdir(paths.audioDir, { recursive: true })

  // 写入 JSON 文件
  await writeJson(paths.persona, persona)
  await writeJson(paths.needsState, defaultNeedsState())
  await writeJson(paths.behaviorConfig, defaultBehaviorConfig())
  await writeJson(paths.audioMeta, [])

  return paths
}

// ── 读取 ── //

/**
 * 读取并返回 pet 项目数据 (§12.1)。
 *
 * 读取所有 JSON 文件并验证；验证失败时抛出包含错误列表的 Error。
 *
 * @param projectDir 项目根目录路径
 * @returns 完整 ProjectData
 */
export async function loadProject(projectDir: string): Promise<ProjectData> {
  const paths = getProjectPaths(projectDir)

  const [personaRaw, needsState, behaviorConfigRaw, clipsScan, audioRaw] = await Promise.all([
    readJson(paths.persona),
    tryReadNeedsState(paths.needsState),
    readJson(paths.behaviorConfig),
    scanClipsDirectory(paths.clipsDir),
    readJson(paths.audioMeta),
  ])

  // 验证（needs-state 已在读取时容错，损坏时回退默认值而非失败）
  const errors: ValidationErrors = []
  errors.push(...validatePersona(personaRaw))
  errors.push(...validateBehaviorConfig(behaviorConfigRaw))
  errors.push(...validateAudioMetaArray(audioRaw))

  if (errors.length > 0) {
    throw new Error(`Project validation failed:\n  ${errors.join('\n  ')}`)
  }

  return {
    persona: personaRaw as Persona,
    needsState: needsState ?? defaultNeedsState(),
    behaviorConfig: behaviorConfigRaw as BehaviorConfig,
    clips: clipsScan.clips,
    unrecognizedVideos: clipsScan.unrecognizedVideos,
    audio: audioRaw as AudioMeta[],
  }
}

/**
 * 直接扫描 clips/ 并按文件名构造片段描述。
 * 文件内容不会被打开；无法识别或浏览器不支持的文件会被忽略。
 */
export async function loadDirectClips(clipsDir: string): Promise<ClipMeta[]> {
  const { clips } = await scanClipsDirectory(clipsDir)
  return clips
}

/** clips/ 扫描结果：可调度片段 + 无法识别的视频文件名（供导入窗口清理） */
export interface ClipsScanResult {
  readonly clips: ClipMeta[]
  /**
   * 扩展名属于可直接播放容器、但命名无法映射到动作清单的视频文件。
   * 典型来源：动作状态从清单移除后遗留的旧片段（如 petted/annoyed）。
   */
  readonly unrecognizedVideos: readonly string[]
}

/**
 * 扫描 clips/ 目录，区分可调度片段与无法识别的视频文件。
 * 文件内容不会被打开；非视频文件（如遗留的 track.json）不计入任何一边。
 */
export async function scanClipsDirectory(clipsDir: string): Promise<ClipsScanResult> {
  let entries: string[]
  try {
    entries = await fs.readdir(clipsDir)
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return { clips: [], unrecognizedVideos: [] }
    }
    throw err
  }

  const clips: ClipMeta[] = []
  const unrecognizedVideos: string[] = []
  for (const fileName of [...entries].sort((a, b) => a.localeCompare(b))) {
    const clip = clipFromFileName(fileName)
    if (clip) clips.push(clip)
    else if (isDirectVideoFile(fileName)) unrecognizedVideos.push(fileName)
  }
  return { clips, unrecognizedVideos }
}

// ── 写入 ── //

/**
 * 将完整 ProjectData 写入项目目录 (§12.1)。
 *
 * 写入前验证全部数据。目录不存在时自动创建。
 *
 * @param projectDir 项目根目录路径
 * @param data 要写入的 ProjectData
 */
export async function saveProject(
  projectDir: string,
  data: ProjectData,
): Promise<void> {
  // 写入前验证
  const errors: ValidationErrors = []
  errors.push(...validatePersona(data.persona))
  errors.push(...validateNeedsState(data.needsState))
  errors.push(...validateBehaviorConfig(data.behaviorConfig))
  errors.push(...validateAudioMetaArray(data.audio))

  if (errors.length > 0) {
    throw new Error(`Cannot save invalid project data:\n  ${errors.join('\n  ')}`)
  }

  const paths = getProjectPaths(projectDir)

  // 确保目录存在
  await fs.mkdir(paths.clipsDir, { recursive: true })
  await fs.mkdir(paths.audioDir, { recursive: true })

  await writeJson(paths.persona, data.persona)
  await writeJson(paths.needsState, data.needsState)
  await writeJson(paths.behaviorConfig, data.behaviorConfig)
  await writeJson(paths.audioMeta, data.audio)
}

// ── 验证 ── //

/**
 * 验证已有项目目录 (§12.1)。
 *
 * 读取所有 JSON 文件并返回验证错误列表（空 = 项目有效）。
 * 如果缺少必需文件，返回对应错误而非抛出异常。
 *
 * @param projectDir 项目根目录路径
 * @returns 验证错误列表（空 = 有效）
 */
export async function validateProject(projectDir: string): Promise<ValidationErrors> {
  const paths = getProjectPaths(projectDir)
  const errors: ValidationErrors = []

  // 逐文件读取并验证，缺失文件记录错误而非抛出
  const files: Array<[string, string, (d: unknown) => ValidationErrors]> = [
    [FILE_PERSONA, paths.persona, validatePersona],
    [FILE_NEEDS_STATE, paths.needsState, validateNeedsState],
    [FILE_BEHAVIOR_CONFIG, paths.behaviorConfig, validateBehaviorConfig],
    [FILE_AUDIO_META, paths.audioMeta, validateAudioMetaArray],
  ]

  for (const [name, filePath, validator] of files) {
    try {
      const raw = await readJson(filePath)
      errors.push(...validator(raw))
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        errors.push(`${name}: file not found`)
      } else {
        errors.push(`${name}: failed to parse — ${(err as Error).message}`)
      }
    }
  }

  // 检查子目录
  for (const [dirName, dirPath] of [
    [DIR_CLIPS, paths.clipsDir],
    [DIR_AUDIO, paths.audioDir],
  ] as const) {
    try {
      await fs.access(dirPath)
    } catch {
      errors.push(`${dirName}/: directory not found`)
    }
  }

  return errors
}

/** 创建带默认 Personality 的 Persona (§9.6) */
export function createDefaultPersona(name: string): Persona {
  return {
    name,
    personality: defaultPersonality(),
  }
}
