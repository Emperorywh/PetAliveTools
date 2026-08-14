# 主链路集成收口规格说明书（Integration Remediation）

> 版本：v0.1　｜　日期：2026-08-14　｜　状态：**已实施（2026-08-14 完成 IR 阶段 0–4，见文末实施记录）**
> 来源：对 [VERIFICATION.md](VERIFICATION.md) 的独立复核 + 全仓库代码级集成审计（2026-08-14）。
> 与 [SPEC.md](SPEC.md) 的关系：本文档不改动产品设计；SPEC 定义"做什么"，本文档定义"已实现的零件如何闭合成可工作的主链路"。所有"IR-xxx"条目均已附带代码证据，修复以 SPEC 对应章节为行为基准。
> 与 VERIFICATION.md 的关系：本文档是 GAP-001~006 之外的第二批缺口登记，并触发其状态分类法修订（§9）。

---

## 0. 结论摘要

VERIFICATION.md 将"有代码级测试覆盖"登记为"实现已完成，只待用户验证"（其 §3 状态约定）。本次审计表明该登记口径不成立：**853 项单测证明的是零件正确，而多条主链路在集成层断裂**——断裂处恰好位于单测断言边界之外（单测断言返回值，集成路径丢弃返回值）。

关键事实：

1. **交互抢占的渲染命令在最后一厘米被丢弃**：抚摸/点击/喂食/玩具触发的交互片段永远不会出现在屏幕上（IR-001）。这是"零件正确 ≠ 整机工作"的最典型例证。
2. **SPEC §6.2 逐片段锚点、§7.4 尺度、§5.3 循环点、§8.3/§8.4 淡化均未落到渲染端**（IR-002、IR-003）。
3. **行走窗口平移由墙钟驱动，与视频时钟完全脱钩**——§7.2"脚爪不滑步"在集成层没有保障机制（IR-004）。
4. **§9.5 调度微随机化 8 个函数零运行时调用方**（IR-006）；需求/节律权重为调度器构建时快照（IR-007）。
5. **embeddedAudio 端到端不可能**：转码无条件 `-an` 剥轨 + 触发端恒传 null 片段，双死（IR-010）。
6. **ffmpeg 二进制从未交付、打包从未执行**（IR-011、IR-018）。

**以上全部不需要真实宠物素材即可复现**（任意合成 WebM-alpha 占位片段即可），因此"只差真实素材"不成立。真实素材验收项见 §8（停止线），本规格全部修复完成后才到达该停止线。

---

## 1. 分级定义与编号约定

| 级别 | 定义 |
|---|---|
| **P0 主链路断裂** | 运行时主链路（调度→渲染→交互）功能性断裂或 SPEC 强制行为未落地渲染端；占位素材即可复现；阻断 Phase 1b/2 验收 |
| **P1 功能不可达** | 模块已实现且有测试，但运行时不可达、数据丢失或交付缺失；阻断 Phase 1a/3 验收 |
| **P2 体验瑕疵** | 链路可通但行为与 SPEC 有偏差；不阻断验收但影响观感/一致性 |
| **P3 交付缺失** | 打包/分发链路问题 |

编号：`IR-xxx`（Integration Remediation），与 VERIFICATION.md 的 `GAP-xxx` 并列为两套登记；GAP-003/005/006 与本规格的映射见附录 A。

---

## 2. 问题总表

