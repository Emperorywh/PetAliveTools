/**
 * 设置面板 UI (settings panel) — §12.4
 *
 * 提供：显示器选择、音量、节律频率、性格 5 维滑杆、
 * 开机自启开关、快捷键配置。
 *
 * 通过 IPC 与主进程通信（SettingsBridge），所有设置持久化到
 * behavior-config.json / persona.json。
 *
 * 运行于渲染进程。
 */

import type { ShellSettings } from '../../shared/types/behavior-config'
import type { Personality } from '../../shared/types/persona'

/** 性格 5 维标签 */
const PERSONALITY_DIMS: ReadonlyArray<{ key: keyof Personality; label: string; desc: string }> = [
  { key: 'liveliness', label: '活泼', desc: '↑→ walk/play 权重↑' },
  { key: 'laziness', label: '慵懒', desc: '↑→ sleep/lie 权重↑' },
  { key: 'clinginess', label: '粘人', desc: '↑→ 抚摸愉悦↑' },
  { key: 'timidity', label: '胆小', desc: '↑→ 更快回静止态' },
  { key: 'curiosity', label: '好奇', desc: '↑→ 稀有动作概率↑' },
]

/**
 * 挂载设置面板到指定容器元素。
 */
export function mountSettingsPanel(container: HTMLElement): SettingsPanel {
  const panel = new SettingsPanelImpl(container)
  void panel.init()
  return panel
}

/** 设置面板实例 */
export interface SettingsPanel {
  dispose(): void
}

interface DisplayOption {
  id: number
  label: string
  isPrimary: boolean
  scaleFactor: number
}

class SettingsPanelImpl implements SettingsPanel {
  private shell: ShellSettings | null = null
  private personality: Personality | null = null
  private displays: DisplayOption[] = []
  private hotkeyCaptureActive = false

  constructor(private readonly container: HTMLElement) {}

  async init(): Promise<void> {
    this.container.innerHTML = ''

    const bridge = window.petalive?.settings
    if (!bridge) {
      this.container.textContent = '设置接口不可用'
      return
    }

    // 并行加载所有数据
    const [shell, personality, displays] = await Promise.all([
      bridge.getShellSettings(),
      bridge.getPersonality(),
      bridge.getDisplays(),
    ])
    this.shell = shell
    this.personality = personality
    this.displays = displays

    this.render()
  }

  dispose(): void {
    this.container.innerHTML = ''
  }

  private render(): void {
    if (!this.shell || !this.personality) return

    const root = document.createElement('div')
    root.className = 'settings-root'

    root.appendChild(this.createHeader())
    root.appendChild(this.createDisplaySection())
    root.appendChild(this.createAudioSection())
    root.appendChild(this.createPersonalitySection())
    root.appendChild(this.createShellSection())

    this.container.innerHTML = ''
    this.container.appendChild(root)
  }

  // —— 标题 —— //

  private createHeader(): HTMLElement {
    const header = document.createElement('h1')
    header.textContent = '设置'
    header.className = 'settings-header'
    return header
  }

  // —— 显示器 —— //

  private createDisplaySection(): HTMLElement {
    const section = this.createSection('显示器 (§6.4)')

    const select = document.createElement('select')
    select.className = 'settings-select'

    // 主显示器选项
    const primaryOpt = document.createElement('option')
    primaryOpt.value = ''
    primaryOpt.textContent = '主显示器'
    select.appendChild(primaryOpt)

    for (const d of this.displays) {
      const opt = document.createElement('option')
      opt.value = String(d.id)
      opt.textContent = `${d.label} (${d.scaleFactor}×)`
      select.appendChild(opt)
    }

    if (this.shell!.displayId !== null) {
      select.value = String(this.shell!.displayId)
    }

    select.addEventListener('change', async () => {
      const id = select.value === '' ? null : Number(select.value)
      this.shell = await window.petalive!.settings!.updateShellSettings({ displayId: id })
    })

    const row = this.createRow('选择显示器', select)

    // DPI 信息
    const selectedDisplay = this.displays.find((d) => d.id === this.shell!.displayId) ?? this.displays.find((d) => d.isPrimary)
    const dpiInfo = document.createElement('p')
    dpiInfo.className = 'settings-hint'
    dpiInfo.textContent = selectedDisplay
      ? `系统缩放因子 ${selectedDisplay.scaleFactor}×；视频仍按原文件直接播放`
      : ''

    section.appendChild(row)
    section.appendChild(dpiInfo)
    return section
  }

