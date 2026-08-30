'use strict';

// koffi FFI 尖峰测试：验证 keybd_event、进程 ID 获取、进程名查询的真实可用写法。
// 只在终端跑：node scripts/spike-native.js

const koffi = require('koffi');

const user32 = koffi.load('user32.dll');
const kernel32 = koffi.load('kernel32.dll');

// 1) keybd_event：发一个无害的 F15 按键（不模拟 Ctrl+C，避免打断当前终端）
const keybd_event = user32.func('void keybd_event(uint8 bVk, uint8 bScan, uint32 dwFlags, uintptr dwExtraInfo)');
keybd_event(0x7e, 0, 0, 0); // F15 down
keybd_event(0x7e, 0, 2, 0); // F15 up（KEYEVENTF_KEYUP=2）
console.log('1) keybd_event F15: OK（无异常）');

// 2) GetWindowThreadProcessId 的 _Out_ 指针写法
const GetForegroundWindow = user32.func('void *GetForegroundWindow()');
const GetWindowThreadProcessId = user32.func('uint32 GetWindowThreadProcessId(void *hWnd, _Out_ uint32 *lpdwProcessId)');
const hwnd = GetForegroundWindow();
console.log('2) 前台窗口句柄:', hwnd ? '非空' : '空');
let pid = 0;
if (hwnd) {
  const pidOut = [0];
  GetWindowThreadProcessId(hwnd, pidOut);
  pid = pidOut[0];
  console.log('   前台进程 PID:', pid);
}

// 3) 进程名：Node Buffer 直接当 void* 传 + _Inout_ uint32* 长度
const OpenProcess = kernel32.func('void *OpenProcess(uint32 dwDesiredAccess, int bInheritHandle, uint32 dwProcessId)');
const CloseHandle = kernel32.func('int CloseHandle(void *hObject)');
const QueryFullProcessImageNameW = kernel32.func(
  'int QueryFullProcessImageNameW(void *hProcess, uint32 dwFlags, void *lpExeName, _Inout_ uint32 *lpdwSize)'
);
const GetCurrentProcess = kernel32.func('void *GetCurrentProcess()');

function queryName(h) {
  const buf = Buffer.alloc(2048);
  const sizeOut = [1024]; // 单位：字符数
  const okFlag = QueryFullProcessImageNameW(h, 0, buf, sizeOut);
  if (!okFlag) return null;
  const chars = sizeOut[0];
  return buf.toString('utf16le', 0, chars * 2);
}

// 3a) 用伪句柄测自身（node.exe），不依赖窗口
const pseudo = GetCurrentProcess();
const selfName = queryName(pseudo);
console.log('3a) 伪句柄自身进程名:', selfName);

// 3b) 用前台窗口的 PID 查
if (pid) {
  const h = OpenProcess(0x1000, 0, pid); // PROCESS_QUERY_LIMITED_INFORMATION
  if (h) {
    const name = queryName(h);
    CloseHandle(h);
    console.log('3b) 前台窗口进程名:', name);
  } else {
    console.log('3b) OpenProcess 失败（权限不足时属正常）');
  }
}
