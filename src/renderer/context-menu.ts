/**
 * 右键上下文菜单渲染视图 (§10)
 *
 * 宠物窗口右键 / 托盘右键共用的自定义菜单（#context-menu 视图，
 * 由主进程 input/context-menu 控制器弹出的无边框透明小窗口）：
 *   - 宠物模式：照料三宫格（喂食/给玩具/喝水）+ 功能项列表
 *   - 托盘模式（mode=tray）：追加宠物列表（切换/两步确认删除）、
 *     导入导出宠物、隐藏/展示与退出
 *
 * 静态状态（静音/可见性/宠物列表）经 URL hash 查询参数注入，打开时定型；
 * 选择经 input:menu-select 回传主进程，挂载后经 input:menu-size 回报
 * 实际内容高度（主进程据此定位并显示窗口），Esc 或点击窗口内空白区请求关闭。
 *
 * 运行于渲染进程（菜单窗口）。
 */

/** 照料动作按钮配置（顺序即展示顺序，两种模式共用） */
const CARE_ACTIONS = [
  { action: 'feed', icon: '🍖', label: '喂食' },
  { action: 'toy', icon: '🧸', label: '给玩具' },
  { action: 'drink', icon: '💧', label: '喝水' },
] as const

/** 菜单窗口宽度（与主进程 CONTEXT_MENU_WINDOW_WIDTH 一致：面板 208 + 边距 32） */
const MENU_WINDOW_WIDTH = 240
/** 面板四周透明边距（容纳投影），高度回报时补回 */
const PANEL_MARGIN = 32
/** 尺寸回报冗余 (px)：吸收不同字体/DPI 下的行高小数，避免重设后 0.x px 溢出 */
const SIZE_SLACK_PX = 2

/** 托盘模式的宠物条目（由主进程注入的 JSON 解析而来） */
interface PetEntry {
  id: string
  name: string
}

/** hash 查询参数解析结果 */
interface MenuParams {
  muted: boolean
  mode: 'pet' | 'tray'
  visible: boolean
  active: string | null
  pets: PetEntry[]
}

