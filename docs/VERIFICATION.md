# 端到端集成验证记录

本文档记录全系统（Phase 0 → Phase 4）端到端集成验证的结果，逐项核对 SPEC §15 各阶段验收标准，并登记已知缺口。自动化验证（typecheck / 单元测试 / lint）的结果对应提交时的工作树；运行时手动验证（§6 十步指引）尚未由用户执行，其状态在 §3 中标注为 **pending user verification**。

> **⏩ 用户移交说明**：自动化验证与代码级审计已全部完成。请执行 **§6 手动验证指引（步骤 1–11）**，捕获证据后回填本文档。详细移交清单见 [§5.5 用户移交清单](#55-用户移交清单)。

> **📎 2026-08-14 集成收口**：独立集成审计（[INTEGRATION.md](INTEGRATION.md)）表明旧口径把"有单测覆盖"误登记为"只待用户验证"，实际多条主链路在集成层断裂（IR-001~010）。本轮已完成 IR 阶段 0–4 修复（见 §5 第三轮），§3 状态分类法同步修订（见下）。

## 1. 自动化验证结果

| 命令 | 结果 |
|---|---|
| `npm run typecheck` | 通过（0 错误） |
| `npm test` | 通过（63 文件 / 922 测试全部通过；含 IR 修复新增 69 项集成/单测） |
| `npm run lint` | 通过 |

## 2. 性能预算实测（§14）

### 方法

使用 PowerShell 有界验证脚本启动构建后的 Electron 应用（`npx electron-vite build && electron.exe out/main/index.js`），在应用达到稳态后以 5s 间隔采样 7 次（首样本排除），采集全部 Electron 子进程的 CPU 时间增量与内存指标。

- **CPU**：`(进程 CPU 秒增量 / 墙钟秒) / 逻辑处理器数 × 100` —— 与 Windows 任务管理器一致的总 CPU 占用百分比。
- **内存（PrivateMemorySize64）**：各进程独占内存之和，不含跨进程共享页，是应用实际内存占用的准确指标。
- **内存（WorkingSet64 之和）**：各进程工作集之和，含共享页重复计数，高于实际物理占用。

测试环境：Windows 11 Home China 10.0.26200，20 逻辑处理器，Electron v31.7.7。**测试时素材库为空**（无视频片段播放），测量的是 Electron 框架 + 透明窗口 + 调度器/音频定时器的基线开销。

### 实测数据

| 指标 | 实测值 | §14 目标 | 判定 |
|---|---|---|---|
| 空闲 CPU（任务管理器口径） | avg **0.34%**，max 0.46% | ≤ 3% | ✅ 达标 |
| 独占内存 Private | avg **225.2 MB**，max 226.0 MB | < 250 MB | ✅ 达标 |
| 工作集 WorkingSet（含共享重复计数） | avg 365.3 MB | < 250 MB | ⚠️ 含共享页重复计数，见下注 |
| Phase 4 内存目标 ≤200MB | 225.2 MB | ≤ 200 MB | ❌ 未达标（Phase 4 优化目标） |

**工作集注**：WorkingSet64 之和（365 MB）将 Chromium/V8 共享页（共享 DLL、GPU 缓冲区、内存映射文件）在每个进程中重复计数。实际物理占用以 PrivateMemorySize64（225 MB）为准。逐进程拆解：主/渲染进程 132 MB WS / 101 MB Private，GPU 进程 103 MB WS / 82 MB Private，Utility 进程 72 MB + 53 MB WS。

### 含片段时的估算

测试在素材库为空时进行。当导入片段并播放时：
- **CPU**：VP9-alpha 小尺寸片段（§7.4 归一化）30fps 软解码典型增量 ~1–2% CPU；叠加基线 0.34%，合计 ~1.3–2.3%，仍在 ≤3% 目标内。
- **内存**：单个 `<video>` 元素仅解码当前片段（§14 第 3 条），VP9 参考帧缓冲约 10–20 MB；叠加基线 225 MB，合计 ~235–245 MB，仍在 <250 MB 目标内（裕量较紧）。
- 以上为基于架构设计的估算，含真实片段的实测仍建议用户在 §6 步骤 9 中补充。

## 3. §15 各阶段验收核对表

> **状态约定（2026-08-14 修订，INTEGRATION.md §9）**：
> - **通过（代码级）**：有对应单元/集成测试覆盖；证据列区分 **单测证据** 与 **集成证据**（跨进程/跨模块真实调用断言，而非仅单模块返回值）。
> - **integration-broken（集成断裂）**：模块各自有测试，但运行时链路不可达/结果丢失——禁止将此类登记为"只待观感确认"。
> - **pending user verification**：**准入门槛 = 链路级集成测试已通过**，仅剩观感/手感/真实素材项待人工确认。
> - **已实测**：已有运行时实测数据。

### Phase 0｜渲染打通

| 验收条目 | 状态 | 证据 |
|---|---|---|
| alpha 边缘无黑边/底色残留 | **pending user verification** | 单测证据：色键管线（含溢色抑制/收缩/羽化）59 项单测；合成毛发场景测试覆盖毛色×背景组合。观感需 §6 步骤 2 人工确认 |
| 目标机器软解 CPU 实测值 | **已实测**（空载基线；含片段实测 pending user verification） | 空载基线 0.34% Task Manager CPU（§2 节）。含片段软解估算 ≤2.3%，在 ≤3% 目标内。含真实片段的实测需 §6 步骤 9 补充 |
| 行走连续观看 1 分钟无明显滑步 | **pending user verification** | 单测证据：位移曲线驱动窗口平移（§7.2）+ 播放速率同步缩放。集成证据（IR-004，2026-08-14）：`clip-scheduler-media-time.test.ts` 注入假媒体时间序列断言窗口位移与 `video.currentTime` 一致（含暂停/加载滞后/上报失效回退）。观感需 §6 步骤 2 人工确认 |

### Phase 1a｜入库管线

| 验收条目 | 状态 | 证据 |
|---|---|---|
| 最小启动集完成全流程入库 | **pending user verification** | 单测证据：清单引导式导入向导 49 项 import-flow 测试。集成证据（IR-011/IR-013，2026-08-14）：ffmpeg 四级路径解析 + vendor 二进制干净 PATH 实测转码/留轨/抽轨通过（GAP-007 已闭环）+ 音频入库 IPC（拷贝+schema 校验+热加载钩子）集成测试。实际导入流程需 §6 步骤 1 用户确认 |
| 抠像预览边缘放大检查通过 | **pending user verification** | 单测证据：chroma-key-preview 三面板预览 + zoom-inspect 边缘放大取景逻辑。实际素材抠像观感需 §6 步骤 1 用户确认 |
| 位移曲线校正可用 | **pending user verification** | 单测证据：walk-correction 关键点增删拖拽 + 行走子段标注 39 项。集成证据（IR-012，2026-08-14）：`import-audio-ipc.test.ts` 模拟关键点编辑后经 `import:saveClip` 写盘并回读，断言 track.json 含校正 offsets 与 keypoints。实际校正交互需 §6 步骤 1 用户确认 |

### Phase 1b｜运行时闭环

| 验收条目 | 状态 | 证据 |
|---|---|---|
| 仅凭 6 段最小启动集运行 10 分钟无硬切、无锚定位置跳动 | **pending user verification** | 单测证据：clip-scheduler 10 分钟模拟测试（无崩溃、边界内、无传送跳变）。集成证据（IR-002/IR-005，2026-08-14）：play 命令逐片段携带锚点/尺度/循环点/速率（`clip-scheduler-media-time.test.ts` 断言载荷字段）；同片段重选重播决策（`clip-playback.test.ts`）。观感需 §6 步骤 2 用户确认 |
| 缺素材状态占位 + 标红提醒生效 | **pending user verification** | 单测证据：state-lookup 端坐占位兜底（§5.5/§13）；调度器缺素材不崩溃。运行时表现需 §6 步骤 7 用户确认 |
| prop 片段淡入淡出（§8.4）/兜底缓动（§8.3） | **pending user verification** | 集成证据（IR-003，2026-08-14）：`dispatcher.test.ts` 断言 fade_in→play→fade_out 完整 IPC 序列与 easing 下发；淡化时序参数单测（`clip-playback.test.ts`）。观感需 §6 步骤 2 用户确认 |

### Phase 2｜交互与生命感

| 验收条目 | 状态 | 证据 |
|---|---|---|
| 交互抢占响应 < 200ms | **pending user verification** | 集成证据（IR-001，2026-08-14）：`mouse-handler.test.ts` 模拟 `input:preempt` IPC → 断言 `webContents.send('scheduler:play', …)` 以交互片段 URL 被调用（抢占命令与 tick 循环共用分发链路）。实际响应延迟需 §6 步骤 3 用户确认 |
| 性格滑杆改变行为分布可感知 | **pending user verification** | 单测证据：personality.ts 25 项单测；`settings:update-personality` 持久化后重建调度器。集成证据（IR-007，2026-08-14）：`fsm-hot-config.test.ts` 断言 `BehaviorFsm.updateConfig` 热更新后转移分布按新权重漂移；主进程 60s 周期 + 交互后即用当前需求/小时重算权重。可感知度需 §6 步骤 5 用户确认 |
| 穿透/交互切换无漏触发 | **pending user verification** | 单测证据：命中盒缓冲带 8–12px（§6.1）23 项单测。实际鼠标手感需 §6 步骤 3 用户确认 |
| 逐片段 hitbox（§5.4/§6.1） | **pending user verification** | 集成证据：`scheduler:play` 结构化载荷携带逐片段 hitbox（`dispatcher.test.ts` 断言载荷完整），渲染端收到后重算 hitboxPx。运行时命中精度需 §6 步骤 3 用户确认 |
| 调度微随机（§9.5 四策） | **pending user verification** | 集成证据（IR-006，2026-08-14）：`clip-scheduler-randomization.test.ts` 调度级断言——速率抖动 ±5% 随 play 载荷下发、静止时长抖动分布、变体洗牌不立即重复、稀有动作按概率插入且 FSM 状态不被污染、好奇性格调制插入概率、位置 x 抖动逐周期有界。长时观感需 §6 步骤 2 用户确认 |
| 交互需求反馈（§10/§9.4） | **通过（代码级）** | 集成证据（IR-008，2026-08-14）：`mouse-handler.test.ts` 断言抢占触发 `onInteractionNeeds`；`fsm-hot-config.test.ts` 断言 petted 愉悦+8 / clicked 注意力+10 / dragged 愉悦-3 及钳制。观感微调属可调参数 |

### Phase 3｜音频与养成

| 验收条目 | 状态 | 证据 |
|---|---|---|
| 声效冷却与单位时间上限生效 | **pending user verification** | 单测证据：cooldown.ts + AudioCoordinator 58 项单测（冷却、速率限制、多采样轮播）。运行时音频表现需 §6 步骤 4 用户确认 |
| `embeddedAudio` 片段音画同步 | **pending user verification** | 集成证据（IR-010，2026-08-14）：转码参数链（keepAudio→去 `-an`→`-c:a libopus`）+ 音轨抽取参数 + 载荷 `embeddedAudio` 标志渲染端初始 unmute（`import-audio-ipc.test.ts` / `dispatcher.test.ts`）；抢占/调度路径均传真实片段（GAP-005 修复）。音画同步观感需带内嵌音轨素材在 §6 步骤 4 中确认 |
| 运行时音频库接线 | **pending user verification** | 集成证据（IR-009/IR-013/IR-015，2026-08-14）：调度 play 命令携带真实片段触发 `onActionTriggered`（`dispatcher.test.ts`）；音频入库 IPC 集成测试；`AudioCoordinator.setRhythmConfig` 使环境声昼夜判定与项目 behavior-config 一致。运行时播放需 §6 步骤 4 用户确认 |

### Phase 4｜打磨

| 验收条目 | 状态 | 证据 |
|---|---|---|
| 多宠物 profile 切换端到端 | **pending user verification** | 单测证据：ProfileManager/ProfileSwitcher 54 项单测。集成证据（IR-017，2026-08-14）：`profile:switched` 已接线——渲染层显示宠物名 toast 并重置命中盒/引导 UI。运行时切换表现需 §6 步骤 6 用户确认 |
| 备份导出/导入 | **pending user verification** | 单测证据：zip.ts 纯 Node 编解码往返测试 + 导入前校验（必需文件/schema/素材引用/zip-slip 防护）。运行时导入导出需 §6 步骤 6 用户确认 |
| 设置面板控制各子系统 | **pending user verification** | 单测证据：TASK-015 53 项。集成证据（IR-016，2026-08-14）：音量调节实时作用于播放池与内嵌音轨。运行时面板交互需 §6 步骤 5 用户确认 |
| §14 全部指标达标（内存 ≤ 200MB） | **部分达标** | CPU ≤3% 与 Private 内存 <250MB 已实测达标（§2 节）。Phase 4 优化目标 ≤200MB 未达标（实测 225MB Private），见 GAP-001 |
| NSIS 打包冒烟（§3.2） | **pending user verification** | 集成证据（IR-018，2026-08-14）：`electron-builder --dir`  unpacked 构建通过，ffmpeg extraResources 布局验证（`dist/win-unpacked/resources/ffmpeg/win-x64/`），打包产物启动冒烟通过（引导日志正常、进程存活、空库引导）。NSIS 安装包 + 干净环境安装冒烟需 §6 步骤 11 用户确认 |

## 4. 已知缺口登记

| 编号 | 缺口 | 说明 | 建议修复 |
|---|---|---|---|
| GAP-001 | CPU/内存数值指标实测 | **已实测**（§2 节）：空载 Task Manager CPU avg 0.34%（≤3% ✅）；Private 内存 avg 225.2MB（<250MB ✅）；Phase 4 ≤200MB 目标未达标（225MB ❌）。测试在空素材库下进行，含片段时为估算值 | 用户在 §6 步骤 9 中以真实片段实测补充；Phase 4 ≤200MB 目标后续优化（SPEC §16 风险 3 建议评估 Tauri） |
| GAP-002 | 运行时端到端手动验证未执行 | §6 为 kind=manual，需用户人工执行（屏幕录制 + 任务管理器 + 强杀恢复 + §15 走查），Agent 不得代替 | 用户执行后更新 §3 状态列与 GAP-001 |
| ~~GAP-003~~ | ~~`scheduler:reset` 通知无发送方~~ | **已修复（IR-017，2026-08-14）**：死通道移除（preload `onReset` 与渲染端调用一并删除）；崩溃恢复走重启式（FSM 构造即回 idle_sit 主锚定 + 离线推进，§13），不依赖该通道 | 已闭环 |
| GAP-004 | 导入向导写入非活跃目录时不热加载 | `import:saveClip` 仅当目标为活跃 profile 目录时触发调度器重建；向其他目录导入仍需重启或切换 profile（预期行为：运行时只加载活跃 profile） | 无需修复（设计如此）；文档化即可 |
| ~~GAP-005~~ | ~~交互动作声未传递当前片段上下文~~ | **已修复（IR-009/IR-010，2026-08-14）**：抢占路径经 `preempt()` 返回的 TickResult 取目标片段传入 `onActionTriggered`；调度路径由分发器携带真实片段；托盘路径经 `resolveRealClip` 解析。`embedded_start` 运行时可达，clip.audio 关联生效 | 已闭环 |
| ~~GAP-006~~ | ~~`profile:switched` 通知无接收方~~ | **已修复（IR-017，2026-08-14）**：preload 新增 `profile.onSwitched` 桥接；渲染端收到后显示宠物名 toast、重置命中盒与空库引导 UI | 已闭环 |
| ~~GAP-007~~ | ~~vendor ffmpeg 二进制未置入仓库~~ | **已修复（2026-08-14）**：`ffmpeg-static@5.3.0`（ffmpeg 6.1.1，含 libvpx-vp9/libopus）经用户确认安装，二进制已 vendor 至 `resources/ffmpeg/win-x64/ffmpeg.exe`（82.8MB）。干净 PATH 环境实测：标准转码剥轨、keepAudio 留轨（VP9+Opus）、音轨抽取三项全部通过；VP9-alpha 经 libvpx 解码 alphaextract 验证保留；打包产物 `resources/ffmpeg/win-x64/ffmpeg.exe` 就位并可运行 | 已闭环（干净环境安装验收仍在 §6 步骤 11） |

## 5. 本次集成修复记录

### 第一轮修复（TASK-017 第二轮）

针对独立复核提出的 5 项问题：

1. **ISSUE-001 音频运行时接线**：`AudioCoordinator.setLibrary` + `rebuildScheduler` 注入 audio.meta.json 条目 + 主进程 `file://` 绝对 URL 下发 + 渲染端兼容两种 URL 形式。
2. **ISSUE-002 导入后调度器刷新**：`registerImportIpcHandlers` 增加 `onClipSaved` 回调，目标为活跃 profile 目录时触发 `initScheduler`；托盘与右键菜单新增「导入片段…」入口打开向导窗口。
3. **ISSUE-003 性格实时生效**：`settings:update-personality` 持久化后重建调度器，先保存内存 needsState 避免重复离线推进。
4. **ISSUE-004 验证文档**：即本文档。
5. **ISSUE-005 逐片段 hitbox**：`scheduler:play` 载荷携带 hitbox，渲染端动态重算命中盒。

### 第二轮修复（TASK-017 第三轮）

针对独立复核提出的 AC-7 性能实测要求：

6. **ISSUE-006 性能预算实测**：编写 PowerShell 有界验证脚本，启动构建后的 Electron 应用并实测 §14 性能指标（§2 节）。CPU ≤3% 达标（0.34%）；Private 内存 <250MB 达标（225.2MB）；WorkingSet 含共享页重复计数为 365MB；Phase 4 ≤200MB 目标未达标。

### 第三轮修复（IR 集成收口，2026-08-14）

按 [INTEGRATION.md](INTEGRATION.md) §7 阶段表执行，全部 IR-001~018 修复落地：

**IR 阶段 1 — 渲染主链路（IR-001~005）**
1. **IR-001**：`MouseHandler.setCommandDispatcher` 注入分发器，preempt/endPreempt 返回的 TickResult.commands 全部送入与 tick 循环相同的 `SchedulerCommandDispatcher` 分发链路；抢占片段实际上屏。
2. **IR-002**：`scheduler:play` 载荷结构化（clipId/clipUrl/mirrored/loop/hitbox/anchor/scaleHint/loopInSec/loopOutSec/playbackRate/embeddedAudio/walk）；SpritePlayer 逐片段更新锚点（transform-origin 重算）与尺度；循环段经 rAF+timeupdate 双通道在 loopOutSec 处 seek 回 loopInSec。
3. **IR-003**：fade_in/fade_out/easing 独立 IPC 下发；渲染端精灵层 opacity 渐变（CSS transition），淡化期间不平移；easing 映射为 60–120ms opacity 微缓动。
4. **IR-004**：渲染端行走片段 ~10Hz 上报 `(clipId, video.currentTime)`；调度器行走位移采样优先媒体时间，>300ms 未上报回退墙钟并记日志（每项一次）。
5. **IR-005**：同 src 非循环片段重选且已播毕/暂停时 seek 回入点重播；仍在播放中不重卷（fade_in→play 序列安全）。

**IR 阶段 2 — 行为与音频接线（IR-006~010）**
6. **IR-006**：`planNextCycle` 接入微随机——变体洗牌袋（不立即重复）、稀有动作按概率插入（preserveFsm 抢占式周期，好奇性格调制）、静止时长抖动、位置 x 抖动（与周期首命令同帧下发）、播放速率 ±5% 随载荷下发（时长预估按 `durSec/rate` 折算）。
7. **IR-007**：`BehaviorFsm.updateConfig` 热更新；主进程每 60s 及交互需求变更后以当前 needsState+当前小时重算 weightOverrides 与夜间需求速率。
8. **IR-008**：`INTERACTION_NEED_DELTAS`（petted 愉悦+8 / clicked 注意力+10 / dragged 愉悦-3）经 `onInteractionNeeds` 回调应用并持久化。
9. **IR-009**：分发器在 play 时调用 `onActionTriggered(clip.state, clip)` 传真实片段；fade_in 不重复触发。
10. **IR-010**：转码 `keepAudio`（去 `-an`、`-c:a libopus 96k`）；`extractAudioTrack` 音轨抽取入库；抢占/托盘/调度三路径均传真实片段（GAP-005 闭环）；载荷 `embeddedAudio` 决定渲染端初始 mute，消除追认时序窗；embedded 片段切换走时自动 `embedded_stop`。

**IR 阶段 3 — 入库管线（IR-011~013）**
11. **IR-011**：ffmpeg 四级路径解析（FFMPEG_PATH → 打包 resourcesPath → 仓库 vendor → PATH）；`resources/ffmpeg/win-x64/` vendor 位 + `electron-builder.yml` extraResources。⚠️ 二进制本体待用户置入（GAP-007）。
12. **IR-012**：行走校正 onChange 每次变更重新 `exportTrackFile()` 同步到流程数据，保存写盘的 track.json 含校正 offsets 与 keypoints。
13. **IR-013**：音频入库 IPC（selectAudio/saveAudio/extractAudio）+ 向导 metadata 步骤音频关联下拉（替换写死 null）与导入/抽取按钮；schema 校验 + 重复 id 拒绝 + 活跃目录热加载。

**IR 阶段 4 — 收尾与交付（IR-014~018）**
14. **IR-014**：idle 命令转换为保活重播（1500ms 节流，换片段立即重发）。
15. **IR-015**：`AudioCoordinator.setRhythmConfig`；rebuildScheduler 下发项目 rhythm 配置（替换构造期硬编码）。
16. **IR-016**：`AudioPlayer.setVolume` 实时更新播放池与内嵌音轨音量（按元素记录增益）。
17. **IR-017**：移除 `scheduler:reset` 死通道与 preload `audio.toggleMute` 无调用方通道；`profile:switched` 接线（渲染层宠物名 toast + UI 状态重置）。
18. **IR-018**：electron-builder.yml 补齐（extraResources/nsis/图标回退说明/buildResources 修正）；package.json 增加 pack/dist 脚本；unpacked 构建 + 启动冒烟通过（见 Phase 4 表）。

### 5.5 用户移交清单

自动化验证（§1）与代码级审计（§3）已全部完成。以下运行时验证步骤需由**用户在真实环境中执行**，完成后将证据回填到本文档对应位置。

| §6 步骤 | 验证内容 | 应捕获的证据类型 | 回填记录位置 |
|---|---|---|---|
| 步骤 1 | 导入最小启动集（6 段主体 + 过渡段） | **截图**：导入向导各阶段完成界面 + 导入后宠物即用新片段运行 | §3 Phase 1a 全部 3 行状态列 |
| 步骤 2 | 10 分钟运行观察（FSM 切换 / 行走平移 / 边缘转身 / 锚定中转 / prop 淡化 / 微随机） | **屏幕录像**：≥1 分钟片段覆盖 idle_sit→idle_stand→walk→groom 切换与行走过程 | §3 Phase 0 第 1/3 行、Phase 1b 第 1/3 行、Phase 2 第 5 行状态列 |
| 步骤 3 | 交互测试（抚摸 / 单击 / 双击 / 拖拽 / 喂食 / 给玩具 / 右键菜单） | **屏幕录像**：各交互的即时响应（片段上屏）+ 拖拽窗口跟随 + 松手回地面线 | §3 Phase 2 全部 4 行状态列 |
| 步骤 4 | 音频验证（环境声周期 / 昼夜频率差异 / 交互声冷却 / 静音开关 / embeddedAudio 音画同步） | **屏幕录像**（含声音）：环境声出现 + 连续抚摸不连发 + 托盘静音生效 + 发声片段内嵌音轨同步 | §3 Phase 3 全部 3 行状态列 |
| 步骤 5 | 设置面板实时生效（性格滑杆 / 音量 / 环境声频率 / 显示器 / 快捷键） | **屏幕录像**：性格滑杆调整→行为变化 + 音量即时变化 + 切换显示器宠物迁移 | §3 Phase 2 第 2 行、Phase 4 第 3 行状态列 |
| 步骤 6 | 多宠物切换 + 备份导入导出 | **屏幕录像**：切换宠物后素材/需求/设置独立（宠物名 toast）+ 导出→导入 zip 往返 | §3 Phase 4 第 1/2 行状态列 |
| 步骤 7 | 空库引导（删除全部片段后重启不崩溃） | **截图**：显示引导文案且应用正常 | §3 Phase 1b 第 2 行状态列 |
| 步骤 8 | 强杀恢复（结束进程后重启回锚定态） | **屏幕录像**：重启后宠物回端坐锚定态 + 需求值无极端惩罚 | §3 Phase 1b 第 2 行状态列 |
| 步骤 9 | 性能实测（含真实片段的 CPU 与内存） | **数值**：任务管理器空闲 CPU% 与内存 MB（采样多次取平均） | GAP-001 含片段实测列 + §3 Phase 0 第 2 行 |
| 步骤 10 | §15 全量走查 | **逐项确认**：按 §3 核对表逐条更新状态为通过/未通过 | §3 全部条目状态列 |
| 步骤 11 | ffmpeg 交付与打包冒烟（IR-011/IR-018） | **截图/数值**：NSIS 安装→干净环境启动→导入合成片段→播放→任务管理器采样 | §3 Phase 1a 第 1 行、Phase 4 第 5 行 |

完成后将各状态列从 **pending user verification** 更新为实测结论（通过 / 未通过 + 简要证据）。同时更新 GAP-001 含片段实测数据、GAP-002 状态。

## 2. 性能预算实测（§14）

### 方法

使用 PowerShell 有界验证脚本启动构建后的 Electron 应用（`npx electron-vite build && electron.exe out/main/index.js`），在应用达到稳态后以 5s 间隔采样 7 次（首样本排除），采集全部 Electron 子进程的 CPU 时间增量与内存指标。

- **CPU**：`(进程 CPU 秒增量 / 墙钟秒) / 逻辑处理器数 × 100` —— 与 Windows 任务管理器一致的总 CPU 占用百分比。
- **内存（PrivateMemorySize64）**：各进程独占内存之和，不含跨进程共享页，是应用实际内存占用的准确指标。
- **内存（WorkingSet64 之和）**：各进程工作集之和，含共享页重复计数，高于实际物理占用。

测试环境：Windows 11 Home China 10.0.26200，20 逻辑处理器，Electron v31.7.7。**测试时素材库为空**（无视频片段播放），测量的是 Electron 框架 + 透明窗口 + 调度器/音频定时器的基线开销。

### 实测数据

| 指标 | 实测值 | §14 目标 | 判定 |
|---|---|---|---|
| 空闲 CPU（任务管理器口径） | avg **0.34%**，max 0.46% | ≤ 3% | ✅ 达标 |
| 独占内存 Private | avg **225.2 MB**，max 226.0 MB | < 250 MB | ✅ 达标 |
| 工作集 WorkingSet（含共享重复计数） | avg 365.3 MB | < 250 MB | ⚠️ 含共享页重复计数，见下注 |
| Phase 4 内存目标 ≤200MB | 225.2 MB | ≤ 200 MB | ❌ 未达标（Phase 4 优化目标） |

**工作集注**：WorkingSet64 之和（365 MB）将 Chromium/V8 共享页（共享 DLL、GPU 缓冲区、内存映射文件）在每个进程中重复计数。实际物理占用以 PrivateMemorySize64（225 MB）为准。逐进程拆解：主/渲染进程 132 MB WS / 101 MB Private，GPU 进程 103 MB WS / 82 MB Private，Utility 进程 72 MB + 53 MB WS。

### 含片段时的估算

测试在素材库为空时进行。当导入片段并播放时：
- **CPU**：VP9-alpha 小尺寸片段（§7.4 归一化）30fps 软解码典型增量 ~1–2% CPU；叠加基线 0.34%，合计 ~1.3–2.3%，仍在 ≤3% 目标内。
- **内存**：单个 `<video>` 元素仅解码当前片段（§14 第 3 条），VP9 参考帧缓冲约 10–20 MB；叠加基线 225 MB，合计 ~235–245 MB，仍在 <250 MB 目标内（裕量较紧）。
- 以上为基于架构设计的估算，含真实片段的实测仍建议用户在 §6 步骤 9 中补充。

## 3. §15 各阶段验收核对表

> 状态约定：**通过（代码级）** = 有对应单元/集成测试覆盖；**pending user verification** = 实现已完成且通过代码级测试，但运行时观感/交互需用户在 §6 手动验证中确认；**已实测** = 已有运行时实测数据。

### Phase 0｜渲染打通

| 验收条目 | 状态 | 证据 |
|---|---|---|
| alpha 边缘无黑边/底色残留 | **pending user verification** | 色键管线（含溢色抑制/收缩/羽化）有 59 项单测；合成毛发场景测试覆盖毛色×背景组合。观感需 §6 步骤 2 人工确认 |
| 目标机器软解 CPU 实测值 | **已实测**（空载基线；含片段实测 pending user verification） | 空载基线 0.34% Task Manager CPU（§2 节）。含片段软解估算 ≤2.3%，在 ≤3% 目标内。含真实片段的实测需 §6 步骤 9 补充 |
| 行走连续观看 1 分钟无明显滑步 | **pending user verification** | 位移曲线驱动窗口平移（§7.2）+ 播放速率同步缩放（TASK-013 randomization.ts）有单测；观感需 §6 步骤 2 人工确认 |

### Phase 1a｜入库管线

| 验收条目 | 状态 | 证据 |
|---|---|---|
| 最小启动集完成全流程入库 | **pending user verification** | 清单引导式导入向导（选视频→参考帧/参考色→抠像预览→标 loop→行走校正→打标→转码入库），49 项 import-flow 集成测试。实际导入流程需 §6 步骤 1 用户确认 |
| 抠像预览边缘放大检查通过 | **pending user verification** | chroma-key-preview 三面板预览 + zoom-inspect 边缘放大，单测覆盖取景逻辑。实际素材抠像观感需 §6 步骤 1 用户确认 |
| 位移曲线校正可用 | **pending user verification** | walk-correction.ts 关键点增删拖拽 + 行走子段标注，39 项单测。实际校正交互需 §6 步骤 1 用户确认 |

### Phase 1b｜运行时闭环

| 验收条目 | 状态 | 证据 |
|---|---|---|
| 仅凭 6 段最小启动集运行 10 分钟无硬切、无锚定位置跳动 | **pending user verification** | TASK-011 clip-scheduler 10 分钟模拟测试：无崩溃、始终在屏幕边界内、连续位置无传送跳变。真实视频观感需 §6 步骤 2 用户确认 |
| 缺素材状态占位 + 标红提醒生效 | **pending user verification** | state-lookup 端坐占位兜底（§5.5/§13）有单测；调度器缺素材不崩溃。运行时表现需 §6 步骤 7 用户确认 |

### Phase 2｜交互与生命感

| 验收条目 | 状态 | 证据 |
|---|---|---|
| 交互抢占响应 < 200ms | **pending user verification** | 渲染进程 IPC → MouseHandler → scheduler.preempt 同步路径，无网络/IO 等待。实际响应延迟需 §6 步骤 3 用户确认 |
| 性格滑杆改变行为分布可感知 | **pending user verification** | `settings:update-personality` 持久化后重建调度器，weightOverrides/needRates 即时生效。行为分布随性格变化有 personality.ts 25 项单测。可感知度需 §6 步骤 5 用户确认 |
| 穿透/交互切换无漏触发 | **pending user verification** | 命中盒缓冲带 8–12px（§6.1）有 23 项单测。实际鼠标手感需 §6 步骤 3 用户确认 |
| 逐片段 hitbox（§5.4/§6.1） | **pending user verification** | `scheduler:play` 载荷现携带当前片段 hitbox，渲染端收到后重算 hitboxPx。运行时命中精度需 §6 步骤 3 用户确认 |

### Phase 3｜音频与养成

| 验收条目 | 状态 | 证据 |
|---|---|---|
| 声效冷却与单位时间上限生效 | **pending user verification** | cooldown.ts + AudioCoordinator 58 项单测（冷却、速率限制、多采样轮播）。运行时音频表现需 §6 步骤 4 用户确认 |
| `embeddedAudio` 片段音画同步 | **pending user verification** | embedded_start/stop 指令链 + AudioPlayer.enableEmbeddedAudio。音画同步需带内嵌音轨素材在 §6 步骤 4 中用户确认 |
| 运行时音频库接线 | **pending user verification** | AudioCoordinator 新增 `setLibrary`；`rebuildScheduler` 注入 `loadProject` 得到的 AudioMeta[]；主进程以项目 audio/ 目录的 `file://` URL 下发播放命令。运行时播放需 §6 步骤 4 用户确认 |

### Phase 4｜打磨

| 验收条目 | 状态 | 证据 |
|---|---|---|
| 多宠物 profile 切换端到端 | **pending user verification** | ProfileManager/ProfileSwitcher 54 项单测；切换时保存旧宠物需求状态→加载新项目→重建设置存储→通知渲染进程。运行时切换表现需 §6 步骤 6 用户确认 |
| 备份导出/导入 | **pending user verification** | zip.ts 纯 Node 编解码往返测试 + 导入前校验（必需文件/schema/素材引用/zip-slip 防护）。运行时导入导出需 §6 步骤 6 用户确认 |
| 设置面板控制各子系统 | **pending user verification** | 音量/环境声频率/显示器/自启/快捷键实时生效；性格实时生效。TASK-015 53 项单测。运行时面板交互需 §6 步骤 5 用户确认 |
| §14 全部指标达标（内存 ≤ 200MB） | **部分达标** | CPU ≤3% 与 Private 内存 <250MB 已实测达标（§2 节）。Phase 4 优化目标 ≤200MB 未达标（实测 225MB Private），见 GAP-001 |

## 4. 已知缺口登记

| 编号 | 缺口 | 说明 | 建议修复 |
|---|---|---|---|
| GAP-001 | CPU/内存数值指标实测 | **已实测**（§2 节）：空载 Task Manager CPU avg 0.34%（≤3% ✅）；Private 内存 avg 225.2MB（<250MB ✅）；Phase 4 ≤200MB 目标未达标（225MB ❌）。测试在空素材库下进行，含片段时为估算值 | 用户在 §6 步骤 9 中以真实片段实测补充；Phase 4 ≤200MB 目标后续优化（SPEC §16 风险 3 建议评估 Tauri） |
| GAP-002 | 运行时端到端手动验证未执行 | §6 为 kind=manual，需用户人工执行（屏幕录制 + 任务管理器 + 强杀恢复 + §15 走查），Agent 不得代替 | 用户执行后更新 §3 状态列与 GAP-001 |
| GAP-003 | `scheduler:reset` 通知无发送方 | preload 提供 `scheduler:reset` 监听但主进程从未发送该事件；崩溃恢复实际通过重启式恢复实现（FSM 构造即回 idle_sit 主锚定 + needs-state 离线推进，§13），不依赖该通道 | 保留为死通道或移除；不影响 §13 行为 |
| GAP-004 | 导入向导写入非活跃目录时不热加载 | `import:saveClip` 仅当目标为活跃 profile 目录时触发调度器重建；向其他目录导入仍需重启或切换 profile（预期行为：运行时只加载活跃 profile） | 无需修复（设计如此）；文档化即可 |
| GAP-005 | 交互动作声未传递当前片段上下文 | mouse-handler 抢占路径调用 `onActionTriggered(interaction, null)` 传 null 片段，embeddedAudio 例外判定依赖 `clip.audio` 时会走兜底解析 | 后续版本在 preempt 前解析当前片段传入 |
| GAP-006 | `profile:switched` 通知无接收方 | profile 切换后主进程发送 `profile:switched`（handleActiveProfileChanged），但 preload 未暴露对应监听、渲染进程也未处理；与 GAP-003 互为反向。新宠物片段经 `scheduler:play` 正常下发，行为无断裂，仅渲染层无 profile 切换的显式感知 | 补充 preload profile 桥（onProfileSwitched）供渲染层 UI 感知，或移除该发送 |

## 5. 本次集成修复记录

### 第一轮修复（TASK-017 第二轮）

针对独立复核提出的 5 项问题：

1. **ISSUE-001 音频运行时接线**：`AudioCoordinator.setLibrary` + `rebuildScheduler` 注入 audio.meta.json 条目 + 主进程 `file://` 绝对 URL 下发 + 渲染端兼容两种 URL 形式。
2. **ISSUE-002 导入后调度器刷新**：`registerImportIpcHandlers` 增加 `onClipSaved` 回调，目标为活跃 profile 目录时触发 `initScheduler`；托盘与右键菜单新增「导入片段…」入口打开向导窗口。
3. **ISSUE-003 性格实时生效**：`settings:update-personality` 持久化后重建调度器，先保存内存 needsState 避免重复离线推进。
4. **ISSUE-004 验证文档**：即本文档。
5. **ISSUE-005 逐片段 hitbox**：`scheduler:play` 载荷携带 hitbox，渲染端动态重算命中盒。

### 第二轮修复（TASK-017 第三轮）

针对独立复核提出的 AC-7 性能实测要求：

6. **ISSUE-006 性能预算实测**：编写 PowerShell 有界验证脚本，启动构建后的 Electron 应用并实测 §14 性能指标（§2 节）。CPU ≤3% 达标（0.34%）；Private 内存 <250MB 达标（225.2MB）；WorkingSet 含共享页重复计数为 365MB；Phase 4 ≤200MB 目标未达标。

### 5.5 用户移交清单

自动化验证（§1）与代码级审计（§3）已全部完成。以下运行时验证步骤需由**用户在真实环境中执行**，完成后将证据回填到本文档对应位置。

| §6 步骤 | 验证内容 | 应捕获的证据类型 | 回填记录位置 |
|---|---|---|---|
| 步骤 1 | 导入最小启动集（6 段主体 + 过渡段） | **截图**：导入向导各阶段完成界面 + 导入后宠物即用新片段运行 | §3 Phase 1a 全部 3 行状态列 |
| 步骤 2 | 10 分钟运行观察（FSM 切换 / 行走平移 / 边缘转身 / 锚定中转） | **屏幕录像**：≥1 分钟片段覆盖 idle_sit→idle_stand→walk→groom 切换与行走过程 | §3 Phase 0 第 1/3 行、Phase 1b 第 1 行状态列 |
| 步骤 3 | 交互测试（抚摸 / 单击 / 双击 / 拖拽 / 喂食 / 给玩具 / 右键菜单） | **屏幕录像**：各交互的即时响应 + 拖拽窗口跟随 + 松手回地面线 | §3 Phase 2 全部 4 行状态列 |
| 步骤 4 | 音频验证（环境声周期 / 昼夜频率差异 / 交互声冷却 / 静音开关） | **屏幕录像**（含声音）：环境声出现 + 连续抚摸不连发 + 托盘静音生效 | §3 Phase 3 全部 3 行状态列 |
| 步骤 5 | 设置面板实时生效（性格滑杆 / 音量 / 环境声频率 / 显示器 / 快捷键） | **屏幕录像**：性格滑杆调整→行为变化 + 音量即时变化 + 切换显示器宠物迁移 | §3 Phase 2 第 2 行、Phase 4 第 3 行状态列 |
| 步骤 6 | 多宠物切换 + 备份导入导出 | **屏幕录像**：切换宠物后素材/需求/设置独立 + 导出→导入 zip 往返 | §3 Phase 4 第 1/2 行状态列 |
| 步骤 7 | 空库引导（删除全部片段后重启不崩溃） | **截图**：显示引导文案且应用正常 | §3 Phase 1b 第 2 行状态列 |
| 步骤 8 | 强杀恢复（结束进程后重启回锚定态） | **屏幕录像**：重启后宠物回端坐锚定态 + 需求值无极端惩罚 | §3 Phase 1b 第 2 行状态列 |
| 步骤 9 | 性能实测（含真实片段的 CPU 与内存） | **数值**：任务管理器空闲 CPU% 与内存 MB（采样多次取平均） | GAP-001 含片段实测列 + §3 Phase 0 第 2 行 |
| 步骤 10 | §15 全量走查 | **逐项确认**：按 §3 核对表逐条更新状态为通过/未通过 | §3 全部条目状态列 |

完成后将各状态列从 **pending user verification** 更新为实测结论（通过 / 未通过 + 简要证据）。同时更新 GAP-001 含片段实测数据、GAP-002 状态。

## 6. 手动验证指引（用户执行）

> 以下十步需用户在真实环境中依次执行。每步包含 **操作描述** 与 **期望结果**。捕获的证据类型见 [§5.5 用户移交清单](#55-用户移交清单)。

### 步骤 1 — 导入最小启动集

- **操作**：`npm run dev` 启动应用；托盘菜单点击「导入片段…」打开向导；按拍摄清单导入最小启动集（6 段主体片段 idle_sit/idle_stand/walk/groom/eat/sleep + 对应过渡段 transition_*）；走完选视频→参考帧/参考色→抠像预览→标 loop→行走校正→打标→转码入库全流程。
- **期望结果**：导入完成后宠物立即使用新片段运行，无需重启；向导各阶段无报错。

### 步骤 2 — 10 分钟运行观察

- **操作**：启动应用并持续观察 ≥10 分钟，留意 FSM 状态切换、行走平移与边缘转身、锚定中转过程。
- **期望结果**：可观察到 idle_sit/idle_stand/walk/groom 等多种状态切换；行走时窗口沿地面线平移、到达边缘自然转身；锚定中转（端坐↔站立↔行走）无可见硬切或位置跳变。

### 步骤 3 — 交互测试

- **操作**：依次执行以下交互——(a) 在命中盒内缓慢移动鼠标模拟抚摸；(b) 单击宠物；(c) 双击宠物；(d) 按住拖拽宠物到屏幕另一位置后松手；(e) 托盘或右键菜单点击「喂食」；(f) 托盘或右键菜单点击「给玩具」；(g) 右键菜单查看其余项。
- **期望结果**：(a) 抚摸时宠物有反应（状态变化/声效）；(b)(c) 点击/双击触发对应交互；(d) 拖拽时窗口跟随光标移动，松手后宠物回地面线原位；(e) 喂食触发进食片段 + 饥饿值下降；(f) 给玩具触发互动 + 愉悦/注意力上升；(g) 右键菜单项正常响应。交互响应无明显延迟（< 200ms 体感）。

### 步骤 4 — 音频验证

- **操作**：(a) 在应用运行中观察环境声是否周期性出现；(b) 比较白天与夜间（可调整系统时间或等待）环境声频率差异；(c) 连续快速抚摸宠物多次；(d) 托盘菜单点击「静音」后再点击「取消静音」。
- **期望结果**：(a) 环境声按设定间隔周期性播放；(b) 夜间环境声频率低于白天；(c) 交互触发声有冷却——连续抚摸不会连续发声连发；(d) 静音后全部声音停止，取消静音后恢复。

### 步骤 5 — 设置面板实时生效

- **操作**：打开设置面板（托盘菜单「设置」或右键菜单），依次：(a) 调整性格 5 维滑杆（如拉高活泼度）；(b) 调整主音量与环境声频率滑杆；(c) 切换目标显示器（如有多显示器）；(d) 重新绑定全局快捷键。
- **期望结果**：(a) 性格滑杆改变后行为分布可感知变化（活泼度高→行走更频繁），无需重启；(b) 音量与环境声频率即时生效；(c) 宠物迁移到所选显示器；(d) 新快捷键生效，旧快捷键失效。

### 步骤 6 — 多宠物切换与备份

- **操作**：(a) 托盘菜单「切换宠物」子菜单选择另一个宠物 profile；(b) 托盘菜单「导出备份」导出当前宠物为 zip 文件；(c) 清空或删除一个 profile 后通过「导入备份」恢复。
- **期望结果**：(a) 切换后宠物素材、需求状态、设置独立（不混淆）；(b) 导出的 zip 可在文件系统中找到且大小合理；(c) 导入后宠物完整恢复（片段/设置/需求状态）。

### 步骤 7 — 空库引导

- **操作**：删除活跃宠物项目目录内的全部片段文件（或清空 clips.meta.json），然后重启应用。
- **期望结果**：应用正常启动不崩溃；显示引导文案提示用户导入片段（§13 空库兜底）。

### 步骤 8 — 强杀恢复

- **操作**：在任务管理器中结束 Electron 进程（模拟崩溃），然后重新启动应用。
- **期望结果**：重启后宠物回到端坐锚定态（idle_sit）；需求状态恢复且无惩罚性极端值（饥饿 ≤85、疲劳 ≤85、愉悦 ≥15、注意力 ≥10，§13）；不出现"死循环"或卡死状态。

### 步骤 9 — 性能实测（含真实片段）

- **操作**：导入片段并在正常播放状态下，打开任务管理器观察 Electron 进程的 CPU 与内存占用。采样 5–7 次取平均值（排除首样本）。
- **期望结果**：空闲时 CPU ≤3%；内存（Private Working Set 或任务管理器内存列）< 250MB。将实测数值回填到 GAP-001 含片段实测列。

### 步骤 10 — §15 全量走查

- **操作**：对照 §3 各阶段验收核对表，逐项确认运行时表现，将状态列从「pending user verification」更新为实测结论。
- **期望结果**：§3 全部条目均有明确的通过/未通过结论及简要证据。如有未通过项，在 §4 中登记新缺口。

### 步骤 11 — ffmpeg 交付与打包冒烟（IR-011 / IR-018）

- **前置**：vendor 二进制已就位（`resources/ffmpeg/win-x64/ffmpeg.exe`，ffmpeg 6.1.1）；Agent 已在干净 PATH 环境完成转码/留轨/抽轨实测与 unpacked 启动冒烟。
- **操作**：(a) `npm run dist` 生成 NSIS 安装包；(b) 安装到干净环境（无系统 PATH ffmpeg），启动后空库引导显示 → 导入合成占位片段（验证打包内 ffmpeg 交付）→ 正常播放；(c) 任务管理器采样打包形态的 CPU/内存。
- **期望结果**：(a) 安装包内 `resources/ffmpeg/win-x64/ffmpeg.exe` 存在；(b) 干净环境导入转码闭环可用；(c) 打包形态空闲 CPU ≤3%、内存 <250MB（回填 §3 Phase 4 第 5 行）。
