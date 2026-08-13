import { describe, it, expect } from 'vitest'
import { AudioCoordinator } from '../../src/main/audio/audio-coordinator'
import type { AudioPlayCommand } from '../../src/main/audio/audio-coordinator'
import type { AudioMeta } from '../../src/shared/types/audio-meta'
import type { ClipMeta } from '../../src/shared/types/clip-meta'
import type { RhythmConfig } from '../../src/shared/types/behavior-config'

function audioEntry(overrides: Partial<AudioMeta>): AudioMeta {
  return {
    file: 'test.wav',
    label: 'Test',
    category: 'action',
    cooldownSec: 5,
    maxPerHour: 10,
    ...overrides,
  } as AudioMeta
}

function clip(overrides: Partial<ClipMeta> = {}): ClipMeta {
  return {
    id: 'test',
    state: 'idle_sit',
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

const RHYTHM: RhythmConfig = {
  nightStartHour: 22,
  nightEndHour: 7,
  nightSleepBoost: 3.0,
}

describe('AudioCoordinator', () => {
  it('sends play command on action trigger', () => {
    const commands: AudioPlayCommand[] = []
    let nowMs = 1000
    const coord = new AudioCoordinator(
      [audioEntry({ id: 'purr_01', file: 'purr_01.wav', category: 'action' })],
      {
        rhythmConfig: RHYTHM,
        rng: () => 0.5,
        now: () => nowMs,
        hour: () => 12,
      },
      (cmd) => commands.push(cmd),
    )

    coord.onActionTriggered('petted', null)
    expect(commands).toHaveLength(1)
    expect(commands[0]).toEqual({
      kind: 'play',
      file: 'purr_01.wav',
      volume: 0.25,
    })
  })

  it('respects cooldown on repeated triggers', () => {
    const commands: AudioPlayCommand[] = []
    let nowMs = 1000
    const coord = new AudioCoordinator(
      [audioEntry({ id: 'purr_01', file: 'purr.wav', category: 'action', cooldownSec: 10 })],
      {
        rhythmConfig: RHYTHM,
        rng: () => 0.5,
        now: () => nowMs,
        hour: () => 12,
      },
      (cmd) => commands.push(cmd),
    )

    coord.onActionTriggered('petted', null) // plays at t=1000
    nowMs = 5000 // 4s later, still in cooldown
    coord.onActionTriggered('petted', null) // blocked
    expect(commands).toHaveLength(1)

    nowMs = 12000 // 11s later, cooldown expired
    coord.onActionTriggered('petted', null) // plays
    expect(commands).toHaveLength(2)
  })

  it('sends embedded_start for embeddedAudio clips (§11.1)', () => {
    const commands: AudioPlayCommand[] = []
    const coord = new AudioCoordinator(
      [],
      { rhythmConfig: RHYTHM, now: () => 1000, hour: () => 12 },
      (cmd) => commands.push(cmd),
    )

    coord.onActionTriggered('eat', clip({ embeddedAudio: true }))
    expect(commands).toHaveLength(1)
    expect(commands[0].kind).toBe('embedded_start')
  })

  it('sends embedded_stop after embedded audio ends', () => {
    const commands: AudioPlayCommand[] = []
    const coord = new AudioCoordinator(
      [],
      { rhythmConfig: RHYTHM, now: () => 1000, hour: () => 12 },
      (cmd) => commands.push(cmd),
    )

    coord.onActionTriggered('eat', clip({ embeddedAudio: true }))
    coord.onEmbeddedAudioEnded()
    expect(commands).toHaveLength(2)
    expect(commands[0].kind).toBe('embedded_start')
    expect(commands[1].kind).toBe('embedded_stop')
  })

  it('does not play when muted (§11.2)', () => {
    const commands: AudioPlayCommand[] = []
    const coord = new AudioCoordinator(
      [audioEntry({ id: 'purr_01', category: 'action' })],
      { rhythmConfig: RHYTHM, now: () => 1000, hour: () => 12 },
      (cmd) => commands.push(cmd),
    )

    coord.setMuted(true)
    coord.onActionTriggered('petted', null)
    expect(commands).toHaveLength(0)
  })

  it('toggleMute returns new muted state', () => {
    const coord = new AudioCoordinator(
      [],
      { rhythmConfig: RHYTHM, now: () => 1000, hour: () => 12 },
      () => {},
    )

    expect(coord.isMuted).toBe(false)
    expect(coord.toggleMute()).toBe(true)
    expect(coord.isMuted).toBe(true)
    expect(coord.toggleMute()).toBe(false)
    expect(coord.isMuted).toBe(false)
  })

  it('default volume is low (§11.2)', () => {
    const commands: AudioPlayCommand[] = []
    const coord = new AudioCoordinator(
      [audioEntry({ id: 'purr_01', file: 'p.wav', category: 'action' })],
      { rhythmConfig: RHYTHM, now: () => 1000, hour: () => 12 },
      (cmd) => commands.push(cmd),
    )

    coord.onActionTriggered('petted', null)
    expect(commands[0].kind).toBe('play')
    if (commands[0].kind === 'play') {
      expect(commands[0].volume).toBeLessThanOrEqual(0.3)
    }
  })

  it('multi-sample rotation picks different samples', () => {
    const commands: AudioPlayCommand[] = []
    let nowMs = 0
    const coord = new AudioCoordinator(
      [
        audioEntry({ id: 'purr_01', file: 'purr_01.wav', category: 'action', cooldownSec: 0 }),
        audioEntry({ id: 'purr_02', file: 'purr_02.wav', category: 'action', cooldownSec: 0 }),
        audioEntry({ id: 'purr_03', file: 'purr_03.wav', category: 'action', cooldownSec: 0 }),
      ],
      {
        rhythmConfig: RHYTHM,
        rng: () => 0.0, // deterministic: always first candidate
        now: () => nowMs,
        hour: () => 12,
      },
      (cmd) => commands.push(cmd),
    )

    // First call: purr_01 (candidates: all, pick first = index 0)
    // Second call: purr_02 (candidates: [1,2], pick first = index 1)
    nowMs = 0
    coord.onActionTriggered('petted', null)
    nowMs = 100
    coord.onActionTriggered('petted', null)

    expect(commands).toHaveLength(2)
    if (commands[0].kind === 'play' && commands[1].kind === 'play') {
      expect(commands[0].file).not.toBe(commands[1].file)
    }
  })

  it('tickAmbient plays ambient sounds when scheduled', () => {
    const commands: AudioPlayCommand[] = []
    let nowMs = 0
    const coord = new AudioCoordinator(
      [
        audioEntry({ id: 'amb_01', file: 'amb_01.wav', category: 'ambient', cooldownSec: 0 }),
      ],
      {
        rhythmConfig: RHYTHM,
        rng: () => 0.5,
        now: () => nowMs,
        hour: () => 12, // daytime
        ambientConfig: {
          dayIntervalSec: [1, 1], // 1 second for fast testing
          nightIntervalSec: [100, 100],
          frequencyMultiplier: 1.0,
        },
      },
      (cmd) => commands.push(cmd),
    )

    // Start ambient scheduling (interval clamped to min 5s)
    coord.start()
    // After 6 seconds, should have triggered
    nowMs = 6000
    coord.tickAmbient()
    expect(commands.length).toBeGreaterThanOrEqual(1)
    expect(commands[0].kind).toBe('play')
    coord.dispose()
  })

  it('tickAmbient does nothing when muted', () => {
    const commands: AudioPlayCommand[] = []
    let nowMs = 0
    const coord = new AudioCoordinator(
      [audioEntry({ id: 'amb_01', file: 'amb.wav', category: 'ambient' })],
      {
        rhythmConfig: RHYTHM,
        rng: () => 0.5,
        now: () => nowMs,
        hour: () => 12,
        ambientConfig: {
          dayIntervalSec: [0, 0],
          nightIntervalSec: [100, 100],
          frequencyMultiplier: 1.0,
        },
      },
      (cmd) => commands.push(cmd),
    )

    coord.start()
    coord.setMuted(true)
    nowMs = 10000
    coord.tickAmbient()
    expect(commands).toHaveLength(0)
    coord.dispose()
  })

  it('rate limiting prevents sound spam (§11.2)', () => {
    const commands: AudioPlayCommand[] = []
    let nowMs = 0
    const coord = new AudioCoordinator(
      [audioEntry({ id: 'purr_01', file: 'p.wav', category: 'action', cooldownSec: 0, maxPerHour: 2 })],
      {
        rhythmConfig: RHYTHM,
        rng: () => 0.5,
        now: () => nowMs,
        hour: () => 12,
      },
      (cmd) => commands.push(cmd),
    )

    // Play 3 times rapidly (cooldown=0, but maxPerHour=2)
    nowMs = 0
    coord.onActionTriggered('petted', null)
    nowMs = 1
    coord.onActionTriggered('petted', null)
    nowMs = 2
    coord.onActionTriggered('petted', null)

    // Only 2 should play
    expect(commands).toHaveLength(2)
  })
})
