'use strict';

// macOS 原生调用（koffi FFI）：CoreGraphics 事件注入模拟 Cmd+C（macOS 复制=Command+C）。
// 惰性加载：模块本身在任何平台都可 require，只有真正调用时才加载系统库。
// macOS 的 Cmd+C 不会中断终端程序，且前台进程名获取依赖权限，黑名单在 mac 上不做强制。

const path = require('node:path');

const KEYCODE_C = 8; // mac 键码
const kCGEventFlagMaskCommand = 1 << 20;
const kCGHIDEventTap = 0;

let libs = null;

function ensureLibs() {
  if (libs) return libs;
  const koffi = require('koffi');
  const cg = koffi.load('/System/Library/Frameworks/CoreGraphics.framework/CoreGraphics');
  libs = {
    createEvent: cg.func('void *CGEventCreateKeyboardEvent(void *source, uint16 virtualKey, int keyDown)'),
    setFlags: cg.func('void CGEventSetFlags(void *event, uint64 flags)'),
    post: cg.func('void CGEventPost(uint32 tap, void *event)'),
    release: cg.func('void CFRelease(void *cf)')
  };
  return libs;
}

// 模拟 Cmd+C：选中文本复制进剪贴板
function sendCtrlC() {
  try {
    const L = ensureLibs();
    const down = L.createEvent(null, KEYCODE_C, 1);
    const up = L.createEvent(null, KEYCODE_C, 0);
    if (down) {
      L.setFlags(down, kCGEventFlagMaskCommand);
      L.post(kCGHIDEventTap, down);
      L.release(down);
    }
    if (up) {
      L.post(kCGHIDEventTap, up);
      L.release(up);
    }
  } catch {
    /* 注入失败（权限/无图形会话）时静默，调用方会因取不到文本而自然跳过 */
  }
}

// mac 上不做剪贴板序列号，返回 null 让调用方退回「内容比较」判定
function clipboardSequence() {
  return null;
}

// mac 上获取前台进程名需要辅助功能权限且价值低（Cmd+C 不中断终端），返回 null
function getForegroundProcessName() {
  return null;
}

module.exports = { sendCtrlC, clipboardSequence, getForegroundProcessName };