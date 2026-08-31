'use strict';

// 划译 · Electron 主进程
// 职责：全局钩子/快捷键触发 → 取词（模拟 Ctrl+C + 剪贴板备份恢复）→ 调网关翻译 → 光标旁弹窗。

const { app, BrowserWindow, Tray, Menu, globalShortcut, ipcMain, clipboard, screen, nativeImage, dialog, desktopCapturer } = require('electron');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { SelectionDetector, matchesBlacklist, parseHotkey, hotkeyMatches, normalizeRect, isValidSelectionRect, scaleRect } = require('#lib/selection.js');
const { pickCopiedText, shouldTranslate, pickCopiedTextBySequence, truncateForTranslate, cleanupOcrText } = require('#lib/clipboardGuard.js');
const { translateText, listModels, isPublicHttpUrl, friendlyError, dedupeModels, freeModelsOnly } = require('#lib/gateway.js');
const { loadConfig, saveConfig, resolveApiKey, mergeDefaults } = require('#lib/config.js');
const { buildIcon } = require('#lib/icon.js');
const native = require('#lib/platform.js');
const { recognizeText: recognizeTesseract } = require('#lib/tesseractOcr.js');
const { uIOhook, UiohookKey } = require('uiohook-napi');

// 调试日志：%APPDATA%\划译\log.txt（只记划译自身行为，不记 key、不记剪贴板内容）
function debugLog(msg) {
  try {
    const dir = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
    fs.mkdirSync(path.join(dir, '划译'), { recursive: true });
    fs.appendFileSync(path.join(dir, '划译', 'log.txt'), new Date().toISOString() + ' ' + msg + '\n', 'utf8');
  } catch {}
}

const COPY_POLL_MS = 50;
const COPY_POLL_TIMES = 14; // 最多等 700ms

if (!app.requestSingleInstanceLock()) {
  app.quit();
}

// 配置加载：文件损坏时给出可行动提示并用默认值启动，不让应用起不来
let config = null;
try {
  config = loadConfig();
} catch (err) {
  debugLog('config load error: ' + ((err && err.message) || err));
  config = mergeDefaults({});
}
let enabled = true; // 托盘总开关（会话级，不落盘）
let tray = null;
let popup = null;
let settingsWin = null;
let lastShown = null;
let lastOriginal = null;
let pending = false;
let hookStarted = false;
let ctrlDown = false;
let altDown = false;
let shiftDown = false;
let hookHotkey = null; // parseHotkey(config.hotkey) 的缓存
const OCR_HOTKEY = 'Alt+S'; // 截图翻译快捷键（v1 固定）
let hookOcrHotkey = parseHotkey(OCR_HOTKEY);
let hotkeyAt = -Infinity; // Electron 全局快捷键刚触发过的时间（去重钩子兜底）
let cachedModels = []; // 网关模型列表缓存（托盘「选择模型」子菜单）
let modelsLoading = false;
let overlay = null; // 截图框选覆盖层
let ocrBusy = false;
let quitting = false;

// keycode → 小写字母/数字（仅 A-Z 0-9，热键兜底判定用）
const KEYCODE_TO_CHAR = new Map(
  Object.entries(UiohookKey)
    .filter(([k, v]) => /^[A-Z0-9]$/.test(k) && typeof v === 'number')
    .map(([k, v]) => [v, k.toLowerCase()])
);

const detector = new SelectionDetector();

// ---------- 轻量串行队列：钩子回调只入队，重活都在这里跑 ----------
const queue = [];
let draining = false;
function enqueue(fn) {
  queue.push(fn);
  if (!draining) drain();
}
async function drain() {
  draining = true;
  while (queue.length) {
    try {
      await queue.shift()();
    } catch (err) {
      debugLog('queue task error: ' + ((err && err.message) || err));
      console.error('[huayi] 队列任务失败:', err);
    }
  }
  draining = false;
}

