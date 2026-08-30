'use strict';

// 用真实注入事件（keybd_event）驱动一次 Alt+Q，验证全局快捷键触发链路。
// 前提：前台窗口里有选中文本（如记事本 Ctrl+A 后）。

const koffi = require('koffi');
const user32 = koffi.load('user32.dll');
const keybd_event = user32.func('void keybd_event(uint8 bVk, uint8 bScan, uint32 dwFlags, uintptr dwExtraInfo)');

const VK_ALT = 0x12;
const VK_Q = 0x51;
const KEYEVENTF_KEYUP = 0x2;

keybd_event(VK_ALT, 0, 0, 0);
keybd_event(VK_Q, 0, 0, 0);
keybd_event(VK_Q, 0, KEYEVENTF_KEYUP, 0);
keybd_event(VK_ALT, 0, KEYEVENTF_KEYUP, 0);
console.log('Alt+Q 已注入');