  // —— 音频 —— //

  private createAudioSection(): HTMLElement {
    const section = this.createSection('音频 (§11)')

    const volumeSlider = this.createSlider({
      label: '音量',
      min: 0,
      max: 100,
      step: 5,
      value: Math.round(this.shell!.volume * 100),
      suffix: '%',
      onChange: async (val) => {
        this.shell = await window.petalive!.settings!.updateShellSettings({
          volume: val / 100,
        })
      },
    })

    const freqSlider = this.createSlider({
      label: '环境声频率',
      min: 10,
      max: 300,
      step: 10,
      value: Math.round(this.shell!.ambientFrequency * 100),
      suffix: '%',
      onChange: async (val) => {
        this.shell = await window.petalive!.settings!.updateShellSettings({
          ambientFrequency: val / 100,
        })
      },
    })

    section.appendChild(volumeSlider)
    section.appendChild(freqSlider)
    return section
  }

  // —— 性格 5 维 —— //

  private createPersonalitySection(): HTMLElement {
    const section = this.createSection('性格 (§9.6)')

    for (const dim of PERSONALITY_DIMS) {
      const slider = this.createSlider({
        label: `${dim.label}`,
        hint: dim.desc,
        min: 0,
        max: 100,
        step: 5,
        value: Math.round(this.personality![dim.key] * 100),
        suffix: '%',
        onChange: async (val) => {
          this.personality = await window.petalive!.settings!.updatePersonality({
            [dim.key]: val / 100,
          } as Partial<Personality>)
        },
      })
      section.appendChild(slider)
    }

    return section
  }

  // —— 自启 + 快捷键 —— //

  private createShellSection(): HTMLElement {
    const section = this.createSection('外壳 (§12.4)')

    // 自启开关
    const autoLaunchCheckbox = document.createElement('input')
    autoLaunchCheckbox.type = 'checkbox'
    autoLaunchCheckbox.checked = this.shell!.autoLaunch
    autoLaunchCheckbox.addEventListener('change', async () => {
      const enabled = autoLaunchCheckbox.checked
      this.shell = await window.petalive!.settings!.updateShellSettings({
        autoLaunch: enabled,
      })
      await window.petalive!.settings!.setAutoLaunch(enabled)
    })

    const autoLaunchRow = this.createRow('开机自启', autoLaunchCheckbox)
    section.appendChild(autoLaunchRow)

    // 快捷键配置
    const hotkeyInput = document.createElement('input')
    hotkeyInput.type = 'text'
    hotkeyInput.className = 'settings-input'
    hotkeyInput.value = this.shell!.hideHotkey
    hotkeyInput.readOnly = true
    hotkeyInput.placeholder = '点击捕获快捷键'

    const captureBtn = document.createElement('button')
    captureBtn.className = 'settings-btn'
    captureBtn.textContent = '重新绑定'
    captureBtn.addEventListener('click', () => {
      if (this.hotkeyCaptureActive) return
      this.hotkeyCaptureActive = true
      captureBtn.textContent = '按下快捷键…'
      hotkeyInput.value = '请按下快捷键…'

      const handler = async (e: KeyboardEvent): Promise<void> => {
        e.preventDefault()
        e.stopPropagation()

        if (e.key === 'Escape') {
          cleanup()
          hotkeyInput.value = this.shell!.hideHotkey
          return
        }

        const accelerator = keyboardEventToAccelerator(e)
        if (!accelerator) return

        cleanup()
        const result = await window.petalive!.settings!.rebindHotkey(accelerator)
        if (result.success) {
          this.shell = await window.petalive!.settings!.getShellSettings()
          hotkeyInput.value = this.shell!.hideHotkey
        } else {
          hotkeyInput.value = this.shell!.hideHotkey
          alert(`快捷键 ${accelerator} 注册失败（可能被其他应用占用）`)
        }
      }

      const cleanup = (): void => {
        this.hotkeyCaptureActive = false
        captureBtn.textContent = '重新绑定'
        document.removeEventListener('keydown', handler, true)
      }

      document.addEventListener('keydown', handler, true)
    })

    const hotkeyRow = this.createRow('隐藏快捷键 (§10)', hotkeyInput)
    const hotkeyBtnRow = document.createElement('div')
    hotkeyBtnRow.className = 'settings-row'
    hotkeyBtnRow.appendChild(captureBtn)

    section.appendChild(hotkeyRow)
    section.appendChild(hotkeyBtnRow)
    return section
  }