// ---------- 应用生命周期 ----------
app.whenReady().then(() => {
  try {
    cleanupOcrTemp(); // 启动时清掉上次可能残留的 OCR 临时文件
    createTray();
    syncHook();
    registerHotkey();
    applyAutoStart();
    wireIpc();
  } catch (err) {
    dialog.showErrorBox('划译启动失败', String((err && err.message) || err));
    app.quit();
    return;
  }
  app.on('second-instance', () => showSettings());

// 冒烟测试：HUAYI_SMOKE=1 启动后 2.5 秒自动退出，验证托盘/钩子/快捷键/IPC 全部就绪
if (process.env.HUAYI_SMOKE) {
  setTimeout(() => {
    console.log('HUAYI_SMOKE_OK tray=%s hook=%s hotkey=%s', !!tray, hookStarted, config.hotkeyEnabled);
    app.exit(0);
  }, 2500);
}
});

app.on('window-all-closed', () => {
  // 托盘应用：窗口全关也不退出
});

app.on('before-quit', () => {
  quitting = true;
  try {
    if (hookStarted) uIOhook.stop();
  } catch {}
  try {
    globalShortcut.unregisterAll();
  } catch {}
});

// ---------- 托盘 ----------
// 图标优先用 SVG 栅格化产物（build/icons/icon-64.png），缺失时退回运行时绘制
function trayIcon() {
  try {
    const p = path.join(__dirname, '..', 'build', 'icons', 'icon-64.png');
    if (fs.existsSync(p)) {
      const img = nativeImage.createFromPath(p);
      if (!img.isEmpty()) return img;
    }
  } catch {}
  return nativeImage.createFromBuffer(buildIcon(64));
}

function createTray() {
  tray = new Tray(trayIcon());
  tray.setToolTip('划译 · 划词翻译');
  tray.on('click', () => showSettings());
  rebuildTrayMenu();
  refreshModelsAsync(false);
}

function rebuildTrayMenu() {
  if (!tray) return;
  const modelItems = [];
  if (cachedModels.length) {
    for (const id of cachedModels) {
      modelItems.push({
        label: id === config.model ? id + '（当前）' : id,
        type: 'checkbox',
        checked: id === config.model,
        click: () => switchModel(id)
      });
    }
  } else {
    modelItems.push({
      label: modelsLoading ? '正在获取模型列表…' : '尚未获取模型列表',
      enabled: false
    });
  }
  modelItems.push({ type: 'separator' });
  modelItems.push({
    label: '刷新模型列表',
    click: () => refreshModelsAsync(true)
  });
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: '划词翻译已启用', type: 'checkbox', checked: enabled, click: (item) => (enabled = item.checked) },
      { label: '选择模型', submenu: modelItems },
      { label: '截图翻译 (Alt+S)', click: () => enqueue(() => startOcrSelection()) },
      { label: '设置…', click: () => showSettings() },
      { type: 'separator' },
      { label: '退出', click: () => app.quit() }
    ])
  );
}

// 托盘一键切换模型：立即生效并落盘
function switchModel(id) {
  if (typeof id !== 'string' || !id.trim() || id === config.model) return;
  config.model = id.trim();
  try {
    saveConfig(config);
  } catch (err) {
    notify('保存失败', String((err && err.message) || err));
  }
  debugLog('model switched to ' + config.model);
  rebuildTrayMenu();
}

// 拉取网关模型列表（当前模型置顶），供托盘子菜单与设置页共用
async function refreshModelsAsync(notifyOnFail) {
  if (modelsLoading) return;
  modelsLoading = true;
  rebuildTrayMenu();
  try {
    const apiKey = await resolveApiKey(config);
    const ids = await listModels({ baseUrl: config.baseUrl, apiKey });
    cachedModels = dedupeModels(freeModelsOnly(ids), config.model);
  } catch (err) {
    debugLog('listModels failed: ' + ((err && err.message) || err));
    if (notifyOnFail) notify('获取模型列表失败', friendlyError(err));
  } finally {
    modelsLoading = false;
    rebuildTrayMenu();
  }
}

function notify(title, content) {
  try {
    if (tray) tray.displayBalloon({ title, content });
    else dialog.showErrorBox(title, content);
  } catch {}
}

