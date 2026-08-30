'use strict';

// 用真实注入事件驱动一次「鼠标拖选」：SetCursorPos 移动 + mouse_event 按下/抬起，
// 验证划译的 drag 触发链路（需要应用配置里 autoPopupEnabled=true）。
// 用法：node scripts/drive-drag.js <x0> <y0> <x1> <y1>   （物理屏幕坐标）

const koffi = require('koffi');
const user32 = koffi.load('user32.dll');

const SetCursorPos = user32.func('int SetCursorPos(int X, int Y)');
const mouse_event = user32.func('void mouse_event(uint32 dwFlags, uint32 dx, uint32 dy, uint32 dwData, uintptr dwExtraInfo)');

const MOUSEEVENTF_LEFTDOWN = 0x02;
const MOUSEEVENTF_LEFTUP = 0x04;

const [x0, y0, x1, y1] = process.argv.slice(2).map(Number);
if ([x0, y0, x1, y1].some((n) => !Number.isFinite(n))) {
  console.error('用法: node scripts/drive-drag.js x0 y0 x1 y1');
  process.exit(1);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  SetCursorPos(x0, y0);
  await sleep(120);
  mouse_event(MOUSEEVENTF_LEFTDOWN, 0, 0, 0, 0);
  await sleep(120);
  const steps = 8;
  for (let i = 1; i <= steps; i++) {
    SetCursorPos(Math.round(x0 + ((x1 - x0) * i) / steps), Math.round(y0 + ((y1 - y0) * i) / steps));
    await sleep(30);
  }
  await sleep(120);
  mouse_event(MOUSEEVENTF_LEFTUP, 0, 0, 0, 0);
  console.log('DRAG DONE', x0, y0, '->', x1, y1);
})();