  // —— UI 辅助 —— //

  private createSection(title: string): HTMLElement {
    const section = document.createElement('section')
    section.className = 'settings-section'

    const h2 = document.createElement('h2')
    h2.textContent = title
    h2.className = 'settings-section-title'
    section.appendChild(h2)

    return section
  }

  private createRow(label: string, control: HTMLElement): HTMLElement {
    const row = document.createElement('div')
    row.className = 'settings-row'

    const labelEl = document.createElement('label')
    labelEl.textContent = label
    labelEl.className = 'settings-label'

    row.appendChild(labelEl)
    row.appendChild(control)
    return row
  }

  private createSlider(params: {
    label: string
    hint?: string
    min: number
    max: number
    step: number
    value: number
    suffix: string
    onChange: (val: number) => void | Promise<void>
  }): HTMLElement {
    const wrapper = document.createElement('div')
    wrapper.className = 'settings-slider-row'

    const labelEl = document.createElement('label')
    labelEl.className = 'settings-label'
    labelEl.textContent = params.label

    const valueDisplay = document.createElement('span')
    valueDisplay.className = 'settings-value'
    valueDisplay.textContent = `${params.value}${params.suffix}`

    const slider = document.createElement('input')
    slider.type = 'range'
    slider.min = String(params.min)
    slider.max = String(params.max)
    slider.step = String(params.step)
    slider.value = String(params.value)
    slider.className = 'settings-slider'

    let debounce: ReturnType<typeof setTimeout> | null = null
    slider.addEventListener('input', () => {
      const val = Number(slider.value)
      valueDisplay.textContent = `${val}${params.suffix}`
      if (debounce) clearTimeout(debounce)
      debounce = setTimeout(() => params.onChange(val), 200)
    })

    wrapper.appendChild(labelEl)
    wrapper.appendChild(slider)
    wrapper.appendChild(valueDisplay)

    if (params.hint) {
      const hint = document.createElement('p')
      hint.className = 'settings-hint'
      hint.textContent = params.hint
      wrapper.appendChild(hint)
    }

    return wrapper
  }
}

/**
 * 把 KeyboardEvent 转为 Electron accelerator 字符串。
 *
 * 支持 Ctrl/Cmd/Alt/Shift 修饰键 + 字母/数字/功能键。
 */
export function keyboardEventToAccelerator(e: KeyboardEvent): string | null {
  const parts: string[] = []

  if (e.ctrlKey || e.metaKey) parts.push('CommandOrControl')
  if (e.altKey) parts.push('Alt')
  if (e.shiftKey) parts.push('Shift')

  // 忽略纯修饰键按下
  const modifierKeys = ['Control', 'Meta', 'Alt', 'Shift']
  if (modifierKeys.includes(e.key)) return null

  // 功能键
  if (e.key.startsWith('F') && /^F\d+$/.test(e.key)) {
    parts.push(e.key)
    return parts.join('+')
  }

  // 字母/数字（空格单独映射为 Space）
  if (e.key.length === 1 && e.key !== ' ') {
    parts.push(e.key.toUpperCase())
    return parts.join('+')
  }

  // 其他特殊键（如 Arrow, Enter 等）
  const keyMap: Record<string, string> = {
    Enter: 'Return',
    Escape: 'Escape',
    ' ': 'Space',
    ArrowUp: 'Up',
    ArrowDown: 'Down',
    ArrowLeft: 'Left',
    ArrowRight: 'Right',
  }
  const mapped = keyMap[e.key]
  if (mapped) {
    parts.push(mapped)
    return parts.join('+')
  }

  return null
}