| 编号 | 级别 | 问题 | SPEC 依据 | 主要证据 |
|---|---|---|---|---|
| IR-001 | P0 | 交互抢占渲染命令被丢弃 | §10 | `mouse-handler.ts:108,114,191,196` |
| IR-002 | P0 | 播放载荷缺锚点/尺度/循环点 | §6.2、§7.4、§5.3 | `main/index.ts:536-542`、`video-player.ts:77,79` |
| IR-003 | P0 | fade/easing 命令不下发，道具淡化为硬切 | §8.3、§8.4 | `main/index.ts:531-548` |
| IR-004 | P0 | 行走窗口平移与视频时钟脱钩 | §7.2 | `main/index.ts:487-517`、`clip-scheduler.ts:276` |
| IR-005 | P0 | 同片段连续重选不重播（冻末帧） | §9.5、§15 Phase 1b | `video-player.ts:181-190` |
| IR-006 | P1 | 调度微随机化零接线 | §9.5 | `scheduler/index.ts:61-75`（仅 re-export） |
| IR-007 | P1 | 需求/节律权重为构建时快照 | §9.3、§9.4 | `main/index.ts:422-433,497` |
| IR-008 | P1 | 抚摸/点击/拖拽无需求反馈 | §10、§9.4 | `mouse-handler.ts:106-116` |
| IR-009 | P1 | 调度器与音频系统零连接 | §11.1 | `main/index.ts:526-551` |
| IR-010 | P1 | embeddedAudio 端到端不可能 | §4.8、§11.1 | `import-transcoder.ts:161-162`、GAP-005 |
| IR-011 | P1 | ffmpeg 二进制交付缺失 | §3.3、§5.2 | `ffmpeg.ts:44,63-68`、`electron-builder.yml` |
| IR-012 | P1 | 行走校正关键点不持久化 | §5.3 | `import-wizard.ts:1016,1023-1036` |
| IR-013 | P1 | 音频素材入库无入口 | §11.1、§12.1 | `import-flow.ts:200`、`ipc-handlers.ts:119-132` |
| IR-014 | P2 | idle 命令不下发，片段间冻帧 | §9.5 | `main/index.ts:548` |
| IR-015 | P2 | 音频昼夜节律配置硬编码 | §9.3、§11.1 | `main/index.ts:72-76,172,423-424` |
| IR-016 | P2 | 音量调节不作用于播放中元素 | §11.2 | `renderer/audio/player.ts:54` |
| IR-017 | P2 | 死通道清理（= GAP-003/006 + preload toggleMute） | — | `preload/index.ts:144,168-170`、`main/index.ts:611` |
| IR-018 | P3 | 打包配置残缺、从未冒烟 | §3.2、§15 Phase 4 | `electron-builder.yml`、`package.json` scripts |

---

## 3. P0 详述与修复规格

### IR-001　交互抢占渲染命令被丢弃

- **现象**：抚摸/点击/拖拽/喂食/玩具触发 `scheduler.preempt()` 后，宠物画面无任何变化（仅可能出声）。
- **证据**：`src/main/input/mouse-handler.ts:108,114,191,196` 四处调用 `preempt()/endPreempt()` 均**丢弃返回的 TickResult**；渲染命令分发函数 `processSchedulerCommands` 仅被 tick 循环调用（`src/main/index.ts:502,508`）。抢占产生的 `play` 命令既不进入 tick 循环的后续输出（命令只在状态变更瞬间产生一次），也无其他分发方。
- **为什么单测全绿**：`clip-scheduler.test.ts` 断言的是 `preempt()` 的返回值；集成路径恰恰扔掉返回值——断裂在断言边界之外。
- **SPEC 依据**：§10"交互抢占：用户交互立即抢占当前状态"；§15 Phase 2 验收"交互抢占响应 < 200ms"。
- **修复规格**：
  1. `MouseHandler` 增加命令分发回调注入（如 `setCommandDispatcher(dispatch)`），`preempt/endPreempt` 返回的 `commands` 全部送入与 tick 循环相同的 `processSchedulerCommands` 分发。
  2. 主进程在 `rebuildScheduler` 注入调度器时一并注入分发器。
  3. VERIFICATION.md Phase 2"交互抢占响应"行的证据列须从"IPC 路径存在"升级为"交互片段实际上屏"。
- **验收**：集成测试——模拟 `input:preempt` IPC → 断言 `webContents.send('scheduler:play', …)` 以交互片段 URL 被调用；手动验证（§7 阶段 1）——占位素材下抚摸/点击/喂食均有片段切换。

### IR-002　播放载荷缺锚点/尺度/循环点

- **现象**：所有片段以构造期固定的 `stand` 锚点、`scaleHint=1.0` 渲染；循环片段整文件循环，loopInSec/loopOutSec 从不送达渲染端。
- **证据**：
  - 载荷仅 `(clipUrl, mirrored, loop, hitbox)`：`src/main/index.ts:536-542`、`src/preload/index.ts:160-164`。
  - `SpritePlayer.anchorPoint` 为 readonly、构造期由 `anchorType:'stand'` 定死（`src/renderer/sprite/video-player.ts:77`、`src/renderer/main.ts:84`）；`scaleHint` 仅构造期赋值 1.0（`video-player.ts:79`、`main.ts:86`），无 per-clip 更新入口。
  - 渲染端对 `loopInSec/loopOutSec` 的全部引用只出现在导入向导（grep 证实），播放器仅 `video.loop = loop`（`video-player.ts:182`）。
