/**
 * 行为引擎模块 (behavior) — Phase 1b 基础生命状态
 *
 * 负责：确定性状态机 (§9.1–§9.3)、锚定姿态中转机制 (§8)、
 * 状态→片段解析与占位兜底 (§5.5)、崩溃恢复回锚定 (§13)。
 * 需求模型 / 性格 / 节律 / 调度 / 交互抢占见 TASK-011/012/013。
 *
 * 运行于主进程，逻辑为纯函数，可供测试直接调用。
 */

export {
  BEHAVIOR_STATES,
  STATE_ANCHOR_FOR,
  FSM_RECOVERY_STATE,
  BehaviorFsm,
} from './fsm'
export type { BehaviorState, BehaviorFsmOptions, FsmSnapshot, TransitionResult } from './fsm'

export {
  TRANSITION_WEIGHTS,
  getNeighbors,
  getOutgoingEdges,
  isTransitionAllowed,
  createSeededRandom,
  sampleWeightedEdge,
} from './transitions'
export type { WeightedEdge } from './transitions'

export {
  TRANSITION_CLIP_STATE,
  ENDPOINTS,
  transitionClipId,
  parseTransitionClip,
  findTransitionClip,
  getClipVariants,
  selectClipForState,
} from './state-lookup'
export type {
  TransitionEndpoint,
  VariantPicker,
  TransitionClipEndpoints,
} from './state-lookup'

export {
  STATE_ANCHORS,
  ANCHOR_STATE,
  LOOP_FRAGMENT_STATES,
  isLoopFragmentState,
  resolveAnchorPose,
  FALLBACK_EASING_MS_RANGE,
  DEFAULT_FALLBACK_EASING_MS,
  PROP_FADE_MS_RANGE,
  DEFAULT_PROP_FADE_MS,
  clampFallbackEasingMs,
  clampPropFadeMs,
  planStateTransition,
} from './anchor-transition'
export type {
  AnchorPose,
  TransitionStepKind,
  StepRole,
  TransitionStep,
  TransitionPlan,
  PlanContext,
  PlanOptions,
} from './anchor-transition'
