/**
 * ZIP 归档编解码器 (§12.3 备份/导入导出底层)
 *
 * 纯 Node 实现（node:zlib deflateRaw + 手写 ZIP 结构），无第三方依赖。
 * 项目目录导出为 zip、从 zip 导入项目均经由本模块。
 *
 * 支持范围（覆盖本项目自产 zip 与常规工具产出的 zip）：
 * - deflate(8) 与 stored(0) 两种压缩方法
 * - UTF-8 文件名（general purpose bit 11）
 * - 通过 End of Central Directory 定位中央目录（数据偏移以中央目录为准，
 *   兼容带 data descriptor 的条目）
 *
 * 运行于主进程（与 vitest node 环境）。
 */

import { deflateRawSync, inflateRawSync } from 'node:zlib'

/** zip 内单个文件条目：相对路径（正斜杠分隔）+ 内容 */
export interface ZipEntry {
  readonly name: string
  readonly data: Buffer
}

// ── ZIP 结构常量 ── //

const SIG_LOCAL = 0x04034b50 // PK\x03\x04
const SIG_CENTRAL = 0x02014b50 // PK\x01\x02
const SIG_EOCD = 0x06054b50 // PK\x05\x06

const VERSION = 20 // 2.0：deflate 所需最低版本
const METHOD_STORED = 0
const METHOD_DEFLATE = 8
const FLAG_UTF8 = 0x0800

// 固定 DOS 时间戳 1980-01-01（zip 时间戳仅作展示，备份内容不依赖它）
const DOS_TIME = 0
const DOS_DATE = 0x0021

const LOCAL_HEADER_SIZE = 30
const CENTRAL_HEADER_SIZE = 46
const EOCD_SIZE = 22

// ── CRC32 (IEEE 802.3，ZIP 标准) ── //

const CRC_TABLE: Uint32Array = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    }
    table[n] = c >>> 0
  }
  return table
})()

/** 计算缓冲区的 CRC-32 校验和 */
export function crc32(buf: Uint8Array): number {
  let crc = 0xffffffff
  for (let i = 0; i < buf.length; i++) {
    crc = CRC_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8)
  }
  return (crc ^ 0xffffffff) >>> 0
}

// ── 写入（打包） ── //

/**
 * 将条目列表打包为 zip 归档 Buffer。
 *
 * 目录条目（以 `/` 结尾的 name）不被支持——调用方只传文件，
 * 目录结构由路径隐含。
 *
 * @param entries 文件条目列表
 * @returns 完整 zip 归档字节
 */
export function createZipArchive(entries: readonly ZipEntry[]): Buffer {
  const localChunks: Buffer[] = []
  const centralChunks: Buffer[] = []
  let offset = 0

  for (const entry of entries) {
    if (entry.name === '' || entry.name.endsWith('/')) {
      throw new Error(`zip: directory entries are not supported: "${entry.name}"`)
    }
    if (entry.name.includes('\\')) {
      throw new Error(`zip: entry name must use forward slashes: "${entry.name}"`)
    }

    const nameBuf = Buffer.from(entry.name, 'utf8')
    const raw = entry.data
    const deflated = deflateRawSync(raw, { level: 9 })
    const useDeflate = deflated.length < raw.length
    const method = useDeflate ? METHOD_DEFLATE : METHOD_STORED
    const payload = useDeflate ? deflated : raw

    const local = Buffer.alloc(LOCAL_HEADER_SIZE)
    local.writeUInt32LE(SIG_LOCAL, 0)
    local.writeUInt16LE(VERSION, 4)
    local.writeUInt16LE(FLAG_UTF8, 6)
    local.writeUInt16LE(method, 8)
    local.writeUInt16LE(DOS_TIME, 10)
    local.writeUInt16LE(DOS_DATE, 12)
    local.writeUInt32LE(crc32(raw), 14)
    local.writeUInt32LE(payload.length, 18) // 压缩后大小
    local.writeUInt32LE(raw.length, 22) // 原始大小
    local.writeUInt16LE(nameBuf.length, 26)
    local.writeUInt16LE(0, 28) // extra 长度

    localChunks.push(local, nameBuf, payload)

    const central = Buffer.alloc(CENTRAL_HEADER_SIZE)
    central.writeUInt32LE(SIG_CENTRAL, 0)
    central.writeUInt16LE(VERSION, 4) // version made by
    central.writeUInt16LE(VERSION, 6) // version needed
    central.writeUInt16LE(FLAG_UTF8, 8)
    central.writeUInt16LE(method, 10)
    central.writeUInt16LE(DOS_TIME, 12)
    central.writeUInt16LE(DOS_DATE, 14)
    central.writeUInt32LE(crc32(raw), 16)
    central.writeUInt32LE(payload.length, 20)
    central.writeUInt32LE(raw.length, 24)
    central.writeUInt16LE(nameBuf.length, 28)
    central.writeUInt16LE(0, 30) // extra 长度
    central.writeUInt16LE(0, 32) // comment 长度
    central.writeUInt16LE(0, 34) // 起始盘号
    central.writeUInt16LE(0, 36) // 内部属性
    central.writeUInt32LE(0, 38) // 外部属性
    central.writeUInt32LE(offset, 42) // 本地头偏移

    centralChunks.push(central, nameBuf)

    offset += local.length + nameBuf.length + payload.length
  }

  const centralDirectory = Buffer.concat(centralChunks)
  const eocd = Buffer.alloc(EOCD_SIZE)
  eocd.writeUInt32LE(SIG_EOCD, 0)
  eocd.writeUInt16LE(0, 4) // 当前盘号
  eocd.writeUInt16LE(0, 6) // 中央目录起始盘号
  eocd.writeUInt16LE(entries.length, 8) // 本盘条目数
  eocd.writeUInt16LE(entries.length, 10) // 总条目数
  eocd.writeUInt32LE(centralDirectory.length, 12)
  eocd.writeUInt32LE(offset, 16) // 中央目录偏移
  eocd.writeUInt16LE(0, 20) // comment 长度

  return Buffer.concat([...localChunks, centralDirectory, eocd])
}

