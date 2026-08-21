import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { promises as fs } from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

import { writeJsonAtomic } from '../../src/main/persistence/atomic-write'

let temporaryRoot: string

beforeEach(async () => {
  temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'petalive-atomic-write-'))
})

afterEach(async () => {
  await fs.rm(temporaryRoot, { recursive: true, force: true })
})

/** 目录内残留的 .tmp 临时文件名 */
async function tmpLeftovers(): Promise<string[]> {
  return (await fs.readdir(temporaryRoot)).filter((name) => name.endsWith('.tmp'))
}

describe('writeJsonAtomic', () => {
  it('以 2 空格缩进写入新文件', async () => {
    const file = path.join(temporaryRoot, 'state.json')
    await writeJsonAtomic(file, { a: 1 })
    expect(await fs.readFile(file, 'utf-8')).toBe(JSON.stringify({ a: 1 }, null, 2))
  })

  it('整体替换已有文件，不残留临时文件', async () => {
    const file = path.join(temporaryRoot, 'state.json')
    await fs.writeFile(file, '{"old":true}', 'utf-8')

    await writeJsonAtomic(file, { b: 2 })

    expect(JSON.parse(await fs.readFile(file, 'utf-8'))).toEqual({ b: 2 })
    expect(await tmpLeftovers()).toEqual([])
  })

  it('同一文件的并发写入按调用顺序串行，最终为最后一次内容', async () => {
    const file = path.join(temporaryRoot, 'state.json')
    await Promise.all(Array.from({ length: 20 }, (_, i) => writeJsonAtomic(file, { i })))

    expect(JSON.parse(await fs.readFile(file, 'utf-8'))).toEqual({ i: 19 })
    expect(await tmpLeftovers()).toEqual([])
  })

  it('序列化失败不阻塞同文件的后续写入', async () => {
    const file = path.join(temporaryRoot, 'state.json')
    const circular: Record<string, unknown> = {}
    circular['self'] = circular

    await expect(writeJsonAtomic(file, circular)).rejects.toBeInstanceOf(TypeError)

    await writeJsonAtomic(file, { ok: true })
    expect(JSON.parse(await fs.readFile(file, 'utf-8'))).toEqual({ ok: true })
    expect(await tmpLeftovers()).toEqual([])
  })
})