- **SPEC 依据**：§6.2"所有片段按锚定姿态的关键点对齐"；§7.4"scaleHint 渲染时统一应用"；§5.3"循环片段标注 loopInSec/loopOutSec 确保无缝"。
- **修复规格**：
  1. `scheduler:play` 载荷扩展为结构化对象：`{ clipUrl, mirrored, loop, hitbox, anchor, scaleHint, loopInSec, loopOutSec, playbackRate }`（playbackRate 预留给 IR-006，本期恒 1.0）。
  2. `SpritePlayer.playClip` 接受完整载荷：逐片段更新锚点（`transformOrigin` 重算）、尺度系数；`loop=true` 且 loopIn/Out 有效时用 `timeupdate` 监听在 `loopOutSec` 处 seek 回 `loopInSec`，否则整文件循环。
  3. preload `SchedulerBridge.onPlayClip` 签名同步修改。
- **验收**：单测覆盖 SpritePlayer 逐片段锚点/尺度/循环段逻辑；集成测试断言载荷字段完整；手动验证——端坐↔站立切换无纵向跳动（§7 阶段 1）。

### IR-003　fade/easing 命令不下发，道具淡化为硬切

- **现象**：`prop: true` 片段（进食/喝水/叼玩具）按 §8.4 应 150–250ms 淡入淡出，实际硬切；§8.3 兜底缓动（60–120ms）从未渲染。
- **证据**：调度器与过渡规划**正确生成** fade 步骤（`src/main/behavior/anchor-transition.ts:184-233`、`src/main/scheduler/lifecycle.ts:134-150`），但分发层 `fade_in` 被当普通 play 发送、`fade_out/easing/idle` 整体丢弃（`src/main/index.ts:531-548`，注释原文"无需 IPC"）。渲染端 SpritePlayer 无任何 opacity 处理。
- **SPEC 依据**：§8.4"进入：锚定态 → 150–250ms 淡入至道具片段首帧；退出同样淡出；淡化期间窗口位置保持不动"；§8.3 兜底过渡。
- **修复规格**：
  1. `fade_in/fade_out` 作为独立 IPC 下发（携带 clipUrl、durationMs、mirrored 及 IR-002 的完整片段载荷）。
  2. 渲染端实现精灵层 opacity 渐变（CSS transition 或 rAF 驱动），淡化期间冻结窗口位置（调度器已保证不位移，渲染端只需不平移精灵）。
  3. `easing` 命令映射为切换点 60–120ms 的 opacity/位置微缓动（SPEC §8.3 允许的最后兜底，不依赖素材）。
- **验收**：单测覆盖淡化时序；集成测试——构造 prop 片段调度周期，断言渲染端收到 fade_in → play → fade_out 完整序列；手动验证观感（§7 阶段 1）。

### IR-004　行走窗口平移与视频时钟脱钩

- **现象**：行走时窗口 x 由主进程墙钟（`Date.now()`，100ms tick）采样位移曲线得到；渲染端 `<video>` 独立播放，二者无任何同步。视频加载/软解启动延迟直接转化为滑步；10Hz 离散步进放大抖动感。
- **证据**：`src/main/index.ts:487-517`（SCHEDULER_TICK_MS=100，墙钟）→ `src/main/scheduler/clip-scheduler.ts:276` `elapsedSec = (nowMs - currentItemStartMs)/1000` → `:683-713` 位移采样。全仓库无任何 `video.currentTime` 回传（grep 证实）。
- **SPEC 依据**：§7.2"窗口平移与画面内步态严格同步，脚爪不滑步；曲线值随播放速率同步缩放"；§16 风险 4（行走滑步观感，高优先）。
- **修复规格**：
  1. 渲染端在行走片段播放期间以 ~10Hz 通过 IPC 上报 `(clipId, video.currentTime)`。
  2. 调度器行走位移采样优先使用最近上报的媒体时间；超过阈值（如 300ms）未收到上报则回退墙钟并记日志。
  3. 上报机制同时天然支持 §9.5 播放速率抖动的位移同步（currentTime 已含速率效应，见 IR-006）。
  4. `moveStartSec/moveEndSec` 站定门控逻辑（`clip-scheduler.ts:694-713`）保持不变，仅时钟源替换。
- **验收**：集成测试——注入假媒体时间序列，断言窗口位移与媒体时间一致（含暂停/变速）；手动验证——占位行走素材下连续观看 1 分钟（§7 阶段 1），真实素材滑步观感属 §8 停止线事项。

### IR-005　同片段连续重选不重播（冻末帧）