// ── 读取（解包） ── //

/** 从尾部向前搜索 End of Central Directory 记录 */
function findEocd(zip: Buffer): number {
  // EOCD 固定 22 字节，comment 最长 65535
  const searchStart = Math.max(0, zip.length - EOCD_SIZE - 0xffff)
  for (let i = zip.length - EOCD_SIZE; i >= searchStart; i--) {
    if (zip.readUInt32LE(i) === SIG_EOCD) return i
  }
  throw new Error('zip: end of central directory record not found (not a zip archive?)')
}

/**
 * 解析 zip 归档，返回全部文件条目（目录条目被跳过）。
 *
 * 条目大小与偏移取自中央目录，本地头仅用于定位数据起始。
 *
 * @param zip 归档字节
 * @returns 文件条目列表
 */
export function readZipArchive(zip: Buffer): ZipEntry[] {
  const eocd = findEocd(zip)
  const entryCount = zip.readUInt16LE(eocd + 10)
  let cursor = zip.readUInt32LE(eocd + 16)

  const entries: ZipEntry[] = []
  for (let i = 0; i < entryCount; i++) {
    if (cursor + CENTRAL_HEADER_SIZE > zip.length || zip.readUInt32LE(cursor) !== SIG_CENTRAL) {
      throw new Error(`zip: corrupt central directory at entry ${i}`)
    }
    const method = zip.readUInt16LE(cursor + 10)
    const compressedSize = zip.readUInt32LE(cursor + 20)
    const nameLen = zip.readUInt16LE(cursor + 28)
    const extraLen = zip.readUInt16LE(cursor + 30)
    const commentLen = zip.readUInt16LE(cursor + 32)
    const localOffset = zip.readUInt32LE(cursor + 42)
    const name = zip.subarray(cursor + CENTRAL_HEADER_SIZE, cursor + CENTRAL_HEADER_SIZE + nameLen).toString('utf8')

    if (name.endsWith('/')) {
      // 目录条目：无数据，跳过
      cursor += CENTRAL_HEADER_SIZE + nameLen + extraLen + commentLen
      continue
    }

    if (localOffset + LOCAL_HEADER_SIZE > zip.length || zip.readUInt32LE(localOffset) !== SIG_LOCAL) {
      throw new Error(`zip: corrupt local header for "${name}"`)
    }
    const localNameLen = zip.readUInt16LE(localOffset + 26)
    const localExtraLen = zip.readUInt16LE(localOffset + 28)
    const dataStart = localOffset + LOCAL_HEADER_SIZE + localNameLen + localExtraLen
    const payload = zip.subarray(dataStart, dataStart + compressedSize)

    let data: Buffer
    if (method === METHOD_STORED) {
      data = Buffer.from(payload)
    } else if (method === METHOD_DEFLATE) {
      data = inflateRawSync(payload)
    } else {
      throw new Error(`zip: unsupported compression method ${method} for "${name}"`)
    }

    entries.push({ name, data })
    cursor += CENTRAL_HEADER_SIZE + nameLen + extraLen + commentLen
  }

  return entries
}
