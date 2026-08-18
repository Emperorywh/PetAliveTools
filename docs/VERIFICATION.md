# 直接片段路线验证记录

更新日期：2026-08-18
依据：[SPEC.md](SPEC.md)

## 1. 自动化结果

| 项目 | 结果 |
|---|---|
| `npm run typecheck` | 通过，0 错误 |
| `npm test -- --reporter=dot` | 通过，41 个测试文件、434 项测试 |
| `npm run lint` | 通过 |
| `npm run build` | 通过，主进程、preload、renderer 均完成生产构建 |
| `npm run pack` | 通过，Windows x64 unpacked 包完成，未要求 FFmpeg 资源 |

## 2. 直接导入验证

自动化用例不使用有效视频，而是写入任意二进制字节并以允许的媒体扩展名导入。这验证了导入链路没有尝试：

- 解码视频；
- 抽取帧；
- 探测时长；
- 转码；
- 生成轨迹或元数据。

已验证：

- 源文件和目标文件字节完全相同；
- `.mov`、`.mp4` 等原扩展名保留；
- 文件名按动作、方向、变体生成；
- 重复导入生成新变体，不覆盖；
- `.avi` 等未允许格式明确拒绝，不转码兜底；
- 新项目不创建 `clips.meta.json`；
- 项目加载只根据文件名建立内存片段描述；
- 旧 `track.json` 不参与扫描；
- zip 备份恢复后媒体字节不变。

## 3. 播放和调度验证

已验证：

- 播放 IPC 使用项目内真实 `fileName`，不强制改成 WebM；
- 播放载荷不含镜像、速率、循环点、轨迹或窗口位置；
- 所有视频播放步骤的调度时长为 `null`，不依赖媒体时长探测；
- 墙钟经过很久也不会猜测非循环文件结束；
- 非循环文件只通过渲染端 `ended` 对应的显式完成调用推进；
- 循环标记只代表完整文件 `video.loop`；
- 调度器不再生成 `update_position` 命令；
- 随机化只改变文件选择、空闲时间和稀有动作概率。

## 4. 仓库清理验证

已移除：

- 主进程 FFmpeg、转码器、轨迹读写和旧导入 IPC；
- 渲染进程抠像预览、导入处理向导、行走校正和帧检查；
- 共享层色键、边缘处理、抽帧、跟踪、裁剪和位移算法；
- 按视频时间移动窗口的调度实现；
- 视频镜像、尺度归一化和视觉合成模块；
- 相关 schema、类型、单元测试和集成测试；
- `ffmpeg-static` npm 依赖；
- `resources/ffmpeg/win-x64/ffmpeg.exe`；
- electron-builder 的 FFmpeg `extraResources` 配置。

## 5. 建议的人工冒烟

自动化无法代替目标机器的真实编解码兼容性检查。发布前建议执行：

1. 创建新宠物项目；
2. 分别导入一个 `.webm`、`.mp4` 或实际使用格式的最终片段；
3. 比较源文件和项目 `clips/` 文件的哈希；
4. 确认导入页没有任何抠像、裁剪、循环点或转码界面；
5. 确认非循环片段完整播毕后才切换；
6. 确认循环动作循环完整文件；
7. 播放 `walk` 时观察窗口不会随视频时间自动平移；
8. 主动拖拽窗口，确认保留的用户交互仍正常；
9. 导出项目并重新导入，确认片段仍可直接播放；
10. 在目标安装环境执行一次打包产物启动冒烟。

由于程序不再做格式转换，真实文件若无法播放，应回到外部专业工具重新导出，而不是在 PetAliveTools 内处理。

## 6. 已排查：启动期 gvt1.com SSL 错误日志

现象：dev 与打包启动后控制台反复输出
`ERROR:ssl_client_socket_impl.cc handshake failed; net_error -100`。

结论与处置（2026-08-18，netlog 抓包验证）：

- 来源是 Chromium 拼写检查词典下载器请求
  `https://redirector.gvt1.com/edgedl/chrome/dict/en-us-10-1.bdic`；
  该请求在网络服务初始化时即发出（早于任何 JS 可注册拦截的时机），
  `webPreferences.spellcheck: false`、`session.setSpellCheckerEnabled(false)`
  与 `webRequest` 拦截均无法阻止；
- 代码层已加双层关闭（三个窗口 `spellcheck: false` + bootstrap 会话级关闭），
  应用自身零外网请求，无行为影响；
- 彻底消除握手失败日志：向 `userData/Dictionaries/` 预置 `en-US-10-1.bdic`
  （可从本机其他 Electron 应用如 VS Code 的同路径复制）。预置后实测
  netlog 中词典请求数为 0，控制台无 SSL 错误；
- 注意：Electron 大版本升级若改用其他词典版本号，会重新出现一次性下载尝试。
