/**
 * 导入流程集成测试 (§5.5)
 *
 * 覆盖验收条件：
 * - 清单分组展示 + 最小启动集置顶 (shooting-list, checklist)
 * - 变体数 vs 建议数 + 缺失标红 (checklist)
 * - 分步导入流程 (import-flow 状态机)
 * - ClipMeta 构建 + clips.meta.json 写入验证
 * - 行走类片段含 moveStartSec/moveEndSec/track
 */
import { describe, it, expect } from 'vitest'
import * as path from 'node:path'
import * as os from 'node:os'
import { promises as fs } from 'node:fs'

import {
  SHOOTING_LIST,
  SHOOTING_CATEGORIES,
  getStartupSetItems,
  findItemByState,
  clipCategoryToShooting,
} from '../../src/shared/pipeline/shooting-list'
import {
  buildChecklist,
  computeStartupSet,
  countIngestedVariants,
  hasWalkDirections,
  nextVariantNumber,
} from '../../src/shared/pipeline/checklist'
import {
  createImportFlow,
  updateData,
  advance,
  retreat,
  isLastStep,
  currentStepIndex,
  validateStep,
  buildClipMeta,
  buildTranscodeRequest,
  getStepSequence,
  makeClipId,
  type ImportFlowState,
} from '../../src/shared/pipeline/import-flow'
import type { ClipMeta } from '../../src/shared/types/clip-meta'
import type { TrackFile } from '../../src/shared/types/track-file'
import { appendClipToProject } from '../../src/main/pipeline/ipc-handlers'
import { createProject, loadProject } from '../../src/main/persistence/project-io'

// ─────────────────────────────────────────────────────────── //
//  Shooting List 数据模型                                     //
// ─────────────────────────────────────────────────────────── //

describe('SHOOTING_LIST', () => {
  it('contains A/B/D categories (C is user-defined, no fixed items)', () => {
    const cats = new Set(SHOOTING_LIST.map((i) => i.category))
    expect(cats.has('A')).toBe(true)
    expect(cats.has('B')).toBe(true)
    expect(cats.has('D')).toBe(true)
    // C (个性招牌) is user-defined per §4.4 — no fixed shooting list items
  })

  it('A category has idle_sit, stand, walk, lie, sleep, groom, turn, transition', () => {
    const aItems = SHOOTING_LIST.filter((i) => i.category === 'A')
    const states = aItems.map((i) => i.state)
    expect(states).toContain('idle_sit')
    expect(states).toContain('stand')
    expect(states).toContain('walk')
    expect(states).toContain('lie')
    expect(states).toContain('sleep')
    expect(states).toContain('groom')
    expect(states).toContain('turn')
    expect(states).toContain('transition')
  })

  it('B category has petted, clicked, called, dragged', () => {
    const bItems = SHOOTING_LIST.filter((i) => i.category === 'B')
    const states = bItems.map((i) => i.state)
    expect(states).toContain('petted')
    expect(states).toContain('clicked')
    expect(states).toContain('called')
    expect(states).toContain('dragged')
  })

  it('D category has beg_food, drink, want_play, bored, happy', () => {
    const dItems = SHOOTING_LIST.filter((i) => i.category === 'D')
    const states = dItems.map((i) => i.state)
    expect(states).toContain('beg_food')
    expect(states).toContain('drink')
    expect(states).toContain('want_play')
    expect(states).toContain('bored')
    expect(states).toContain('happy')
  })

  it('SHOOTING_CATEGORIES has 4 categories with labels', () => {
    expect(SHOOTING_CATEGORIES).toHaveLength(4)
    expect(SHOOTING_CATEGORIES.map((c) => c.id)).toEqual(['A', 'B', 'C', 'D'])
    for (const c of SHOOTING_CATEGORIES) {
      expect(c.label.length).toBeGreaterThan(0)
      expect(c.subtitle.length).toBeGreaterThan(0)
    }
  })
})

