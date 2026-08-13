/**
 * 音频素材库管理 (§11.1 音频分离入库, §12.1 audio.meta.json)
 *
 * 管理所有 AudioMeta 条目，支持：
 *   - 按 id 查询单个声效
 *   - 按类别筛选 (ambient / action)
 *   - 多采样分组与轮播 (§11.2 同一声效多采样轮播)
 *   - 解析片段的 audio 字段引用 (§5.4)
 *
 * 多采样约定：id 格式 `<base>_<NN>`（如 purr_01, purr_02），
 * 共享前缀 `<base>` 的条目归为同一采样组。
 * 片段的 audio 字段可引用具体 id 或组前缀。
 *
 * 纯逻辑，无平台依赖。
 */

import type { AudioMeta, AudioCategory } from '../types/audio-meta'

/** 采样组：同一基础声效的多个变体 */
export interface AudioSampleGroup {
  /** 组前缀，如 "purr" */
  readonly baseId: string
  /** 该组的全部采样 */
  readonly samples: readonly AudioMeta[]
}

/** 音频素材库 */
export interface AudioLibrary {
  /** 全部条目 */
  readonly entries: readonly AudioMeta[]
  /** id → AudioMeta 查找 */
  readonly byId: ReadonlyMap<string, AudioMeta>
  /** 组前缀 → 采样组 */
  readonly groups: ReadonlyMap<string, AudioSampleGroup>
  /** 按类别索引的条目 */
  readonly byCategory: ReadonlyMap<AudioCategory, readonly AudioMeta[]>
}

/**
 * 从音频 id 提取组前缀。
 *
 * "purr_01" → "purr"
 * "meow" → "meow"
 * "ambient_bird_03" → "ambient_bird"
 */
export function extractGroupPrefix(id: string): string {
  const match = id.match(/^(.+)_\d+$/)
  return match ? match[1] : id
}

/**
 * 构建音频素材库。
 *
 * 解析全部条目，建立 id 索引、组索引和类别索引。
 */
export function buildAudioLibrary(entries: readonly AudioMeta[]): AudioLibrary {
  const byId = new Map<string, AudioMeta>()
  const groupMap = new Map<string, AudioMeta[]>()

  for (const entry of entries) {
    byId.set(entry.id, entry)
    const prefix = extractGroupPrefix(entry.id)
    const group = groupMap.get(prefix)
    if (group) {
      group.push(entry)
    } else {
      groupMap.set(prefix, [entry])
    }
  }

  const groups = new Map<string, AudioSampleGroup>()
  for (const [baseId, samples] of groupMap) {
    groups.set(baseId, { baseId, samples })
  }

  const byCategory = new Map<AudioCategory, AudioMeta[]>([
    ['ambient', []],
    ['action', []],
  ])
  for (const entry of entries) {
    byCategory.get(entry.category)?.push(entry)
  }

  return { entries, byId, groups, byCategory }
}

/** 按 id 查询单个声效 */
export function getAudioById(lib: AudioLibrary, id: string): AudioMeta | null {
  return lib.byId.get(id) ?? null
}

/** 按组前缀查询采样组 */
export function getSampleGroup(lib: AudioLibrary, baseId: string): AudioSampleGroup | null {
  return lib.groups.get(baseId) ?? null
}

/** 按类别获取全部条目 */
export function getByCategory(lib: AudioLibrary, category: AudioCategory): readonly AudioMeta[] {
  return lib.byCategory.get(category) ?? []
}

// —— 多采样轮播 (§11.2) —— //

/** 轮播状态：组前缀 → 上次使用的采样索引 */
export interface RotationState {
  readonly indices: ReadonlyMap<string, number>
}

/** 创建初始轮播状态 */
export function createRotationState(): RotationState {
  return { indices: new Map() }
}

/**
 * 从采样组中选择下一个采样 (§11.2 多采样轮播)。
 *
 * 策略：避免连续播放同一样本。多采样时使用轮转 + 随机偏移。
 * 单采样时直接返回。
 *
 * @returns 选中的采样与更新后的轮播状态
 */
export function pickNextSample(
  state: RotationState,
  group: AudioSampleGroup,
  rng: () => number = Math.random,
): { readonly sample: AudioMeta; readonly state: RotationState } {
  const samples = group.samples
  if (samples.length === 0) {
    throw new Error(`Empty sample group: ${group.baseId}`)
  }
  if (samples.length === 1) {
    return { sample: samples[0], state }
  }

  const lastIndex = state.indices.get(group.baseId) ?? -1
  // 从其余样本中随机选择
  const candidates: number[] = []
  for (let i = 0; i < samples.length; i++) {
    if (i !== lastIndex) candidates.push(i)
  }
  const pick = candidates[Math.floor(rng() * candidates.length)]

  const indices = new Map(state.indices)
  indices.set(group.baseId, pick)

  return { sample: samples[pick], state: { indices } }
}

/**
 * 解析片段的 audio 字段引用 (§5.4)。
 *
 * 优先按组前缀解析（支持多采样轮播），
 * 若组不存在则按精确 id 查找。
 *
 * @returns 采样组（用于轮播）或精确条目，或 null（未找到）
 */
export function resolveClipAudio(
  lib: AudioLibrary,
  audioId: string,
): { readonly kind: 'group'; readonly group: AudioSampleGroup } | {
  readonly kind: 'single'
  readonly meta: AudioMeta
} | null {
  // 先尝试组前缀
  const group = lib.groups.get(audioId)
  if (group) return { kind: 'group', group }

  // 再尝试精确 id
  const meta = lib.byId.get(audioId)
  if (meta) return { kind: 'single', meta }

  return null
}