/** 从 hash 中解析菜单参数（#context-menu?mode=tray&muted=1&…） */
function parseParams(): MenuParams {
  const hash = window.location.hash.replace(/^#/, '')
  const query = new URLSearchParams(hash.split('?')[1] ?? '')
  let pets: PetEntry[] = []
  try {
    const raw = query.get('pets')
    const parsed = raw ? (JSON.parse(raw) as unknown) : []
    if (Array.isArray(parsed)) {
      pets = parsed.filter(
        (p): p is PetEntry =>
          typeof p === 'object' && p !== null && typeof p.id === 'string' && typeof p.name === 'string',
      )
    }
  } catch {
    pets = []
  }
  const active = query.get('active')
  return {
    muted: query.get('muted') === '1',
    mode: query.get('mode') === 'tray' ? 'tray' : 'pet',
    visible: query.get('visible') === '1',
    active: active ? active : null,
    pets,
  }
}

/** 两步删除确认的停留时间 (ms)：超时未确认则复位 */
const DELETE_CONFIRM_RESET_MS = 2500

/**
 * 渲染进程入口使用的挂载函数。
 * 返回清理函数供测试/调试使用。
 */
export function mountContextMenu(container: HTMLElement): () => void {
  const params = parseParams()

  const panel = document.createElement('div')
  panel.className = 'cm-panel'

  // —— 照料动作三宫格（共用） —— //
  const care = document.createElement('div')
  care.className = 'cm-care'
  for (const item of CARE_ACTIONS) {
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.className = 'cm-care-btn'
    btn.dataset.action = item.action
    const icon = document.createElement('span')
    icon.className = 'cm-care-icon'
    icon.textContent = item.icon
    const label = document.createElement('span')
    label.className = 'cm-care-label'
    label.textContent = item.label
    btn.append(icon, label)
    care.appendChild(btn)
  }
  panel.appendChild(care)
  panel.appendChild(separator())

  // —— 功能项列表 —— //
  const baseRows: Array<{ action: string; icon: string; label: string }> = [
    { action: 'call', icon: '📢', label: '呼唤' },
    { action: 'toggle-mute', icon: params.muted ? '🔊' : '🔇', label: params.muted ? '取消静音' : '静音' },
  ]
  if (params.mode === 'tray') {
    // 托盘模式：隐藏/展示随宠物窗口可见性切换标签；导入向导归入本组
    baseRows.push({ action: 'hide', icon: params.visible ? '🌙' : '☀️', label: params.visible ? '隐藏' : '展示' })
    baseRows.push({ action: 'import', icon: '📥', label: '导入片段…' })
  }
  for (const row of baseRows) panel.appendChild(menuRow(row))

  if (params.mode === 'tray') {
    panel.appendChild(separator())
    panel.appendChild(sectionLabel('宠物'))
    if (params.pets.length === 0) {
      const empty = menuRow({ action: '', icon: '', label: '暂无宠物' })
      empty.classList.add('cm-item-disabled')
      panel.appendChild(empty)
    } else {
      const deletable = params.pets.length > 1
      for (const pet of params.pets) {
        panel.appendChild(petRow(pet, pet.id === params.active, deletable))
      }
    }
    const activeName = params.pets.find((p) => p.id === params.active)?.name
    if (activeName) {
      panel.appendChild(menuRow({ action: 'export-pet', icon: '📤', label: `导出「${activeName}」…` }))
    }
    panel.appendChild(menuRow({ action: 'import-pet', icon: '🧳', label: '导入宠物…' }))

    panel.appendChild(separator())
    panel.appendChild(menuRow({ action: 'settings', icon: '⚙️', label: '设置' }))
    panel.appendChild(menuRow({ action: 'about', icon: 'ℹ️', label: '关于' }))
    panel.appendChild(separator())
    const quit = menuRow({ action: 'quit', icon: '🚪', label: '退出' })
    quit.classList.add('cm-item-danger')
    panel.appendChild(quit)
  } else {
    panel.appendChild(separator())
    panel.appendChild(menuRow({ action: 'import', icon: '📥', label: '导入片段…' }))
    panel.appendChild(menuRow({ action: 'hide', icon: '🌙', label: '隐藏' }))
    panel.appendChild(menuRow({ action: 'settings', icon: '⚙️', label: '设置' }))
    panel.appendChild(separator())
    panel.appendChild(menuRow({ action: 'about', icon: 'ℹ️', label: '关于' }))
  }

  container.appendChild(panel)
  injectStyles()

  // —— 事件路由（全部转发主进程，本视图不直接执行动作） —— //
  const onSelect = (e: Event): void => {
    const target = (e.target as HTMLElement | null)?.closest<HTMLElement>('[data-action]')
    if (target?.dataset.action) window.petalive?.input?.menuSelect(target.dataset.action)
  }
  // 点击面板外透明边距（窗口内空白）→ 请求关闭
  const onOutside = (e: MouseEvent): void => {
    if (!(e.target as HTMLElement | null)?.closest('.cm-panel')) {
      window.petalive?.input?.menuClose()
    }
  }
  const onKeyDown = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') window.petalive?.input?.menuClose()
  }

  panel.addEventListener('click', onSelect)
  container.addEventListener('mousedown', onOutside)
  document.addEventListener('keydown', onKeyDown)

  // —— 尺寸回报：挂载布局完成后上报实际内容高度，主进程据此重设窗口并显示 —— //
  requestAnimationFrame(() => {
    // 抬起 max-height 测「自然高度」：窗口尚处占位尺寸时面板会被
    // max-height 钳制，直接量 offsetHeight 会误报占位高度、窗口永远不长高
    panel.style.maxHeight = 'none'
    const height = Math.ceil(panel.offsetHeight) + PANEL_MARGIN + SIZE_SLACK_PX
    panel.style.maxHeight = ''
    window.petalive?.input?.menuSize(MENU_WINDOW_WIDTH, height)
  })

  return () => {
    panel.removeEventListener('click', onSelect)
    container.removeEventListener('mousedown', onOutside)
    document.removeEventListener('keydown', onKeyDown)
    panel.remove()
  }
}