- **现象**：调度器连续两次选中同一片段时（最小启动集下极常见：stand 仅 1 变体、walk 每方向 1–2 变体），非循环片段冻结在末帧整段周期。
- **证据**：`video-player.ts:181-190`：`if (this.video.src !== src)` 守卫跳过同 src，且从不 seek(0)；非循环片段播毕后 `video.paused=true`，`playClip` 同 src 时不调 `play()`。
- **SPEC 依据**：§15 Phase 1b 验收"仅凭 6 段最小启动集运行 10 分钟无硬切"——冻帧不是硬切，但构成"可见异常停顿"。
- **修复规格**：`playClip` 同 src 且非循环时 `video.currentTime = 0`（或 loopInSec）后 `play()`；同 src 且循环时无需动作。
- **验收**：单测覆盖同 src 重选分支；手动验证——单变体状态下片段正常重播。

---

## 4. P1 详述与修复规格

### IR-006　调度微随机化零接线

- **现象**：§9.5 第 4 条全部四项微随机（播放速率 ±5%、静止时长抖动、位置 x 抖动、片段顺序打乱）及稀有动作插入在运行时均不发生。
- **证据**：`src/main/scheduler/randomization.ts` 的 8 个导出函数（`jitteredPlaybackRate`/`syncedWalkDuration`/`jitteredIdleDuration`/`jitteredPositionX`/`shuffleVariants`/`shouldInsertRareAction`/`pickRareAction`/`generateRandomizationParams`）在 `src/` 内**零运行时调用方**（grep 证实），仅 `scheduler/index.ts:61-75` re-export。变体选择为均匀随机（`clip-scheduler.ts:718-724`），空闲间隔为定值（`main/index.ts:452-456`）。
- **SPEC 依据**：§9.5 四策并用；§15 Phase 2 范围含"调度微随机"。
- **修复规格**：
  1. `ClipScheduler.planNextCycle` 接入 `generateRandomizationParams`：变体洗牌选取、稀有动作按概率插入（受性格好奇调制，`effectiveRareActionProbability`）、空闲间隔抖动、出现位置 x 抖动。
  2. 播放速率抖动随 IR-002 载荷下发 `playbackRate`；**必须依赖 IR-004 的视频时钟**（currentTime 采样天然消除速率-位移失配，`syncedWalkDuration` 用于时长预估）。
  3. 变体耗尽兜底（§9.5 末条，已实现于 idle-scheduler）保持不变。
- **验收**：单测升级为调度级集成测试（注入 rng 断言分布）；手动验证——长时间运行无机械重复感（观感部分属 §8）。

### IR-007　需求/节律权重为构建时快照

- **现象**：运行中需求每 tick 推进（`main/index.ts:497`），但 FSM 权重只在调度器**构建时**合并一次（`:425-430`）；昼夜小时数同样只在构建时采样（`:422`）。会话内"饿了更想讨食""入夜更想睡"不会发生，除非改性格/切 profile/导入片段触发重建。
- **SPEC 依据**：§9.3"需求驱动：数值越高权重越大；节律：昼夜时段调制"。
- **修复规格**：
  1. 周期性（建议 60s）或需求跨越阈值时，用当前 `needsState` 与当前小时重算 `weightOverrides` 并热更新 FSM 配置（`BehaviorFsm` 增加 `updateConfig`，避免整调度器重建打断当前周期）。
  2. 保留构建时合并逻辑作为初始化路径。
- **验收**：调度级集成测试——时间推进+需求推进后断言转移分布漂移；手动验证（§7 阶段 2）。

### IR-008　抚摸/点击/拖拽无需求反馈

- **现象**：仅喂食/玩具有需求增量（`main/index.ts:222-229`）；抚摸（愉悦↑）、点击（注意力↑）、拖拽按 §10 表应有反馈，实际无。
- **SPEC 依据**：§10 交互表（"愉悦↑""注意力↑"）；§9.4 愉悦"交互提升"。
- **修复规格**：`MouseHandler` 抢占路径按交互类型调用 `applyNeedDelta`（数值建议：petted 愉悦+8、clicked 注意力+10、dragged 愉悦-3；最终数值可调），并持久化。
- **验收**：单测断言各交互的需求增量；手动验证（§7 阶段 2）。

### IR-009　调度器与音频系统零连接

