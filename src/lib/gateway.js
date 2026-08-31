'use strict';

// opencode-go 网关客户端（OpenAI 兼容格式）。
// key 一律由调用方在运行时传入（来自 auth.json），本模块绝不打印、不持久化 key。

const DEFAULT_BASE_URL = 'https://opencode.ai/zen/v1';
const DEFAULT_MODEL = 'mimo-v2.5-free';

const SYSTEM_PROMPT =
  '你是翻译引擎。把用户输入翻译成简体中文：只输出译文本身，不要解释、不要加引号、不要附原文；' +
  '原文本身就是简体中文时原样输出；保留原有的换行与段落格式。';

const SYSTEM_PROMPT_EN =
  'You are a translation engine. Translate the user input into English. ' +
  'Output only the translation, no explanations, no quotes, keep line breaks.';

// 安全校验：只允许 http/https，拒绝 localhost、环回、私有与保留地址。
// 返回 { ok: true } 或 { ok: false, reason }。
function isPublicHttpUrl(value) {
  if (typeof value !== 'string' || !value.trim()) {
    return { ok: false, reason: '地址为空' };
  }
  let u;
  try {
    u = new URL(value);
  } catch {
    return { ok: false, reason: 'URL 无法解析' };
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    return { ok: false, reason: '只允许 http/https 协议' };
  }
  const host = u.hostname.toLowerCase();
  if (!host) return { ok: false, reason: '缺少主机名' };

  // IPv6 字面量在 URL.hostname 里带方括号，先剥掉
  const bare = /^\[.*\]$/.test(host) ? host.slice(1, -1) : host;

  // 单标签主机名（如 myhost）：无法确认是公网地址，拒绝
  const ipv4 = bare.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (
    bare === 'localhost' || bare.endsWith('.localhost') ||
    /\.(local|home\.arpa|example|invalid|test)$/.test(bare)
  ) {
    return { ok: false, reason: '不允许本地/保留主机名：' + host };
  }
  if (ipv4) {
    const octets = ipv4.slice(1).map(Number);
    if (octets.some((o) => o > 255)) return { ok: false, reason: '非法 IPv4 地址' };
    const [a, b, c] = octets;
    const privateRanges =
      a === 0 || a === 10 || a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 0 && c === 0) ||
      (a === 192 && b === 168) ||
      (a === 198 && (b === 18 || b === 19)) ||
      (a === 203 && b === 0 && c === 113) ||
      a >= 224;
    if (privateRanges) return { ok: false, reason: '不允许私有/保留地址：' + host };
    return { ok: true };
  }
  if (bare.includes(':')) {
    // IPv6 字面量（已去方括号）
    if (bare === '::' || bare === '::1') return { ok: false, reason: '不允许环回地址：' + host };
    // IPv4 映射地址（::ffff:a.b.c.d 或 URL 规范化后的 ::ffff:hhhh:hhhh）→ 按内嵌 IPv4 判定
    if (bare.toLowerCase().startsWith('::ffff:')) {
      const tail = bare.slice(7);
      const dotted = tail.match(/^(\d{1,3}(?:\.\d{1,3}){3})$/);
      if (dotted) return isPublicHttpUrl('http://' + dotted[1]);
      const hexPair = tail.match(/^([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i);
      if (hexPair) {
        const g5 = parseInt(hexPair[1], 16);
        const g6 = parseInt(hexPair[2], 16);
        const v4 = [(g5 >> 8) & 255, g5 & 255, (g6 >> 8) & 255, g6 & 255].join('.');
        return isPublicHttpUrl('http://' + v4);
      }
    }
    if (/^f[cd]/.test(bare)) return { ok: false, reason: '不允许私有 IPv6（fc00::/7）：' + host };
    if (bare.startsWith('fe80:')) return { ok: false, reason: '不允许链路本地 IPv6：' + host };
    if (bare.startsWith('ff')) return { ok: false, reason: '不允许组播地址：' + host };
    return { ok: true };
  }
  if (!bare.includes('.')) {
    return { ok: false, reason: '不允许单标签主机名：' + host };
  }
  return { ok: true };
}

function containsChinese(s) {
  return typeof s === 'string' && /[\u4e00-\u9fff]/.test(s);
}

function buildMessages(text, targetLang) {
  const system = targetLang === 'English' ? SYSTEM_PROMPT_EN : SYSTEM_PROMPT;
  return [
    { role: 'system', content: system },
    { role: 'user', content: text }
  ];
}

function friendlyError(err) {
  const msg = err && err.message ? String(err.message) : String(err);
  if (/RegionError/i.test(msg)) return '该模型在你的区域不可用，请在设置中更换模型';
  if (/\b429\b|rate limit/i.test(msg)) return '请求太频繁（免费模型限流），等几秒再试，或在设置中更换模型';
  if (/aborted/i.test(msg)) return '翻译请求超时';
  return msg;
}

// 发起翻译。opts: { baseUrl, apiKey, model, text, targetLang, timeoutMs, fetchImpl }
async function translateText(opts) {
  const {
    baseUrl = DEFAULT_BASE_URL,
    apiKey,
    model = DEFAULT_MODEL,
    text,
    targetLang = '简体中文',
    timeoutMs = 30000,
    fetchImpl = globalThis.fetch
  } = opts || {};
  const doFetch = fetchImpl || globalThis.fetch; // 显式传 undefined 也不失守
  const check = isPublicHttpUrl(baseUrl);
  if (!check.ok) throw new Error('翻译服务地址被拒绝：' + check.reason);
  if (!apiKey) throw new Error('缺少 API key，请先在设置中配置');
  const trimmed = String(text == null ? '' : text).trim();
  if (!trimmed) throw new Error('没有可翻译的文本');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await doFetch(baseUrl.replace(/\/+$/, '') + '/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + apiKey
      },
      body: JSON.stringify({
        model,
        messages: buildMessages(trimmed, targetLang),
        temperature: 0,
        stream: false
      }),
      signal: controller.signal
    });
    if (!res.ok) {
      let detail = '';
      try {
        const j = await res.json();
        if (j && j.error) detail = j.error.message || JSON.stringify(j.error);
      } catch {
        /* 非 JSON 错误体，忽略 */
      }
      const err = new Error('翻译服务返回 HTTP ' + res.status + (detail ? '：' + detail : ''));
      err.status = res.status;
      throw err;
    }
    const data = await res.json();
    const content =
      data && data.choices && data.choices[0] && data.choices[0].message
        ? data.choices[0].message.content
        : undefined;
    if (typeof content !== 'string' || !content.trim()) {
      throw new Error('翻译服务返回了空结果');
    }
    return content.trim();
  } catch (err) {
    throw new Error(friendlyError(err));
  } finally {
    clearTimeout(timer);
  }
}