// ---------- 设置窗口 ----------
function showSettings() {
  if (settingsWin) {
    settingsWin.show();
    settingsWin.focus();
    return;
  }
  settingsWin = new BrowserWindow({
    width: 720,
    height: 780,
    title: '划译 · 设置',
    autoHideMenuBar: true,
    icon: trayIcon(),
    webPreferences: { preload: path.join(__dirname, 'preload-settings.js') }
  });
  settingsWin.loadFile(path.join(__dirname, 'renderer', 'settings.html'));
  settingsWin.on('closed', () => (settingsWin = null));
}

// ---------- 译文弹窗 ----------
function ensurePopup() {
  if (popup) return popup;
  popup = new BrowserWindow({
    width: 460,
    height: 310,
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: false,
    webPreferences: { preload: path.join(__dirname, 'preload-popup.js') }
  });
  popup.setAlwaysOnTop(true, 'screen-saver');
  popup.loadFile(path.join(__dirname, 'renderer', 'popup.html'));
  popup.on('blur', () => {
    if (!pending) popup.hide();
  });
  popup.on('closed', () => (popup = null));
  return popup;
}

function positionPopupAtCursor(win) {
  const cursor = screen.getCursorScreenPoint();
  const { workArea } = screen.getDisplayNearestPoint(cursor);
  const [w, h] = win.getSize();
  const x = Math.min(Math.max(cursor.x + 14, workArea.x), workArea.x + workArea.width - w - 4);
  const y = Math.min(Math.max(cursor.y + 14, workArea.y), workArea.y + workArea.height - h - 4);
  win.setPosition(x, y, false);
}

function ourWindowFocused() {
  return !!(popup && popup.isFocused()) || !!(settingsWin && settingsWin.isFocused()) || !!(
    overlay && overlay.isFocused()
  );
}

// ---------- 取词 ----------
// Electron 44 起 clipboard.readText() 返回 Promise——统一 await 兼容两种形态。
async function readClipboardText() {
  return String((await clipboard.readText()) || '').trim();
}

// 模拟 Ctrl+C 前先备份剪贴板文本；用剪贴板序列号判定「真的复制了」。
// 恢复旧剪贴板前再查一次序列号：若用户在轮询期间又复制了新内容，则保留用户的，
// 不覆盖（v1 只备份/恢复文本；原本是图片/文件时无法还原，见 PROGRESS.md）。
async function copySelectionViaKeys() {
  const seqAvailable = typeof native.clipboardSequence === 'function';
  const seqBefore = seqAvailable ? native.clipboardSequence() : null;
  const before = await readClipboardText();
  native.sendCtrlC();
  let after = null;
  let seqChanged = false;
  for (let i = 0; i < COPY_POLL_TIMES; i++) {
    await new Promise((r) => setTimeout(r, COPY_POLL_MS));
    const cur = await readClipboardText();
    if (!seqChanged && seqAvailable && native.clipboardSequence() !== seqBefore) seqChanged = true;
    if (!seqChanged && !seqAvailable && cur && cur !== before) seqChanged = true;
    if (seqChanged && cur) {
      after = cur;
      break;
    }
  }
  const stillSameSeq = !seqAvailable || native.clipboardSequence() === seqBefore;
  if (stillSameSeq) await clipboard.writeText(before);
  return seqChanged && after ? after : null;
}

function isForegroundBlacklisted() {
  try {
    return matchesBlacklist(native.getForegroundProcessName(), config.blacklist);
  } catch {
    return false;
  }
}

// ---------- 触发处理 ----------
async function onTrigger(kind) {
  debugLog('onTrigger kind=' + kind + ' enabled=' + enabled);
  if (!enabled || quitting) return;
  if (ourWindowFocused()) return;
  detector.doubleCopyWindowMs = config.doubleCopyWindowMs;

  let text = null;
  if (kind === 'double-copy') {
    if (!config.doubleCopyEnabled) return;
    text = await readClipboardText();
  } else {
    if ((kind === 'drag' || kind === 'dblclick') && !config.autoPopupEnabled) return;
    if (kind === 'drag' && isForegroundBlacklisted()) return;
    text = await copySelectionViaKeys();
  }
  if (!shouldTranslate(text, lastShown)) return;
  await translateAndShow(text);
}

