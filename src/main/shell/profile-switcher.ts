/**
 * 托盘 Profile 切换器 (§12.2)
 *
 * 负责：
 * - 托盘菜单回调契约（TrayMenuCallbacks，含宠物切换、导入/导出、删除）
 * - 编排 profile 操作（切换/导出/导入/删除）并通知宿主刷新运行时状态
 *
 * 托盘菜单 UI 由自定义 HTML 菜单窗口呈现（input/context-menu 控制器），
 * 本模块不再构建原生菜单模板。
 *
 * 本模块不依赖 Electron 运行时（对话框通过 FileDialogs 注入）。
 *
 * 运行于主进程。
 */

import type { ProfileSummary } from '../persistence/profiles'
import { ProfileManager } from '../persistence/profiles'
import {
  exportProjectToZip,
  importProjectFromZip,
  type ExportResult,
  type ImportResult,
} from '../persistence/backup'

/** 托盘菜单回调（由外壳接线，自定义菜单窗口按动作回传执行） */
export interface TrayMenuCallbacks {
  /** 喂食（触发 beg_food 讨食片段，D 类，饥饿↓） */
  onFeed: () => void
  /** 给玩具（触发 want_play 求玩片段，D 类，愉悦↑） */
  onToy: () => void
  /** 喂水（触发 drink 喝水片段，D 类；需求模型无口渴维度，轻度缓解饥饿） */
  onDrink: () => void
  /** 呼唤宠物（触发 called 被呼唤转身片段，B 类） */
  onCall: () => void
  /** 切换静音 (§11.2) */
  onToggleMute: () => void
  /** 暂时隐藏/展示（安全阀的另一入口，§10） */
  onToggleHide: () => void
  /** 设置面板 (§12.4) */
  onSettings: () => void
  /** 关于 */
  onAbout: () => void
  /** 退出应用（托盘菜单唯一常驻退出入口） */
  onQuit: () => void
  /** 切换活跃宠物 (§12.2) */
  onSwitchProfile: (id: string) => void
  /** 从 zip 导入宠物 (§12.3) */
  onImportProfile: () => void
  /** 导出当前宠物为 zip (§12.3) */
  onExportProfile: () => void
  /** 删除宠物 */
  onDeleteProfile: (id: string) => void
  /** 打开导入向导（§5.5，向活跃宠物目录导入片段） */
  onImportWizard: () => void
  /** 托盘右键 → 打开自定义托盘菜单（外壳负责收集状态并弹菜单窗口） */
  onOpenMenu: () => void
}

/** 托盘菜单状态 */
export interface TrayMenuState {
  /** 全部 profile（§12.2 多宠物） */
  readonly profiles: readonly ProfileSummary[]
  /** 活跃 profile 标识（唯一活跃，§12.2） */
  readonly activeProfileId: string | null
  /** 是否静音 */
  readonly isMuted: boolean
  /** 宠物窗口当前是否可见（隐藏/展示标签据此切换） */
  readonly isPetVisible: boolean
}


// ── Profile 操作编排 ── //

/** 文件对话框抽象（由外壳注入 Electron dialog 实现） */
export interface FileDialogs {
  /** 选择导出 zip 保存路径；取消返回 null */
  showSaveZipDialog(defaultPath: string): Promise<string | null>
  /** 选择导入 zip 文件；取消返回 null */
  showOpenZipDialog(): Promise<string | null>
}

/**
 * Profile 切换器宿主：由外壳实现，负责把 profile 变化同步到运行时
 * （需求状态保存/加载、设置存储重建、托盘刷新、渲染进程通知）。
 */
export interface ProfileSwitcherHost {
  /** 活跃 profile 发生变化（切换/删除后改指/导入后新设） */
  onActiveProfileChanged(profile: ProfileSummary | null): void
  /** profile 列表发生变化（导入/删除） */
  onProfilesChanged(): void
  /** 向用户报告操作结果（如导出路径、错误信息） */
  onNotify(message: string): void
}

/**
 * Profile 切换器：编排托盘触发的宠物管理操作 (§12.2、§12.3)。
 *
 * 使用方式：
 *   const switcher = new ProfileSwitcher(manager, dialogs, host)
 *   await switcher.switchProfile('小白')   // 切换活跃宠物
 *   await switcher.exportActiveProfile()   // 导出 zip
 *   await switcher.importProfile()         // 导入 zip
 */
export class ProfileSwitcher {
  constructor(
    private readonly manager: ProfileManager,
    private readonly dialogs: FileDialogs,
    private readonly host: ProfileSwitcherHost,
  ) {}

  /** 供托盘菜单使用的当前状态 */
  async getMenuState(isMuted: boolean, isPetVisible: boolean): Promise<TrayMenuState> {
    const profiles = await this.manager.listProfiles()
    const activeProfileId = await this.manager.getActiveProfileId()
    return { profiles, activeProfileId, isMuted, isPetVisible }
  }

  /**
   * 切换活跃宠物 (§12.2)。
   *
   * 切换成功后通知宿主加载新宠物数据。
   */
  async switchProfile(id: string): Promise<ProfileSummary> {
    const profile = await this.manager.switchProfile(id)
    this.host.onActiveProfileChanged(profile)
    return profile
  }

  /**
   * 导出当前活跃宠物为 zip (§12.3)。
   *
   * @returns 导出结果；取消对话框或无活跃宠物时为 null
   */
  async exportActiveProfile(): Promise<ExportResult | null> {
    const active = await this.manager.getActiveProfile()
    if (active === null) {
      this.host.onNotify('没有活跃宠物，无法导出')
      return null
    }
    const zipPath = await this.dialogs.showSaveZipDialog(`${active.id}.zip`)
    if (zipPath === null) return null

    const result = await exportProjectToZip(active.dir, zipPath)
    this.host.onNotify(`已导出「${active.name}」（${result.fileCount} 个文件）`)
    return result
  }

  /**
   * 从 zip 导入宠物 (§12.3)。
   *
   * 校验失败时抛错（不落盘）；当前无活跃宠物时将导入项设为活跃。
   *
   * @returns 导入结果；取消对话框时为 null
   */
  async importProfile(): Promise<ImportResult | null> {
    const zipPath = await this.dialogs.showOpenZipDialog()
    if (zipPath === null) return null

    const result = await importProjectFromZip(zipPath, this.manager.root)
    this.host.onProfilesChanged()

    // 无活跃宠物时（首次导入前）将新宠物设为活跃
    if ((await this.manager.getActiveProfileId()) === null) {
      await this.manager.setActiveProfile(result.profileId)
    }
    const profile = await this.manager.getActiveProfile()
    this.host.onActiveProfileChanged(profile)
    this.host.onNotify(
      `已导入「${result.data.persona.name}」（${result.data.clips.length} 个片段）`,
    )
    return result
  }

  /**
   * 删除宠物 (§12.2)。
   *
   * 仅剩一只时不允许删除（保证运行时始终有活跃宠物）；
   * 删除的是活跃宠物时自动切换到首个剩余宠物。
   */
  async deleteProfile(id: string): Promise<void> {
    const profiles = await this.manager.listProfiles()
    if (profiles.length <= 1) {
      this.host.onNotify('至少保留一只宠物')
      return
    }
    const wasActive = (await this.manager.getActiveProfileId()) === id
    await this.manager.deleteProfile(id)
    this.host.onProfilesChanged()

    if (wasActive) {
      // deleteProfile 已将活跃指针改指首个剩余宠物
      const next = await this.manager.getActiveProfile()
      this.host.onActiveProfileChanged(next)
    }
    this.host.onNotify('已删除宠物')
  }
}
