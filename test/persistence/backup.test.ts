import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { promises as fs } from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

import {
  exportProjectToZip,
  importProjectFromZip,
  normalizeZipEntries,
  validateProjectEntries,
} from '../../src/main/persistence/backup'
import {
  createDefaultPersona,
  createProject,
} from '../../src/main/persistence/project-io'
import type { ZipEntry } from '../../src/main/persistence/zip'

let temporaryRoot: string

beforeEach(async () => {
  temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'petalive-direct-backup-'))
})

afterEach(async () => {
  await fs.rm(temporaryRoot, { recursive: true, force: true })
})

/**
 * 备份测试验证原始媒体字节随项目整体打包和恢复。
 * 备份层只处理 zip 条目，不解析或转换视频内容。
 */
describe('直接片段项目备份', () => {
  it('导出再导入后媒体字节完全一致', async () => {
    const sourceProject = path.join(temporaryRoot, 'source')
    const paths = await createProject(sourceProject, createDefaultPersona('咪咪'))
    const fileName = 'idle_sit__none__01.webm'
    const mediaBytes = Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x00, 0xff])
    await fs.writeFile(path.join(paths.clipsDir, fileName), mediaBytes)

    const zipPath = path.join(temporaryRoot, 'mimi.zip')
    const exported = await exportProjectToZip(sourceProject, zipPath)
    const imported = await importProjectFromZip(
      zipPath,
      path.join(temporaryRoot, 'pets'),
      'restored',
    )

    expect(exported.fileCount).toBeGreaterThanOrEqual(5)
    expect(imported.data.clips).toHaveLength(1)
    await expect(fs.readFile(path.join(imported.projectDir, 'clips', fileName))).resolves.toEqual(mediaBytes)
    await expect(fs.access(path.join(imported.projectDir, 'clips.meta.json'))).rejects.toThrow()
  })

  it('项目归档不要求 clips.meta.json', async () => {
    const projectDir = path.join(temporaryRoot, 'plain')
    const paths = await createProject(projectDir, createDefaultPersona('咪咪'))
    const entries: ZipEntry[] = await Promise.all([
      'persona.json',
      'needs-state.json',
      'behavior-config.json',
      'audio.meta.json',
    ].map(async (name) => ({
      name,
      data: await fs.readFile(path.join(projectDir, name)),
    })))
    entries.push({ name: 'clips/walk__left__01.mov', data: Buffer.from('raw-media') })

    expect(validateProjectEntries(normalizeZipEntries(entries))).toEqual([])
    expect(paths).not.toHaveProperty('clipsMeta')
  })

  it('仍拒绝可能逃出目标目录的 zip 条目', () => {
    expect(() => normalizeZipEntries([
      { name: '../outside.txt', data: Buffer.from('x') },
    ])).toThrow('unsafe entry name')
  })

  it('缺少项目配置时在写盘前拒绝导入', () => {
    const errors = validateProjectEntries(normalizeZipEntries([
      { name: 'persona.json', data: Buffer.from('{}') },
    ]))

    expect(errors).toContain('needs-state.json: missing from archive')
    expect(errors).toContain('behavior-config.json: missing from archive')
    expect(errors).toContain('audio.meta.json: missing from archive')
  })
})
