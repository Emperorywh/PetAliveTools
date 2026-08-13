/**
 * 清单视图 (§5.5)
 *
 * 按 §4.4 四大类别分组展示拍摄清单，最小启动集置顶。
 * 每项状态显示已入库变体数 / 建议数；缺失状态标红。
 *
 * 运行于渲染进程。纯 DOM 渲染，无业务逻辑（逻辑由
 * shared/pipeline/checklist.ts 计算）。
 */

import type { ChecklistStatus, ChecklistEntry } from '../../shared/pipeline/checklist'
import type { ShootingListItem } from '../../shared/pipeline/shooting-list'
import { SHOOTING_CATEGORIES } from '../../shared/pipeline/shooting-list'

/** 点击清单条目时的回调（开始导入） */
export type OnItemSelect = (item: ShootingListItem) => void

/** 配色 */
const COLOR_BG = '#1e2128'
const COLOR_PANEL = '#272b34'
const COLOR_PANEL_BORDER = '#363b46'
const COLOR_TEXT = '#dfe2e8'
const COLOR_TEXT_DIM = '#8b909c'
const COLOR_STARTUP = '#ffd166'
const COLOR_OK = '#7ec8ff'
const COLOR_MISSING = '#ff4d6d'
const COLOR_WARN = '#ff9f43'

const CATEGORY_TITLES: Readonly<Record<string, string>> = {
  A: 'A. 基础生命状态',
  B: 'B. 互动响应',
  C: 'C. 个性招牌动作',
  D: 'D. 情绪 / 需求表达',
}

/**
 * 清单视图组件。
 *
 * 渲染最小启动集进度条 + 四大类别分组的清单条目。
 * 每个条目可点击以启动该状态的导入流程。
 */
export class ChecklistView {
  private readonly container: HTMLElement
  private readonly onSelect: OnItemSelect | null
  private status: ChecklistStatus | null = null

  constructor(container: HTMLElement, onSelect: OnItemSelect | null = null) {
    this.container = container
    this.onSelect = onSelect
  }

  /** 更新清单状态并重绘 */
  update(status: ChecklistStatus): void {
    this.status = status
    this.render()
  }

  /** 重绘整个清单视图 */
  render(): void {
    if (!this.status) return
    this.container.innerHTML = ''
    this.container.className = 'checklist-root'

    // 标题
    const title = el('div', 'checklist-title', '拍摄清单')
    this.container.appendChild(title)

    // 最小启动集进度条
    this.container.appendChild(this.renderStartupSet(this.status))

    // 各类别分组
    for (const catMeta of SHOOTING_CATEGORIES) {
      const group = this.status.groups.find((g) => g.category === catMeta.id)
      if (!group) continue
      this.container.appendChild(this.renderGroup(group))
    }

    // C 类别提示（用户自定义）
    const catC = this.status.groups.find((g) => g.category === 'C')
    if (!catC || catC.entries.length === 0) {
      this.container.appendChild(this.renderSignatureHint())
    }
  }

  /** 渲染最小启动集进度条 */
  private renderStartupSet(status: ChecklistStatus): HTMLElement {
    const panel = el('div', 'checklist-startup-panel')
    panel.style.background = COLOR_PANEL
    panel.style.border = `1px solid ${COLOR_STARTUP}40`

    const header = el('div', 'checklist-startup-header')
    header.style.color = COLOR_STARTUP
    header.textContent =
      status.startupSet.complete
        ? `★ 最小启动集已完成 (${status.startupSet.satisfiedCount}/${status.startupSet.totalCount})`
        : `★ 最小启动集 (${status.startupSet.satisfiedCount}/${status.startupSet.totalCount})`

    // 进度条
    const barWrap = el('div', 'checklist-progress-bar-wrap')
    barWrap.style.cssText = `height:8px;background:${COLOR_BG};border-radius:4px;overflow:hidden;margin-top:8px`
    const barFill = el('div', 'checklist-progress-bar-fill')
    const pct = status.startupSet.totalCount > 0
      ? (status.startupSet.satisfiedCount / status.startupSet.totalCount) * 100
      : 0
    barFill.style.cssText = `height:100%;width:${pct}%;background:${COLOR_STARTUP};border-radius:4px;transition:width 0.3s`
    barWrap.appendChild(barFill)

    panel.appendChild(header)
    panel.appendChild(barWrap)

    // 启动集条目列表
    const grid = el('div', 'checklist-startup-grid')
    grid.style.cssText = 'display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:6px;margin-top:10px'
    for (const entry of status.startupSet.entries) {
      grid.appendChild(this.renderEntryChip(entry))
    }
    panel.appendChild(grid)

    return panel
  }

