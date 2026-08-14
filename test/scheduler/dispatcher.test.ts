import { describe, expect, it, vi } from 'vitest'
import type { BrowserWindow } from 'electron'

import {
  IDLE_KEEPALIVE_MS,
  SchedulerCommandDispatcher,
} from '../../src/main/dispatch/scheduler-dispatcher'
import { createPlaceholderClip } from '../../src/main/persistence/placeholder'
import type { RenderCommand } from '../../src/main/scheduler/clip-scheduler'
import type { ClipMeta } from '../../src/shared/types/clip-meta'
import type { PlayClipPayload } from '../../src/shared/types/play-command'

/**
 * 构造原样媒体片段。
 * 特意使用 mp4 扩展名，以证明分发器不会强制改成 WebM。
 */
function clip(overrides: Partial<ClipMeta> = {}): ClipMeta {
  return {
    id: 'idle_sit__none__01',
    fileName: 'idle_sit__none__01.mp4',
    state: 'idle_sit',
    category: 'basic',
    direction: 'none',
    anchor: 'sit',
    loop: false,
    signature: false,
    variant: 1,
    prop: false,
    embeddedAudio: true,
    audio: null,
    hitbox: [0.1, 0.05, 0.8, 0.9],
    ...overrides,
  }
}

/**
 * 创建最小 BrowserWindow 替身。
 * 分发测试只观察发往渲染进程的 IPC 载荷。
 */
function fakeWindow(): { win: BrowserWindow; send: ReturnType<typeof vi.fn> } {
  const send = vi.fn()
  return {
    win: {
      isDestroyed: () => false,
      webContents: { send },
    } as unknown as BrowserWindow,
    send,
  }
}

describe('原样片段命令分发', () => {
  it('播放载荷保留真实文件名且没有处理参数', () => {
    const { win, send } = fakeWindow()
    const source = clip()
    const dispatcher = new SchedulerCommandDispatcher({
      getWindow: () => win,
      getProjectDir: () => 'C:\\pets\\mimi',
    })

    dispatcher.dispatch([{ kind: 'play', clip: source, loop: false }])

    const payload = send.mock.calls[0]?.[1] as PlayClipPayload
    expect(payload.clipUrl).toContain('idle_sit__none__01.mp4')
    expect(payload).toEqual({
      clipId: source.id,
      clipUrl: payload.clipUrl,
      loop: false,
      hitbox: source.hitbox,
      embeddedAudio: true,
    })
    expect(payload).not.toHaveProperty('playbackRate')
    expect(payload).not.toHaveProperty('walk')
  })

  it('淡入仍复用同一个原始文件载荷', () => {
    const { win, send } = fakeWindow()
    const dispatcher = new SchedulerCommandDispatcher({
      getWindow: () => win,
      getProjectDir: () => 'C:\\pets\\mimi',
    })

    dispatcher.dispatch([{ kind: 'fade_in', clip: clip(), durationMs: 180 }])

    expect(send).toHaveBeenCalledWith('scheduler:fade-in', {
      clip: expect.objectContaining({ clipUrl: expect.stringContaining('.mp4') }),
      durationMs: 180,
    })
  })

  it('空闲保活只重发文件播放并按时间节流', () => {
    let now = 0
    const { win, send } = fakeWindow()
    const source = clip()
    const dispatcher = new SchedulerCommandDispatcher({
      getWindow: () => win,
      getProjectDir: () => 'C:\\pets\\mimi',
      now: () => now,
    })
    const command: RenderCommand = { kind: 'idle', clip: source, intervalMs: 5_000 }

    dispatcher.dispatch([command])
    now = IDLE_KEEPALIVE_MS - 1
    dispatcher.dispatch([command])
    now = IDLE_KEEPALIVE_MS
    dispatcher.dispatch([command])

    expect(send).toHaveBeenCalledTimes(2)
  })

  it('占位片段没有实体文件，因此不会发送播放请求', () => {
    const { win, send } = fakeWindow()
    const dispatcher = new SchedulerCommandDispatcher({
      getWindow: () => win,
      getProjectDir: () => 'C:\\pets\\mimi',
    })

    dispatcher.dispatch([{ kind: 'play', clip: createPlaceholderClip(), loop: true }])
    expect(send).not.toHaveBeenCalled()
  })
})
