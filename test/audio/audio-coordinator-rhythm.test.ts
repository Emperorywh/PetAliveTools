/**
 * AudioCoordinator.setRhythmConfig 测试 (IR-015)
 *
 * 项目 behavior-config.json 的昼夜节律下发后，环境声频率判定
 * 与 FSM 使用同一份配置（替换构造期硬编码 DEFAULT_RHYTHM）。
 */
import { describe, it, expect } from 'vitest'
import {
  AudioCoordinator,
  type AudioPlayCommand,
} from '../../src/main/audio/audio-coordinator'
import type { AudioMeta } from '../../src/shared/types/audio-meta'
import type { RhythmConfig } from '../../src/shared/types/behavior-config'

/** 22–07 夜间（hour=12 为白天） */
const DAY_AT_12: RhythmConfig = { nightStartHour: 22, nightEndHour: 7, nightSleepBoost: 3.0 }
/** 08–20 夜间（hour=12 为夜间）—— 用于热切换验证 */
const NIGHT_AT_12: RhythmConfig = { nightStartHour: 8, nightEndHour: 20, nightSleepBoost: 3.0 }

function ambientEntry(): AudioMeta {
  return { id: 'amb_01', file: 'amb.wav', label: '环境声', category: 'ambient', cooldownSec: 0, maxPerHour: 10000 }
}

function makeCoordinator(nowRef: { now: number }, commands: AudioPlayCommand[]): AudioCoordinator {
  return new AudioCoordinator(
    [ambientEntry()],
    {
      rhythmConfig: DAY_AT_12,
      rng: () => 0.5,
      now: () => nowRef.now,
      hour: () => 12,
      ambientConfig: {
        dayIntervalSec: [1, 1], // 白天 1s（快测）
        nightIntervalSec: [100, 100], // 夜间 100s
        frequencyMultiplier: 1.0,
      },
    },
    (cmd) => commands.push(cmd),
  )
}

describe('AudioCoordinator.setRhythmConfig (IR-015)', () => {
  it('下发夜间节律后，后续环境声调度按夜间频率（白天→夜间热切换）', () => {
    const commands: AudioPlayCommand[] = []
    const nowRef = { now: 0 }
    const coord = makeCoordinator(nowRef, commands)

    coord.start()
    // 热下发：hour=12 变为夜间（项目配置 08–20）
    coord.setRhythmConfig(NIGHT_AT_12)

    // 首次触发仍按启动时的白天间隔（1s）
    nowRef.now = 6000
    coord.tickAmbient()
    expect(commands).toHaveLength(1)

    // 触发后按新节律重排：夜间 100s → 短期内不再有环境声
    nowRef.now = 7000
    coord.tickAmbient()
    expect(commands).toHaveLength(1)
    nowRef.now = 60_000
    coord.tickAmbient()
    expect(commands).toHaveLength(1)

    // 越过夜间间隔后再次播放
    nowRef.now = 120_000
    coord.tickAmbient()
    expect(commands).toHaveLength(2)

    coord.dispose()
  })

  it('保持白天节律的对照组按白天频率连续播放', () => {
    const commands: AudioPlayCommand[] = []
    const nowRef = { now: 0 }
    const coord = makeCoordinator(nowRef, commands)

    coord.start()
    nowRef.now = 6000
    coord.tickAmbient()
    nowRef.now = 11_500
    coord.tickAmbient()
    nowRef.now = 17_000
    coord.tickAmbient()
    expect(commands.length).toBe(3)

    coord.dispose()
  })
})
