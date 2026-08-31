'use strict';

// 译文弹窗渲染层：只做展示，翻译在主进程完成。

const originalEl = document.getElementById('original');
const resultEl = document.getElementById('result');
const metaEl = document.getElementById('meta');
const badgeEl = document.getElementById('badge');
const copyBtn = document.getElementById('copyBtn');
const retryBtn = document.getElementById('retryBtn');
const closeBtn = document.getElementById('close');
const toastEl = document.getElementById('toast');

let currentTranslated = '';

let toastTimer = null;

function toast(msg) {
  toastEl.textContent = msg;
  toastEl.style.opacity = '1';
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (toastEl.style.opacity = '0'), 1200);
}

window.huayi.onPending((d) => {
  badgeEl.textContent = d.model || '';
  originalEl.textContent = d.original || '';
  resultEl.className = 'loading';
  resultEl.innerHTML = '<span class="spin"></span>翻译中…';
  metaEl.textContent = d.truncated ? '原文过长已截断' : '';
  copyBtn.hidden = true;
  retryBtn.hidden = true;
  currentTranslated = '';
});

window.huayi.onResult((d) => {
  if (d.ok) {
    resultEl.className = '';
    resultEl.textContent = d.translated;
    currentTranslated = d.translated;
    copyBtn.hidden = false;
    metaEl.textContent = [d.model, d.ms != null ? d.ms + 'ms' : null].filter(Boolean).join(' · ');
  } else {
    resultEl.className = 'err';
    resultEl.textContent = '翻译失败：' + d.error;
    retryBtn.hidden = false;
  }
});

copyBtn.addEventListener('click', () => {
  if (!currentTranslated) return;
  window.huayi.copy(currentTranslated);
  toast('已复制译文');
});
retryBtn.addEventListener('click', () => window.huayi.retry());
closeBtn.addEventListener('click', () => window.huayi.hide());

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') window.huayi.hide();
});
