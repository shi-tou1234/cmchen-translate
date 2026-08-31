# 划译 · 跨平台划词翻译

在任意软件里选中文字，光标旁弹出小窗显示中文翻译；按 `Alt+Z`（macOS `Cmd+Z`）框选屏幕任意区域，OCR 识别图中文字并翻译。

支持 **Windows、macOS、Linux**，引擎使用你自己的 [OpenCode](https://opencode.ai) 网关免费模型（`-free` 后缀），无需为翻译另行注册或付费。模型不可用时自动降级重试。

![icon](build/icons/icon-128.png)

## 功能

- **划词翻译**：选中文字后 `Alt+Z`（macOS `Cmd+Z`），或 600ms 内连按两次 `Ctrl+C`（macOS `Cmd+C`）；也可开启「选中自动弹窗」（拖选/双击即弹，终端类程序自动跳过）
- **截图翻译（OCR）**：`Alt+S`（macOS `Cmd+S`）框选屏幕区域 → 拖动手柄调整选区 → Enter 确认 → OCR 识别 → 自动翻译
  - Windows：系统自带 WinRT OCR（离线，支持中英文）
  - macOS/Linux：随包 Tesseract WASM（eng + chi\_sim，运行时离线）
- **模型自选 + 自动降级**：翻译失败（429/503/超时）时自动切换备用模型重试，弹窗提示用户；托盘右键「选择模型」一键切换，设置页支持下拉选择或直接输入任意免费模型名
- **暗色毛玻璃 UI**：弹窗/设置页/覆盖层全部暗色设计，不抢焦点（`showInactive`），点击外部自动收起
- **截图框选可编辑**：画框后进入编辑态，8 个手柄调整大小、框内拖动移动、Enter/按钮确认

## 下载安装

前往 [GitHub Releases](https://github.com/shi-tou1234/cmchen-translate/releases) 下载：

| 平台 | 文件 |
|------|------|
| Windows x64 | `cmchen-translate-setup-1.0.0.exe`（安装版）或 `cmchen-translate-portable-1.0.0.exe`（单文件便携） |
| macOS Apple Silicon | `cmchen-translate-1.0.0-arm64.dmg` |
| Linux x64 | `cmchen-translate-1.0.0.AppImage` 或 `cmchen-translate-1.0.0.deb` |

macOS 首次打开提示"未知开发者"：右键 → 打开；Windows SmartScreen 提示"仍要运行"；Linux AppImage 需要 `chmod +x`。

## 使用

启动后托盘出现图标（需授权辅助功能权限以使用全局钩子）。快捷键：

| 方式 | Windows / Linux | macOS |
|------|----------------|-------|
| 快捷键 | `Alt+Z` | `Cmd+Z` |
| 双击复制 | `Ctrl+C` 连按两次 | `Cmd+C` 连按两次 |
| 选中自动弹 | 设置中开启（终端自动跳过） | 设置中开启 |
| 截图翻译 | `Alt+S` | `Cmd+S` |

弹窗内：`Esc` 关闭，失焦自动收起；「复制译文」写剪贴板，「重试」重翻。翻译失败自动降级备用模型，弹窗提示切换信息。

## 设置

托盘右键 → 设置（或再次双击启动图标）。可改：服务地址、模型（下拉/自由输入）、API Key（留空自动读 opencode 的 key）、字数上限、触发开关、截图 OCR 开关、黑名单（Windows/Linux）、开机自启。

## 从源码构建

环境：Windows 10+ / macOS 12+ / Ubuntu 20.04+，Node.js 22+。

```bash
git clone https://github.com/shi-tou1234/cmchen-translate.git
cd cmchen-translate
npm install --prefer-offline
npm run icons           # 由 build/icon.svg 生成多尺寸 PNG 与 icon.ico
npm run stage:tessdata  # 收集 OCR 语言数据（macOS/Linux 必需）
npm test                # 单元测试（84 个，node:test）
npm run deploy          # （Windows）便携目录版 + 桌面快捷方式
npm run verify          # 验收：测试 + 网关 + 交付物
```

打包：

```bash
npx electron-builder --win nsis portable --x64       # Windows
npx electron-builder --mac dmg zip --arm64           # macOS ARM
npx electron-builder --linux AppImage deb --x64      # Linux
```

CI 自动化（tag 触发 GitHub Actions 构建并上传 Release）：

```bash
git tag v1.0.1 && git push origin v1.0.1
```

## 架构

```
src/main.js                  主进程：钩子/快捷键/取词/翻译/弹窗/截图 OCR
src/lib/platform.js          平台分派（Win32/darwin/linux）
src/lib/native.js            Win32 原生：koffi SendInput + 剪贴板序列号 + 前台进程名
src/lib/nativeDarwin.js      macOS 原生：CoreGraphics Cmd+C
src/lib/nativeLinux.js       Linux 原生：XTest Ctrl+C
src/lib/tesseractOcr.js      跨平台 OCR（Tesseract WASM，macOS/Linux）
src/lib/gateway.js           OpenAI 兼容翻译客户端 + URL 安全校验（含 SSRF 重定向防护）
src/lib/selection.js         选词状态机（拖选/双击/双击复制/矩形工具）
src/lib/clipboardGuard.js    取词判定 + OCR 文本清理
src/lib/config.js            配置管理（%APPDATA%\划译\config.json）
src/lib/authJson.js          opencode 凭据读取（路径穿越防护）
src/renderer/popup.html/js   翻译结果弹窗（暗色毛玻璃）
src/renderer/overlay.html/js 截图框选两阶段覆盖层（绘制→编辑→确认）
src/renderer/settings.html/js 设置页（暗色主题）
scripts/ocr.ps1              Windows OCR（WinRT）
tests/                       单元测试（84 个，node:test）
```

## 安全

- **API Key 零泄漏**：key 只在运行时从本地 auth.json 读取，不写入源码、日志或测试
- **URL 校验**：翻译服务地址验证公网 IP，禁止 localhost/内网/保留地址
- **SSRF 防护**：fetch 使用 `redirect: 'manual'`，重定向时逐跳校验目标地址
- **路径穿越防护**：环境变量路径在 `path.resolve` 前预校验；OCR 临时文件路径边界校验
- **日志安全**：消息转义换行符，不泄露完整文件路径

## 隐私

翻译文本只发送给你自己配置的翻译服务（默认 OpenCode 网关）；API Key 仅运行时读取，不落日志。
截图仅本地 OCR，识别文本同样只发往翻译服务。OCR 语言数据随应用打包，运行时完全离线。

## 协议

[MIT](LICENSE)
