# PROGRESS · 划译

## 第二轮：模型选择 + 免费模型约束 + UI 美化 + OCR + 单文件 exe + 图标/协议（2026-08-31）✅

领导新增需求与落地情况：

1. **模型自选**：托盘「选择模型」子菜单一键切换（启动即拉取列表、可刷新、当前模型打勾）；设置页改为「下拉建议 + 自由输入」组合框（input list + datalist），不再局限于列表
2. **只能用免费模型**：freeModelsOnly() 过滤（-free 后缀），托盘/设置页两个入口都过滤；配置层兜底——非免费模型名在 mergeDefaults 时自动回退默认免费模型，手输也绕不过
3. **UI 美化**：弹窗重做（渐变头部+Logo+模型徽章、卡片圆角阴影、SVG 图标按钮、弹入动画）；设置页重做（渐变 Hero 头、卡片分区、彩色图标 chip、聚焦光圈、渐变保存按钮）；**弹窗改为 showInactive 不抢焦点**，点击弹窗外部由全局钩子收起（修真实 UX 缺陷）
4. **OCR 截图翻译**：Alt+S（或托盘「截图翻译」）→ 全屏框选覆盖层 → desktopCapturer 截屏裁剪 → PowerShell 调 Windows 自带 WinRT OCR（离线零依赖，zh-Hans-CN 实测可用）→ 文本清理（去中文字间空格）→ 翻译弹窗。实弹证据：识别 21 字符「需要 LF 行结束符」并弹出翻译（laguna · 1733ms）
5. **单文件 exe**：electron-builder portable → release-builder\划译.exe（约 96MB，icon.ico 已嵌入）。关键配置：electronDist 指向本地已解压 dist（不联网下载）、npmRebuild=false（N-API 预编译无需 VS 重编译）、asarUnpack scripts（PowerShell OCR 脚本必须在磁盘上）
6. **SVG 图标**：build/icon.svg（渐变圆角方块+双语对话气泡）→ scripts/render-icon.js 用 Electron 栅格化 7 个尺寸 PNG + 打包 icon.ico；托盘/窗口/exe 全部换新图标
7. **README 重写 + MIT LICENSE**；不提交 GitHub（纯本地）

第二轮实弹回归（全部在新便携 exe 上）：
- Alt+S → OCR → 翻译弹窗 ✓（识别「需要 LF 行结束符」）
- Alt+Q → 弹窗「机器学习系统通过经验自动提高性能。」（2264ms）✓
- 双 Ctrl+C → detector double-copy → 翻译 ✓
- 单元测试 84/84 全绿 skipped=0
- powershell scripts/verify.ps1 → VERIFY ALL GREEN（84 测试 + E2E 真连网关返回中文 + 双交付物存在）

第二轮执行中发现并修掉的坑：
- UiohookKey.C=46（不是 Windows VK 0x43），探针确认
- 双 Ctrl+C 判定：C 键 keyup 不能清双击基准（真实序列 C↓C↑C↓C↑）
- Electron 44 的 clipboard.readText() 返回 Promise（同步写法拿到 Promise 对象）
- 取词判定改用 GetClipboardSequenceNumber（剪贴板内容相同也算新复制）
- display.size×scaleFactor 产生分数（2560.5）→ desktopCapturer 参数转换失败 → Math.round
- OCR 框选高度 <8 DIP 被静默忽略 → 加提示；ourWindowFocused 补上 overlay
- 便携 exe 运行中锁住输出文件导致 electron-builder 等解锁 → 打包前先杀实例

遗留（环境固有，非缺陷）：免费模型 mimo-v2.5-free 当日限流严重（429/503 频发），laguna-s-2.1-free 稳定；当前配置选 laguna，托盘一键可切回 mimo。

---

## 第一轮：任务 0-3（2026-08-30）✅

### 开工回执
- 理解的目标：Windows 划词翻译工具——任意软件选中文字，光标旁弹窗显示中文；三种触发（Alt+Q / 双 Ctrl+C / 自动弹默认关）；引擎走领导 opencode-go 网关；交付便携目录+桌面快捷方式
- 让步顺序：取词翻译稳定可靠 > 引擎可换 > 界面好看

### 任务 0 环境核验
- 预置 zip sha256 = e61aa3bcea8152bc0730abd015e47c032d778a0ef10e2a1c78ba3c4ea47942f9 与任务书一致 ✓
- npx electron --version → v44.0.0 ✓
- 真实网关调用 → 「敏捷的棕色狐狸跳过懒惰的狗。」断言含中文 ✓
- npm install --prefer-offline → added 17 packages in 1s ✓

### 任务 1 核心链路
- 核心库：gateway / selection / clipboardGuard / config / authJson / icon / native
- E2E 反向验证：--reverse（提示词改英文）→ 断言失败 exit 1（红）；还原 → 「敏捷的棕色狐狸跃过了懒狗。」exit 0（绿）

### 任务 2 交互与设置
- 冒烟 HUAYI_SMOKE=1 → HUAYI_SMOKE_OK tray=true hook=true hotkey=true
- 三触发实弹验证 + 失焦收起 + 设置页二次启动弹出

### 任务 3 交付
- deploy.ps1 一键重建 release\划译\ + 桌面快捷方式；便携 exe 冒烟通过
- verify.ps1 全绿（84 测试 + E2E 真连网关 + 交付物存在）

### 第一轮修掉的坑
- Electron 44 clipboard.readText() 返回 Promise；取词判定改剪贴板序列号
- 双击判定 mouseup 误清状态；双 Ctrl+C 的 C 键 keyup 误清基准
- RegisterHotKey 对注入输入不响应 → 低级钩子兜底（真实键盘两条路都通）
- deploy 前 kill 异步未等待导致删文件撞占用 → 等待 1.5s
