/**
 * 原样视频片段导入窗口。
 *
 * 用户只需选择动作和已制作完成的视频文件；窗口不会加载视频画面、
 * 抽取帧、预览抠像、设置裁剪或循环点，也不会发起转码。
 * 已导入片段可按文件删除或整组清空，删除只移除 clips/ 中的文件；
 * 命名不在动作清单内的遗留视频文件单独列出，仅提供删除清理入口；
 * 每行附带预览按钮，把该片段交给桌面宠物按运行时链路播放（调试用）。
 */

import type { ProjectData } from '../shared/types/project'
import type { ClipDirection, ClipMeta, TransitionEndpoint } from '../shared/types/clip-meta'
import { transitionKey } from '../shared/direct-media'
import {
  SHOOTING_CATEGORIES,
  SHOOTING_LIST,
  variantSuggestionText,
  type ShootingListItem,
} from '../shared/shooting-list'

/** 过渡片段可选端点（§4.2 双锚定 + §8.2 循环进出） */
const TRANSITION_ENDPOINT_OPTIONS: readonly { value: TransitionEndpoint; label: string }[] = [
  { value: 'sit', label: '端坐' },
  { value: 'stand', label: '站立' },
  { value: 'lie', label: '趴卧' },
  { value: 'sleep', label: '睡眠' },
  { value: 'groom', label: '理毛' },
]

/**
 * 直接导入窗口状态。
 * projectData 中的 clips 来自主进程对 clips/ 的实时扫描。
 */
export class ImportWizard {
  private projectDir: string | null = null
  private projectData: ProjectData | null = null
  private message = ''
  private busy = false

  constructor(private readonly container: HTMLElement) {
    this.injectStyles()
    void this.initialize()
  }

  /**
   * 优先打开当前活跃宠物项目。
   * 没有活跃项目时展示项目选择入口。
   */
  private async initialize(): Promise<void> {
    const defaultDir = await window.petalive.import.getDefaultProjectDir()
    if (defaultDir) await this.openProject(defaultDir)
    else this.render()
  }

  /**
   * 读取项目配置和 clips/ 文件列表。
   * 主进程不会读取视频内容，只根据文件名建立运行时映射。
   */
  private async openProject(projectDir: string): Promise<void> {
    try {
      this.projectData = await window.petalive.import.loadProject(projectDir)
      this.projectDir = projectDir
      this.message = ''
    } catch (err) {
      this.projectData = null
      this.projectDir = null
      this.message = `项目加载失败：${errorMessage(err)}`
    }
    this.render()
  }

  /**
   * 选择一个现有项目目录。
   * 取消选择时保持当前页面不变。
   */
  private async chooseProject(): Promise<void> {
    const dir = await window.petalive.import.selectProject()
    if (dir) await this.openProject(dir)
  }

  /**
   * 在用户选择的父目录中创建新项目。
   * 创建后立即进入原样片段导入页面。
   */
  private async createProject(): Promise<void> {
    const parentDir = await window.petalive.import.selectProject()
    if (!parentDir) return
    const petName = window.prompt('宠物名称')?.trim()
    if (!petName) return
    try {
      const projectDir = await window.petalive.import.createProject(parentDir, petName)
      await this.openProject(projectDir)
    } catch (err) {
      this.message = `创建项目失败：${errorMessage(err)}`
      this.render()
    }
  }

  /**
   * 选择文件后请求主进程逐字节复制。
   * stateKey 为目标状态键：清单状态（如 walk）、过渡端点键
   * （transition_sit_to_stand）或 sig_ 招牌键。导入成功后重新扫描目录。
   */
  private async importClip(
    stateKey: string,
    direction: ClipDirection,
    label: string,
  ): Promise<void> {
    if (!this.projectDir || this.busy) return
    const sourcePath = await window.petalive.import.selectClip()
    if (!sourcePath) return

    this.busy = true
    this.message = '正在复制原始片段……'
    this.render()
    try {
      const result = await window.petalive.import.copyClip(this.projectDir, {
        sourcePath,
        state: stateKey,
        direction,
      })
      this.projectData = await window.petalive.import.loadProject(this.projectDir)
      this.message = `已原样导入「${label}」：${result.fileName}`
    } catch (err) {
      this.message = `导入失败：${errorMessage(err)}`
    } finally {
      this.busy = false
      this.render()
    }
  }

