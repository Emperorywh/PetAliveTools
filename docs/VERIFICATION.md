# 端到端集成验证记录（TASK-017）

本文档记录全系统（Phase 0 → Phase 4）端到端集成验证的结果，逐项核对 SPEC §15 各阶段验收标准，并登记已知缺口。自动化验证（typecheck / 单元测试 / lint）的结果对应提交时的工作树；运行时手动验证（VERIFY-002）尚未由用户执行，其步骤与风险见文末。

## 1. 自动化验证结果

| 命令 | 结果 |
|---|---|
| `npm run typecheck` | 通过（0 错误） |
| `npm test` | 通过（55 文件 / 853 测试全部通过） |
| `npm run lint` | 通过 |

## 2. §15 各阶段验收核对表

### Phase 0｜渲染打通

| 验收条目 | 状态 | 证据 |
|---|---|---|
| alpha 边缘无黑边/底色残留 | 代码级实现，运行时待手动验证 | 色键管线（含溢色抑制/收缩/羽化）有 59 项单测；合成毛发场景测试覆盖毛色×背景组合。观感需 VERIFY-002 人工确认 |
| 目标机器软解 CPU 实测值 | **已知缺口** | 无实测数据。§14 CPU≤3% 指标未在任何机器上测得，需 VERIFY-002 任务管理器实测 |
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
| 性格滑杆改变行为分布可感知 | 通过（本次修复，ISSUE-003） | `settings:update-personality` 现在先持久化 needsState 再重建调度器（src/main/index.ts），weightOverrides/needRates 即时生效，无需重启。行为分布随性格变化有 personality.ts 25 项单测 |
| 穿透/交互切换无漏触发 | 代码级实现，运行时待手动验证 | 命中盒缓冲带 8–12px（§6.1）有 23 项单测；实际鼠标手感需人工确认 |
| 逐片段 hitbox（§5.4/§6.1） | 通过（本次修复，ISSUE-005） | `scheduler:play` 载荷现携带当前片段 hitbox，渲染端收到后重算 hitboxPx（src/main/index.ts、src/preload/index.ts、src/renderer/main.ts） |

### Phase 3｜音频与养成

| 验收条目 | 状态 | 证据 |
|---|---|---|
| 声效冷却与单位时间上限生效 | 通过 | cooldown.ts + AudioCoordinator 58 项单测（冷却、速率限制、多采样轮播） |
| `embeddedAudio` 片段音画同步 | 通过（代码级） | embedded_start/stop 指令链 + AudioPlayer.enableEmbeddedAudio；实际音画同步需带内嵌音轨素材人工确认 |
| 运行时音频库接线（ISSUE-001，本次修复） | 通过（代码级） | AudioCoordinator 新增 `setLibrary`；`rebuildScheduler` 注入 `loadProject` 得到的 AudioMeta[]；主进程以项目 audio/ 目录的 `file://` URL 下发播放命令，渲染端直接使用绝对 URL。非空库下环境声/动作声可实际发出 play 命令（audio-coordinator.test.ts 注入非空库验证） |

### Phase 4｜打磨

| 验收条目 | 状态 | 证据 |
|---|---|---|
| 多宠物 profile 切换端到端 | 通过（代码级） | ProfileManager/ProfileSwitcher 54 项单测；切换时保存旧宠物需求状态→加载新项目→重建设置存储→通知渲染进程 |
| 备份导出/导入 | 通过 | zip.ts 纯 Node 编解码往返测试 + 导入前校验（必需文件/schema/素材引用/zip-slip 防护） |
| 设置面板控制各子系统 | 通过（本次修复后） | 音量/环境声频率/显示器/自启/快捷键实时生效；性格实时生效（本次修复）。TASK-015 53 项单测 |
| §14 全部指标达标（内存 ≤ 200MB） | **已知缺口** | 见下节 |

## 3. 已知缺口登记

