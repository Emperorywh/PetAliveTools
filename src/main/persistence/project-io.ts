/**
 * Pet 项目目录 I/O (§12.1)
 *
 * 负责：创建、读取、写入、验证 pet 项目目录。
 * 运行于主进程。
 *
 * 项目目录结构：
 * ```
 * <pet_name>/
 *   persona.json
 *   needs-state.json
 *   behavior-config.json
 *   clips/           *.webm + *.track.json
 *   clips.meta.json
 *   audio/
 *   audio.meta.json
 * ```
 */

import { promises as fs } from 'node:fs'
import * as path from 'node:path'

import type { ProjectData, Persona, NeedsState, BehaviorConfig, ClipMeta, AudioMeta } from '../../shared/types/project'
import {
  validatePersona,
  validateNeedsState,
  validateBehaviorConfig,
  validateClipMetaArray,
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
const FILE_CLIPS_META = 'clips.meta.json'
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
  readonly clipsMeta: string
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
    clipsMeta: path.join(projectDir, FILE_CLIPS_META),
    audioDir: path.join(projectDir, DIR_AUDIO),
    audioMeta: path.join(projectDir, FILE_AUDIO_META),
  }
}

// ── JSON 辅助 ── //

async function readJson(filePath: string): Promise<unknown> {
  const content = await fs.readFile(filePath, 'utf-8')
  return JSON.parse(content)
}

async function writeJson(filePath: string, data: unknown): Promise<void> {
  const content = JSON.stringify(data, null, 2)
  await fs.writeFile(filePath, content, 'utf-8')
}

// ── 创建 ── //

/**
 * 创建新的 pet 项目目录 (§12.1)。
 *
 * 创建完整目录结构与所有 JSON 文件（含空的 clips/audio 元数据数组）。
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
  await writeJson(paths.clipsMeta, [])
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

  const [personaRaw, needsStateRaw, behaviorConfigRaw, clipsRaw, audioRaw] = await Promise.all([
    readJson(paths.persona),
    readJson(paths.needsState),
    readJson(paths.behaviorConfig),
    readJson(paths.clipsMeta),
    readJson(paths.audioMeta),
  ])

  // 验证
  const errors: ValidationErrors = []
  errors.push(...validatePersona(personaRaw))
  errors.push(...validateNeedsState(needsStateRaw))
  errors.push(...validateBehaviorConfig(behaviorConfigRaw))
  errors.push(...validateClipMetaArray(clipsRaw))
  errors.push(...validateAudioMetaArray(audioRaw))

  if (errors.length > 0) {
    throw new Error(`Project validation failed:\n  ${errors.join('\n  ')}`)
  }

  return {
    persona: personaRaw as Persona,
    needsState: needsStateRaw as NeedsState,
    behaviorConfig: behaviorConfigRaw as BehaviorConfig,
    clips: clipsRaw as ClipMeta[],
    audio: audioRaw as AudioMeta[],
  }
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
  errors.push(...validateClipMetaArray(data.clips))
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
  await writeJson(paths.clipsMeta, data.clips)
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
    [FILE_CLIPS_META, paths.clipsMeta, validateClipMetaArray],
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
    symmetrical: true,
    personality: defaultPersonality(),
  }
}