/** 功能列表行（图标 + 标签） */
function menuRow(row: { action: string; icon: string; label: string }): HTMLElement {
  const btn = document.createElement('button')
  btn.type = 'button'
  btn.className = 'cm-item'
  if (row.action) btn.dataset.action = row.action
  const icon = document.createElement('span')
  icon.className = 'cm-item-icon'
  icon.textContent = row.icon
  const label = document.createElement('span')
  label.className = 'cm-item-label'
  label.textContent = row.label
  btn.append(icon, label)
  return btn
}

/** 区段小标题（如「宠物」） */
function sectionLabel(text: string): HTMLElement {
  const el = document.createElement('div')
  el.className = 'cm-section'
  el.textContent = text
  return el
}

/**
 * 宠物行：名称区点击切换；多于一只时右侧悬停出现 ✕（两步确认后删除）。
 * 两步确认在首次点击 ✕ 时进入（按钮变为「确认」），超时自动复位。
 */
function petRow(pet: PetEntry, active: boolean, deletable: boolean): HTMLElement {
  const row = document.createElement('div')
  row.className = 'cm-pet' + (active ? ' cm-pet-active' : '')

  const main = document.createElement('button')
  main.type = 'button'
  main.className = 'cm-pet-main'
  main.dataset.action = `switch:${pet.id}`
  const dot = document.createElement('span')
  dot.className = 'cm-pet-dot'
  dot.textContent = active ? '●' : '○'
  const name = document.createElement('span')
  name.className = 'cm-pet-name'
  name.textContent = pet.name
  main.append(dot, name)
  row.appendChild(main)

  if (deletable) {
    const del = document.createElement('button')
    del.type = 'button'
    del.className = 'cm-pet-del'
    del.textContent = '✕'
    del.title = '删除这只宠物'
    let confirming = false
    let resetTimer: number | undefined
    del.addEventListener('click', (e) => {
      // 两步确认：第一次点击仅进入确认态，不冒泡到菜单选择
      e.stopPropagation()
      if (!confirming) {
        confirming = true
        row.classList.add('cm-del-confirming')
        del.textContent = '确认'
        resetTimer = window.setTimeout(() => {
          confirming = false
          row.classList.remove('cm-del-confirming')
          del.textContent = '✕'
        }, DELETE_CONFIRM_RESET_MS)
        return
      }
      window.clearTimeout(resetTimer)
      window.petalive?.input?.menuSelect(`delete:${pet.id}`)
    })
    row.appendChild(del)
  }
  return row
}

/** 分隔线 */
function separator(): HTMLElement {
  const sep = document.createElement('div')
  sep.className = 'cm-sep'
  return sep
}

/**
 * 注入菜单局部样式（深色玻璃拟态，配色与导入向导同系）。
 * 面板四周 16px 为窗口透明边距，供投影绘制；内容超高时面板内部
 * 可滚动但滚动条永不显示。
 */
