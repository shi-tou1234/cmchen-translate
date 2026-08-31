# 划译 · 跨平台划词翻译

在任意软件里选中文字，光标旁弹出小窗显示中文翻译；按 `Alt+S`（macOS `Cmd+S`）框选屏幕任意区域，识别图中文字并翻译。
支持 **Windows、macOS、Linux**，引擎使用你自己的 [OpenCode](https://opencode.ai) 网关免费模型（`-free` 后缀），无需为翻译另行注册或付费。

![icon](build/icons/icon-128.png)

## 功能

- **划词翻译**：选中文字后 `Alt+Q`（macOS 为 `Cmd+Q`），或 600ms 内连按两次 `Ctrl+C`（macOS 连按两次 `Cmd+C`）；也可开启「选中自动弹窗」（拖选/双击即弹，终端类程序自动跳过）
- **截图翻译（OCR）**：`Alt+S`（macOS 为 `Cmd+S`）框选屏幕区域 → OCR 识别 → 自动翻译
  - Windows：系统自带 WinRT OCR（离线，支持中英文）
  - macOS/Linux：随包 Tesseract WASM（eng + chi_sim，运行时不联网，约 50MB 包体增加）
- **模型自选**：托盘右键「选择模型」一键切换（仅显示免费模型），设置页也可直接输入任意免费模型名
- **托盘常驻**：总开关、模型切换、截图翻译、设置、退出
- **跨平台 UI**：弹窗不抢焦点（`showInactive`），点击外部自动收起

## 下载安装

前往 [GitHub Releases](https://github.com/shi-tou1234/cmchen-translate/releases) 下载对应平台：

| 平台 | 文件 |
|------|------|
| Windows x64 | `cmchen-translate-setup-*.exe`（安装版）或 `cmchen-translate-portable-*.exe`（单文件便携） |
| macOS Intel | `cmchen-translate-*-x64.dmg` |
| macOS Apple Silicon | `cmchen-translate-*-arm64.dmg` |
| Linux x64 | `cmchen-translate-*.AppImage` 或 `cmchen-translate-*.deb` |

首次打开 macOS 可能提示"未知开发者"：右键 → 打开；Linux AppImage 需要 `chmod +x`；Windows 未签名安装包可能弹 SmartScreen 提示，点"仍要运行"。

## 使用

启动后托盘出现蓝色图标。三种触发方式（默认开启前两种）：

| 方式 | Windows / Linux | macOS |
|------|----------------|-------|
| 快捷键 | `Alt+Q` | `Cmd+Q` |
| 快速双复制 | `Ctrl+C` 连按两次 | `Cmd+C` 连按两次 |
| 选中自动弹 | 设置中开启，终端自动跳过 | 设置中开启 |

弹窗内：`Esc` 关闭，失焦自动收起；「复制译文」写剪贴板，「重试」重翻。

截图翻译：快捷键后全屏半透明覆盖层 → 拖拽框选 → **拖手柄调整大小/拖内部移动** → Enter 或点击「翻译」→ OCR 识别 → 翻译弹窗。

## 设置

托盘右键 → 设置（或再次双击启动图标）。
可改：服务地址、模型（下拉列表/自由输入）、API Key（留空自动读 opencode 的 key）、字数上限、三种触发开关、黑名单（Windows/Linux）、OCR 开关、开机自启。

## 从源码构建

环境要求：Windows 10+ / macOS 12+ / Ubuntu 20.04+，Node.js 22+。

```bash
git clone https://github.com/shi-tou1234/cmchen-translate.git
cd cmchen-translate
npm install --prefer-offline          # 安装依赖（本机缓存友好）
npm run icons                         # 由 build/icon.svg 生成多尺寸 PNG 与 icon.ico
npm run stage:tessdata                # 收集 OCR 语言数据到 build/tessdata/（macOS/Linux 必需）
npm test                              # 单元测试（node:test）
npm run deploy                        # （Windows）便携目录版 + 桌面快捷方式
npm run verify                        # （Windows）验收：测试 + 网关 + 交付物
# 打包三平台安装包（macOS 只能在 macOS 上打；Linux 只能打 Linux/AppImage/deb）
npx electron-builder --win nsis portable --x64       # Windows
npx electron-builder --mac dmg zip --arm64           # macOS ARM
npx electron-builder --linux AppImage deb --x64      # Linux
```

CI 自动化（tag 触发 GitHub Actions）：
```bash
git tag v1.0.0 && git push origin v1.0.0   # 触发 Release 工作流，自动构建三平台并上传产物
```

> 本机构建 Windows 版时若遇到 `EBUSY: resource busy or locked`（杀毒扫描句柄残留），临时目录解决见 `scripts/deploy.ps1`。

## 架构

```
src/main.js                主进程：全局钩子/快捷键 → 取词 → 翻译 → 弹窗/截图框选 OCR
src/lib/platform.js        平台分派层（Win → native.js / macOS → nativeDarwin.js / Linux → nativeLinux.js）
src/lib/tesseractOcr.js    跨平台 OCR（Tesseract WASM，macOS/Linux 用）
src/lib/gateway.js         OpenAI 兼容翻译客户端 + URL 安全校验
src/lib/selection.js       选词/快捷键状态机（拖选、双击、双击复制、矩形工具）
src/lib/clipboardGuard.js  取词判定、剪贴板序列号、OCR 文本清理
src/lib/icon.js            运行时 PNG/ICO 生成（零依赖）
src/renderer/overlay.html/js   截图框选两阶段覆盖层（绘制 → 编辑手柄 → 确认）
src/renderer/popup.html/js      翻译结果弹窗
src/renderer/settings.html/js   设置页
scripts/ocr.ps1           Windows OCR（WinRT，PowerShell）
scripts/stage-tessdata.js 收集 Tesseract 语言数据
tests/                    单元测试（84 个，node:test）
```

设计要点：全局钩子回调只做轻活（入队即返回），重活在主进程串行队列执行；
取词用剪贴板序列号判定（剪贴板已有相同文本时也能识别）；触发前后备份恢复剪贴板（文本级）。

## 隐私

翻译文本只发送给你自己配置的翻译服务（默认 OpenCode 网关）；API Key 仅运行时从本地凭据文件或设置读取，不落日志、不进源码。
截图仅本地 OCR，识别文本同样只发往翻译服务。OCR 语言数据（eng + chi_sim）随应用打包，运行时完全离线。

## 协议

[MIT](LICENSE)
