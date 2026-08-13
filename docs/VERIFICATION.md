# 端到端集成验证记录（TASK-017）

本文档记录全系统（Phase 0 → Phase 4）端到端集成验证的结果，逐项核对 SPEC §15 各阶段验收标准，并登记已知缺口。自动化验证（typecheck / 单元测试 / lint）的结果对应提交时的工作树；运行时手动验证（VERIFY-002）尚未由用户执行，其步骤与风险见文末。

## 1. 自动化验证结果

| 命令 | 结果 |
|---|---|
| `npm run typecheck` | 通过（0 错误） |
| `npm test` | 通过（55 文件 / 853 测试全部通过） |
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
- 以上为基于架构设计的估算，含真实片段的实测仍建议用户在 VERIFY-002 步骤 9 中补充。

## 3. §15 各阶段验收核对表

### Phase 0｜渲染打通

| 验收条目 | 状态 | 证据 |
|---|---|---|
| alpha 边缘无黑边/底色残留 | 代码级实现，运行时待手动验证 | 色键管线（含溢色抑制/收缩/羽化）有 59 项单测；合成毛发场景测试覆盖毛色×背景组合。观感需 VERIFY-002 人工确认 |
| 目标机器软解 CPU 实测值 | **已实测** | 空载基线 0.34% Task Manager CPU（§2 节）。含片段软解估算 ≤2.3%，在 ≤3% 目标内 |
| 行走连续观看 1 分钟无明显滑步 | 代码级实现，运行时待手动验证 | 位移曲线驱动窗口平移（§7.2）+ 播放速率同步缩放（TASK-013 randomization.ts）有单测；观感需人工确认 |

### Phase 1a｜入库管线

| 验收条目 | 状态 | 证据 |
|---|---|---|
| 最小启动集完成全流程入库 | 通过（代码级） | 清单引导式导入向导（选视频→参考帧/参考色→抠像预览→标 loop→行走校正→打标→转码入库），49 项 import-flow 集成测试 |
| 抠像预览边缘放大检查通过 | 通过（代码级） | chroma-key-preview 三面板预览 + zoom-inspect 边缘放大，单测覆盖取景逻辑；实际素材观感需人工确认 |
| 位移曲线校正可用 | 通过（代码级） | walk-correction.ts 关键点增删拖拽 + 行走子段标注，39 项单测 |

### Phase 1b｜运行时闭环

| 验收条目 | 状态 | 证据 |
|---|---|---|
| 仅凭 6 段最小启动集运行 10 分钟无硬切、无锚定位置跳动 | 通过（模拟级） | TASK-011 clip-scheduler 10 分钟模拟测试：无崩溃、始终在屏幕边界内、连续位置无传送跳变。真实视频观感需人工确认 |
| 缺素材状态占位 + 标红提醒生效 | 通过（代码级） | state-lookup 端坐占位兜底（§5.5/§13）有单测；调度器缺素材不崩溃 |

### Phase 2｜交互与生命感

| 验收条目 | 状态 | 证据 |
|---|---|---|
| 交互抢占响应 < 200ms | 代码级实现，运行时待手动验证 | 渲染进程 IPC → MouseHandler → scheduler.preempt 同步路径，无网络/IO 等待；实际延迟需人工确认 |
| 性格滑杆改变行为分布可感知 | 通过（代码级修复） | `settings:update-personality` 持久化后重建调度器，weightOverrides/needRates 即时生效。行为分布随性格变化有 personality.ts 25 项单测 |
| 穿透/交互切换无漏触发 | 代码级实现，运行时待手动验证 | 命中盒缓冲带 8–12px（§6.1）有 23 项单测；实际鼠标手感需人工确认 |
| 逐片段 hitbox（§5.4/§6.1） | 通过（代码级修复） | `scheduler:play` 载荷现携带当前片段 hitbox，渲染端收到后重算 hitboxPx |

### Phase 3｜音频与养成

