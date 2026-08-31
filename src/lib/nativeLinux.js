'use strict';

// Linux 原生调用（koffi FFI）：XTest 事件注入模拟 Ctrl+C（X11 会话）。
// 惰性加载：任何平台都可 require 本模块，只有调用时才加载系统库（libX11/libXtst）。
// 注意：Linux 终端里 Ctrl+C 是中断信号，自动弹窗必须谨慎；本模块不做前台进程名。

let libs = null;

function ensureLibs() {
  if (libs) return libs;
  const koffi = require('koffi');
  const x11 = koffi.load('libX11.so.6');
  const xtst = koffi.load('libXtst.so.6');
  libs = {
    xOpenDisplay: x11.func('void *XOpenDisplay(void *name)'),
    xKeysymToKeycode: x11.func('uint8 XKeysymToKeycode(void *display, ulong keysym)'),
    xFlush: x11.func('int XFlush(void *display)'),
    fakeKey: xtst.func('int XTestFakeKeyEvent(void *display, uint8 keycode, int is_press, ulong delay)')
  };
  return libs;
}

let displayPtr = null;

// 模拟 Ctrl+C（X11 下向焦点窗口注入）
function sendCtrlC() {
  try {
    const L = ensureLibs();
    if (!displayPtr) displayPtr = L.xOpenDisplay(null);
    if (!displayPtr) return;
    const ctrl = L.xKeysymToKeycode(displayPtr, 0xffe3); // XK_Control_L
    const c = L.xKeysymToKeycode(displayPtr, 0x63); // XK_c
    L.fakeKey(displayPtr, ctrl, 1, 0);
    L.fakeKey(displayPtr, c, 1, 0);
    L.fakeKey(displayPtr, c, 0, 0);
    L.fakeKey(displayPtr, ctrl, 0, 0);
    L.xFlush(displayPtr);
  } catch {
    /* 无 X 会话/缺库时静默 */
  }
}

// Linux 上不做剪贴板序列号，返回 null 让调用方退回「内容比较」判定
function clipboardSequence() {
  return null;
}

// Linux 上获取前台进程名需要额外 X 查询（首次规避），返回 null
function getForegroundProcessName() {
  return null;
}

module.exports = { sendCtrlC, clipboardSequence, getForegroundProcessName };