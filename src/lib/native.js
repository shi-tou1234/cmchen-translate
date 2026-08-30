'use strict';

// Win32 原生调用（koffi FFI），写法均经 scripts/spike-native.js 实机验证。
// 仅在主进程使用；单元测试不依赖本模块。

const path = require('node:path');
const koffi = require('koffi');

const user32 = koffi.load('user32.dll');
const kernel32 = koffi.load('kernel32.dll');

const keybd_event = user32.func('void keybd_event(uint8 bVk, uint8 bScan, uint32 dwFlags, uintptr dwExtraInfo)');
const GetForegroundWindow = user32.func('void *GetForegroundWindow()');
const GetWindowThreadProcessId = user32.func('uint32 GetWindowThreadProcessId(void *hWnd, _Out_ uint32 *lpdwProcessId)');
const GetClipboardSequenceNumber = user32.func('uint32 GetClipboardSequenceNumber()');
const OpenProcess = kernel32.func('void *OpenProcess(uint32 dwDesiredAccess, int bInheritHandle, uint32 dwProcessId)');
const CloseHandle = kernel32.func('int CloseHandle(void *hObject)');
const QueryFullProcessImageNameW = kernel32.func(
  'int QueryFullProcessImageNameW(void *hProcess, uint32 dwFlags, void *lpExeName, _Inout_ uint32 *lpdwSize)'
);

const KEYEVENTF_KEYUP = 0x2;
const PROCESS_QUERY_LIMITED_INFORMATION = 0x1000;
const VK_CTRL = 0x11;
const VK_C = 0x43;

// 模拟一次 Ctrl+C（选中文本复制到剪贴板）
function sendCtrlC() {
  keybd_event(VK_CTRL, 0, 0, 0);
  keybd_event(VK_C, 0, 0, 0);
  keybd_event(VK_C, 0, KEYEVENTF_KEYUP, 0);
  keybd_event(VK_CTRL, 0, KEYEVENTF_KEYUP, 0);
}

// 查询前台窗口所属进程的可执行文件名（如 explorer.exe）；失败返回 null。
function getForegroundProcessName() {
  try {
    const hwnd = GetForegroundWindow();
    if (!hwnd) return null;
    const pidOut = [0];
    GetWindowThreadProcessId(hwnd, pidOut);
    const pid = pidOut[0];
    if (!pid) return null;
    const handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
    if (!handle) return null;
    try {
      const buf = Buffer.alloc(2048);
      const sizeOut = [1024]; // 单位：WCHAR 字符数
      const okFlag = QueryFullProcessImageNameW(handle, 0, buf, sizeOut);
      if (!okFlag || !sizeOut[0]) return null;
      const full = buf.toString('utf16le', 0, sizeOut[0] * 2);
      return path.win32.basename(full) || null;
    } finally {
      CloseHandle(handle);
    }
  } catch {
    return null;
  }
}

// 剪贴板序列号：任何剪贴板写入（包括与旧内容相同）都会使它 +1。
// 用来判定「模拟 Ctrl+C 是否真的发生了复制」，与文本内容无关。
function clipboardSequence() {
  return GetClipboardSequenceNumber();
}

module.exports = { sendCtrlC, getForegroundProcessName, clipboardSequence };