async function translateAndShow(originalText) {
  debugLog('translateAndShow len=' + originalText.length);
  const text = originalText.trim();
  lastShown = text;
  lastOriginal = text;
  const { text: toSend, truncated } = truncateForTranslate(text, config.maxChars);

  const win = ensurePopup();
  positionPopupAtCursor(win);
  pending = true;
  // 首次创建弹窗时页面还没加载完：等 did-finish-load 再发事件，避免 pending 丢失
  const payload = { original: text, truncated, model: config.model };
  if (win.webContents.isLoading()) {
    win.webContents.once('did-finish-load', () => win.webContents.send('huayi:pending', payload));
  } else {
    win.webContents.send('huayi:pending', payload);
  }
  win.showInactive(); // 不抢焦点：不打断用户当前的打字/操作

  const started = Date.now();
  try {
    const apiKey = await resolveApiKey(config);
    const translated = await translateText({
      baseUrl: config.baseUrl,
      apiKey,
      model: config.model,
      text: toSend
    });
    win.webContents.send('huayi:result', {
      ok: true,
      original: text,
      translated,
      ms: Date.now() - started,
      model: config.model
    });
  } catch (err) {
    debugLog('translate error: ' + ((err && err.message) || err));
    win.webContents.send('huayi:result', {
      ok: false,
      original: text,
      error: String((err && err.message) || err),
      model: config.model
    });
  } finally {
    pending = false;
  }
}

// ---------- 全局钩子 ----------
function needsHook() {
  return config.doubleCopyEnabled || config.autoPopupEnabled || config.ocrEnabled;
}

function startHook() {
  if (hookStarted) return;
  // 重启钩子时强制清零修饰键状态，防止上一次会话留下的 stale 标志导致误判
  ctrlDown = false;
  altDown = false;
  shiftDown = false;
  uIOhook.on('mousedown', (e) => {
    // 轻活：弹窗未聚焦模式下，点击弹窗外部即收起（getBounds 是同步轻调用）
    if (popup && popup.isVisible()) {
      const b = popup.getBounds();
      if (e.x < b.x || e.y < b.y || e.x > b.x + b.width || e.y > b.y + b.height) {
        pending = false;
        popup.hide();
      }
    }
    enqueue(() => {
      const t = detector.mouse({ type: 'down', x: e.x, y: e.y, button: e.button });
      if (t) return onTrigger(t);
    });
  });
  uIOhook.on('mouseup', (e) => {
    enqueue(() => {
      const t = detector.mouse({ type: 'up', x: e.x, y: e.y, button: e.button });
      if (t) return onTrigger(t);
    });
  });
  uIOhook.on('keydown', (e) => {
    if (e.keycode === UiohookKey.Ctrl) ctrlDown = true;
    if (e.keycode === UiohookKey.Alt) altDown = true;
    if (e.keycode === UiohookKey.Shift) shiftDown = true;
    if (e.keycode === UiohookKey.C) {
      debugLog('hook keydown C ctrl=' + ctrlDown);
      enqueue(() => {
        if (ourWindowFocused()) return;
        const t = detector.key({ key: 'c', ctrl: ctrlDown });
        debugLog('detector.key -> ' + t);
        if (t) return onTrigger(t);
      });
      return;
    }
    // 快捷键兜底：RegisterHotKey 在部分环境（如远程会话注入输入）不触发，
    // 低级钩子看得见同样的按键；真实键盘两条路都走，靠串行队列+去重防双弹。
    const ch = KEYCODE_TO_CHAR.get(e.keycode);
    if (!ch) return;
    if (hookHotkey && hotkeyMatches(hookHotkey, { key: ch, ctrl: ctrlDown, alt: altDown, shift: shiftDown })) {
      debugLog('hook fallback hotkey fired');
      enqueue(() => {
        if (ourWindowFocused()) return;
        if (Date.now() - hotkeyAt < 800) return; // 全局快捷键刚触发过
        hotkeyAt = Date.now();
        return onTrigger('hotkey');
      });
      return;
    }
    if (hookOcrHotkey && config.ocrEnabled && hotkeyMatches(hookOcrHotkey, { key: ch, ctrl: ctrlDown, alt: altDown, shift: shiftDown })) {
      debugLog('hook fallback ocr hotkey fired');
      enqueue(() => {
        if (ourWindowFocused()) return;
        if (Date.now() - hotkeyAt < 800) return;
        hotkeyAt = Date.now();
        return startOcrSelection();
      });
    }
  });
  uIOhook.on('keyup', (e) => {
    if (e.keycode === UiohookKey.Ctrl) ctrlDown = false;
    if (e.keycode === UiohookKey.Alt) altDown = false;
    if (e.keycode === UiohookKey.Shift) shiftDown = false;
  });
  try {
    uIOhook.start();
  } catch (err) {
    // 启动失败（权限/环境限制）：清掉刚注册的监听器，避免下次重试重复触发
    try {
      uIOhook.removeAllListeners();
    } catch {}
    hookStarted = false;
    debugLog('uIOhook.start failed: ' + ((err && err.message) || err));
    notify('全局钩子启动失败', '划词取词与截图框选不可用，但快捷键触发的翻译仍可工作');
    return;
  }
  hookStarted = true;
}

