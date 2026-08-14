import { describe, it, expect } from 'vitest'
import * as crypto from 'node:crypto'

import { createZipArchive, readZipArchive, crc32, type ZipEntry } from '../../src/main/persistence/zip'

describe('crc32', () => {
  it('computes known CRC-32 values', () => {
    expect(crc32(Buffer.from([]))).toBe(0x00000000)
    expect(crc32(Buffer.from('123456789'))).toBe(0xcbf43926)
    expect(crc32(Buffer.from('The quick brown fox jumps over the lazy dog'))).toBe(0x414fa339)
  })
})

describe('createZipArchive / readZipArchive round-trip', () => {
  it('round-trips multiple text and binary files', () => {
    const binary = crypto.randomBytes(4096)
    const entries: ZipEntry[] = [
      { name: 'persona.json', data: Buffer.from('{"name":"小橘"}', 'utf-8') },
      { name: 'clips/idle_sit__none__01.webm', data: binary },
      { name: 'clips/walk__right__01.mov', data: crypto.randomBytes(768) },
      { name: 'audio/meow_02.wav', data: crypto.randomBytes(512) },
    ]

    const zip = createZipArchive(entries)
    const restored = readZipArchive(zip)

    expect(restored.map((e) => e.name).sort()).toEqual(
      entries.map((e) => e.name).sort(),
    )
    for (const original of entries) {
      const entry = restored.find((e) => e.name === original.name)!
      expect(Buffer.compare(entry.data, original.data)).toBe(0)
    }
  })

  it('round-trips an empty file', () => {
    const zip = createZipArchive([{ name: 'empty.txt', data: Buffer.alloc(0) }])
    const restored = readZipArchive(zip)
    expect(restored).toHaveLength(1)
    expect(restored[0]!.data).toHaveLength(0)
  })

  it('round-trips incompressible data via stored method', () => {
    // 随机数据 deflate 后更大 → 应回退 stored
    const random = crypto.randomBytes(64 * 1024)
    const zip = createZipArchive([{ name: 'random.bin', data: random }])
    const restored = readZipArchive(zip)
    expect(Buffer.compare(restored[0]!.data, random)).toBe(0)
  })

  it('round-trips highly compressible data smaller than input', () => {
    const repetitive = Buffer.alloc(100_000, 0x61)
    const zip = createZipArchive([{ name: 'aaa.txt', data: repetitive }])
    expect(zip.length).toBeLessThan(repetitive.length)
    const restored = readZipArchive(zip)
    expect(Buffer.compare(restored[0]!.data, repetitive)).toBe(0)
  })

  it('supports unicode entry names', () => {
    const zip = createZipArchive([{ name: 'clips/小橘_端坐.webm', data: Buffer.from([1, 2, 3]) }])
    const restored = readZipArchive(zip)
    expect(restored[0]!.name).toBe('clips/小橘_端坐.webm')
  })

  it('rejects directory entries and backslash names on write', () => {
    expect(() => createZipArchive([{ name: 'clips/', data: Buffer.alloc(0) }])).toThrow()
    expect(() => createZipArchive([{ name: '', data: Buffer.alloc(0) }])).toThrow()
    expect(() => createZipArchive([{ name: 'a\\b.txt', data: Buffer.alloc(0) }])).toThrow()
  })
})

describe('readZipArchive error handling', () => {
  it('throws on non-zip input', () => {
    expect(() => readZipArchive(Buffer.from('this is not a zip file at all'))).toThrow(
      /end of central directory/,
    )
    expect(() => readZipArchive(Buffer.alloc(0))).toThrow()
  })

  it('throws on corrupted local file header', () => {
    const zip = createZipArchive([{ name: 'data.bin', data: crypto.randomBytes(1024) }])
    const corrupt = Buffer.from(zip)
    corrupt[0] = 0x00 // 篡改本地文件头签名
    expect(() => readZipArchive(corrupt)).toThrow(/corrupt local header/)
  })

  it('throws on truncated archive', () => {
    const zip = createZipArchive([{ name: 'data.bin', data: crypto.randomBytes(1024) }])
    const truncated = zip.subarray(0, zip.length - 10)
    expect(() => readZipArchive(truncated)).toThrow(/end of central directory/)
  })
})