  /** 渲染单个类别分组 */
  private renderGroup(group: { category: string; label: string; subtitle: string; entries: readonly ChecklistEntry[] }): HTMLElement {
    const section = el('div', `checklist-group checklist-group-${group.category}`)

    const header = el('div', 'checklist-group-header')
    header.style.cssText = `margin-top:16px;margin-bottom:8px;display:flex;align-items:baseline;gap:8px`
    const titleEl = el('span', 'checklist-group-title')
    titleEl.style.cssText = `font-size:14px;font-weight:600;color:${COLOR_TEXT}`
    titleEl.textContent = CATEGORY_TITLES[group.category] ?? group.label
    const subEl = el('span', 'checklist-group-subtitle')
    subEl.style.cssText = `font-size:11px;color:${COLOR_TEXT_DIM}`
    subEl.textContent = group.subtitle
    header.appendChild(titleEl)
    header.appendChild(subEl)
    section.appendChild(header)

    if (group.entries.length === 0 && group.category === 'C') {
      return section
    }

    const list = el('div', 'checklist-group-list')
    list.style.cssText = 'display:flex;flex-direction:column;gap:4px'
    for (const entry of group.entries) {
      list.appendChild(this.renderEntryRow(entry))
    }
    section.appendChild(list)

    return section
  }

  /** 渲染 C 类别提示 */
  private renderSignatureHint(): HTMLElement {
    const section = el('div', 'checklist-group checklist-group-C')
    const header = el('div', 'checklist-group-header')
    header.style.cssText = 'margin-top:16px;margin-bottom:8px'
    const titleEl = el('span', 'checklist-group-title')
    titleEl.style.cssText = `font-size:14px;font-weight:600;color:${COLOR_TEXT}`
    titleEl.textContent = 'C. 个性招牌动作'
    header.appendChild(titleEl)
    section.appendChild(header)

    const hint = el('div', 'checklist-signature-hint')
    hint.style.cssText = `padding:10px;background:${COLOR_PANEL};border-radius:6px;color:${COLOR_TEXT_DIM};font-size:12px;line-height:1.5`
    hint.textContent = '由用户自定义捕捉：翻肚皮 / 叼玩具 / 打呼噜 / 特定怪睡姿…… 导入时打上 signature 标签，低频偶发触发。'
    section.appendChild(hint)

    return section
  }

  /** 渲染启动集小芯片 */
  private renderEntryChip(entry: ChecklistEntry): HTMLElement {
    const chip = makeBtn('checklist-chip')
    const color = entry.missing ? COLOR_MISSING : entry.satisfied ? COLOR_OK : COLOR_WARN
    chip.style.cssText = `padding:4px 8px;border-radius:4px;border:1px solid ${color}40;background:${COLOR_BG};color:${color};font-size:11px;cursor:pointer;text-align:left`
    chip.textContent = `${entry.item.label}: ${entry.ingestedCount}/${entry.suggestedCount}`
    chip.title = entry.item.description
    chip.addEventListener('click', () => this.onSelect?.(entry.item))
    return chip
  }

  /** 渲染清单条目行 */
  private renderEntryRow(entry: ChecklistEntry): HTMLElement {
    const row = makeBtn('checklist-entry')
    const { item, ingestedCount, suggestedCount, missing, satisfied } = entry

    const color = missing ? COLOR_MISSING : satisfied ? COLOR_OK : COLOR_WARN
    row.style.cssText = `display:flex;align-items:center;justify-content:space-between;padding:8px 12px;background:${COLOR_PANEL};border:1px solid ${COLOR_PANEL_BORDER};border-left:3px solid ${color};border-radius:4px;cursor:pointer;width:100%;text-align:left;color:${COLOR_TEXT};transition:border-color 0.15s`
    if (missing) {
      row.style.background = `${COLOR_MISSING}15`
    }

    row.addEventListener('mouseenter', () => {
      row.style.borderColor = color
    })
    row.addEventListener('mouseleave', () => {
      row.style.borderColor = COLOR_PANEL_BORDER
    })
    row.addEventListener('click', () => this.onSelect?.(item))

    // 左侧：标签 + 说明
    const left = el('div', 'checklist-entry-left')
    left.style.cssText = 'flex:1;min-width:0'
    const label = el('div', 'checklist-entry-label')
    label.style.cssText = 'font-size:13px;font-weight:500'
    label.textContent = item.label
    const desc = el('div', 'checklist-entry-desc')
    desc.style.cssText = `font-size:11px;color:${COLOR_TEXT_DIM};white-space:nowrap;overflow:hidden;text-overflow:ellipsis`
    desc.textContent = item.description
    left.appendChild(label)
    left.appendChild(desc)
    row.appendChild(left)

    // 右侧：变体数
    const right = el('div', 'checklist-entry-right')
    right.style.cssText = 'flex-shrink:0;margin-left:12px'
    const count = el('span', 'checklist-entry-count')
    count.style.cssText = `font-size:13px;font-weight:600;color:${color}`
    count.textContent = `${ingestedCount}/${suggestedCount}`
    right.appendChild(count)

    if (missing) {
      const badge = el('span', 'checklist-entry-badge')
      badge.style.cssText = `font-size:10px;color:${COLOR_MISSING};margin-left:6px;padding:1px 4px;border:1px solid ${COLOR_MISSING}60;border-radius:3px`
      badge.textContent = '缺失'
      right.appendChild(badge)
    }

    row.appendChild(right)
    return row
  }
}

/** 创建带类名的 DOM 元素 */
function el(tag: string, className: string, text?: string): HTMLElement {
  const e = document.createElement(tag)
  e.className = className
  if (text !== undefined) e.textContent = text
  return e
}

/** 创建带类名的 button 元素 */
function makeBtn(className: string, text?: string): HTMLButtonElement {
  const b = document.createElement('button')
  b.type = 'button'
  b.className = className
  if (text !== undefined) b.textContent = text
  return b
}
