'use strict';

// 截图框选覆盖层：两阶段状态机。
//   draw：拖拽画矩形（原行为），松开进入 edit
//   edit ：8 向手柄调整大小、框内拖动移动、框外按下重新画、Enter/「翻译」确认、Esc/✕ 取消
// 确认后把 DIP 坐标发给主进程裁剪 + OCR。

const selEl = document.getElementById('sel');
const sizeEl = document.getElementById('size');
const hintEl = document.getElementById('hint');
const barEl = document.getElementById('bar');
const btnOk = document.getElementById('btnOk');
const btnRedo = document.getElementById('btnRedo');
const btnCancel = document.getElementById('btnCancel');

const MIN_SIZE = 8; // 与主进程 isValidSelectionRect 的最小阈值一致
const HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

let mode = 'draw'; // 'draw' | 'edit'
let rect = { x: 0, y: 0, width: 0, height: 0 };
let dragKind = null; // 'draw' | 'move' | 'resize'
let activeHandle = 'se';
let anchor = { x: 0, y: 0 }; // draw/move 起点或 resize 的对角锚点
let resizeBase = { x: 0, y: 0, width: 0, height: 0 }; // resize 开始时的原始矩形（固定边锚定用）
let moveOffset = { x: 0, y: 0 };

const handleEls = {};
for (const h of HANDLES) {
  const el = document.createElement('div');
  el.className = 'handle ' + h;
  el.dataset.handle = h;
  document.body.appendChild(el);
  handleEls[h] = el;
}

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

function clampRect(r) {
  const maxX = window.innerWidth - 1;
  const maxY = window.innerHeight - 1;
  const width = Math.min(r.width, window.innerWidth);
  const height = Math.min(r.height, window.innerHeight);
  return {
    x: clamp(r.x, 0, Math.max(0, maxX - width)),
    y: clamp(r.y, 0, Math.max(0, maxY - height)),
    width,
    height
  };
}

function render() {
  selEl.style.left = rect.x + 'px';
  selEl.style.top = rect.y + 'px';
  selEl.style.width = rect.width + 'px';
  selEl.style.height = rect.height + 'px';
  sizeEl.textContent = Math.round(rect.width) + ' × ' + Math.round(rect.height);
  if (mode === 'edit') {
    document.body.classList.add('editing');
    for (const h of HANDLES) {
      const el = handleEls[h];
      el.style.display = 'block';
      const cx = h.includes('w') ? rect.x : h.includes('e') ? rect.x + rect.width : rect.x + rect.width / 2;
      const cy = h.includes('n') ? rect.y : h.includes('s') ? rect.y + rect.height : rect.y + rect.height / 2;
      el.style.left = cx - 6 + 'px';
      el.style.top = cy - 6 + 'px';
    }
    // 工具条贴在框下方，放不下就放框内底部
    const barH = 38;
    let bx = rect.x;
    let by = rect.y + rect.height + 10;
    if (by + barH > window.innerHeight) by = rect.y + rect.height - barH - 10;
    bx = clamp(bx, 4, window.innerWidth - barEl.offsetWidth - 4);
    by = clamp(by, 4, window.innerHeight - barH - 4);
    barEl.style.left = bx + 'px';
    barEl.style.top = by + 'px';
  } else {
    document.body.classList.remove('editing');
    for (const h of HANDLES) handleEls[h].style.display = 'none';
  }
}

function enterEdit(r) {
  rect = clampRect(r);
  mode = 'edit';
  dragKind = null;
  selEl.style.display = 'block';
  sizeEl.style.display = 'block';
  barEl.style.display = 'block';
  hintEl.style.opacity = '0';
  render();
}

function enterDraw(startX, startY) {
  mode = 'draw';
  dragKind = 'draw';
  anchor = { x: startX, y: startY };
  rect = { x: startX, y: startY, width: 0, height: 0 };
  barEl.style.display = 'none';
  selEl.style.display = 'block';
  sizeEl.style.display = 'block';
  render();
}

function cancelAll() {
  mode = 'draw';
  dragKind = null;
  selEl.style.display = 'none';
  sizeEl.style.display = 'none';
  barEl.style.display = 'none';
  window.huayiOverlay.cancel();
}

function confirmSelection() {
  if (mode !== 'edit') return;
  const r = {
    x: Math.round(rect.x),
    y: Math.round(rect.y),
    width: Math.round(rect.width),
    height: Math.round(rect.height)
  };
  window.huayiOverlay.select(r);
}