- **现象**：FSM 自主调度播放带 `audio` 字段的片段（如讨食叫声）时静默；仅交互路径有动作声（且因 GAP-005 走默认映射）。
- **证据**：`processSchedulerCommands`（`main/index.ts:526-551`）无 audioCoordinator 引用；`src/main/scheduler/` 与 `src/shared/scheduler/` 全文无 audio 引用。
- **SPEC 依据**：§11.1"动作触发声：讨食/玩耍/被抚摸等动作叠加对应采样"。
- **修复规格**：`processSchedulerCommands` 在分发 `play` 时调用 `audioCoordinator.onActionTriggered(clip.state, clip)`（**传真实片段**，同时修复 GAP-005 在调度路径的体现）；音频冷却/上限逻辑（已实现）自然约束频率。
- **验收**：集成测试——调度播放带 audio 片段 → 断言 audio:play IPC 发出；手动验证（§7 阶段 2，合成音频即可）。

### IR-010　embeddedAudio 端到端不可能

- **现象**：标记 `embeddedAudio: true` 的发声片段播放时仍静音——且**物理上不可能有声**，因为入库转码无条件 `-an` 剥除音轨。
- **证据**：
  1. 转码剥轨：`src/main/pipeline/import-transcoder.ts:161-162`（`transcoder.ts:243-244` 同）；`embeddedAudio` 标志对转码参数无影响。
  2. 触发端死：`resolveActionAudio` 规则 1（`src/shared/audio/action-sounds.ts:68-70`）要求非 null clip，而全部调用点传 null（GAP-005：`mouse-handler.ts:109,192,197`、`main/index.ts:251,256`）→ `embedded_start` 运行时不可达 → `embedded_stop` 空转。
  3. 渲染端播放器恒 `muted=true` 创建（`video-player.ts:126`），唯一的解除点（`enableEmbeddedAudio`）因上两条不可达。
- **SPEC 依据**：§4.8"embeddedAudio: true 播放时保留内嵌音轨保证同步"；§11.1 音画同步例外。
- **修复规格**：
  1. 转码：`embeddedAudio=true` 时保留音轨（去 `-an`，加音频转码参数）；同时按 §4.8 支持将原始音轨抽取为独立音频素材入 `audio/`（与 IR-013 联动）。
  2. 抢占路径（`mouse-handler`）在 `preempt` 前解析目标片段并传入 `onActionTriggered`（修复 GAP-005 本体）；调度路径由 IR-009 覆盖。
  3. `playClip` 载荷携带 `embeddedAudio` 标志，渲染端据此决定初始 muted 状态，避免"先出声后被 embedded_start 追认"的时序窗。
- **验收**：集成测试——embeddedAudio 片段从转码参数到渲染端 unmute 全链；手动验证属 §8（需真实发声素材确认同步观感）。

### IR-011　ffmpeg 二进制交付缺失

- **现象**：SPEC §3.3 要求"打包 ffmpeg（离线）"；实际仓库无 ffmpeg 二进制、无 `ffmpeg/` 目录；dev 依赖系统 PATH（`ffmpeg.ts:67-68`）；打包路径解析到 `app.asar` 内部（`ffmpeg.ts:63-65`），而 `electron-builder.yml` 无 `asarUnpack`/`extraResources`——即使放入二进制也无法从 asar 内 spawn。
- **SPEC 依据**：§3.3、§5.2；§15 Phase 1a 验收"完成全流程入库"。
- **修复规格**：
  1. 选定交付方式：vendor 二进制（`resources/ffmpeg/win-x64/ffmpeg.exe`，推荐，离线确定性最强）或 `ffmpeg-static` 依赖。
  2. `electron-builder.yml` 配置 `extraResources`（或 `asarUnpack`）；路径解析顺序改为：显式覆盖（FFMPEG_PATH）→ 打包 `process.resourcesPath` → 仓库 vendor → 系统 PATH 兜底。
  3. 打包配置与 IR-018 一并冒烟。
- **验收**：在**无系统 PATH ffmpeg** 的环境下（可用干净 PATH 的 shell 模拟）完成一次导入转码；打包产物内完成同测（§7 阶段 4）。

### IR-012　行走校正关键点不持久化

- **现象**：导入向导中拖拽位移曲线关键点的校正在预览中生效，但写入磁盘的 track.json 是**未校正的原始曲线 + 空 keypoints**——校正内容丢失。
- **证据**：`import-wizard.ts:1032-1036` trackFile 只在校正视图**初始化时**导出一次（此时 `keypoints: []`，`:1016`）；`onChange` 回调（`:1023-1029`）只回写 `moveStartSec/moveEndSec`，从不重新导出 trackFile。导出方法本身存在（`walk-correction.ts:169-178`），写盘链路存在（`track-file.ts:29-43`）——缺的是"变更后重导出"一环。
- **SPEC 依据**：§5.3"导入 UI 支持手动校正关键点"；§15 Phase 1a 验收"位移曲线校正可用"。
- **修复规格**：`onChange` 中同步 `exportTrackFile()` 结果到 `flowState.data.trackFile`（或保存时统一导出）；`import:saveClip` 写盘内容含校正后 offsets 与 keypoints。
- **验收**：集成测试——模拟关键点编辑后保存，读盘断言 track.json 含编辑结果；手动验证（§7 阶段 3）。