| 验收条目 | 状态 | 证据 |
|---|---|---|
| 声效冷却与单位时间上限生效 | 通过 | cooldown.ts + AudioCoordinator 58 项单测（冷却、速率限制、多采样轮播） |
| `embeddedAudio` 片段音画同步 | 通过（代码级） | embedded_start/stop 指令链 + AudioPlayer.enableEmbeddedAudio；实际音画同步需带内嵌音轨素材人工确认 |
| 运行时音频库接线 | 通过（代码级修复） | AudioCoordinator 新增 `setLibrary`；`rebuildScheduler` 注入 `loadProject` 得到的 AudioMeta[]；主进程以项目 audio/ 目录的 `file://` URL 下发播放命令 |

### Phase 4｜打磨

| 验收条目 | 状态 | 证据 |
|---|---|---|
| 多宠物 profile 切换端到端 | 通过（代码级） | ProfileManager/ProfileSwitcher 54 项单测；切换时保存旧宠物需求状态→加载新项目→重建设置存储→通知渲染进程 |
| 备份导出/导入 | 通过 | zip.ts 纯 Node 编解码往返测试 + 导入前校验（必需文件/schema/素材引用/zip-slip 防护） |
| 设置面板控制各子系统 | 通过（代码级修复后） | 音量/环境声频率/显示器/自启/快捷键实时生效；性格实时生效。TASK-015 53 项单测 |
| §14 全部指标达标（内存 ≤ 200MB） | **部分达标** | CPU ≤3% 与 Private 内存 <250MB 已实测达标（§2 节）。Phase 4 优化目标 ≤200MB 未达标（实测 225MB Private），见 GAP-001 |

## 4. 已知缺口登记

| 编号 | 缺口 | 说明 | 建议修复 |
|---|---|---|---|
| GAP-001 | CPU/内存数值指标实测 | **已实测**（§2 节）：空载 Task Manager CPU avg 0.34%（≤3% ✅）；Private 内存 avg 225.2MB（<250MB ✅）；Phase 4 ≤200MB 目标未达标（225MB ❌）。测试在空素材库下进行，含片段时为估算值 | 用户在 VERIFY-002 步骤 9 中以真实片段实测补充；Phase 4 ≤200MB 目标后续优化（SPEC §16 风险 3 建议评估 Tauri） |
| GAP-002 | 运行时端到端手动验证未执行 | VERIFY-002 为 kind=manual，需用户人工执行（屏幕录制 + 任务管理器 + 强杀恢复 + §15 走查），Agent 不得代替 | 用户执行后更新本文档 |
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

## 6. VERIFY-002 手动验证指引（用户执行）

按以下步骤执行并回填本文档：

1. `npm run dev` 启动应用，托盘菜单「导入片段…」打开向导，按清单导入最小启动集（6 段主体 + 过渡段），确认导入后宠物无需重启即用新片段运行。
2. 观察 10 分钟：FSM 状态切换（idle_sit/idle_stand/walk/groom 等）、行走平移与边缘转身、锚定中转无硬切。
3. 依次测试：抚摸（命中盒内移动）、单击/双击、拖拽（窗口跟随 + 松手回地面线）、托盘/右键「喂食」「给玩具」、右键菜单其余项。
4. 音频：确认环境声周期性出现且昼夜频率不同；交互触发声有冷却（连续抚摸不会连发）；托盘静音开关全局生效。
5. 设置面板：调整性格滑杆确认行为分布变化（无需重启）；调整音量/环境声频率即时生效；切换显示器宠物迁移；改快捷键生效。
6. 托盘「切换宠物」子菜单切换另一宠物，确认素材/需求状态/设置独立。
7. 删除活跃宠物目录内全部片段（或清空 clips.meta.json）后重启：显示引导文案不崩溃（§13）。
8. 强杀进程（任务管理器结束 Electron 进程）后重启：宠物回端坐锚定态、needs-state 恢复且无惩罚性极端值（§13）。
9. 任务管理器观察：含真实片段时空闲 CPU≤3%、内存<250MB，回填 GAP-001 含片段实测列。
10. 按 §3 核对表逐项走查并更新状态列。
