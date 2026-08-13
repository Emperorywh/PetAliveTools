/**
 * 持久化模块 (persistence)
 *
 * 负责：pet 项目目录读写、需求状态持久化 (needs-state.json)、FSM 配置管理。
 * 参见 SPEC §12 (数据与持久化)。
 *
 * 运行于主进程。
 */

export {
  getProjectPaths,
  createProject,
  loadProject,
  saveProject,
  validateProject,
  createDefaultPersona,
} from './project-io'
export type { ProjectPaths } from './project-io'

export {
  PLACEHOLDER_CLIP_ID,
  createPlaceholderClip,
  resolveClipForState,
  getMissingStates,
  buildClipLookup,
  isPlaceholderClip,
} from './placeholder'

export {
  ProfileManager,
  DEFAULT_PROFILE_NAME,
  sanitizeProfileId,
  loadNeedsStateOrDefault,
  saveNeedsState,
} from './profiles'
export type { ProfileSummary } from './profiles'

export {
  collectProjectFiles,
  exportProjectToZip,
  findCommonRootDir,
  normalizeZipEntries,
  validateProjectEntries,
  importProjectFromZip,
} from './backup'
export type { ExportResult, ImportResult } from './backup'

export { createZipArchive, readZipArchive, crc32 } from './zip'
export type { ZipEntry } from './zip'
