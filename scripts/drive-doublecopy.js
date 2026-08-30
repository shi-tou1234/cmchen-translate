'use strict';

// 用真实注入事件（keybd_event，与物理键盘同路，能被低级键盘钩子看见）
// 驱动一次「双 Ctrl+C」，验证划译的 double-copy 触发链路。
// 前提：前台窗口里已有选中文本（如记事本 Ctrl+A 全选后）。

const koffi = require('koffi');
const user32 = koffi.load('user32.dll');
const keybd_event = user32.func('void keybd_event(uint8 bVk, uint8 bScan, uint32 dwFlags, uintptr dwExtraInfo)');

const VK_CTRL = 0x11;
const VK_C = 0x43;
const KEYEVENTF_KEYUP = 0x2;

function tapCtrlC() {
  keybd_event(VK_CTRL, 0, 0, 0);
  keybd_event(VK_C, 0, 0, 0);
  keybd_event(VK_C, 0, KEYEVENTF_KEYUP, 0);
  keybd_event(VK_CTRL, 0, KEYEVENTF_KEYUP, 0);
}

tapCtrlC();
console.log('第 1 次 Ctrl+C 已注入');
setTimeout(() => {
  tapCtrlC();
  console.log('第 2 次 Ctrl+C 已注入（间隔 250ms，应触发 double-copy）');
}, 250);
