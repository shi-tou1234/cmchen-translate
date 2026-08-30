'use strict';

// 剪贴板守卫：决定「这次拿到的文本值不值得翻译」。
// 纯逻辑，Electron clipboard 的读写由主进程完成。

const MAX_SAFE_CHARS = 20000;

// before=模拟 Ctrl+C 前的剪贴板文本；after=模拟后的剪贴板文本。
// 返回可翻译文本（去首尾空白）或 null（没拿到新文本）。
function pickCopiedText(before, after) {
  if (typeof after !== 'string') return null;
  const t = after.trim();
  if (!t) return null;
  if (typeof before === 'string' && t === before.trim()) return null;
  return t;
}

// 上次已翻译过的文本不重复翻译；空文本忽略。
function shouldTranslate(text, lastShownText) {
  if (typeof text !== 'string') return false;
  const t = text.trim();
  if (!t) return false;
  if (typeof lastShownText === 'string' && t === lastShownText.trim()) return false;
  return true;
}

// 基于剪贴板序列号的取词判定：序列号变了 = 确实发生了一次新复制。
// 文本与剪贴板旧值相同也有效（用户可能重新选中了同样内容再按快捷键）。
function pickCopiedTextBySequence(before, after, seqChanged) {
  if (!seqChanged) return null;
  if (typeof after !== 'string') return null;
  const t = after.trim();
  if (!t) return null;
  return t;
}

function truncateForTranslate(text, maxChars) {
  const limit = Number.isFinite(maxChars) && maxChars > 0 ? Math.min(maxChars, MAX_SAFE_CHARS) : MAX_SAFE_CHARS;
  if (text.length <= limit) return { text, truncated: false };
  return { text: text.slice(0, limit), truncated: true };
}

// OCR 文本清理：WinRT OCR 会在中文字符之间插入空格（"划 词 翻 译"），去掉；
// 只清空格/制表符（保留换行结构），中英之间的空格保留（忠实原文）。
function cleanupOcrText(text) {
  if (typeof text !== 'string') return '';
  let t = text.replace(/\r\n/g, '\n');
  t = t.replace(/(?<=[\u4e00-\u9fff\u3000-\u303f\uff00-\uffef])[\t ]+(?=[\u4e00-\u9fff\u3000-\u303f\uff00-\uffef])/g, '');
  t = t.replace(/[ \t]+\n/g, '\n');
  t = t.replace(/\n{3,}/g, '\n\n');
  return t.trim();
}

module.exports = { pickCopiedText, shouldTranslate, pickCopiedTextBySequence, truncateForTranslate, cleanupOcrText, MAX_SAFE_CHARS };
