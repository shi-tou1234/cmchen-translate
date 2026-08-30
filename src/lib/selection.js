'use strict';

// 选词/触发判定状态机（纯逻辑，不依赖 Electron 与原生钩子，可单测）。
//
// 三种触发：
//   drag        —— 左键按下拖动超过 dragThresholdPx 后松开
//   dblclick    —— 左键双击（两次按下间隔与位移都在阈值内）
//   double-copy —— 600ms 内第二次「按住 Ctrl 按 C」（第一次已经把文本复制进剪贴板）
//
// 带冷却：一次触发后 cooldownMs 内不再触发，防止连环弹窗。

class SelectionDetector {
  constructor(opts) {
    const o = opts || {};
    this.dragThresholdPx = o.dragThresholdPx ?? 8;
    this.doubleClickMs = o.doubleClickMs ?? 400;
    this.doubleClickMaxPx = o.doubleClickMaxPx ?? 4;
    this.doubleCopyWindowMs = o.doubleCopyWindowMs ?? 600;
    this.cooldownMs = o.cooldownMs ?? 800;
    this.now = o.now || Date.now;
    this._resetMouse();
    this._lastTriggerAt = -Infinity;
    this._lastCopyAt = -Infinity;
  }

  _resetMouse() {
    this._downAt = -Infinity;
    this._downX = 0;
    this._downY = 0;
    this._held = false;
  }

  _inCooldown() {
    return this.now() - this._lastTriggerAt < this.cooldownMs;
  }

  _fire(kind) {
    this._lastTriggerAt = this.now();
    this._resetMouse();
    return kind;
  }

  // e: { type: 'down'|'up', x, y, button }，button 1=左键。返回触发类型或 null。
  // _downAt/_downX/_downY 始终记录「上一次左键按下」的时间与位置：
  //   down 时用它判双击，up 时用它算拖选距离。
  mouse(e) {
    if (!e || e.button !== 1) return null;
    const t = this.now();
    if (e.type === 'down') {
      const isDbl =
        this._downAt !== -Infinity &&
        t - this._downAt <= this.doubleClickMs &&
        Math.abs(e.x - this._downX) <= this.doubleClickMaxPx &&
        Math.abs(e.y - this._downY) <= this.doubleClickMaxPx;
      this._downAt = t;
      this._downX = e.x;
      this._downY = e.y;
      this._held = true;
      if (isDbl && !this._inCooldown()) return this._fire('dblclick');
      return null;
    }
    // up
    if (!this._held) return null;
    this._held = false;
    const dist = Math.hypot(e.x - this._downX, e.y - this._downY);
    if (dist > this.dragThresholdPx && !this._inCooldown()) return this._fire('drag');
    return null;
  }

  // e: { key, ctrl }，key 用小写字母。返回 'double-copy' 或 null。
  // 双击基准只靠时间窗衰减；C 键抬起不清基准——真实序列是 C↓ C↑ Ctrl↑ C↓，
  // 中间的抬起若清基准，第二次永远判不上。
  key(e) {
    if (!e || e.key !== 'c' || !e.ctrl) return null;
    const t = this.now();
    const isDouble = t - this._lastCopyAt <= this.doubleCopyWindowMs;
    this._lastCopyAt = isDouble ? -Infinity : t;
    if (isDouble && !this._inCooldown()) return this._fire('double-copy');
    return null;
  }
}

// 黑名单匹配：进程名（任意大小写、可带 .exe）对黑名单条目。
// 规则：去掉 .exe 后小写比较，条目相等或为进程名前缀即命中（'powershell' 命中 'powershell_1' 这类不可信，故只做相等与前缀）。
function matchesBlacklist(processName, blacklist) {
  if (!processName) return false;
  const list = Array.isArray(blacklist) ? blacklist : [];
  const base = String(processName).replace(/\.exe$/i, '').toLowerCase();
  if (!base) return false;
  return list.some((entry) => {
    if (typeof entry !== 'string' || !entry.trim()) return false;
    const e = entry.replace(/\.exe$/i, '').toLowerCase();
    return base === e || base.startsWith(e);
  });
}

// 解析快捷键字符串（如 'Alt+Q'）→ { alt, ctrl, shift, meta, key(小写) }；不合法返回 null。
function parseHotkey(spec) {
  if (typeof spec !== 'string') return null;
  const parts = spec.split('+').map((s) => s.trim()).filter(Boolean);
  if (parts.length < 2) return null;
  const mods = { alt: false, ctrl: false, shift: false, meta: false };
  let key = null;
  for (const p of parts) {
    const l = p.toLowerCase();
    if (l === 'alt') mods.alt = true;
    else if (l === 'ctrl' || l === 'control') mods.ctrl = true;
    else if (l === 'shift') mods.shift = true;
    else if (l === 'meta' || l === 'super' || l === 'cmd' || l === 'cmdorctrl') return null; // 不支持平台相关写法
    else if (p.length === 1 && /[a-z0-9]/i.test(p)) key = l;
    else return null;
  }
  if (!key) return null;
  return { ...mods, key };
}

// 判定一次按键事件是否命中解析后的快捷键。e: { key, ctrl, alt, shift }
function hotkeyMatches(parsed, e) {
  if (!parsed || !e) return false;
  return (
    e.key === parsed.key &&
    !!e.ctrl === !!parsed.ctrl &&
    !!e.alt === !!parsed.alt &&
    !!e.shift === !!parsed.shift
  );
}

// 截图选区：把任意两个对角点规整成 {x, y, width, height}
function normalizeRect(x1, y1, x2, y2) {
  const x = Math.min(x1, x2);
  const y = Math.min(y1, y2);
  return { x, y, width: Math.abs(x2 - x1), height: Math.abs(y2 - y1) };
}

// 选区是否大到值得识别（过滤误触的一个点）
function isValidSelectionRect(rect, minSize) {
  if (!rect) return false;
  const min = minSize || 8;
  return rect.width >= min && rect.height >= min;
}

// DIP 选区 -> 物理像素选区（截图裁剪用）
function scaleRect(rect, scaleFactor) {
  const s = scaleFactor > 0 ? scaleFactor : 1;
  return {
    x: Math.round(rect.x * s),
    y: Math.round(rect.y * s),
    width: Math.round(rect.width * s),
    height: Math.round(rect.height * s)
  };
}

module.exports = { SelectionDetector, matchesBlacklist, parseHotkey, hotkeyMatches, normalizeRect, isValidSelectionRect, scaleRect };