  /**
   * 导入自定义招牌动作 (§4.4 C 类)：用户输入动作名，
   * 以 sig_<名称> 状态键原样复制。导入后作为低频稀有动作触发。
   */
  private async importSignatureClip(rawName: string): Promise<void> {
    const name = rawName.trim().toLowerCase().replace(/\s+/g, '_')
    if (!/^[a-z0-9_]{1,24}$/.test(name)) {
      this.message = '招牌动作名称只能包含小写字母、数字和下划线（1–24 字符）'
      this.render()
      return
    }
    await this.importClip(`sig_${name}`, 'none', `招牌动作 ${name}`)
  }

  /**
   * 删除 clips/ 中的片段文件后重新扫描目录，使计数立即刷新。
   * 删除只移除文件并更新运行时映射，不触发任何视频处理。
   */
  private async deleteClips(fileNames: readonly string[]): Promise<void> {
    if (!this.projectDir || this.busy || fileNames.length === 0) return
    const target = fileNames.length === 1 ? fileNames[0]! : `${fileNames.length} 个片段`
    this.busy = true
    this.message = `正在删除：${target}`
    this.render()
    try {
      for (const fileName of fileNames) {
        await window.petalive.import.deleteClip(this.projectDir, fileName)
      }
      this.projectData = await window.petalive.import.loadProject(this.projectDir)
      this.message = `已删除：${target}`
    } catch (err) {
      this.message = `删除失败：${errorMessage(err)}`
    } finally {
      this.busy = false
      this.render()
    }
  }

  /**
   * 根据是否已选择项目渲染入口或动作清单。
   * 页面没有 video/canvas 元素，因此不会触发任何媒体读取；
   * 预览播放发生在桌面宠物窗口中。
   */
  private render(): void {
    // 整页重渲染发生在导入/删除之后，保留滚动位置避免每次跳回顶部。
    const previousScroll = this.container.querySelector('main.direct-import')?.scrollTop ?? 0
    this.container.innerHTML = ''
    const root = element('main', 'direct-import')
    root.appendChild(this.renderHeader())
    if (this.message) root.appendChild(element('div', 'direct-message', this.message))
    root.appendChild(this.projectData ? this.renderActionList() : this.renderProjectChooser())
    this.container.appendChild(root)
    root.scrollTop = previousScroll
  }

  /**
   * 渲染标题和当前项目路径。
   * 文案明确说明程序只复制文件，不处理视频。
   */
  private renderHeader(): HTMLElement {
    const header = element('header', 'direct-header')
    header.appendChild(element('h1', '', '直接导入视频片段'))
    header.appendChild(element(
      'p',
      '',
      '片段必须已由专业工具制作完成。PetAliveTools 只原样复制并直接播放，不抠像、不裁剪、不转码。',
    ))
    if (this.projectDir) header.appendChild(element('code', '', this.projectDir))
    return header
  }

  /**
   * 渲染选择或创建项目的两个入口。
   * 项目选择只涉及目录配置，不涉及视频处理。
   */
  private renderProjectChooser(): HTMLElement {
    const panel = element('section', 'direct-panel')
    panel.appendChild(element('h2', '', '选择宠物项目'))
    panel.appendChild(button('打开现有项目', () => void this.chooseProject()))
    panel.appendChild(button('创建新项目', () => void this.createProject()))
    return panel
  }

  /**
   * 按行为类别展示直接导入按钮与已导入数量。
   * 左右方向仅决定文件名中的动作映射，不会对画面做镜像。
   * C 类无固定清单条目：渲染自定义动作名输入 + sig_ 导入入口。
   */
  private renderActionList(): HTMLElement {
    const wrapper = element('div', 'direct-categories')
    const switchButton = button('切换项目', () => void this.chooseProject())
    switchButton.className = 'direct-switch'
    wrapper.appendChild(switchButton)

    for (const category of SHOOTING_CATEGORIES) {
      const section = element('section', 'direct-panel')
      section.appendChild(element('h2', '', category.label))
      section.appendChild(element('p', 'direct-subtitle', category.subtitle))
      if (category.id === 'C') {
        section.appendChild(this.renderSignatureImport())
      } else {
        for (const item of SHOOTING_LIST.filter(
          (candidate) => candidate.category === category.id,
        )) {
          section.appendChild(this.renderActionRow(item))
        }
      }
      wrapper.appendChild(section)
    }

    const unrecognized = this.renderUnrecognizedSection()
    if (unrecognized) wrapper.appendChild(unrecognized)
    return wrapper
  }