// 拉取模型列表。opts: { baseUrl, apiKey, timeoutMs, fetchImpl }
async function listModels(opts) {
  const {
    baseUrl = DEFAULT_BASE_URL,
    apiKey,
    timeoutMs = 15000,
    fetchImpl = globalThis.fetch
  } = opts || {};
  const doFetch = fetchImpl || globalThis.fetch;
  const check = isPublicHttpUrl(baseUrl);
  if (!check.ok) throw new Error('翻译服务地址被拒绝：' + check.reason);
  if (!apiKey) throw new Error('缺少 API key');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await doFetch(baseUrl.replace(/\/+$/, '') + '/models', {
      headers: { Authorization: 'Bearer ' + apiKey },
      signal: controller.signal
    });
    if (!res.ok) throw new Error('获取模型列表失败：HTTP ' + res.status);
    const data = await res.json();
    const ids = (data && data.data ? data.data : []).map((m) => m && m.id).filter(Boolean);
    return ids;
  } catch (err) {
    throw new Error(friendlyError(err));
  } finally {
    clearTimeout(timer);
  }
}

// 只保留免费模型（领导拍板：只能用 opencode 的免费模型，免费模型 id 以 -free 结尾）。
// 非免费项直接过滤，不参与任何选择入口；返回 trim 后的干净 id。
function freeModelsOnly(ids) {
  return (Array.isArray(ids) ? ids : [])
    .filter((id) => typeof id === 'string' && /-free$/.test(id.trim()))
    .map((id) => id.trim());
}

// 模型列表整理：当前使用的模型排最前（不在列表里也保留），其余去重、去空。
// 用于托盘快捷切换与设置页下拉，保证「自己选的模型」永远可见可选。
function dedupeModels(ids, current) {
  const out = [];
  const seen = new Set();
  const cur = typeof current === 'string' ? current.trim() : '';
  if (cur) {
    out.push(cur);
    seen.add(cur);
  }
  for (const id of Array.isArray(ids) ? ids : []) {
    if (typeof id !== 'string' || !id.trim()) continue;
    const t = id.trim();
    if (!seen.has(t)) {
      seen.add(t);
      out.push(t);
    }
  }
  return out;
}

module.exports = {
  DEFAULT_BASE_URL,
  DEFAULT_MODEL,
  SYSTEM_PROMPT,
  isPublicHttpUrl,
  containsChinese,
  buildMessages,
  friendlyError,
  translateText,
  listModels,
  freeModelsOnly,
  dedupeModels
};