### IR-013　音频素材入库无入口

- **现象**：SPEC §11.1 要求音视频分离入库，但全仓库无音频导入 UI/IPC；`audio.meta.json` 只有创建项目时写入的 `[]`；导入向导把新片段 `audio` 字段**写死为 null**（`import-flow.ts:200`），即便手工建库也无法关联。运行时音频库恒空 → 环境声/动作声整套空转。唯一间接途径是 zip 整体导入（`backup.ts`）。
- **SPEC 依据**：§11.1、§12.1（audio/ + audio.meta.json）；§15 Phase 3。
- **修复规格**：
  1. 导入向导新增音频入库步骤（或独立入口）：选择音频文件 → 拷贝至 `audio/` → 追加 `audio.meta.json`（schema 校验，`src/shared/schemas/audio-meta.ts` 已备）。
  2. 片段打标步骤的 `audio` 字段改为从库中选择（替换写死 null）。
  3. 与 IR-010 的音轨抽取联动：从视频抽取音轨直接入库为可选捷径。
- **验收**：集成测试——音频导入→关联片段→调度播放发声（合成音频）；手动验证（§7 阶段 3）。

---

## 5. P2 详述与修复规格

### IR-014　idle 命令不下发，片段间冻帧

- **现象**：调度周期结束到下一周期开始之间（空闲间隔 3–8s，`main/index.ts:452-456`），非循环片段冻结在末帧。锚定设计（片段止于锚定姿态）使冻帧≈静止姿态，观感可接受但偏呆板；与 IR-005 叠加时冻帧会延伸整个周期。
- **修复规格**：分发层将 `idle` 命令转换为对锚定/占位片段的保活重播（或渲染端在非循环片段 ended 且处于调度空闲时重播当前片段）；IR-005 修复后本项影响大幅降低，可降为观感调优。
- **验收**：手动验证——片段间无"死画面"感（观感项）。

### IR-015　音频昼夜节律配置硬编码

- **现象**：AudioCoordinator 的 `rhythmConfig` 为构造期硬编码 `DEFAULT_RHYTHM`（22–07，`main/index.ts:72-76,172`）；项目 `behavior-config.json` 的 rhythm 设置只喂给 FSM（`:423-424`），用户在设置中修改昼夜时段不影响环境声频率判定。
- **修复规格**：`AudioCoordinator` 增加 `setRhythmConfig`，`rebuildScheduler`/设置更新时下发项目配置。
- **验收**：单测 + 设置面板修改昼夜时段后环境声频率带变化。

### IR-016　音量调节不作用于播放中元素

- **现象**：`AudioPlayer.playSound` 在播放时一次性设定音量（`renderer/audio/player.ts:54`）；调节音量滑杆只影响之后播放的声响。
- **修复规格**：`setVolume` 遍历播放池实时更新；或接受现状并文档化（SPEC §11.2 未强制实时）。
- **验收**：手动验证。

### IR-017　死通道清理（吸收 GAP-003 / GAP-006）

- **现象**：① `scheduler:reset` preload 有监听、主进程无发送方（GAP-003）；② `profile:switched` 主进程有发送方（`main/index.ts:611`）、preload/渲染进程无接收方（GAP-006）；③ preload 暴露的 `audio.toggleMute`（`preload/index.ts:144` → `mouse-handler.ts:126-128`）渲染端无调用者。
- **修复规格**：逐一决定"接线"或"移除"：建议 ①移除（崩溃恢复走重启式，§13 已满足）；②接线（渲染层据此显示当前宠物名/重置 UI 状态）；③移除。
- **验收**：typecheck + 代码审查无死通道。

---

## 6. P3 详述与修复规格

### IR-018　打包配置残缺、从未冒烟

