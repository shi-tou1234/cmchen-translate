'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { SelectionDetector, matchesBlacklist, parseHotkey, hotkeyMatches, normalizeRect, isValidSelectionRect, scaleRect } = require('#lib/selection.js');

function makeDetector(now, opts) {
  let t = 0;
  return new SelectionDetector({ ...(opts || {}), now: () => t });
}

test('拖选：位移超过 8px 触发 drag', () => {
  const d = makeDetector();
  d.mouse({ type: 'down', x: 100, y: 100, button: 1 });
  assert.equal(d.mouse({ type: 'up', x: 160, y: 100, button: 1 }), 'drag');
});

test('拖选：位移 8px 以内不触发（普通点击）', () => {
  const d = makeDetector();
  d.mouse({ type: 'down', x: 100, y: 100, button: 1 });
  assert.equal(d.mouse({ type: 'up', x: 105, y: 102, button: 1 }), null);
});

test('双击：两次快速近距离按下触发 dblclick', () => {
  const d = makeDetector();
  d.mouse({ type: 'down', x: 50, y: 50, button: 1 });
  d.mouse({ type: 'up', x: 50, y: 50, button: 1 });
  assert.equal(d.mouse({ type: 'down', x: 51, y: 51, button: 1 }), 'dblclick');
});

test('双击：间隔太久不算', () => {
  let t = 0;
  const d = new SelectionDetector({ now: () => t });
  d.mouse({ type: 'down', x: 50, y: 50, button: 1 });
  d.mouse({ type: 'up', x: 50, y: 50, button: 1 });
  t = 1000;
  assert.equal(d.mouse({ type: 'down', x: 50, y: 50, button: 1 }), null);
});

test('双击：位移太远不算（两次独立点击）', () => {
  const d = makeDetector();
  d.mouse({ type: 'down', x: 50, y: 50, button: 1 });
  d.mouse({ type: 'up', x: 50, y: 50, button: 1 });
  assert.equal(d.mouse({ type: 'down', x: 90, y: 90, button: 1 }), null);
});

test('冷却期内不重复触发', () => {
  let t = 0;
  const d = new SelectionDetector({ now: () => t });
  d.mouse({ type: 'down', x: 0, y: 0, button: 1 });
  assert.equal(d.mouse({ type: 'up', x: 50, y: 0, button: 1 }), 'drag');
  t = 100; // 冷却 800ms 内
  d.mouse({ type: 'down', x: 0, y: 0, button: 1 });
  assert.equal(d.mouse({ type: 'up', x: 50, y: 0, button: 1 }), null);
  t = 2000; // 冷却结束
  d.mouse({ type: 'down', x: 0, y: 0, button: 1 });
  assert.equal(d.mouse({ type: 'up', x: 50, y: 0, button: 1 }), 'drag');
});

test('非左键不触发', () => {
  const d = makeDetector();
  d.mouse({ type: 'down', x: 0, y: 0, button: 2 });
  assert.equal(d.mouse({ type: 'up', x: 50, y: 0, button: 2 }), null);
});

test('双 Ctrl+C：600ms 内两次触发 double-copy', () => {
  let t = 0;
  const d = new SelectionDetector({ now: () => t, doubleCopyWindowMs: 600 });
  assert.equal(d.key({ key: 'c', ctrl: true }), null);
  t = 200;
  assert.equal(d.key({ key: 'c', ctrl: true }), 'double-copy');
});

test('双 Ctrl+C：间隔超过窗口不触发', () => {
  let t = 0;
  const d = new SelectionDetector({ now: () => t, doubleCopyWindowMs: 600 });
  d.key({ key: 'c', ctrl: true });
  t = 700;
  assert.equal(d.key({ key: 'c', ctrl: true }), null);
});

test('双 Ctrl+C：普通打字（无 Ctrl）不触发', () => {
  const d = makeDetector();
  assert.equal(d.key({ key: 'c', ctrl: false }), null);
  assert.equal(d.key({ key: 'x', ctrl: true }), null);
});

test('双 Ctrl+C 触发后进入冷却，第三次连打不触发', () => {
  let t = 0;
  const d = new SelectionDetector({ now: () => t });
  d.key({ key: 'c', ctrl: true });
  t = 100;
  assert.equal(d.key({ key: 'c', ctrl: true }), 'double-copy');
  t = 300;
  assert.equal(d.key({ key: 'c', ctrl: true }), null);
});

