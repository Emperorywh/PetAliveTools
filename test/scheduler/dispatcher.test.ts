import { describe, it, expect, vi } from 'vitest'
import type { BrowserWindow } from 'electron'
import {
  SchedulerCommandDispatcher,
  IDLE_KEEPALIVE_MS,
  type SchedulerDispatcherDeps,
} from '../../src/main/dispatch/scheduler-dispatcher'
import { AudioCoordinator } from '../../src/main/audio/audio-coordinator'
import type { RenderCommand } from '../../src/main/scheduler/clip-scheduler'
import type { ClipMeta } from '../../src/shared/types/clip-meta'
import type { AudioMeta } from '../../src/shared/types/audio-meta'
import type { PlayClipPayload, FadeInPayload } from '../../src/shared/types/play-command'

// —— 测试辅助 —— //

function clip(overrides: Partial<ClipMeta> & Pick<ClipMeta, 'id' | 'state'>): ClipMeta {
  return {
    category: 'basic',
    direction: 'none',
    anchor: 'sit',
    loop: false,
    loopInSec: null,
    loopOutSec: null,
    signature: false,
    variant: 1,
    prop: false,
    embeddedAudio: false,
    audio: null,
    scaleHint: 1.0,
    hitbox: [0.1, 0.05, 0.8, 0.9],
    ...overrides,
  }
}

interface FakeWindow {
  send: ReturnType<typeof vi.fn>
  setPosition: ReturnType<typeof vi.fn>
  win: BrowserWindow
}

function makeFakeWindow(): FakeWindow {
  const send = vi.fn()
  const setPosition = vi.fn()
  const win = {
    isDestroyed: () => false,
    setPosition,
    webContents: { send },
  } as unknown as BrowserWindow
  return { send, setPosition, win }
}

function makeDispatcher(
  fake: FakeWindow,
  overrides: Partial<SchedulerDispatcherDeps> = {},
): SchedulerCommandDispatcher {
  return new SchedulerCommandDispatcher({
    getWindow: () => fake.win,
    getProjectDir: () => '/proj/pet-a',
    now: () => nowMs,
    ...overrides,
  })
}

let nowMs = 1_000_000

function playCmd(clipMeta: ClipMeta, overrides: Partial<Extract<RenderCommand, { kind: 'play' }>> = {}): RenderCommand {
  return {
    kind: 'play',
    clip: clipMeta,
    loop: clipMeta.loop,
    mirrored: false,
    anchor: 'sit',
    playbackRate: 1,
    ...overrides,
  }
}

describe('SchedulerCommandDispatcher (IR-002)', () => {
  it('play 命令下发结构化载荷：锚点/尺度/循环点/速率/embeddedAudio 齐全', () => {
    const fake = makeFakeWindow()
    const d = makeDispatcher(fake)
    const c = clip({
      id: 'walk_right_01',
      state: 'walk',
      anchor: 'stand',
      loop: true,
      loopInSec: 0.5,
      loopOutSec: 2.5,
      scaleHint: 0.8,
    })

    d.dispatch([playCmd(c, { anchor: 'stand', playbackRate: 1.05, mirrored: true })])

    expect(fake.send).toHaveBeenCalledTimes(1)
    const [channel, payload] = fake.send.mock.calls[0] as [string, PlayClipPayload]
    expect(channel).toBe('scheduler:play')
    expect(payload.clipId).toBe('walk_right_01')
    expect(payload.clipUrl).toMatch(/^file:\/\/.*walk_right_01\.webm$/)
    expect(payload.mirrored).toBe(true)
    expect(payload.loop).toBe(true)
    expect(payload.anchor).toBe('stand')
    expect(payload.scaleHint).toBe(0.8)
    expect(payload.loopInSec).toBe(0.5)
    expect(payload.loopOutSec).toBe(2.5)
    expect(payload.playbackRate).toBe(1.05)
    expect(payload.embeddedAudio).toBe(false)
    expect(payload.walk).toBe(true)
    expect(payload.hitbox).toEqual([0.1, 0.05, 0.8, 0.9])
  })

  it('占位片段不下发播放指令 (§5.5)', () => {
    const fake = makeFakeWindow()
    const d = makeDispatcher(fake)
    const placeholder = clip({ id: '__placeholder_idle_sit__', state: 'idle_sit' })
    d.dispatch([playCmd(placeholder)])
    expect(fake.send).not.toHaveBeenCalled()
  })

  it('窗口缺失/销毁时丢弃命令不抛错', () => {
    const d = new SchedulerCommandDispatcher({
      getWindow: () => null,
      getProjectDir: () => '/proj/pet-a',
    })
    expect(() => d.dispatch([playCmd(clip({ id: 'a', state: 'idle_sit' }))])).not.toThrow()
  })
})

