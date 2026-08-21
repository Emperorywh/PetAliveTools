import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { promises as fs } from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

import {
  createDefaultPersona,
  createProject,
  getProjectPaths,
  loadDirectClips,
  loadProject,
  saveProject,
  scanClipsDirectory,
  validateProject,
} from '../../src/main/persistence/project-io'
import { defaultNeedsState } from '../../src/shared/schemas'

let temporaryRoot: string
let projectDir: string

beforeEach(async () => {
  temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'petalive-direct-project-'))
  projectDir = path.join(temporaryRoot, 'mimi')
})

afterEach(async () => {
  await fs.rm(temporaryRoot, { recursive: true, force: true })
})

/**
 * 项目持久化测试只写入任意字节，不构造或解析真实视频。
 * 这样可以直接证明项目 I/O 不会触碰媒体内容。
 */
describe('直接片段项目 I/O', () => {
  it('新项目不创建 clips.meta.json 或轨迹文件', async () => {
    const paths = await createProject(projectDir, createDefaultPersona('咪咪'))

    await expect(fs.access(paths.persona)).resolves.toBeUndefined()
    await expect(fs.access(paths.needsState)).resolves.toBeUndefined()
    await expect(fs.access(paths.behaviorConfig)).resolves.toBeUndefined()
    await expect(fs.access(paths.audioMeta)).resolves.toBeUndefined()
    await expect(fs.access(paths.clipsDir)).resolves.toBeUndefined()
    await expect(fs.access(path.join(projectDir, 'clips.meta.json'))).rejects.toThrow()
  })

  it('加载项目只按文件名扫描片段，不读取媒体字节', async () => {
    const paths = await createProject(projectDir, createDefaultPersona('咪咪'))
    const bytes = Buffer.from([0xff, 0x00, 0x7a, 0x13])
    await fs.writeFile(path.join(paths.clipsDir, 'walk__left__01.mov'), bytes)
    await fs.writeFile(path.join(paths.clipsDir, '说明.txt'), 'ignored')

    const data = await loadProject(projectDir)

    expect(data.clips).toHaveLength(1)
    expect(data.clips[0]).toMatchObject({
      id: 'walk__left__01',
      fileName: 'walk__left__01.mov',
      state: 'walk',
      direction: 'left',
    })
    await expect(fs.readFile(path.join(paths.clipsDir, 'walk__left__01.mov'))).resolves.toEqual(bytes)
  })

  it('保存配置不会改写 clips/ 中的原始片段', async () => {
    const paths = await createProject(projectDir, createDefaultPersona('咪咪'))
    const mediaPath = path.join(paths.clipsDir, 'idle_sit__none__01.webm')
    const bytes = Buffer.from('not-decoded-media-content')
    await fs.writeFile(mediaPath, bytes)
    const data = await loadProject(projectDir)

    await saveProject(projectDir, {
      ...data,
      persona: { ...data.persona, name: '新名字' },
    })

    await expect(fs.readFile(mediaPath)).resolves.toEqual(bytes)
    await expect(fs.access(path.join(projectDir, 'clips.meta.json'))).rejects.toThrow()
  })

  it('兼容扫描旧式动作文件名，但忽略旧轨迹 JSON', async () => {
    const clipsDir = path.join(temporaryRoot, 'clips')
    await fs.mkdir(clipsDir)
    await fs.writeFile(path.join(clipsDir, 'walk_right_01.webm'), Buffer.from([1]))
    await fs.writeFile(path.join(clipsDir, 'walk_right_01.track.json'), '{}')

    const clips = await loadDirectClips(clipsDir)

    expect(clips).toHaveLength(1)
    expect(clips[0]).toMatchObject({ state: 'walk', direction: 'right', variant: 1 })
  })

  it('扫描把无法识别的视频文件与可调度片段分开返回', async () => {
    const clipsDir = path.join(temporaryRoot, 'clips')
    await fs.mkdir(clipsDir)
    await fs.writeFile(path.join(clipsDir, 'idle_sit__none__01.mp4'), Buffer.from([1]))
    // 状态已从动作清单移除的遗留片段：视频扩展名但命名不可映射
    await fs.writeFile(path.join(clipsDir, 'petted__none__01.mp4'), Buffer.from([2]))
    await fs.writeFile(path.join(clipsDir, 'annoyed__none__01.webm'), Buffer.from([3]))
    // 非视频文件不计入任何一边
    await fs.writeFile(path.join(clipsDir, 'walk_01.track.json'), '{}')

    const scan = await scanClipsDirectory(clipsDir)

    expect(scan.clips.map((clip) => clip.fileName)).toEqual(['idle_sit__none__01.mp4'])
    expect(scan.unrecognizedVideos).toEqual(['annoyed__none__01.webm', 'petted__none__01.mp4'])
  })

  it('loadProject 返回无法识别的遗留视频文件名', async () => {
    const paths = await createProject(projectDir, createDefaultPersona('咪咪'))
    await fs.writeFile(path.join(paths.clipsDir, 'idle_sit__none__01.mp4'), Buffer.from([1]))
    await fs.writeFile(path.join(paths.clipsDir, 'petted__none__01.mp4'), Buffer.from([2]))

    const data = await loadProject(projectDir)

    expect(data.clips).toHaveLength(1)
    expect(data.unrecognizedVideos).toEqual(['petted__none__01.mp4'])
  })

  it('项目校验只要求配置文件和目录，不要求媒体元数据', async () => {
    await createProject(projectDir, createDefaultPersona('咪咪'))
    expect(await validateProject(projectDir)).toEqual([])

    const paths = getProjectPaths(projectDir)
    await fs.rm(paths.audioMeta)
    expect(await validateProject(projectDir)).toContain('audio.meta.json: file not found')
  })

  it('needs-state.json 被截断为 0 字节时回退默认值，不阻塞加载（§13）', async () => {
    await createProject(projectDir, createDefaultPersona('咪咪'))
    const paths = getProjectPaths(projectDir)
    await fs.writeFile(paths.needsState, '', 'utf-8')

    const data = await loadProject(projectDir)
    expect(data.needsState).toEqual(defaultNeedsState())
  })

  it('needs-state.json 内容非法时同样回退默认值', async () => {
    await createProject(projectDir, createDefaultPersona('咪咪'))
    const paths = getProjectPaths(projectDir)
    await fs.writeFile(paths.needsState, '{"hunger":999}', 'utf-8')

    const data = await loadProject(projectDir)
    expect(data.needsState).toEqual(defaultNeedsState())
  })

  it('用户配置文件损坏时加载仍然失败', async () => {
    await createProject(projectDir, createDefaultPersona('咪咪'))
    const paths = getProjectPaths(projectDir)
    await fs.writeFile(paths.persona, '', 'utf-8')

    await expect(loadProject(projectDir)).rejects.toThrow()
  })
})