function stopHook() {
  if (!hookStarted) return;
  try {
    uIOhook.stop();
    uIOhook.removeAllListeners();
  } catch {}
  hookStarted = false;
  ctrlDown = false;
  altDown = false;
  shiftDown = false;
}

function syncHook() {
  if (needsHook()) startHook();
  else stopHook();
}

// ---------- 快捷键与自启 ----------
function registerHotkey() {
  try {
    globalShortcut.unregisterAll();
  } catch {}
  config.hotkeyRegistered = null;
  hookHotkey = config.hotkeyEnabled ? parseHotkey(config.hotkey) : null;
  if (config.hotkeyEnabled) {
    try {
      const okFlag = globalShortcut.register(config.hotkey, () => {
        hotkeyAt = Date.now();
        enqueue(() => onTrigger('hotkey'));
      });
      if (okFlag) config.hotkeyRegistered = config.hotkey;
      else notify('快捷键注册失败', config.hotkey + ' 可能被其他程序占用，可在设置中更换。');
    } catch (err) {
      notify('快捷键注册失败', String((err && err.message) || err));
    }
  }
  if (config.ocrEnabled) {
    try {
      const okFlag = globalShortcut.register(OCR_HOTKEY, () => {
        hotkeyAt = Date.now();
        enqueue(() => startOcrSelection());
      });
      if (!okFlag) debugLog('Alt+S 注册失败（可能被占用），钩子兜底仍可用');
    } catch (err) {
      debugLog('Alt+S 注册异常: ' + ((err && err.message) || err));
    }
  }
}

function applyAutoStart() {
  try {
    app.setLoginItemSettings({ openAtLogin: !!config.autoStart, path: process.execPath, args: [] });
  } catch {}
}

// ---------- 截图翻译（OCR） ----------
// 清理本应用的 OCR 临时目录（固定路径，无用户输入成分）
function cleanupOcrTemp() {
  try {
    const dir = path.resolve(app.getPath('temp'), 'huayi-ocr');
    if (dir.startsWith(path.resolve(app.getPath('temp')))) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  } catch {}
}

function startOcrSelection() {
  if (!config.ocrEnabled || overlay) return;
  const cursor = screen.getCursorScreenPoint();
  const display = screen.getDisplayNearestPoint(cursor);
  const { x, y, width, height } = display.bounds;
  const win = new BrowserWindow({
    x, y, width, height,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: false,
    webPreferences: { preload: path.join(__dirname, 'preload-overlay.js') }
  });
  overlay = win;
  win.setAlwaysOnTop(true, 'screen-saver');
  win.loadFile(path.join(__dirname, 'renderer', 'overlay.html'));
  // 闭包捕获：旧窗口的 closed 事件不能清掉后来新创建的 overlay 引用
  win.on('closed', () => {
    if (overlay === win) overlay = null;
  });
}

function closeOverlay() {
  if (overlay) {
    try {
      overlay.destroy();
    } catch {}
    overlay = null;
  }
}