| 编号 | 缺口 | 说明 | 建议修复 |
|---|---|---|---|
| GAP-001 | CPU/内存数值指标无实测证据 | §14 空闲 CPU≤3%、内存<250MB（Phase 4 目标≤200MB）未经任何机器实测。代码级证据：渲染端全程单个 `<video>` 元素、playClip 仅切换 src（仅解码当前单段，§14 第 3 条达成）；调度器 100ms tick + 音频 5s tick 低频轮询 | 用户按 VERIFY-002 步骤以任务管理器实测并回填本表 |
| GAP-002 | 运行时端到端手动验证未执行 | VERIFY-002 为 kind=manual，需用户人工执行（屏幕录制 + 任务管理器 + 强杀恢复 + §15 走查），Agent 不得代替 | 用户执行后更新本文档 |
| GAP-003 | `scheduler:reset` 通知无发送方 | preload 提供 `scheduler:reset` 监听（src/preload/index.ts）但主进程从未发送该事件；崩溃恢复实际通过重启式恢复实现（FSM 构造即回 idle_sit 主锚定 + needs-state 离线推进，§13），不依赖该通道 | 保留为死通道或移除；不影响 §13 行为 |
| GAP-004 | 导入向导写入非活跃目录时不热加载 | `import:saveClip` 仅当目标为活跃 profile 目录时触发调度器重建；向其他目录导入仍需重启或切换 profile（预期行为：运行时只加载活跃 profile） | 无需修复（设计如此）；文档化即可 |
| GAP-005 | 交互动作声未传递当前片段上下文 | mouse-handler 抢占路径调用 `onActionTriggered(interaction, null)` 传 null 片段，embeddedAudio 例外判定依赖 `clip.audio` 时会走兜底解析 | 后续版本在 preempt 前解析当前片段传入 |

## 4. 本次集成修复记录（TASK-017 第二轮）

针对独立复核提出的 5 项问题：

1. **ISSUE-001 音频运行时接线**：`AudioCoordinator.setLibrary` + `rebuildScheduler` 注入 audio.meta.json 条目 + 主进程 `file://` 绝对 URL 下发 + 渲染端兼容两种 URL 形式。
2. **ISSUE-002 导入后调度器刷新**：`registerImportIpcHandlers` 增加 `onClipSaved` 回调，目标为活跃 profile 目录时触发 `initScheduler`；托盘与右键菜单新增「导入片段…」入口打开向导窗口。
3. **ISSUE-003 性格实时生效**：`settings:update-personality` 持久化后重建调度器，先保存内存 needsState 避免重复离线推进。
4. **ISSUE-004 验证文档**：即本文档。
5. **ISSUE-005 逐片段 hitbox**：`scheduler:play` 载荷携带 hitbox，渲染端动态重算命中盒。

## 5. VERIFY-002 手动验证指引（用户执行）

按以下步骤执行并回填本文档：

1. `npm run dev` 启动应用，托盘菜单「导入片段…」打开向导，按清单导入最小启动集（6 段主体 + 过渡段），确认导入后宠物无需重启即用新片段运行。
2. 观察 10 分钟：FSM 状态切换（idle_sit/idle_stand/walk/groom 等）、行走平移与边缘转身、锚定中转无硬切。
3. 依次测试：抚摸（命中盒内移动）、单击/双击、拖拽（窗口跟随 + 松手回地面线）、托盘/右键「喂食」「给玩具」、右键菜单其余项。
4. 音频：确认环境声周期性出现且昼夜频率不同；交互触发声有冷却（连续抚摸不会连发）；托盘静音开关全局生效。
5. 设置面板：调整性格滑杆确认行为分布变化（无需重启）；调整音量/环境声频率即时生效；切换显示器宠物迁移；改快捷键生效。
6. 托盘「切换宠物」子菜单切换另一宠物，确认素材/需求状态/设置独立。
7. 删除活跃宠物目录内全部片段（或清空 clips.meta.json）后重启：显示引导文案不崩溃（§13）。
8. 强杀进程（任务管理器结束 Electron 进程）后重启：宠物回端坐锚定态、needs-state 恢复且无惩罚性极端值（§13）。
9. 任务管理器观察：空闲 CPU≤3%、内存<250MB（Phase 4 目标≤200MB），回填 GAP-001。
10. 按 §2 核对表逐项走查并更新状态列。
