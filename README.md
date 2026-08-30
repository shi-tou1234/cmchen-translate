# 划译 · Windows 划词翻译

在任何软件里选中文字，光标旁弹出小窗显示中文翻译；按 `Alt+S` 框选屏幕任意区域，识别图中文字并翻译。
引擎使用你自己的 [opencode](https://opencode.ai) 网关免费模型（`-free` 结尾），无需为翻译另行注册或付费。

![icon](build/icons/icon-128.png)

## 功能

- **划词翻译**：选中文字后 `Alt+Q`，或 600ms 内连按两次 `Ctrl+C`；也可开启「选中自动弹窗」（拖选/双击即弹，终端类程序自动跳过）
- **截图翻译（OCR）**：`Alt+S` 框选屏幕区域 → Windows 自带 OCR 离线识别 → 自动翻译，中英文都支持
- **模型自选**：托盘「选择模型」一键切换（仅列免费模型），设置页也支持下拉选择或直接输入任意免费模型名
- **托盘常驻**：总开关、模型切换、截图翻译、设置、退出
- **设置**：服务地址、模型、API Key（留空自动读取 opencode 的 key）、字数上限、触发开关、黑名单、开机自启

## 下载与使用

- **单文件版**：`release-builder\划译.exe` —— 一个 exe，双击即用（首次启动解包需几秒）
- **便携目录版**：`npm run deploy` 部署到 `%LOCALAPPDATA%\划译\app-<时间戳>\` 并自动创建桌面快捷方式
- 桌面快捷方式图标取自 exe 内嵌资源

弹窗内：`Esc` 关闭，失焦自动收起；「复制译文」写剪贴板，「重试」重翻。
免费模型偶发限流（429/503）时弹窗会提示，稍等重试或在设置里换个模型。

## 从源码构建

环境要求：Windows 10+、Node.js 20+。

```bat
npm install --prefer-offline     :: 安装依赖（本机 npm 缓存友好）
npm run icons                    :: 由 build/icon.svg 生成多尺寸 PNG 与 icon.ico（需 Electron）
npm test                         :: 单元测试（node:test）
node scripts/e2e-gateway.js      :: 真连网关集成测试
npm run deploy                   :: 便携目录版 + 桌面快捷方式
npm run verify                   :: 验收：测试 + 网关 + 交付物
set ELECTRON_BUILDER_BINARIES_MIRROR=https://npmmirror.com/mirrors/electron-builder-binaries/
npx electron-builder --win portable --x64   :: 单文件 exe（输出 release-builder\）
```

> Electron 二进制获取困难时，将 zip 放到 `%LOCALAPPDATA%\electron\Cache` 对应哈希目录，或设置
> `ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/`。

## 架构

```
src/main.js        主进程：全局钩子/快捷键 → 取词（模拟 Ctrl+C + 剪贴板序列号备份恢复）
                   / 截图框选（desktopCapturer + WinRT OCR）→ 翻译 → 光标旁弹窗
src/lib/           纯逻辑库（node:test 覆盖）：gateway（OpenAI 兼容客户端 + URL 安全校验）
                   selection（选词/快捷键状态机）clipboardGuard（取词与 OCR 文本清理）
                   config authJson icon（纯代码 PNG/ICO）native（koffi FFI：SendInput 级按键、前台进程名）
src/renderer/      弹窗 / 设置 / 框选覆盖层（原生 HTML/JS，无框架）
build/icon.svg     图标源文件（栅格化脚本 scripts/render-icon.js）
tests/             单元测试（84 个）
scripts/           e2e、OCR 脚本、部署与验收、实弹驱动/探针工具
```

设计要点：全局鼠标/键盘钩子回调只做轻活（入队即返回），重活在主进程串行队列执行；
取词用剪贴板序列号判定（与剪贴板旧内容相同也能识别），触发前后备份恢复用户剪贴板（文本级）。

## 隐私

翻译文本只发送给你自己配置的翻译服务（默认 opencode 网关）；API Key 仅运行时从本地凭据文件或设置读取，不落日志、不进源码。截图仅本地 OCR，识别文本同样只发往翻译服务。

## 协议

[MIT](LICENSE)