// 用 PowerShell 调 Windows 自带 WinRT OCR（离线、零依赖）。语言包缺失时报 exit 3。
function runOcr(pngPath) {
  return new Promise((resolve, reject) => {
    // 打包后 scripts/ 在 asarUnpack 的 app.asar.unpacked 里
    let base = app.getAppPath();
    if (base.includes('app.asar')) base = base.replace('app.asar', 'app.asar.unpacked');
    const script = path.join(base, 'scripts', 'ocr.ps1');
    const child = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script, pngPath], {
      windowsHide: true
    });
    let out = '';
    let errText = '';
    const timer = setTimeout(() => {
      try { child.kill(); } catch {}
      reject(new Error('OCR 超时（30 秒）'));
    }, 30000);
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (errText += d));
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) return resolve(cleanupOcrText(out));
      if (code === 3) {
        return reject(new Error('Windows 缺少可用的 OCR 语言包：请在系统设置→时间和语言→语言中添加中文或英文'));
      }
      reject(new Error('OCR 失败: ' + (errText.trim() || 'exit ' + code)));
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(new Error('无法启动 PowerShell: ' + err.message));
    });
  });
}

async function handleOcrRect(rect) {
  if (ocrBusy) return;
  ocrBusy = true;
  try {
    debugLog('handleOcrRect rect=' + JSON.stringify(rect));
    if (!isValidSelectionRect(rect, 8)) {
      debugLog('ocr rect too small');
      notify('截图翻译', '选区太小，请框选更大一些的区域');
      return;
    }
    const winBounds = overlay ? overlay.getBounds() : screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).bounds;
    closeOverlay();
    // 覆盖层必须先隐藏再截图，否则暗色遮罩会拍进图里
    await new Promise((r) => setTimeout(r, 400));

    const center = { x: winBounds.x + Math.round(rect.x + rect.width / 2), y: winBounds.y + Math.round(rect.y + rect.height / 2) };
    const display = screen.getDisplayNearestPoint(center);
    const scaleFactor = display.scaleFactor > 0 ? display.scaleFactor : 1;
    const pixRect = scaleRect(rect, scaleFactor);
    // desktopCapturer.getSources 在部分机器上对超大缩略图会挂起：限时竞速，超时降尺寸重试
    const capture = async (w, h) => {
      const sources = await Promise.race([
        desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: w, height: h } }),
        new Promise((_, rej) => setTimeout(() => rej(new Error('capture timeout')), 12000))
      ]);
      const source = sources.find((s) => s.display_id === String(display.id)) || sources[0];
      if (!source || source.thumbnail.isEmpty()) throw new Error('无法捕获屏幕内容');
      return source;
    };
    let source;
    try {
      const w = Math.round(display.size.width * scaleFactor);
      const h = Math.round(display.size.height * scaleFactor);
      debugLog('capturing screen ' + w + 'x' + h);
      source = await capture(w, h);
    } catch (err) {
      debugLog('capture full-size failed: ' + err.message + '，降尺寸重试');
      source = await capture(Math.round(display.size.width), Math.round(display.size.height));
    }
    debugLog('captured ok');
    // 裁剪区钳制在缩略图边界内（负坐标/超宽高会被 clamp，避免 crop 越界）
    const capSize = source.thumbnail.getSize();
    const cx = Math.max(0, Math.min(pixRect.x, capSize.width - 1));
    const cy = Math.max(0, Math.min(pixRect.y, capSize.height - 1));
    const cw = Math.max(1, Math.min(pixRect.width, capSize.width - cx));
    const ch = Math.max(1, Math.min(pixRect.height, capSize.height - cy));
    if (cw < 2 || ch < 2) {
      notify('截图翻译', '选区太小，请框选更大一些的区域');
      return;
    }
    const cropped = source.thumbnail.crop({ x: cx, y: cy, width: cw, height: ch });
    // 临时截图：固定目录 + 路径边界校验，用完即删（仅动自己生成的临时文件）
    const tmpDir = path.resolve(app.getPath('temp'), 'huayi-ocr');
    fs.mkdirSync(tmpDir, { recursive: true });
    const tmp = path.resolve(tmpDir, 'huayi-ocr-' + Date.now() + '.png');
    if (!tmp.startsWith(tmpDir + path.sep)) throw new Error('临时文件路径不合法');
    fs.writeFileSync(tmp, cropped.toPNG());
    let text = '';
    try {
      // Windows 用系统 WinRT OCR（离线、快）；macOS/Linux 用随包 Tesseract WASM
      if (process.platform === 'win32') {
        text = await runOcr(tmp);
      } else {
        const langPath = path.join(app.getAppPath(), 'build', 'tessdata');
        text = await recognizeTesseract(tmp, { langPath });
      }
      debugLog('ocr raw len=' + text.length);
    } finally {
      cleanupOcrTemp(); // 识别完成即清理截图等临时产物
    }
    if (!text) {
      debugLog('ocr empty text');
      notify('截图翻译', '未识别到文字，试试框得更紧一些');
      return;
    }
    debugLog('ocr text len=' + text.length);
    await translateAndShow(text);
  } catch (err) {
    notify('截图翻译失败', String((err && err.message) || err));
  } finally {
    ocrBusy = false;
  }
}