  /**
   * 渲染无法识别的视频文件清理区。
   * 这些文件的命名不在当前动作清单内（典型来源：状态已从清单移除的
   * 旧片段），调度器不会播放它们；仅提供删除入口，不提供重命名映射。
   */
  private renderUnrecognizedSection(): HTMLElement | null {
    const files = this.projectData?.unrecognizedVideos ?? []
    if (files.length === 0) return null

    const section = element('section', 'direct-panel')
    section.appendChild(element('h2', '', `无法识别的片段文件（${files.length} 个）`))
    section.appendChild(
      element(
        'p',
        'direct-subtitle',
        '以下视频文件的命名不在当前动作清单内，不会被调度播放。它们通常是动作清单调整后遗留的旧片段，可删除清理。',
      ),
    )
    const list = element('div', 'direct-clips')
    for (const fileName of files) {
      const line = element('div', 'direct-clip-line')
      line.appendChild(element('code', '', fileName))
      const remove = button('删除', () => void this.deleteClips([fileName]))
      remove.className = 'direct-danger'
      remove.disabled = this.busy
      line.appendChild(remove)
      list.appendChild(line)
    }
    if (files.length > 1) {
      const removeAll = button(`全部删除（${files.length} 个）`, () => {
        if (window.confirm(`确定删除全部 ${files.length} 个无法识别的片段文件吗？`)) {
          void this.deleteClips(files)
        }
      })
      removeAll.className = 'direct-danger direct-remove-all'
      removeAll.disabled = this.busy
      list.appendChild(removeAll)
    }
    section.appendChild(list)
    return section
  }

  /**
   * 渲染 C 类自定义招牌动作导入区。
   * 用户输入动作名，文件以 sig_<名称> 状态键原样复制；
   * 已导入的招牌动作按状态分组展示，可删除或预览。
   */
  private renderSignatureImport(): HTMLElement {
    const wrap = element('div', 'direct-item')
    const row = element('div', 'direct-row')
    const input = document.createElement('input')
    input.type = 'text'
    input.placeholder = '动作名称（如 backflip）'
    input.className = 'direct-input'
    input.disabled = this.busy
    row.appendChild(input)
    const importButton = button('选择并导入', () => void this.importSignatureClip(input.value))
    importButton.disabled = this.busy
    row.appendChild(importButton)
    wrap.appendChild(row)
    wrap.appendChild(
      element(
        'p',
        'direct-subtitle',
        '招牌动作以 sig_<名称> 记录，播放时走短淡入淡出，低频随机触发增添灵动感。',
      ),
    )

    const signatureClips = this.projectData?.clips.filter((clip) => clip.signature) ?? []
    const byState = new Map<string, ClipMeta[]>()
    for (const clip of signatureClips) {
      const group = byState.get(clip.state) ?? []
      group.push(clip)
      byState.set(clip.state, group)
    }
    for (const [state, clips] of byState) {
      const group = element('div', 'direct-clips')
      group.appendChild(element('strong', '', state))
      group.appendChild(this.renderClipList({ state, label: state } as ShootingListItem, clips))
      wrap.appendChild(group)
    }
    return wrap
  }