- **现象**：`package.json` 无 pack/dist 脚本；`electron-builder.yml` 仅 13 行，`files` 引用不存在的 `ffmpeg/**`，`buildResources: build` 目录不存在；无 `extraResources/asarUnpack`；仓库无 `dist/` 产物，全部 23 个提交无打包记录。
- **SPEC 依据**：§3.2"用 electron-builder 打包 win-x64"；§15 Phase 4。
- **修复规格**：
  1. 补齐配置：`extraResources`（ffmpeg，见 IR-011）、应用图标、nsis 选项；`package.json` 增加 `dist` 脚本。
  2. **无真实素材打包冒烟测试**：打包 → 安装到干净环境 → 启动 → 空库引导显示 → 导入合成占位片段（验证 IR-011 的 ffmpeg 交付）→ 播放 → 任务管理器采样 CPU/内存。
  3. 冒烟清单并入 VERIFICATION.md §6。
- **验收**：NSIS 安装包在干净 Windows 环境完成上述冒烟全流程。

---

## 7. 修复阶段与验收标准

> 原则：**全部阶段均不依赖真实宠物素材**（合成 WebM-alpha / 合成音频即可）。每阶段结束跑 `typecheck + test + lint` 三件套并更新 VERIFICATION.md。

| 阶段 | 内容 | 验收标准 |
|---|---|---|
| **IR 阶段 0** | VERIFICATION.md 状态分类法修订（§9）；本规格登记 | 文档落地 |
| **IR 阶段 1：渲染主链路** | IR-001 ~ IR-005 | 占位素材下：交互片段上屏；端坐↔站立锚定无纵向跳动；prop 片段淡入淡出；行走位移与视频 currentTime 同步（集成测试断言）；同片段重选正常重播 |
| **IR 阶段 2：行为与音频接线** | IR-006 ~ IR-010 | 调度级集成测试：微随机分布、需求/节律漂移、交互需求反馈、调度动作声；合成音频下 embeddedAudio 全链（转码参数→unmute） |
| **IR 阶段 3：入库管线** | IR-011 ~ IR-013 | 无 PATH ffmpeg 环境完成导入闭环；关键点校正写盘可回读；音频入库→关联→调度发声 |
| **IR 阶段 4：收尾与交付** | IR-014 ~ IR-018 | P2 逐项走查；NSIS 打包冒烟通过（IR-018 清单） |

阶段间依赖：IR-006 的速率抖动依赖 IR-004（视频时钟）；IR-010 的转码部分依赖 IR-011 交付方式结论；其余可并行。

---

## 8. 停止线：本规格完成后仍 pending 的真实素材验收项

以下事项**只能**用真实宠物素材验收，在此之前保持 pending 是**正确**的（与 VERIFICATION.md §5.5 移交清单一致）：

1. 真猫毛发边缘、溢色与半透明细节观感（§5.1 质量悬崖）。
2. 实际行走脚滑是否低于可感知阈值（§16 风险 4；IR-004 提供机制保障，观感仍需实测）。
3. 双锚点切换的视觉连续性（真实素材姿态一致性）。
4. 人体遮挡/道具观感（§4.7、§16 风险 7）。
5. embeddedAudio 音画同步观感、随机音频疲劳度（§11）。
6. 真实 VP9-alpha 解码下的 CPU/内存实测与多显示器手感（§14；VERIFICATION GAP-001 含片段实测列）。
7. §16 风险 6（采集完成度/弃坑率）——产品层观察项。

---

## 9. 对 VERIFICATION.md 状态分类法的修订要求

本次审计的反例表明，其 §3 状态约定（"pending user verification = 实现已完成且通过代码级测试"）会把**集成断裂**误登记为**只待观感确认**。修订要求：

1. 新增状态 **集成断裂（integration-broken）**：模块各自有测试，但运行时链路不可达/结果丢失。IR-001~005 修复前的对应行应归此列。
2. "pending user verification" 的准入门槛提高为：**链路级集成测试通过**（断言跨进程/跨模块的真实调用结果，而非仅单模块返回值），仅剩观感/手感/真实素材项待人工确认。
3. 每条"通过（代码级）"或"pending user verification"的证据列必须区分：**单测证据** vs **集成证据**。

---

## 附录 A：与 VERIFICATION.md GAP 登记的关系

| VERIFICATION GAP | 状态 | 本规格处置 |
|---|---|---|
| GAP-001 性能实测 | 部分完成（空载达标，含片段为估算） | 属 §8 停止线第 6 项；IR-018 冒烟补充打包形态实测 |
| GAP-002 手动验证未执行 | 开放 | 本规格修复完成后按 §7 重新执行，而非按原清单 |
| GAP-003 scheduler:reset 无发送方 | 开放 | 并入 IR-017 |
| GAP-004 非活跃目录导入不热加载 | 设计如此 | 维持文档化结论，不修复 |
| GAP-005 交互动作声传 null 片段 | 开放 | 由 IR-009（调度路径）与 IR-010（抢占路径）联合修复；登记的影响面（embedded 不可达 + clip.audio 关联失效）经本次审计确认且扩大（`-an` 物理断轨） |
| GAP-006 profile:switched 无接收方 | 开放 | 并入 IR-017 |