function injectStyles(): void {
  if (document.getElementById('petalive-context-menu-style')) return
  const style = document.createElement('style')
  style.id = 'petalive-context-menu-style'
  style.textContent = `
    body { user-select: none; cursor: default; }
    .cm-panel {
      box-sizing: border-box;
      margin: 16px;
      width: calc(100% - 32px);
      max-height: calc(100vh - 32px);
      overflow-y: auto;
      /* 永不显示滚动条：极端超高（宠物多于屏高）时滚轮仍可滚动，但不画滚动条 UI */
      scrollbar-width: none;
      padding: 12px;
      background: rgba(23, 25, 31, 0.92);
      border: 1px solid rgba(255, 255, 255, 0.09);
      border-radius: 12px;
      box-shadow: 0 16px 40px rgba(0, 0, 0, 0.5), 0 2px 8px rgba(0, 0, 0, 0.35);
      font-family: system-ui, 'Segoe UI', sans-serif;
      color: #eef1f6;
      animation: cm-enter 140ms cubic-bezier(0.2, 0.9, 0.3, 1.2);
      transform-origin: 0 0;
    }
    @keyframes cm-enter {
      from { opacity: 0; transform: scale(0.94); }
      to { opacity: 1; transform: scale(1); }
    }
    /* Electron/Chromium：隐藏面板滚动条（配合 scrollbar-width: none） */
    .cm-panel::-webkit-scrollbar {
      display: none;
    }
    /* 全局按钮重置（本视图独占菜单窗口）：元素选择器优先级低于项类，
       项类的 padding 不会被覆盖 */
    button {
      font: inherit;
      color: inherit;
      border: none;
      background: none;
      padding: 0;
      cursor: pointer;
    }
    .cm-panel button:focus-visible {
      outline: 2px solid #8ed0ff;
      outline-offset: 1px;
    }
    /* —— 照料动作三宫格 —— */
    .cm-care {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 8px;
    }
    .cm-care-btn {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 7px;
      padding: 11px 0 9px;
      border-radius: 10px;
      background: rgba(255, 255, 255, 0.05);
      border: 1px solid rgba(255, 255, 255, 0.06);
      transition: background 120ms ease, transform 120ms ease, border-color 120ms ease;
    }
    .cm-care-btn:hover {
      background: rgba(255, 255, 255, 0.13);
      border-color: rgba(255, 255, 255, 0.14);
      transform: translateY(-1px);
    }
    .cm-care-btn:active { transform: translateY(0) scale(0.97); }
    .cm-care-icon { font-size: 23px; line-height: 1; }
    .cm-care-label { font-size: 12px; color: #c6ccd8; }
    .cm-care-btn:hover .cm-care-label { color: #f3f5f8; }
    /* —— 功能项列表 —— */
    .cm-item {
      display: flex;
      align-items: center;
      gap: 10px;
      width: 100%;
      height: 30px;
      padding: 0 10px;
      border-radius: 8px;
      font-size: 13px;
      transition: background 100ms ease;
    }
    .cm-item:hover { background: rgba(255, 255, 255, 0.09); }
    .cm-item:active { background: rgba(255, 255, 255, 0.14); }
    .cm-item-icon { font-size: 14px; line-height: 1; }
    .cm-item-label { color: #d8dde6; }
    .cm-item:hover .cm-item-label { color: #f3f5f8; }
    .cm-item.cm-item-disabled { opacity: 0.45; cursor: default; }
    .cm-item.cm-item-disabled:hover { background: none; }
    .cm-item.cm-item-danger .cm-item-label { color: #f3b8c0; }
    .cm-item.cm-item-danger:hover { background: rgba(220, 76, 92, 0.18); }
    .cm-sep {
      height: 1px;
      margin: 6px 10px;
      background: rgba(255, 255, 255, 0.08);
    }
    .cm-section {
      margin: 2px 10px 4px;
      font-size: 11px;
      letter-spacing: 1px;
      color: #8a93a3;
    }
    /* —— 托盘模式宠物行 —— */
    .cm-pet {
      display: flex;
      align-items: center;
      gap: 6px;
      border-radius: 8px;
      transition: background 100ms ease;
    }
    .cm-pet:hover { background: rgba(255, 255, 255, 0.07); }
    .cm-pet-main {
      display: flex;
      flex: 1 1 auto;
      align-items: center;
      gap: 10px;
      min-width: 0;
      height: 30px;
      padding: 0 10px 0 12px;
      border-radius: 8px;
      font-size: 13px;
      text-align: left;
    }
    .cm-pet-dot { font-size: 10px; color: #5a6373; }
    .cm-pet.cm-pet-active .cm-pet-dot { color: #8ed0ff; }
    .cm-pet-name {
      color: #d8dde6;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .cm-pet.cm-pet-active .cm-pet-name { color: #f3f5f8; }
    .cm-pet-del {
      flex: 0 0 auto;
      margin-right: 8px;
      padding: 3px 7px;
      border-radius: 6px;
      font-size: 11px;
      color: #7c4a52;
      opacity: 0;
      transition: opacity 100ms ease, background 100ms ease, color 100ms ease;
    }
    .cm-pet:hover .cm-pet-del { opacity: 1; }
    .cm-pet-del:hover { color: #f3b8c0; background: rgba(220, 76, 92, 0.2); }
    .cm-pet.cm-del-confirming .cm-pet-del {
      opacity: 1;
      color: #ff9aa6;
      background: rgba(220, 76, 92, 0.3);
    }
  `
  document.head.appendChild(style)
}
