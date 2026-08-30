'use strict';

// 独立探针：uiohook 监听 + koffi 注入，验证注入事件能否被低级钩子看见、事件的字段形态。
// 运行 4 秒自动退出。注意：注入的是 Ctrl+C——不要在没有焦点保护需求的终端里跑。

const { uIOhook, UiohookKey } = require('uiohook-napi');
const koffi = require('koffi');

const user32 = koffi.load('user32.dll');
const keybd_event = user32.func('void keybd_event(uint8 bVk, uint8 bScan, uint32 dwFlags, uintptr dwExtraInfo)');

uIOhook.on('keydown', (e) => console.log('KEYDOWN', JSON.stringify(e)));
uIOhook.on('keyup', (e) => console.log('KEYUP', JSON.stringify(e)));

uIOhook.start();
console.log('探针：钩子已启动，1 秒后注入 Ctrl+C（VK 17/67 是 Windows VK；uiohook 侧 Ctrl=%d C=%d）', UiohookKey.Ctrl, UiohookKey.C);

setTimeout(() => {
  keybd_event(0x11, 0, 0, 0);
  keybd_event(0x43, 0, 0, 0);
  keybd_event(0x43, 0, 2, 0);
  keybd_event(0x11, 0, 2, 0);
  console.log('已注入 keybd_event Ctrl+C');
}, 1000);

setTimeout(() => {
  uIOhook.stop();
  process.exit(0);
}, 4000);
