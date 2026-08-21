/**
 * JSON 状态文件原子写入。
 *
 * fs.writeFile 直接覆盖目标文件时会先截断再写入，进程如果在两步之间
 * 被杀（如 before-quit 的不等待保存遇到快速退出），磁盘上会留下 0 字节
 * 文件，下次启动 JSON.parse 直接失败。
 *
 * 这里改为：写入同目录临时文件并 fsync 落盘，再 rename 顶替目标文件。
 * rename 在同一卷上是原子操作，任意时刻被杀，目标文件要么是完整的旧
 * 内容、要么是完整的新内容。对同一目标路径的并发写入按调用顺序串行
 * 执行，避免两个写入交叉产生混合内容。
 */

import { promises as fs } from 'node:fs'

/** 每个目标路径的写入队列尾（键为绝对或相对路径字符串，按值去重即可） */
const pending = new Map<string, Promise<void>>()

/**
 * 原子写入 JSON 状态文件（2 空格缩进，UTF-8）。
 *
 * @param filePath 目标文件路径
 * @param data 可 JSON 序列化的数据
 */
export function writeJsonAtomic(filePath: string, data: unknown): Promise<void> {
  const previous = pending.get(filePath) ?? Promise.resolve()
  const job = previous
    .catch(() => {
      /* 上一次写入失败不阻塞本次 */
    })
    .then(() => writeJsonAtomicNow(filePath, data))
  pending.set(filePath, job)
  return job
}

async function writeJsonAtomicNow(filePath: string, data: unknown): Promise<void> {
  const content = JSON.stringify(data, null, 2)
  const tmp = `${filePath}.${process.pid}.tmp`
  const handle = await fs.open(tmp, 'w')
  try {
    await handle.writeFile(content, 'utf-8')
    await handle.sync()
  } finally {
    await handle.close()
  }
  await fs.rename(tmp, filePath)
}
