/**
 * 直接导入片段的动作清单。
 *
 * 清单只负责把用户选择的原始视频关联到行为状态，不读取视频内容，
 * 也不触发抠像、裁剪、转码、时长探测或轨迹生成。
 */

import type { ClipAnchor, ClipCategory, ClipDirection } from './types/clip-meta'

/** 动作清单大类别 */
export type ShootingCategory = 'A' | 'B' | 'C' | 'D'

/** 方向需求 */
export type DirectionRequirement = 'none' | 'front' | 'side' | 'left-right' | 'both'

/**
 * 拍摄清单条目 (§4.4 表格一行)
 */
export interface ShootingListItem {
  /** FSM 状态键，如 "idle_sit" / "walk" */
  readonly state: string
  /** 显示名称 */
  readonly label: string
  /** 大类别 A/B/C/D */
  readonly category: ShootingCategory
  /** 必拍 / 选拍 */
  readonly required: boolean
  /** 最小启动集 */
  readonly startupSet: boolean
  /** 方向需求 */
  readonly direction: DirectionRequirement
  /** 是否循环片段 */
  readonly loop: boolean
  /** 起止锚定 (§4.2) */
  readonly anchor: ClipAnchor
  /** 建议变体数下限 */
  readonly suggestedVariants: number
  /** 建议变体数上限 */
  readonly suggestedVariantsMax: number
  /** 说明 */
  readonly description: string
}

/** 大类别元信息 */
export interface CategoryMeta {
  readonly id: ShootingCategory
  readonly label: string
  readonly subtitle: string
}

/** 四大类别元信息 */
export const SHOOTING_CATEGORIES: readonly CategoryMeta[] = [
  { id: 'A', label: '基础生命状态', subtitle: '必拍，构成 FSM 骨架' },
  { id: 'B', label: '互动响应', subtitle: '选拍，增强连接' },
  { id: 'C', label: '个性招牌动作', subtitle: '个性，身份灵魂' },
  { id: 'D', label: '情绪 / 需求表达', subtitle: '选拍，养成感' },
] as const

/**
 * 完整动作清单。
 *
 * 清单只帮助用户把最终文件关联到行为状态。
 */
