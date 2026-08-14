# ffmpeg 二进制放置处 (IR-011 / SPEC §3.3)

将 **Windows x64 的 ffmpeg.exe** 放在本目录：

```
resources/ffmpeg/win-x64/ffmpeg.exe
```

- 需要包含 `libvpx-vp9`（VP9-alpha 编码）与 `libopus`（音轨转码，§4.8）。
- 开发环境：`resolveFfmpegPath` 优先解析本路径，不存在时回退系统 PATH 的 `ffmpeg`。
- 打包：`electron-builder.yml` 的 `extraResources` 把 `resources/ffmpeg/` 拷贝到
  安装目录 `resources/ffmpeg/`，运行时按 `process.resourcesPath` 解析（asar 外，可直接 spawn）。
- 获取渠道（任选其一）：
  - https://www.gyan.dev/ffmpeg/builds/ （ffmpeg-release-essentials 或 full 构建）
  - `npm i -D ffmpeg-static` 后从 `node_modules/ffmpeg-static/ffmpeg.exe` 拷贝
- 显式覆盖：设置环境变量 `FFMPEG_PATH` 指向任意 ffmpeg.exe（最高优先级）。