describe('getStartupSetItems', () => {
  it('returns only startupSet items', () => {
    const items = getStartupSetItems()
    expect(items.length).toBeGreaterThan(0)
    expect(items.every((i) => i.startupSet)).toBe(true)
  })

  it('includes the 6 core states: idle_sit, stand, walk, lie, sleep', () => {
    const items = getStartupSetItems()
    const states = items.map((i) => i.state)
    expect(states).toContain('idle_sit')
    expect(states).toContain('stand')
    expect(states).toContain('walk')
    expect(states).toContain('lie')
    expect(states).toContain('sleep')
  })

  it('walk is the only walk-type item in startup set', () => {
    const items = getStartupSetItems()
    const walkItems = items.filter((i) => i.isWalk)
    expect(walkItems).toHaveLength(1)
    expect(walkItems[0].state).toBe('walk')
  })
})

describe('findItemByState', () => {
  it('finds idle_sit', () => {
    const item = findItemByState('idle_sit')
    expect(item).toBeDefined()
    expect(item!.label).toContain('端坐')
  })

  it('returns undefined for unknown state', () => {
    expect(findItemByState('nonexistent')).toBeUndefined()
  })
})

describe('clipCategoryToShooting', () => {
  it('maps basic→A, interactive→B, signature→C, emotion→D', () => {
    expect(clipCategoryToShooting('basic')).toBe('A')
    expect(clipCategoryToShooting('interactive')).toBe('B')
    expect(clipCategoryToShooting('signature')).toBe('C')
    expect(clipCategoryToShooting('emotion')).toBe('D')
  })
})

// ─────────────────────────────────────────────────────────── //
//  Checklist 计算                                             //
// ─────────────────────────────────────────────────────────── //

