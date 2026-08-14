import { describe, expect, it } from 'vitest'

import { decideReplayAction } from '../../src/renderer/sprite/clip-playback'

/**
 * 播放器只决策是否装载或从完整文件开头重播。
 * 不再测试循环点、速率钳制或逐帧媒体逻辑。
 */
describe('原样文件重复播放决策', () => {
  it('文件地址变化时直接装载新文件', () => {
    expect(decideReplayAction(false, false, false, false)).toBe('load')
  })

  it('完整文件循环时不打断浏览器原生循环', () => {
    expect(decideReplayAction(true, true, true, true)).toBe('none')
  })

  it('同一非循环文件播毕后从文件开头重播', () => {
    expect(decideReplayAction(true, false, true, true)).toBe('restart')
  })

  it('同一文件仍在播放时不跳转时间', () => {
    expect(decideReplayAction(true, false, false, false)).toBe('none')
  })
})