export const SHOOTING_LIST: readonly ShootingListItem[] = [
  // ── A. 基础生命状态 ── //
  {
    state: 'idle_sit',
    label: '端坐（主锚定）',
    category: 'A',
    required: true,
    startupSet: true,
    direction: 'front',
    loop: false,
    anchor: 'sit',
    suggestedVariants: 2,
    suggestedVariantsMax: 3,
    description: '大多数中转的基准姿态',
  },
  {
    state: 'stand',
    label: '站立（副锚定）',
    category: 'A',
    required: true,
    startupSet: true,
    direction: 'side',
    loop: false,
    anchor: 'stand',
    suggestedVariants: 1,
    suggestedVariantsMax: 1,
    description: '站立行为片段',
  },
  {
    state: 'walk',
    label: '行走',
    category: 'A',
    required: true,
    startupSet: true,
    direction: 'left-right',
    loop: false,
    anchor: 'stand',
    suggestedVariants: 2,
    suggestedVariantsMax: 4,
    description: '直接使用已制作完成的左、右方向片段',
  },
  {
    state: 'lie',
    label: '趴卧',
    category: 'A',
    required: true,
    startupSet: true,
    direction: 'none',
    loop: true,
    anchor: 'sit',
    suggestedVariants: 2,
    suggestedVariantsMax: 3,
    description: '完整文件循环播放',
  },
  {
    state: 'sleep',
    label: '睡眠',
    category: 'A',
    required: true,
    startupSet: true,
    direction: 'none',
    loop: true,
    anchor: 'sit',
    suggestedVariants: 1,
    suggestedVariantsMax: 2,
    description: '长循环，含翻身变体',
  },
  {
    state: 'groom',
    label: '理毛',
    category: 'A',
    required: false,
    startupSet: false,
    direction: 'none',
    loop: true,
    anchor: 'sit',
    suggestedVariants: 1,
    suggestedVariantsMax: 2,
    description: '完整文件循环播放',
  },
  {
    state: 'turn',
    label: '转身',
    category: 'A',
    required: true,
    startupSet: false,
    direction: 'both',
    loop: false,
    anchor: 'stand',
    suggestedVariants: 1,
    suggestedVariantsMax: 2,
    description: '直接使用已制作完成的左、右方向片段',
  },
  {
    state: 'transition',
    label: '起身 / 趴下过渡',
    category: 'A',
    required: true,
    startupSet: true,
    direction: 'none',
    loop: false,
    anchor: 'none',
    suggestedVariants: 2,
    suggestedVariantsMax: 4,
    description: '坐↔站、坐↔趴卧，锚定间过渡',
  },

  // ── B. 互动响应 ── //
  {
    state: 'petted',
    label: '被抚摸享受',
    category: 'B',
    required: false,
    startupSet: false,
    direction: 'none',
    loop: false,
    anchor: 'sit',
    suggestedVariants: 1,
    suggestedVariantsMax: 2,
    description: '眯眼 / 呼噜 / 蹭手等最终成片',
  },
  {
    state: 'clicked',
    label: '抬头看镜头（点击呼应）',
    category: 'B',
    required: false,
    startupSet: false,
    direction: 'none',
    loop: false,
    anchor: 'sit',
    suggestedVariants: 1,
    suggestedVariantsMax: 1,
    description: '点击呼应',
  },
  {
    state: 'called',
    label: '被呼唤转身',
    category: 'B',
    required: false,
    startupSet: false,
    direction: 'none',
    loop: false,
    anchor: 'sit',
    suggestedVariants: 1,
    suggestedVariantsMax: 1,
    description: '被呼唤转身',
  },
  {
    state: 'dragged',
    label: '被抱起 / 悬空（拖拽反应）',
    category: 'B',
    required: false,
    startupSet: false,
    direction: 'none',
    loop: false,
    anchor: 'none',
    suggestedVariants: 1,
    suggestedVariantsMax: 1,
    description: '拖拽反应 + 松手落回地面',
  },

  // ── D. 情绪 / 需求表达 ── //
  {
    state: 'beg_food',
    label: '讨食',
    category: 'D',
    required: false,
    startupSet: false,
    direction: 'none',
    loop: false,
    anchor: 'sit',
    suggestedVariants: 1,
    suggestedVariantsMax: 2,
    description: '完整道具画面由外部制作，程序原样播放',
  },
  {
    state: 'drink',
    label: '喝水',
    category: 'D',
    required: false,
    startupSet: false,
    direction: 'none',
    loop: false,
    anchor: 'sit',
    suggestedVariants: 1,
    suggestedVariantsMax: 1,
    description: '完整道具画面由外部制作，程序原样播放',
  },
  {
    state: 'want_play',
    label: '求玩',
    category: 'D',
    required: false,
    startupSet: false,
    direction: 'none',
    loop: false,
    anchor: 'sit',
    suggestedVariants: 1,
    suggestedVariantsMax: 2,
    description: '求玩',
  },
  {
    state: 'bored',
    label: '无聊',
    category: 'D',
    required: false,
    startupSet: false,
    direction: 'none',
    loop: true,
    anchor: 'sit',
    suggestedVariants: 1,
    suggestedVariantsMax: 2,
    description: '无聊',
  },
  {
    state: 'happy',
    label: '开心',
    category: 'D',
    required: false,
    startupSet: false,
    direction: 'none',
    loop: true,
    anchor: 'sit',
    suggestedVariants: 1,
    suggestedVariantsMax: 2,
    description: '开心',
  },
  {
    state: 'annoyed',
    label: '烦躁',
    category: 'D',
    required: false,
    startupSet: false,
    direction: 'none',
    loop: false,
    anchor: 'sit',
    suggestedVariants: 1,
    suggestedVariantsMax: 2,
    description: '烦躁',
  },
] as const

// ── C 类别无固定条目，由用户自定义动作 ── //

/**
 * 建议段数文案：下限等于上限时显示单值，否则显示区间。
 * 供导入向导展示，纯字符串格式化，不涉及媒体内容。
 */
export function variantSuggestionText(item: ShootingListItem): string {
  return item.suggestedVariants === item.suggestedVariantsMax
    ? `${item.suggestedVariants} 段`
    : `${item.suggestedVariants}–${item.suggestedVariantsMax} 段`
}

/**
 * 最小启动集条目。
 *
 * 6 段主体：端坐、站立、行走×2(左/右)、趴卧、睡眠 + 过渡段。
 */
export function getStartupSetItems(): readonly ShootingListItem[] {
  return SHOOTING_LIST.filter((item) => item.startupSet)
}

/**
 * 非启动集条目（清单的其余部分）。
 */
export function getNonStartupItems(): readonly ShootingListItem[] {
  return SHOOTING_LIST.filter((item) => !item.startupSet)
}

/**
 * 按 FSM 状态键查找清单条目。
 */
export function findItemByState(state: string): ShootingListItem | undefined {
  return SHOOTING_LIST.find((item) => item.state === state)
}

/**
 * 将运行时 ClipCategory 映射为 ShootingCategory。
 *
 * basic → A, interactive → B, signature → C, emotion → D。
 */
export function clipCategoryToShooting(category: ClipCategory): ShootingCategory {
  switch (category) {
    case 'basic':
      return 'A'
    case 'interactive':
      return 'B'
    case 'signature':
      return 'C'
    case 'emotion':
      return 'D'
  }
}

/**
 * 根据 ShootingListItem 的方向需求推断默认 ClipDirection。
 *
 * left-right 类需要用户选择；其余映射为 none。
 */
export function defaultClipDirection(item: ShootingListItem): ClipDirection {
  if (item.direction === 'left-right' || item.direction === 'both') {
    return 'none' // 需要用户在导入时选择
  }
  return 'none'
}
