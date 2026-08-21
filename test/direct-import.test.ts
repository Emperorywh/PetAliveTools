import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { promises as fs } from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

vi.mock('electron', () => ({
  dialog: { showOpenDialog: vi.fn() },
  ipcMain: { handle: vi.fn() },
}))

import {
  copyClipDirectly,
  deleteClipDirectly,
  validatePreviewClip,
} from '../src/main/direct-import-handlers'
import {
  createDefaultPersona,
  createProject,
  getProjectPaths,
} from '../src/main/persistence/project-io'

let temporaryRoot: string
let projectDir: string

beforeEach(async () => {
  temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'petalive-copy-'))
  projectDir = path.join(temporaryRoot, 'project')
  await createProject(projectDir, createDefaultPersona('咪咪'))
})

afterEach(async () => {
  await fs.rm(temporaryRoot, { recursive: true, force: true })
})

/**
 * 直接导入的核心契约是逐字节复制。
 * 测试数据故意不是有效视频，若实现尝试解码或转码，这些用例就无法通过。
 */
describe('原样片段导入', () => {
  it('逐字节复制源文件并保留扩展名', async () => {
    const sourcePath = path.join(temporaryRoot, 'prepared.MOV')
    const sourceBytes = Buffer.from([0x00, 0xff, 0x41, 0x00, 0x7f, 0x19])
    await fs.writeFile(sourcePath, sourceBytes)

    const result = await copyClipDirectly(projectDir, {
      sourcePath,
      state: 'walk',
      direction: 'left',
    })
    const destination = path.join(getProjectPaths(projectDir).clipsDir, result.fileName)

    expect(result.fileName).toBe('walk__left__01.mov')
    await expect(fs.readFile(destination)).resolves.toEqual(sourceBytes)
    await expect(fs.access(path.join(projectDir, 'clips.meta.json'))).rejects.toThrow()
  })

  it('重复导入生成新文件编号，不覆盖既有片段', async () => {
    const sourcePath = path.join(temporaryRoot, 'prepared.mp4')
    await fs.writeFile(sourcePath, Buffer.from('already-prepared'))

    const first = await copyClipDirectly(projectDir, {
      sourcePath,
      state: 'idle_sit',
      direction: 'none',
    })
    const second = await copyClipDirectly(projectDir, {
      sourcePath,
      state: 'idle_sit',
      direction: 'none',
    })

    expect(first.fileName).toBe('idle_sit__none__01.mp4')
    expect(second.fileName).toBe('idle_sit__none__02.mp4')
    expect(second.clipsCount).toBe(2)
  })

  it('不支持的容器直接拒绝，不尝试转码兜底', async () => {
    const sourcePath = path.join(temporaryRoot, 'prepared.avi')
    await fs.writeFile(sourcePath, Buffer.from('avi-content'))

    await expect(copyClipDirectly(projectDir, {
      sourcePath,
      state: 'walk',
      direction: 'right',
    })).rejects.toThrow('项目禁止转码')
  })

  it('删除单个已导入片段并重新计数', async () => {
    const sourcePath = path.join(temporaryRoot, 'prepared.mp4')
    await fs.writeFile(sourcePath, Buffer.from('clip'))
    const first = await copyClipDirectly(projectDir, {
      sourcePath,
      state: 'idle_sit',
      direction: 'none',
    })
    const second = await copyClipDirectly(projectDir, {
      sourcePath,
      state: 'idle_sit',
      direction: 'none',
    })

    const result = await deleteClipDirectly(projectDir, second.fileName)

    expect(result.clipsCount).toBe(1)
    const clipsDir = getProjectPaths(projectDir).clipsDir
    await expect(fs.access(path.join(clipsDir, second.fileName))).rejects.toThrow()
    await expect(fs.access(path.join(clipsDir, first.fileName))).resolves.toBeUndefined()
  })

  it('全部删除后重新导入从 01 重新编号', async () => {
    const sourcePath = path.join(temporaryRoot, 'prepared.mp4')
    await fs.writeFile(sourcePath, Buffer.from('clip'))
    const first = await copyClipDirectly(projectDir, {
      sourcePath,
      state: 'idle_sit',
      direction: 'none',
    })
    const second = await copyClipDirectly(projectDir, {
      sourcePath,
      state: 'idle_sit',
      direction: 'none',
    })
    await deleteClipDirectly(projectDir, first.fileName)
    await deleteClipDirectly(projectDir, second.fileName)

    const reImported = await copyClipDirectly(projectDir, {
      sourcePath,
      state: 'idle_sit',
      direction: 'none',
    })

    expect(reImported.fileName).toBe('idle_sit__none__01.mp4')
  })

  it('拒绝删除携带路径分隔符或非视频文件', async () => {
    await expect(deleteClipDirectly(projectDir, '../outside.mp4')).rejects.toThrow('片段文件名不合法')
    await expect(deleteClipDirectly(projectDir, 'a\\b.mp4')).rejects.toThrow('片段文件名不合法')
    await expect(deleteClipDirectly(projectDir, 'persona.json')).rejects.toThrow('只能删除 clips/ 内的视频文件')
  })

  it('可删除命名无法识别的遗留视频文件（清单变更后的孤儿片段）', async () => {
    const sourcePath = path.join(temporaryRoot, 'prepared.mp4')
    await fs.writeFile(sourcePath, Buffer.from('clip'))
    const imported = await copyClipDirectly(projectDir, {
      sourcePath,
      state: 'idle_sit',
      direction: 'none',
    })
    // 模拟状态已从动作清单移除的旧片段：直接放入按旧状态命名的文件
    const clipsDir = getProjectPaths(projectDir).clipsDir
    await fs.copyFile(
      path.join(clipsDir, imported.fileName),
      path.join(clipsDir, 'petted__none__01.mp4'),
    )

    const result = await deleteClipDirectly(projectDir, 'petted__none__01.mp4')

    expect(result.clipsCount).toBe(1)
    await expect(fs.access(path.join(clipsDir, 'petted__none__01.mp4'))).rejects.toThrow()
  })
})

describe('桌面预览目标校验', () => {
  it('存在的片段文件解析出片段描述', async () => {
    const sourcePath = path.join(temporaryRoot, 'prepared.mp4')
    await fs.writeFile(sourcePath, Buffer.from('clip'))
    const imported = await copyClipDirectly(projectDir, {
      sourcePath,
      state: 'walk',
      direction: 'left',
    })

    const parsed = await validatePreviewClip(projectDir, imported.fileName)

    expect(parsed.state).toBe('walk')
    expect(parsed.direction).toBe('left')
    expect(parsed.fileName).toBe(imported.fileName)
  })

  it('拒绝相对项目目录、非法文件名与不可识别命名', async () => {
    await expect(validatePreviewClip('relative/dir', 'walk__left__01.mp4')).rejects.toThrow(
      '项目目录必须使用绝对路径',
    )
    await expect(validatePreviewClip(projectDir, '..\\evil.mp4')).rejects.toThrow('片段文件名不合法')
    await expect(validatePreviewClip(projectDir, 'random.mp4')).rejects.toThrow(
      '不是可识别的导入片段',
    )
  })

  it('拒绝磁盘上不存在的片段文件', async () => {
    await expect(validatePreviewClip(projectDir, 'walk__left__01.mp4')).rejects.toThrow()
  })
})
