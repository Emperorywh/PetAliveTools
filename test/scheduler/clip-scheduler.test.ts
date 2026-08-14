import { describe, expect, it } from 'vitest'

import { BehaviorFsm } from '../../src/main/behavior/fsm'
import {
  ClipScheduler,
  type ClipSchedulerConfig,
} from '../../src/main/scheduler/clip-scheduler'
import type { ClipMeta } from '../../src/shared/types/clip-meta'

/**
 * 构造已从 clips/ 扫描出来的片段描述。
 * 调度器只能选择 fileName，不获得媒体时长、轨迹或画面变换参数。
 */
function clip(id: string, state: string, loop = false): ClipMeta {
  return {
    id,
    fileName: `${id}.webm`,
    state,
    category: state === 'petted' ? 'interactive' : 'basic',
    direction: 'none',
    anchor: 'sit',
    loop,
    signature: false,
    variant: 1,
    prop: false,
    embeddedAudio: true,
    audio: null,
    hitbox: [0.1, 0.05, 0.8, 0.9],
  }
}

/**
 * 使用确定性随机源创建调度器。
 * 配置只包含行为节奏，不包含任何视频处理或窗口运动参数。
 */
function scheduler(clips: readonly ClipMeta[]): ClipScheduler {
  const config: ClipSchedulerConfig = {
    idleConfig: {
      idleIntervalMs: 8_000,
      activeIntervalMs: 3_000,
      exhaustionMultiplier: 1.5,
      exhaustionThreshold: 3,
    },
    planOptions: {},
    rng: () => 0,
  }
  return new ClipScheduler({ fsm: new BehaviorFsm({ rng: () => 0 }), clips }, config)
}

describe('原样片段调度器', () => {
  it('交互抢占只发出最小文件播放命令', () => {
    const target = clip('petted__none__01', 'petted')
    const instance = scheduler([
      clip('idle_sit__none__01', 'idle_sit', true),
      target,
    ])
    const result = instance.preempt('petted', 100)
    const play = result.commands.find((command) => command.kind === 'play')

    expect(play).toEqual({ kind: 'play', clip: target, loop: false })
    expect(play).not.toHaveProperty('playbackRate')
    expect(play).not.toHaveProperty('mirrored')
    expect(play).not.toHaveProperty('walk')
  })

  it('墙钟推进不会猜测非循环视频已经结束', () => {
    const instance = scheduler([
      clip('idle_sit__none__01', 'idle_sit', true),
      clip('petted__none__01', 'petted'),
    ])
    instance.preempt('petted', 0)

    const afterLongWait = instance.tick(3_600_000)
    expect(afterLongWait.cycleCompleted).toBe(false)
    expect(instance.snapshot.phase).toBe('cycling')
  })

  it('只有 ended 对应的显式完成调用才推进非循环文件', () => {
    const instance = scheduler([
      clip('idle_sit__none__01', 'idle_sit', true),
      clip('petted__none__01', 'petted'),
    ])
    instance.preempt('petted', 0)
    const completed = instance.completeCurrentPlayback(1_000)

    expect(completed.cycleCompleted).toBe(true)
    expect(instance.snapshot.phase).toBe('idle')
  })

  it('循环标记只表示完整文件循环', () => {
    const instance = scheduler([
      clip('idle_sit__none__01', 'idle_sit', true),
      clip('petted__none__01', 'petted', true),
    ])
    instance.preempt('petted', 0)

    expect(instance.isPlayingLoop).toBe(true)
  })
})