---

## 附录 B：实施记录（2026-08-14）

> 实施结果汇总；逐项证据见 [VERIFICATION.md](VERIFICATION.md) §5 第三轮修复。三件套全绿：`typecheck` 0 错误 / `test` 63 文件 922 用例（新增 69 项 IR 用例）/ `lint` 通过。

| 编号 | 状态 | 实施要点 |
|---|---|---|
| IR-001 | ✅ 已修复 | `MouseHandler.setCommandDispatcher` 注入与 tick 同链路的 `SchedulerCommandDispatcher`；集成测试断言 preempt IPC → `scheduler:play` 上屏 |
| IR-002 | ✅ 已修复 | `scheduler:play` 结构化载荷（anchor/scaleHint/loopInSec/loopOutSec/playbackRate…）；SpritePlayer 逐片段锚点（transform-origin 重算）+ 循环段 seek |
| IR-003 | ✅ 已修复 | `scheduler:fade-in`/`fade-out`/`easing` 独立 IPC；渲染端 opacity 渐变，淡化期间不平移 |
| IR-004 | ✅ 已修复 | 渲染端 ~10Hz 上报 `video.currentTime`；调度器位移采样优先媒体时间，>300ms 回退墙钟并记日志 |
| IR-005 | ✅ 已修复 | 同 src 非循环且已播毕 → 回入点重播；播放中不重卷（fade_in→play 序列安全） |
| IR-006 | ✅ 已修复 | `planNextCycle` 接入微随机：洗牌袋变体（不立即重复）、稀有动作 preserveFsm 插入（好奇调制）、空闲间隔/位置 x 抖动、速率 ±5% 随载荷下发 |
| IR-007 | ✅ 已修复 | `BehaviorFsm.updateConfig` 热更新；60s 周期 + 交互后用当前需求/小时重算权重与夜间速率 |
| IR-008 | ✅ 已修复 | `INTERACTION_NEED_DELTAS`（petted +8 愉悦 / clicked +10 注意力 / dragged -3 愉悦）经回调应用并持久化 |
| IR-009 | ✅ 已修复 | 分发器 play 时 `onActionTriggered(state, clip)` 传真实片段；全链测试断言 `audio:play` 发出 |
| IR-010 | ✅ 已修复 | 转码 `keepAudio` 去 `-an`（`-c:a libopus`）；`extractAudioTrack` 入库；三路径真实片段（GAP-005 闭环）；载荷 embeddedAudio 决定初始 mute |
| IR-011 | ✅ 已修复 | 四级解析（FFMPEG_PATH→resourcesPath→仓库 vendor→PATH）+ extraResources；ffmpeg 6.1.1（ffmpeg-static 渠道，用户确认）已 vendor 至 `resources/ffmpeg/win-x64/`；干净 PATH 环境转码/留轨/抽轨实测通过，打包产物内二进制可运行 |
| IR-012 | ✅ 已修复 | 校正 onChange 重导出 trackFile；集成测试断言写盘 track.json 含校正 offsets+keypoints |
| IR-013 | ✅ 已修复 | selectAudio/saveAudio/extractAudio IPC + 向导音频关联下拉与入库/抽取按钮；schema 校验拒绝重复 id |
| IR-014 | ✅ 已修复 | idle 命令转保活重播（1500ms 节流） |
| IR-015 | ✅ 已修复 | `AudioCoordinator.setRhythmConfig`；rebuildScheduler 下发项目 rhythm |
| IR-016 | ✅ 已修复 | `setVolume` 实时更新播放池与内嵌音轨（按元素增益记录） |
| IR-017 | ✅ 已修复 | `scheduler:reset` 与 `audio.toggleMute` 死通道移除；`profile:switched` 接线（宠物名 toast + UI 重置） |
| IR-018 | ✅ 已修复 | electron-builder.yml 补齐（extraResources/nsis）；pack/dist 脚本；unpacked+NSIS 构建通过，打包产物启动冒烟通过；干净环境安装冒烟列入 §6 步骤 11 |

**遗留**：无代码级遗留项。§8 停止线真实素材验收项与 VERIFICATION.md §6 手动验证（步骤 1–11）维持 pending，待用户执行。