  /**
   * 渲染单个动作的方向选择、导入按钮和已导入片段删除列表。
   * 过渡动作额外提供起点/终点姿态选择，端点编码进文件名状态段
   * （如 transition_sit_to_stand），供锚定中转机制查找 (§8.1/§8.2)。
   * 视频文件在用户确认前不会被页面打开。
   */
  private renderActionRow(item: ShootingListItem): HTMLElement {
    const wrap = element('div', 'direct-item')
    const row = element('div', 'direct-row')
    const info = element('div', 'direct-info')
    info.appendChild(element('strong', '', item.label))
    info.appendChild(element('span', '', item.description))
    const clips = this.projectData?.clips.filter((clip) => clip.state === item.state) ?? []
    info.appendChild(
      element('small', '', `已导入 ${clips.length} 个片段 · 建议 ${variantSuggestionText(item)}`),
    )
    const tags = element('div', 'direct-tags')
    if (item.startupSet) tags.appendChild(tag('最小启动集'))
    if (item.loop) tags.appendChild(tag('循环播放'))
    if (tags.childElementCount > 0) info.appendChild(tags)
    row.appendChild(info)

    // 过渡片段：选择起点/终点姿态，组合成端点状态键
    let transitionFrom: TransitionEndpoint = 'sit'
    let transitionTo: TransitionEndpoint = 'stand'
    if (item.state === 'transition') {
      const fromSelect = document.createElement('select')
      for (const option of TRANSITION_ENDPOINT_OPTIONS) {
        fromSelect.append(new Option(`起点：${option.label}`, option.value))
      }
      fromSelect.addEventListener('change', () => {
        transitionFrom = fromSelect.value as TransitionEndpoint
      })
      const toSelect = document.createElement('select')
      for (const option of TRANSITION_ENDPOINT_OPTIONS) {
        toSelect.append(new Option(`终点：${option.label}`, option.value))
      }
      toSelect.addEventListener('change', () => {
        transitionTo = toSelect.value as TransitionEndpoint
      })
      row.appendChild(fromSelect)
      row.appendChild(toSelect)
    }

    let direction: ClipDirection = 'none'
    if (item.direction === 'left-right' || item.direction === 'both') {
      const select = document.createElement('select')
      select.append(new Option('向左片段', 'left'), new Option('向右片段', 'right'))
      direction = 'left'
      select.addEventListener('change', () => {
        direction = select.value as ClipDirection
      })
      row.appendChild(select)
    }

    const importButton = button('选择并导入', () => {
      const stateKey =
        item.state === 'transition' ? transitionKey(transitionFrom, transitionTo) : item.state
      const label =
        item.state === 'transition' ? `${item.label}（${transitionFrom}→${transitionTo}）` : item.label
      void this.importClip(stateKey, direction, label)
    })
    importButton.disabled = this.busy
    row.appendChild(importButton)
    wrap.appendChild(row)

    if (clips.length > 0) wrap.appendChild(this.renderClipList(item, clips))
    return wrap
  }

  /**
   * 渲染单个动作下已导入片段的删除列表。
   * 列表展示 clips/ 中的真实文件名；预览按钮请求主进程让桌面宠物
   * 按运行时链路播放该片段（调试用），删除按钮只移除对应文件。
   */
  private renderClipList(item: ShootingListItem, clips: readonly ClipMeta[]): HTMLElement {
    const list = element('div', 'direct-clips')
    for (const clip of clips) {
      const line = element('div', 'direct-clip-line')
      line.appendChild(element('code', '', clip.fileName))
      const preview = button('预览', () => void this.previewClip(clip))
      preview.disabled = this.busy
      line.appendChild(preview)
      const remove = button('删除', () => void this.deleteClips([clip.fileName]))
      remove.className = 'direct-danger'
      remove.disabled = this.busy
      line.appendChild(remove)
      list.appendChild(line)
    }
    if (clips.length > 1) {
      const removeAll = button(`全部删除（${clips.length} 个）`, () => {
        if (window.confirm(`确定删除「${item.label}」的全部 ${clips.length} 个片段吗？`)) {
          void this.deleteClips(clips.map((clip) => clip.fileName))
        }
      })
      removeAll.className = 'direct-danger direct-remove-all'
      removeAll.disabled = this.busy
      list.appendChild(removeAll)
    }
    return list
  }

  /**
   * 请求主进程让桌面宠物播放该片段（调试预览）。
   * 页面本身不加载视频；播放发生在宠物窗口的原生 <video> 中，
   * 与正常运行时的调度播放走完全相同的链路。
   */
  private async previewClip(clip: ClipMeta): Promise<void> {
    if (!this.projectDir) return
    try {
      const error = await window.petalive.import.previewClip(this.projectDir, clip.fileName)
      this.message = error ?? `正在桌面预览：${clip.fileName}`
    } catch (err) {
      this.message = `预览失败：${errorMessage(err)}`
    }
    this.render()
  }

