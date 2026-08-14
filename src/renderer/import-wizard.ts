/**
 * 原样视频片段导入窗口。
 *
 * 用户只需选择动作和已制作完成的视频文件；窗口不会加载视频画面、
 * 抽取帧、预览抠像、设置裁剪或循环点，也不会发起转码。
 */

import type { ProjectData } from '../shared/types/project'
import type { ClipDirection } from '../shared/types/clip-meta'
import {
  SHOOTING_CATEGORIES,
  SHOOTING_LIST,
  type ShootingListItem,
} from '../shared/shooting-list'

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
   * 导入成功后重新扫描目录，使计数立即刷新。
   */
  private async importClip(item: ShootingListItem, direction: ClipDirection): Promise<void> {
    if (!this.projectDir || this.busy) return
    const sourcePath = await window.petalive.import.selectClip()
    if (!sourcePath) return

    this.busy = true
    this.message = '正在复制原始片段……'
    this.render()
    try {
      const result = await window.petalive.import.copyClip(this.projectDir, {
        sourcePath,
        state: item.state,
        direction,
      })
      this.projectData = await window.petalive.import.loadProject(this.projectDir)
      this.message = `已原样导入：${result.fileName}`
    } catch (err) {
      this.message = `导入失败：${errorMessage(err)}`
    } finally {
      this.busy = false
      this.render()
    }
  }

  /**
   * 根据是否已选择项目渲染入口或动作清单。
   * 页面没有 video/canvas 元素，因此不会触发任何媒体读取。
   */
  private render(): void {
    this.container.innerHTML = ''
    const root = element('main', 'direct-import')
    root.appendChild(this.renderHeader())
    if (this.message) root.appendChild(element('div', 'direct-message', this.message))
    root.appendChild(this.projectData ? this.renderActionList() : this.renderProjectChooser())
    this.container.appendChild(root)
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
      for (const item of SHOOTING_LIST.filter((candidate) => candidate.category === category.id)) {
        section.appendChild(this.renderActionRow(item))
      }
      wrapper.appendChild(section)
    }
    return wrapper
  }

  /**
   * 渲染单个动作的方向选择和导入按钮。
   * 视频文件在用户确认前不会被页面打开。
   */
  private renderActionRow(item: ShootingListItem): HTMLElement {
    const row = element('div', 'direct-row')
    const info = element('div', 'direct-info')
    info.appendChild(element('strong', '', item.label))
    info.appendChild(element('span', '', item.description))
    const count = this.projectData?.clips.filter((clip) => clip.state === item.state).length ?? 0
    info.appendChild(element('small', '', `已导入 ${count} 个片段`))
    row.appendChild(info)

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

    const importButton = button('选择并导入', () => void this.importClip(item, direction))
    importButton.disabled = this.busy
    row.appendChild(importButton)
    return row
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
      .direct-import { max-width: 980px; margin: 0 auto; padding: 28px; }
      .direct-header { margin-bottom: 22px; }
      .direct-header h1 { margin: 0 0 8px; font-size: 26px; }
      .direct-header p { color: #b9c0cc; line-height: 1.7; }
      .direct-header code { display: block; color: #8ed0ff; word-break: break-all; }
      .direct-message { margin: 14px 0; padding: 10px 12px; background: #253247; border-radius: 7px; }
      .direct-panel { margin: 14px 0; padding: 18px; background: #22252d; border: 1px solid #343945; border-radius: 10px; }
      .direct-panel h2 { margin: 0 0 6px; font-size: 18px; }
      .direct-subtitle { margin: 0 0 12px; color: #929baa; }
      .direct-row { display: grid; grid-template-columns: minmax(0, 1fr) auto auto; gap: 12px; align-items: center; padding: 12px 0; border-top: 1px solid #343945; }
      .direct-info { display: flex; flex-direction: column; gap: 3px; }
      .direct-info span, .direct-info small { color: #9da6b5; }
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
 * 回调只会触发项目选择或原样文件复制。
 */
function button(label: string, onClick: () => void): HTMLButtonElement {
  const node = document.createElement('button')
  node.type = 'button'
  node.textContent = label
  node.addEventListener('click', onClick)
  return node
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