describe('SchedulerCommandDispatcher (IR-003 fade/easing)', () => {
  it('fade_in → scheduler:fade-in 携带完整片段载荷与时长', () => {
    const fake = makeFakeWindow()
    const d = makeDispatcher(fake)
    const prop = clip({ id: 'eat_01', state: 'eat', prop: true })

    d.dispatch([
      { kind: 'fade_in', clip: prop, durationMs: 200, mirrored: false, anchor: 'sit', playbackRate: 1 },
    ])

    const [channel, payload] = fake.send.mock.calls[0] as [string, FadeInPayload]
    expect(channel).toBe('scheduler:fade-in')
    expect(payload.durationMs).toBe(200)
    expect(payload.clip.clipId).toBe('eat_01')
    expect(payload.clip.clipUrl).toContain('eat_01.webm')
  })

  it('fade_out → scheduler:fade-out 携带时长；easing → scheduler:easing', () => {
    const fake = makeFakeWindow()
    const d = makeDispatcher(fake)
    const prop = clip({ id: 'eat_01', state: 'eat', prop: true })

    d.dispatch([
      { kind: 'fade_out', clip: prop, durationMs: 180 },
      { kind: 'easing', durationMs: 90, reason: 'missing transition' },
    ])

    expect(fake.send).toHaveBeenNthCalledWith(1, 'scheduler:fade-out', {
      clipId: 'eat_01',
      durationMs: 180,
    })
    expect(fake.send).toHaveBeenNthCalledWith(2, 'scheduler:easing', {
      durationMs: 90,
      reason: 'missing transition',
    })
  })

  it('道具片段调度周期产生 fade_in → play → fade_out 完整序列', () => {
    const fake = makeFakeWindow()
    const d = makeDispatcher(fake)
    const prop = clip({ id: 'eat_01', state: 'eat', prop: true })
    const anchor = clip({ id: 'idle_sit_01', state: 'idle_sit' })

    d.dispatch([
      { kind: 'fade_in', clip: prop, durationMs: 200, mirrored: false, anchor: 'sit', playbackRate: 1 },
      playCmd(prop),
      { kind: 'fade_out', clip: prop, durationMs: 200 },
      playCmd(anchor),
    ])

    const channels = fake.send.mock.calls.map((c) => c[0])
    expect(channels).toEqual([
      'scheduler:fade-in',
      'scheduler:play',
      'scheduler:fade-out',
      'scheduler:play',
    ])
  })
})

describe('SchedulerCommandDispatcher (IR-009 音频接线)', () => {
  it('play 命令携带真实片段触发动作声', () => {
    const fake = makeFakeWindow()
    const onActionAudio = vi.fn()
    const d = makeDispatcher(fake, { onActionAudio })
    const c = clip({ id: 'beg_01', state: 'beg_food', audio: 'meow' })

    d.dispatch([playCmd(c)])

    expect(onActionAudio).toHaveBeenCalledWith('beg_food', c)
  })

  it('调度播放带 audio 片段 → audio:play IPC 全链发出（分发器→协调器→渲染）', () => {
    const fake = makeFakeWindow()
    // 真实 AudioCoordinator：audio.meta 含 meow 条目
    const audioLib: AudioMeta[] = [
      { id: 'meow', file: 'meow.webm', label: '叫声', category: 'action', cooldownSec: 0, maxPerHour: 1000 },
    ]
    const coordinator = new AudioCoordinator(
      audioLib,
      {
        rhythmConfig: { nightStartHour: 22, nightEndHour: 7, nightSleepBoost: 3.0 },
        rng: () => 0.5,
      },
      (cmd) => {
        if (cmd.kind === 'play') fake.send('audio:play', cmd.file, cmd.volume)
      },
    )
    const d = makeDispatcher(fake, {
      onActionAudio: (state, c) => coordinator.onActionTriggered(state, c),
    })

    const c = clip({ id: 'beg_01', state: 'beg_food', audio: 'meow' })
    d.dispatch([playCmd(c)])

    const audioCalls = fake.send.mock.calls.filter((call) => call[0] === 'audio:play')
    expect(audioCalls).toHaveLength(1)
    expect(audioCalls[0][1]).toBe('meow.webm')
    coordinator.dispose()
  })

  it('embeddedAudio 片段调度播放 → embedded_start（不叠加采样）', () => {
    const fake = makeFakeWindow()
    const coordinator = new AudioCoordinator(
      [],
      { rhythmConfig: { nightStartHour: 22, nightEndHour: 7, nightSleepBoost: 3.0 } },
      (cmd) => {
        if (cmd.kind === 'embedded_start') fake.send('audio:embedded-start')
        if (cmd.kind === 'embedded_stop') fake.send('audio:embedded-stop')
      },
    )
    const d = makeDispatcher(fake, {
      onActionAudio: (state, c) => coordinator.onActionTriggered(state, c),
      onEmbeddedAudioEnded: () => coordinator.onEmbeddedAudioEnded(),
    })

    const embedded = clip({ id: 'meow_e_01', state: 'beg_food', embeddedAudio: true })
    d.dispatch([playCmd(embedded)])
    expect(fake.send.mock.calls.some((c) => c[0] === 'audio:embedded-start')).toBe(true)

    // 切换到普通片段 → embedded_stop 自动收尾
    const plain = clip({ id: 'idle_sit_01', state: 'idle_sit' })
    d.dispatch([playCmd(plain)])
    expect(fake.send.mock.calls.some((c) => c[0] === 'audio:embedded-stop')).toBe(true)
    coordinator.dispose()
  })

  it('fade_in 不触发动作声（由后续 play 统一触发，避免双发）', () => {
    const fake = makeFakeWindow()
    const onActionAudio = vi.fn()
    const d = makeDispatcher(fake, { onActionAudio })
    const prop = clip({ id: 'eat_01', state: 'eat', prop: true })

    d.dispatch([
      { kind: 'fade_in', clip: prop, durationMs: 200, mirrored: false, anchor: 'sit', playbackRate: 1 },
    ])
    expect(onActionAudio).not.toHaveBeenCalled()
  })
})

