import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { promises as fs } from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

vi.mock('electron', () => ({
  dialog: { showOpenDialog: vi.fn() },
  ipcMain: { handle: vi.fn() },
}))

import { copyClipDirectly } from '../src/main/direct-import-handlers'
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
})