  /**
   * 注入直接导入窗口的局部样式。
   * 样式不包含视频预览、画布或处理参数控件。
   */
  private injectStyles(): void {
    if (document.getElementById('direct-import-style')) return
    const style = document.createElement('style')
    style.id = 'direct-import-style'
    style.textContent = `
      body { margin: 0; background: #17191f; color: #eef1f6; font-family: system-ui, sans-serif; }
      /* index.html 已固定 html/body overflow:hidden，滚动在本容器内进行 */
      .direct-import { max-width: 980px; margin: 0 auto; padding: 28px; height: 100%; box-sizing: border-box; overflow-y: auto; }
      .direct-header { margin-bottom: 22px; }
      .direct-header h1 { margin: 0 0 8px; font-size: 26px; }
      .direct-header p { color: #b9c0cc; line-height: 1.7; }
      .direct-header code { display: block; color: #8ed0ff; word-break: break-all; }
      .direct-message { margin: 14px 0; padding: 10px 12px; background: #253247; border-radius: 7px; }
      .direct-panel { margin: 14px 0; padding: 18px; background: #22252d; border: 1px solid #343945; border-radius: 10px; }
      .direct-panel h2 { margin: 0 0 6px; font-size: 18px; }
      .direct-subtitle { margin: 0 0 12px; color: #929baa; }
      .direct-row { display: flex; flex-wrap: wrap; gap: 12px; align-items: center; padding: 12px 0; border-top: 1px solid #343945; }
      .direct-row .direct-info { flex: 1 1 260px; min-width: 0; }
      .direct-input { border: 1px solid #4a5363; border-radius: 6px; background: #1c1f26; color: #f3f5f8; padding: 8px 12px; flex: 1 1 200px; }
      .direct-info { display: flex; flex-direction: column; gap: 3px; }
      .direct-info span, .direct-info small { color: #9da6b5; }
      .direct-tags { display: flex; gap: 6px; margin-top: 2px; }
      .direct-tag { font-size: 11px; line-height: 1.6; padding: 0 8px; border-radius: 999px; background: #263349; border: 1px solid #3b5170; color: #9fc1ff; }
      .direct-clips { display: flex; flex-direction: column; gap: 6px; padding: 2px 0 14px; }
      .direct-clip-line { display: grid; grid-template-columns: minmax(0, 1fr) auto auto; gap: 12px; align-items: center; background: #1c1f26; border: 1px solid #303542; border-radius: 7px; padding: 6px 10px; }
      .direct-clip-line code { color: #8ed0ff; word-break: break-all; font-size: 12px; }
      .direct-clips button { margin-right: 0; padding: 5px 10px; font-size: 12px; }
      .direct-remove-all { align-self: flex-end; }
      .direct-danger { background: #45252d; border-color: #7c3a44; color: #f3c5cd; }
      .direct-danger:hover:enabled { background: #5a3039; }
      button, select { border: 1px solid #4a5363; border-radius: 6px; background: #343b49; color: #f3f5f8; padding: 8px 12px; cursor: pointer; }
      button { margin-right: 8px; }
      button:disabled { opacity: .5; cursor: wait; }
      .direct-switch { margin-bottom: 8px; }
    `
    document.head.appendChild(style)
  }
}

/**
 * 创建带类名和可选文本的 DOM 元素。
 * 该辅助函数只用于静态导入界面。
 */
function element(tag: string, className: string, text?: string): HTMLElement {
  const node = document.createElement(tag)
  node.className = className
  if (text !== undefined) node.textContent = text
  return node
}

/**
 * 创建按钮并绑定点击回调。
 * 回调只会触发项目选择、原样文件复制或桌面调试预览。
 */
function button(label: string, onClick: () => void): HTMLButtonElement {
  const node = document.createElement('button')
  node.type = 'button'
  node.textContent = label
  node.addEventListener('click', onClick)
  return node
}

/**
 * 创建静态信息标签（最小启动集 / 循环播放）。
 * 标签只是清单数据的展示，不承载交互。
 */
function tag(label: string): HTMLElement {
  return element('span', 'direct-tag', label)
}

/**
 * 将未知异常转换为用户可读文本。
 * 不暴露额外媒体诊断或处理建议。
 */
function errorMessage(value: unknown): string {
  return value instanceof Error ? value.message : String(value)
}

/**
 * 渲染进程入口使用的挂载函数。
 * 返回实例供开发控制台查看当前项目状态。
 */
export function mountImportWizard(container: HTMLElement): ImportWizard {
  return new ImportWizard(container)
}