describe('SchedulerCommandDispatcher (IR-010 embedded 切换)', () => {
  it('embeddedAudio 片段切换走时回调内嵌音轨结束', () => {
    const fake = makeFakeWindow()
    const onEmbeddedAudioEnded = vi.fn()
    const d = makeDispatcher(fake, { onEmbeddedAudioEnded, onActionAudio: vi.fn() })
    const embedded = clip({ id: 'meow_01', state: 'beg_food', embeddedAudio: true })
    const plain = clip({ id: 'idle_sit_01', state: 'idle_sit' })

    d.dispatch([playCmd(embedded)])
    expect(onEmbeddedAudioEnded).not.toHaveBeenCalled()

    d.dispatch([playCmd(plain)])
    expect(onEmbeddedAudioEnded).toHaveBeenCalledTimes(1)
  })

  it('embeddedAudio 载荷标志随 play 下发', () => {
    const fake = makeFakeWindow()
    const d = makeDispatcher(fake)
    const embedded = clip({ id: 'meow_01', state: 'beg_food', embeddedAudio: true })

    d.dispatch([playCmd(embedded)])

    const [, payload] = fake.send.mock.calls[0] as [string, PlayClipPayload]
    expect(payload.embeddedAudio).toBe(true)
  })
})

describe('SchedulerCommandDispatcher (IR-014 idle 保活)', () => {
  it('idle 命令转换为保活重播并按 IDLE_KEEPALIVE_MS 节流', () => {
    const fake = makeFakeWindow()
    const d = makeDispatcher(fake)
    const idle = clip({ id: 'idle_sit_01', state: 'idle_sit', loop: true, loopInSec: 0, loopOutSec: 3 })

    // 首次 idle → 立即保活重播
    d.dispatch([{ kind: 'idle', clip: idle, intervalMs: 5000, mirrored: false }])
    expect(fake.send).toHaveBeenCalledTimes(1)
    expect(fake.send.mock.calls[0][0]).toBe('scheduler:play')

    // 节流窗口内同片段 → 不重发
    nowMs += 500
    d.dispatch([{ kind: 'idle', clip: idle, intervalMs: 4500, mirrored: false }])
    expect(fake.send).toHaveBeenCalledTimes(1)

    // 超过节流间隔 → 再次保活
    nowMs += IDLE_KEEPALIVE_MS
    d.dispatch([{ kind: 'idle', clip: idle, intervalMs: 3000, mirrored: false }])
    expect(fake.send).toHaveBeenCalledTimes(2)

    // 换片段 → 立即重发
    const stand = clip({ id: 'stand_01', state: 'stand', anchor: 'stand' })
    d.dispatch([{ kind: 'idle', clip: stand, intervalMs: 3000, mirrored: false }])
    expect(fake.send).toHaveBeenCalledTimes(3)
  })
})

describe('SchedulerCommandDispatcher (窗口平移 §7.2)', () => {
  it('update_position 直接移动窗口（取整）', () => {
    const fake = makeFakeWindow()
    const d = makeDispatcher(fake)
    d.dispatch([{ kind: 'update_position', x: 123.7, y: 800.2 }])
    expect(fake.setPosition).toHaveBeenCalledWith(124, 800, false)
  })
})