// ---------- IPC ----------
function wireIpc() {
  ipcMain.on('huayi:hide', () => {
    pending = false;
    if (popup) popup.hide();
  });
  ipcMain.on('huayi:copy', (e, text) => {
    if (typeof text === 'string') clipboard.writeText(text);
  });
  ipcMain.on('huayi:retry', () => {
    enqueue(async () => {
      if (lastOriginal && shouldTranslate(lastOriginal, null)) await translateAndShow(lastOriginal);
    });
  });

  ipcMain.on('huayi:ocr-cancel', () => closeOverlay());
  ipcMain.on('huayi:ocr-rect', (_e, rect) => {
    debugLog('ocr-rect ipc: ' + JSON.stringify(rect));
    const r = {
      x: Number(rect && rect.x),
      y: Number(rect && rect.y),
      width: Number(rect && rect.width),
      height: Number(rect && rect.height)
    };
    if (![r.x, r.y, r.width, r.height].every((n) => Number.isFinite(n) && n >= 0)) {
      closeOverlay();
      return;
    }
    const norm = normalizeRect(r.x, r.y, r.x + r.width, r.y + r.height);
    closeOverlay();
    enqueue(() => handleOcrRect(norm));
  });

  ipcMain.handle('huayi:get-config', () => {
    // apiKey 不回传渲染层：只告知是否已手填
    return { ...config, apiKey: '', apiKeySet: !!config.apiKey, hotkeyRegistered: undefined };
  });
  ipcMain.handle('huayi:save-config', (e, next) => {
    const merged = mergeDefaults({ ...config, ...next });
    // apiKey 语义：传空且原来也没填 → 保持空（自动读 auth.json）；传非空 → 更新
    if (typeof next.apiKey === 'string' && next.apiKey.trim()) merged.apiKey = next.apiKey.trim();
    else merged.apiKey = config.apiKey || '';
    const urlCheck = isPublicHttpUrl(merged.baseUrl);
    if (!urlCheck.ok) return { ok: false, error: '服务地址被拒绝：' + urlCheck.reason };
    if (!/^[A-Za-z0-9]+(\+[A-Za-z0-9]+)*$/.test(merged.hotkey)) {
      return { ok: false, error: '快捷键格式不合法，示例：Alt+Q' };
    }
    config = merged;
    delete config.hotkeyRegistered;
    try {
      saveConfig(config);
    } catch (err) {
      return { ok: false, error: '保存失败：' + ((err && err.message) || err) };
    }
    // 应用配置：任一环节失败都不卡死设置页，返回具体错误（配置本身已落盘）
    try {
      registerHotkey();
      syncHook();
      applyAutoStart();
    } catch (err) {
      return { ok: false, error: '配置已保存但生效失败：' + ((err && err.message) || err) };
    }
    return { ok: true };
  });
  ipcMain.handle('huayi:list-models', async () => {
    try {
      const apiKey = await resolveApiKey(config);
      const ids = await listModels({ baseUrl: config.baseUrl, apiKey });
      return { ok: true, ids: dedupeModels(freeModelsOnly(ids), config.model) };
    } catch (err) {
      return { ok: false, error: String((err && err.message) || err) };
    }
  });
}
