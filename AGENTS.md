# AGENTS.md — PetAliveTools 工作区说明

桌面宠物 Electron 应用（"直接视频片段路线"）：播放用户自备、已制作完成的视频片段。程序只做文件管理、行为调度和原生 `<video>` 播放，**不做任何视频处理**。文档与注释均使用中文，请保持一致。

## 常用命令

```bash
npm run dev         # electron-vite 开发模式
npm run build       # 生产构建（输出到 out/）
npm run typecheck   # tsc --noEmit（strict + noUnusedLocals/Parameters）
npm run lint        # eslint .（ESLint 9 flat config）
npm test            # vitest run（全部测试，约 434 项）
npx vitest run test/behavior/fsm.test.ts   # 运行单个测试文件
npm run pack        # 构建 + electron-builder --dir（Windows x64）
npm run dist        # 构建 + electron-builder（NSIS 安装包，输出 dist/）
```

## 目录结构

- `src/main/` — Electron 主进程：`behavior/`（FSM、需求、性格、节律）、`scheduler/`（片段/空闲调度）、`audio/`、`input/`（鼠标命中/穿透）、`persistence/`（项目 IO、profile、备份）、`shell/`（设置、快捷键、显示器、自启）、`media-protocol.ts`（`petmedia://` 协议）
- `src/preload/index.ts` — 唯一的 contextBridge，向渲染层暴露 `window.petalive`
- `src/renderer/` — 无框架的 TypeScript UI：`sprite/video-player.ts`、`clip-playback.ts`、`settings/`、`import-wizard.ts`
- `src/shared/` — 两进程共用的纯逻辑与类型：`types/`、`schemas/`（运行时校验）、`spatial/`、`media-url.ts`、`direct-media.ts`。不依赖 Electron API
- `test/` — Vitest 单测（node 环境），目录结构与 src 对应
- `docs/` — 见下方"必读文档"

## 不可违反的媒体边界（改代码前必读）

这是本项目最核心的产品约束（SPEC.md §2），任何改动不得突破：

- 导入 = 逐字节复制：仅 `fs.copyFile(..., COPYFILE_EXCL)` 到项目 `clips/` 目录。不读帧、不探测时长/分辨率/编解码、不生成视频元数据
- 永久排除：转码、FFmpeg、抠像/色键、Canvas 逐帧处理、裁剪/缩放/镜像、播放速率调整、循环入出点、轨迹（`track.json`）、音轨抽取。无法直接播放的文件应明确报错，**不得转码兜底**
- 播放只用原生 `<video>`：非循环片段靠原生 `ended` 事件推进（不得按预计时长计时）；循环只用 `video.loop`；淡入淡出只改容器透明度；播放器不得采样画面或向主进程上报媒体时间
- 调度指令载荷只允许：片段 ID、文件 URL、循环标志、命中盒、内嵌音轨标志（见 INTEGRATION.md §3）
- 资产发现只枚举 `clips/` 文件名推导描述，不读 `clips.meta.json` 等元数据

## 架构规则

- 三层进程结构：main / preload / renderer。渲染层只能通过 `window.petalive`（preload 中 contextBridge 暴露）与主进程通信，不直接使用 `ipcRenderer` 或 Node API
- IPC 通道按特性命名空间命名（`import:*`、`scheduler:*`、`input:*`、`audio:*`、`settings:*`、`profile:*`）。新增 IPC 必须三处同步：`ipcMain.handle/on`、preload bridge 接口、渲染层调用
- 可测试的纯逻辑放 `src/shared/`（如 hitbox、interaction-state、drag、media-url），主进程与测试共用；Electron 依赖隔离在 `src/main/` 各模块内

## 代码风格

- Prettier：无分号、单引号、2 空格缩进、无尾逗号、printWidth 100
- TS strict 模式；未使用的局部变量/参数会导致 typecheck 失败
- 测试位于 `test/**/*.test.ts`，新功能需附带对应单测（当前约 41 个测试文件）

## 必读文档（改敏感区域前先读）

- `docs/SPEC.md` — 产品与技术规格、媒体边界完整清单
- `docs/INTEGRATION.md` — 主链路（导入 → 扫描 → 调度 → `petmedia://` → 播放）各层边界
- `docs/VERIFICATION.md` — 验证记录与命令基线
- `docs/SHOOTING.md` — 用户素材准备说明（对外文档）

## 其他注意

- 开发平台为 Windows（Git Bash），打包目标仅 Windows x64 NSIS
- `out/` 是 electron-vite 构建输出，`dist/` 是 electron-builder 产物，均已 gitignore，勿手工修改