test('真实按键序列：Ctrl↓ C↓ C↑ Ctrl↑ Ctrl↓ C↓（600ms 内）→ 触发', () => {
  let t = 0;
  const d = new SelectionDetector({ now: () => t, doubleCopyWindowMs: 600 });
  // 第一次 Ctrl+C（用户手动复制）
  d.key({ key: 'c', ctrl: true }); // C↓
  // C↑ / Ctrl↑ 不调用任何清理（状态机只认 key 事件）
  t = 250;
  // 第二次 Ctrl+C
  assert.equal(d.key({ key: 'c', ctrl: true }), 'double-copy');
});

test('按住 Ctrl 连打多次 C：触发一次后冷却期内不再触发', () => {
  let t = 0;
  const d = new SelectionDetector({ now: () => t });
  assert.equal(d.key({ key: 'c', ctrl: true }), null); // t=0 记录
  t = 100;
  assert.equal(d.key({ key: 'c', ctrl: true }), 'double-copy'); // t=100 触发
  t = 300;
  assert.equal(d.key({ key: 'c', ctrl: true }), null); // 冷却期内
  t = 2000;
  assert.equal(d.key({ key: 'c', ctrl: true }), null); // 冷却已过但无双击，重新记录
  t = 2100;
  assert.equal(d.key({ key: 'c', ctrl: true }), 'double-copy'); // 再次成对
});

test('matchesBlacklist: 精确命中（大小写/.exe 宽容）', () => {
  assert.equal(matchesBlacklist('WindowsTerminal.exe', ['WindowsTerminal']), true);
  assert.equal(matchesBlacklist('windowsterminal', ['WindowsTerminal']), true);
  assert.equal(matchesBlacklist('powershell.EXE', ['powershell']), true);
});

test('matchesBlacklist: 前缀命中', () => {
  assert.equal(matchesBlacklist('powershell_ise.exe', ['powershell']), true);
});

test('matchesBlacklist: 不命中', () => {
  assert.equal(matchesBlacklist('chrome.exe', ['WindowsTerminal', 'powershell', 'cmd', 'conhost']), false);
  assert.equal(matchesBlacklist('notepad++.exe', ['cmd']), false);
});

test('matchesBlacklist: 空名/空名单安全', () => {
  assert.equal(matchesBlacklist('', ['cmd']), false);
  assert.equal(matchesBlacklist('cmd.exe', []), false);
  assert.equal(matchesBlacklist('cmd.exe', null), false);
});

test('parseHotkey: Alt+Q 正常解析', () => {
  assert.deepEqual(parseHotkey('Alt+Q'), { alt: true, ctrl: false, shift: false, meta: false, key: 'q' });
  assert.deepEqual(parseHotkey('Ctrl+Shift+D'), { alt: false, ctrl: true, shift: true, meta: false, key: 'd' });
  assert.equal(parseHotkey('Q'), null);
  assert.equal(parseHotkey('Alt+'), null);
  assert.equal(parseHotkey('F5'), null);
  assert.equal(parseHotkey(null), null);
});

test('hotkeyMatches: 组合与修饰键全匹配才命中', () => {
  const altQ = parseHotkey('Alt+Q');
  assert.equal(hotkeyMatches(altQ, { key: 'q', ctrl: false, alt: true, shift: false }), true);
  assert.equal(hotkeyMatches(altQ, { key: 'q', ctrl: false, alt: false, shift: false }), false);
  assert.equal(hotkeyMatches(altQ, { key: 'w', ctrl: false, alt: true, shift: false }), false);
  assert.equal(hotkeyMatches(altQ, { key: 'q', ctrl: true, alt: true, shift: false }), false);
  assert.equal(hotkeyMatches(null, { key: 'q', alt: true }), false);
});

test('normalizeRect: 反向拖选也规整成正矩形', () => {
  assert.deepEqual(normalizeRect(300, 200, 100, 80), { x: 100, y: 80, width: 200, height: 120 });
  assert.deepEqual(normalizeRect(10, 10, 50, 60), { x: 10, y: 10, width: 40, height: 50 });
});

test('isValidSelectionRect: 过滤误触小选区', () => {
  assert.equal(isValidSelectionRect({ x: 0, y: 0, width: 5, height: 40 }), false);
  assert.equal(isValidSelectionRect({ x: 0, y: 0, width: 40, height: 5 }), false);
  assert.equal(isValidSelectionRect({ x: 0, y: 0, width: 40, height: 40 }), true);
  assert.equal(isValidSelectionRect(null), false);
});

test('scaleRect: DIP 转物理像素（1.5x 缩放屏）', () => {
  assert.deepEqual(scaleRect({ x: 10.6, y: 20.2, width: 30.4, height: 40 }, 1.5), { x: 16, y: 30, width: 46, height: 60 });
  assert.deepEqual(scaleRect({ x: 10, y: 10, width: 10, height: 10 }, 0), { x: 10, y: 10, width: 10, height: 10 });
});