function handleAt(x, y) {
  for (const h of HANDLES) {
    const el = handleEls[h];
    const hx = parseFloat(el.style.left);
    const hy = parseFloat(el.style.top);
    if (x >= hx - 2 && x <= hx + 14 && y >= hy - 2 && y <= hy + 14) return h;
  }
  return null;
}

function insideRect(x, y) {
  return x >= rect.x && x <= rect.x + rect.width && y >= rect.y && y <= rect.y + rect.height;
}

function applyResize(x, y) {
  // 固定边锚定在按下时的原始矩形，避免拖动中边缘漂移；宽高不低于 MIN_SIZE
  const b = resizeBase;
  let x1 = b.x;
  let y1 = b.y;
  let x2 = b.x + b.width;
  let y2 = b.y + b.height;
  if (activeHandle.includes('w')) x1 = x;
  if (activeHandle.includes('e')) x2 = x;
  if (activeHandle.includes('n')) y1 = y;
  if (activeHandle.includes('s')) y2 = y;
  if (Math.abs(x2 - x1) < MIN_SIZE) {
    const mid = (x1 + x2) / 2;
    x1 = mid - MIN_SIZE / 2;
    x2 = mid + MIN_SIZE / 2;
  }
  if (Math.abs(y2 - y1) < MIN_SIZE) {
    const mid = (y1 + y2) / 2;
    y1 = mid - MIN_SIZE / 2;
    y2 = mid + MIN_SIZE / 2;
  }
  rect = {
    x: Math.min(x1, x2),
    y: Math.min(y1, y2),
    width: Math.abs(x2 - x1),
    height: Math.abs(y2 - y1)
  };
}

function onDown(e) {
  if (e.button !== 0) return;
  const x = e.clientX;
  const y = e.clientY;

  // 画框模式：只处理纯画框，点击工具条/手柄不启动画框
  if (mode === 'draw') {
    if (e.target.closest('#bar') || e.target.closest('.handle')) return;
    e.preventDefault();
    enterDraw(x, y);
    return;
  }

  // 编辑模式：手柄拖动 > 工具条按钮（放行 click） > 框内移动 > 框外重画
  const h = handleAt(x, y);
  if (h) {
    e.preventDefault();
    dragKind = 'resize';
    activeHandle = h;
    resizeBase = { ...rect };
    return;
  }
  if (e.target.closest('#bar')) return; // 工具条点击交给浏览器原生处理（按钮 click）
  if (insideRect(x, y)) {
    e.preventDefault();
    dragKind = 'move';
    moveOffset = { x: x - rect.x, y: y - rect.y };
    return;
  }
  e.preventDefault();
  enterDraw(x, y);
}

function onMove(e) {
  if (!dragKind) return;
  const x = e.clientX;
  const y = e.clientY;
  if (dragKind === 'draw') {
    rect = clampRect({
      x: Math.min(anchor.x, x),
      y: Math.min(anchor.y, y),
      width: Math.abs(x - anchor.x),
      height: Math.abs(y - anchor.y)
    });
    render();
  } else if (dragKind === 'resize') {
    applyResize(x, y);
    rect = clampRect(rect);
    render();
  } else if (dragKind === 'move') {
    rect = clampRect({
      x: x - moveOffset.x,
      y: y - moveOffset.y,
      width: rect.width,
      height: rect.height
    });
    render();
  }
}

function onUp(e) {
  if (e.button !== 0 || !dragKind) return;
  if (dragKind === 'draw') {
    const r = {
      x: Math.min(anchor.x, e.clientX),
      y: Math.min(anchor.y, e.clientY),
      width: Math.abs(e.clientX - anchor.x),
      height: Math.abs(e.clientY - anchor.y)
    };
    if (r.width < MIN_SIZE || r.height < MIN_SIZE) {
      cancelAll(); // 误触：直接取消
      return;
    }
    enterEdit(r);
  }
  dragKind = null; // resize/move 拖完留在 edit 模式
}

document.addEventListener('mousedown', onDown, true);
document.addEventListener('mousemove', onMove, true);
document.addEventListener('mouseup', onUp, true);
document.addEventListener('contextmenu', (e) => { e.preventDefault(); cancelAll(); });
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') cancelAll();
  if (e.key === 'Enter' && mode === 'edit') { e.preventDefault(); confirmSelection(); }
});

btnOk.addEventListener('click', () => confirmSelection());
btnRedo.addEventListener('click', () => {
  barEl.style.display = 'none';
  selEl.style.display = 'none';
  sizeEl.style.display = 'none';
  dragKind = null;
  activeHandle = 'se';
  resizeBase = { ...rect };
  rect = { x: 0, y: 0, width: 0, height: 0 };
  mode = 'draw';
});
btnCancel.addEventListener('click', () => cancelAll());