function makeClip(state: string, overrides: Partial<ClipMeta> = {}): ClipMeta {
  return {
    id: `${state}_${overrides.variant ?? 1}`.padStart(2, '0'),
    state,
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

describe('countIngestedVariants', () => {
  it('counts clips by state', () => {
    const clips = [
      makeClip('idle_sit', { variant: 1 }),
      makeClip('idle_sit', { variant: 2 }),
      makeClip('stand', { variant: 1 }),
    ]
    expect(countIngestedVariants('idle_sit', clips)).toBe(2)
    expect(countIngestedVariants('stand', clips)).toBe(1)
    expect(countIngestedVariants('walk', clips)).toBe(0)
  })

  it('ignores placeholder clips', () => {
    const clips = [
      makeClip('idle_sit'),
      { ...makeClip('idle_sit'), id: '__placeholder_idle_sit__' },
    ]
    expect(countIngestedVariants('idle_sit', clips)).toBe(1)
  })
})

describe('hasWalkDirections', () => {
  it('detects left and right walk clips', () => {
    const clips = [
      makeClip('walk', { direction: 'left' }),
      makeClip('walk', { direction: 'right' }),
    ]
    const result = hasWalkDirections(clips)
    expect(result.hasLeft).toBe(true)
    expect(result.hasRight).toBe(true)
  })

  it('reports missing direction', () => {
    const clips = [makeClip('walk', { direction: 'left' })]
    const result = hasWalkDirections(clips)
    expect(result.hasLeft).toBe(true)
    expect(result.hasRight).toBe(false)
  })
})

describe('computeStartupSet', () => {
  it('reports incomplete when no clips', () => {
    const ss = computeStartupSet([])
    expect(ss.complete).toBe(false)
    expect(ss.satisfiedCount).toBe(0)
    expect(ss.missingStates.length).toBeGreaterThan(0)
  })

  it('reports incomplete when walk missing a direction', () => {
    const clips = [
      makeClip('idle_sit'),
      makeClip('stand'),
      makeClip('walk', { direction: 'left' }), // missing right
      makeClip('lie'),
      makeClip('sleep'),
      makeClip('transition'),
    ]
    const ss = computeStartupSet(clips)
    expect(ss.complete).toBe(false)
    // walk entry should not be satisfied (missing right direction)
    const walkEntry = ss.entries.find((e) => e.item.state === 'walk')
    expect(walkEntry!.satisfied).toBe(false)
  })

  it('reports complete when all startup items satisfied', () => {
    const clips = [
      makeClip('idle_sit'),
      makeClip('stand'),
      makeClip('walk', { direction: 'left', variant: 1, id: 'walk_left_01' }),
      makeClip('walk', { direction: 'right', variant: 2, id: 'walk_right_01' }),
      makeClip('lie'),
      makeClip('sleep'),
      makeClip('transition'),
    ]
    const ss = computeStartupSet(clips)
    expect(ss.complete).toBe(true)
    expect(ss.missingStates).toHaveLength(0)
  })
})

describe('buildChecklist', () => {
  it('returns 4 groups', () => {
    const status = buildChecklist([])
    expect(status.groups).toHaveLength(4)
    expect(status.groups.map((g) => g.category)).toEqual(['A', 'B', 'C', 'D'])
  })

  it('marks missing states as missing and red', () => {
    const status = buildChecklist([])
    const idleEntry = status.groups
      .find((g) => g.category === 'A')!
      .entries.find((e) => e.item.state === 'idle_sit')!
    expect(idleEntry.missing).toBe(true)
    expect(idleEntry.ingestedCount).toBe(0)
  })

  it('shows correct variant count vs suggested', () => {
    const clips = [makeClip('idle_sit'), makeClip('idle_sit', { variant: 2 })]
    const status = buildChecklist(clips)
    const idleEntry = status.groups
      .find((g) => g.category === 'A')!
      .entries.find((e) => e.item.state === 'idle_sit')!
    expect(idleEntry.ingestedCount).toBe(2)
    expect(idleEntry.satisfied).toBe(true)
  })

  it('startup set is pinned at top with progress info', () => {
    const status = buildChecklist([])
    expect(status.startupSet.entries.length).toBeGreaterThan(0)
    expect(status.startupSet.complete).toBe(false)
  })

  it('allMissingStates lists all states with 0 clips', () => {
    const status = buildChecklist([])
    expect(status.allMissingStates.length).toBeGreaterThan(5)
    expect(status.allMissingStates).toContain('idle_sit')
  })
})

describe('nextVariantNumber', () => {
  it('returns 1 for state with no clips', () => {
    expect(nextVariantNumber('idle_sit', [])).toBe(1)
  })

  it('returns N+1 for state with N clips', () => {
    const clips = [makeClip('idle_sit'), makeClip('idle_sit', { variant: 2 })]
    expect(nextVariantNumber('idle_sit', clips)).toBe(3)
  })
})

// ─────────────────────────────────────────────────────────── //
//  Import Flow 状态机                                         //
// ─────────────────────────────────────────────────────────── //

describe('getStepSequence', () => {
  it('non-walk clips skip walk-tracking', () => {
    const steps = getStepSequence(false)
    expect(steps).not.toContain('walk-tracking')
    expect(steps).toContain('crop-loop')
    expect(steps).toContain('metadata')
  })

  it('walk clips include walk-tracking', () => {
    const steps = getStepSequence(true)
    expect(steps).toContain('walk-tracking')
    // walk-tracking is between crop-loop and metadata
    const cropIdx = steps.indexOf('crop-loop')
    const walkIdx = steps.indexOf('walk-tracking')
    const metaIdx = steps.indexOf('metadata')
    expect(cropIdx).toBeLessThan(walkIdx)
    expect(walkIdx).toBeLessThan(metaIdx)
  })
})

describe('createImportFlow', () => {
  it('creates flow for idle_sit (non-walk)', () => {
    const item = findItemByState('idle_sit')!
    const state = createImportFlow(item, 1)
    expect(state.isWalk).toBe(false)
    expect(state.step).toBe('select-video')
    expect(state.data.clipId).toBe('idle_sit_01')
    expect(state.data.variant).toBe(1)
  })

  it('creates flow for walk (walk-type)', () => {
    const item = findItemByState('walk')!
    const state = createImportFlow(item, 1)
    expect(state.isWalk).toBe(true)
    expect(state.steps).toContain('walk-tracking')
  })
})

describe('validateStep', () => {
  it('select-video requires videoPath', () => {
    const item = findItemByState('idle_sit')!
    const state = createImportFlow(item, 1)
    const result = validateStep(state)
    expect(result.ok).toBe(false)
    expect(result.error).toContain('视频')
  })

  it('select-video passes with video data', () => {
    const item = findItemByState('idle_sit')!
    const state = updateData(createImportFlow(item, 1), {
      videoPath: '/test/video.mp4',
      videoWidth: 1920,
      videoHeight: 1080,
    })
    const result = validateStep(state)
    expect(result.ok).toBe(true)
  })

  it('background-reference requires referenceColor', () => {
    const item = findItemByState('idle_sit')!
    let state = updateData(createImportFlow(item, 1), {
      videoPath: '/test/video.mp4',
      videoWidth: 1920,
      videoHeight: 1080,
    })
    state = advance(state) as ImportFlowState
    const result = validateStep(state)
    expect(result.ok).toBe(false)
    expect(result.error).toContain('参考色')
  })
})

describe('advance / retreat', () => {
  function setupIdleSitFlow(): ImportFlowState {
    const item = findItemByState('idle_sit')!
    let state = createImportFlow(item, 1)
    state = updateData(state, {
      videoPath: '/test/video.mp4',
      videoWidth: 1920,
      videoHeight: 1080,
      videoDurationSec: 5,
    })
    return state
  }

  it('advance moves to next step when valid', () => {
    let state = setupIdleSitFlow()
    state = advance(state) as ImportFlowState
    expect(state.step).toBe('background-reference')
  })

  it('advance returns error when invalid', () => {
    const item = findItemByState('idle_sit')!
    const state = createImportFlow(item, 1) // no video
    const result = advance(state)
    expect('error' in result).toBe(true)
  })

  it('retreat moves to previous step', () => {
    let state = setupIdleSitFlow()
    state = advance(state) as ImportFlowState // → background-reference
    state = retreat(state)
    expect(state.step).toBe('select-video')
  })

  it('retreat does nothing on first step', () => {
    const item = findItemByState('idle_sit')!
    const state = createImportFlow(item, 1)
    const retreated = retreat(state)
    expect(retreated.step).toBe('select-video')
  })
})

describe('isLastStep / currentStepIndex', () => {
  it('isLastStep is false initially', () => {
    const item = findItemByState('idle_sit')!
    const state = createImportFlow(item, 1)
    expect(isLastStep(state)).toBe(false)
  })

  it('isLastStep is true on transcode-save', () => {
    const item = findItemByState('idle_sit')!
    const state = { ...createImportFlow(item, 1), step: 'transcode-save' as const }
    expect(isLastStep(state)).toBe(true)
  })

  it('currentStepIndex returns correct index', () => {
    const item = findItemByState('idle_sit')!
    const state = createImportFlow(item, 1)
    expect(currentStepIndex(state)).toBe(0)
  })
})

// ─────────────────────────────────────────────────────────── //
//  buildClipMeta                                              //
// ─────────────────────────────────────────────────────────── //

describe('buildClipMeta', () => {
  it('builds correct ClipMeta for non-walk clip', () => {
    const item = findItemByState('idle_sit')!
    let state = createImportFlow(item, 1)
    state = updateData(state, {
      videoPath: '/test/video.mp4',
      videoWidth: 1920,
      videoHeight: 1080,
      referenceColor: { r: 128, g: 128, b: 128 },
    })
    const clip = buildClipMeta(state)
    expect(clip.id).toBe('idle_sit_01')
    expect(clip.state).toBe('idle_sit')
    expect(clip.category).toBe('basic')
    expect(clip.anchor).toBe('sit')
    expect(clip.variant).toBe(1)
    expect(clip.moveStartSec).toBeUndefined()
    expect(clip.moveEndSec).toBeUndefined()
    expect(clip.track).toBeUndefined()
  })

  it('builds ClipMeta with walk fields for walk clips', () => {
    const item = findItemByState('walk')!
    let state = createImportFlow(item, 1)
    const trackFile: TrackFile = {
      version: 1,
      fps: 30,
      frameCount: 3,
      offsets: [0, 1.5, 3.0],
      keypoints: [],
    }
    state = updateData(state, {
      videoPath: '/test/walk.mp4',
      videoWidth: 1920,
      videoHeight: 1080,
      referenceColor: { r: 100, g: 100, b: 100 },
      direction: 'right',
      moveStartSec: 0.5,
      moveEndSec: 5.0,
      trackFile,
    })
    const clip = buildClipMeta(state)
    expect(clip.state).toBe('walk')
    expect(clip.direction).toBe('right')
    expect(clip.anchor).toBe('stand')
    expect(clip.moveStartSec).toBe(0.5)
    expect(clip.moveEndSec).toBe(5.0)
    expect(clip.track).toBe('walk_01.track.json')
  })

  it('loop clips have loop fields from shooting list item', () => {
    const item = findItemByState('sleep')!
    let state = createImportFlow(item, 1)
    state = updateData(state, {
      videoPath: '/test/sleep.mp4',
      videoWidth: 1920,
      videoHeight: 1080,
      loopInSec: 1.0,
      loopOutSec: 8.0,
    })
    const clip = buildClipMeta(state)
    expect(clip.loop).toBe(true)
    expect(clip.loopInSec).toBe(1.0)
    expect(clip.loopOutSec).toBe(8.0)
  })
})

describe('buildTranscodeRequest', () => {
  it('includes chromaKey when referenceColor set', () => {
    const item = findItemByState('idle_sit')!
    let state = createImportFlow(item, 1)
    state = updateData(state, {
      videoPath: '/test/video.mp4',
      videoWidth: 1920,
      videoHeight: 1080,
      referenceColor: { r: 128, g: 128, b: 128 },
      keyingTolerance: 0.2,
      keyingSoftness: 0.4,
    })
    const req = buildTranscodeRequest(state)
    expect(req.chromaKey).toBeDefined()
    expect(req.chromaKey!.referenceColor).toEqual({ r: 128, g: 128, b: 128 })
    expect(req.chromaKey!.tolerance).toBe(0.2)
    expect(req.chromaKey!.softness).toBe(0.4)
  })

  it('omits chromaKey when no referenceColor', () => {
    const item = findItemByState('idle_sit')!
    const state = updateData(createImportFlow(item, 1), {
      videoPath: '/test/video.mp4',
      videoWidth: 1920,
      videoHeight: 1080,
    })
    const req = buildTranscodeRequest(state)
    expect(req.chromaKey).toBeUndefined()
  })

  it('includes trim when set', () => {
    const item = findItemByState('idle_sit')!
    const state = updateData(createImportFlow(item, 1), {
      videoPath: '/test/video.mp4',
      videoWidth: 1920,
      videoHeight: 1080,
      trimStartSec: 1.0,
      trimEndSec: 5.0,
    })
    const req = buildTranscodeRequest(state)
    expect(req.trimStartSec).toBe(1.0)
    expect(req.trimEndSec).toBe(5.0)
  })
})

describe('makeClipId', () => {
  it('pads variant to 2 digits', () => {
    expect(makeClipId('idle_sit', 1)).toBe('idle_sit_01')
    expect(makeClipId('walk', 12)).toBe('walk_12')
  })
})

// ─────────────────────────────────────────────────────────── //
//  端到端集成：项目 I/O + clip 保存                            //
// ─────────────────────────────────────────────────────────── //

describe('End-to-end: project I/O + clip save', () => {
  it('saves clip to project and reads it back from clips.meta.json', async () => {
    const tmpDir = path.join(os.tmpdir(), `petalive-test-${Date.now()}`)
    await createProject(tmpDir, { name: 'TestPet', symmetrical: true, personality: { liveliness: 0.5, laziness: 0.5, clinginess: 0.5, timidity: 0.5, curiosity: 0.5 } })

    const project = await loadProject(tmpDir)
    expect(project.clips).toHaveLength(0)

    // Build a clip via import flow
    const item = findItemByState('idle_sit')!
    let flowState = createImportFlow(item, 1)
    flowState = updateData(flowState, {
      videoPath: '/test/video.mp4',
      videoWidth: 1920,
      videoHeight: 1080,
      referenceColor: { r: 128, g: 128, b: 128 },
    })
    const clip = buildClipMeta(flowState)

    // Save via appendClipToProject
    const updated = await appendClipToProject(tmpDir, project, clip)
    expect(updated.clips).toHaveLength(1)
    expect(updated.clips[0].id).toBe('idle_sit_01')

    // Read back
    const reloaded = await loadProject(tmpDir)
    expect(reloaded.clips).toHaveLength(1)
    expect(reloaded.clips[0].state).toBe('idle_sit')

    // Clean up
    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  it('saves walk clip with track.json', async () => {
    const tmpDir = path.join(os.tmpdir(), `petalive-walk-test-${Date.now()}`)
    await createProject(tmpDir, { name: 'TestPet', symmetrical: true, personality: { liveliness: 0.5, laziness: 0.5, clinginess: 0.5, timidity: 0.5, curiosity: 0.5 } })

    const project = await loadProject(tmpDir)

    const item = findItemByState('walk')!
    let flowState = createImportFlow(item, 1)
    const trackFile: TrackFile = {
      version: 1,
      fps: 30,
      frameCount: 3,
      offsets: [0, 1.5, 3.0],
      keypoints: [],
    }
    flowState = updateData(flowState, {
      videoPath: '/test/walk.mp4',
      videoWidth: 1920,
      videoHeight: 1080,
      referenceColor: { r: 100, g: 100, b: 100 },
      direction: 'right',
      moveStartSec: 0.5,
      moveEndSec: 5.0,
      trackFile,
    })
    const clip = buildClipMeta(flowState)

    await appendClipToProject(tmpDir, project, clip, trackFile)

    const reloaded = await loadProject(tmpDir)
    expect(reloaded.clips).toHaveLength(1)
    expect(reloaded.clips[0].track).toBe('walk_01.track.json')

    // Verify track.json was written
    const trackPath = path.join(tmpDir, 'clips', 'walk_01.track.json')
    const trackContent = await fs.readFile(trackPath, 'utf-8')
    const track = JSON.parse(trackContent)
    expect(track.fps).toBe(30)
    expect(track.frameCount).toBe(3)

    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  it('checklist reflects updated state after saving clips', async () => {
    const tmpDir = path.join(os.tmpdir(), `petalive-checklist-test-${Date.now()}`)
    await createProject(tmpDir, { name: 'TestPet', symmetrical: true, personality: { liveliness: 0.5, laziness: 0.5, clinginess: 0.5, timidity: 0.5, curiosity: 0.5 } })

    let project = await loadProject(tmpDir)

    // Before: all states missing
    let checklist = buildChecklist(project.clips)
    const idleBefore = checklist.groups.find((g) => g.category === 'A')!
      .entries.find((e) => e.item.state === 'idle_sit')!
    expect(idleBefore.missing).toBe(true)

    // Save an idle_sit clip
    const item = findItemByState('idle_sit')!
    let flowState = createImportFlow(item, 1)
    flowState = updateData(flowState, {
      videoPath: '/test/video.mp4',
      videoWidth: 1920,
      videoHeight: 1080,
      referenceColor: { r: 128, g: 128, b: 128 },
    })
    const clip = buildClipMeta(flowState)
    project = await appendClipToProject(tmpDir, project, clip)

    // After: idle_sit no longer missing
    checklist = buildChecklist(project.clips)
    const idleAfter = checklist.groups.find((g) => g.category === 'A')!
      .entries.find((e) => e.item.state === 'idle_sit')!
    expect(idleAfter.missing).toBe(false)
    expect(idleAfter.ingestedCount).toBe(1)

    await fs.rm(tmpDir, { recursive: true, force: true })
  })
})
