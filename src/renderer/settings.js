'use strict';

const $ = (id) => document.getElementById(id);
const msgEl = $('msg');

function showMsg(text, ok) {
  msgEl.textContent = text;
  msgEl.className = ok ? 'ok' : 'err';
}

function parseBlacklist(text) {
  return String(text || '')
    .split(/[,\n，]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

async function load() {
  // 通过 preload 读取图标并设置 data URI（sandbox:false 已开启，preload 可用 fs）
  try {
    const iconUri = window.huayiSettings.getIconDataUri();
    const el = document.querySelector('.app-icon');
    if (el && iconUri) el.style.backgroundImage = 'url(' + iconUri + ')';
  } catch {}
  const c = await window.huayiSettings.getConfig();
  $('baseUrl').value = c.baseUrl || '';
  $('maxChars').value = c.maxChars || 5000;
  $('hotkey').value = c.hotkey || 'Alt+Q';
  $('hotkeyEnabled').checked = !!c.hotkeyEnabled;
  $('doubleCopyEnabled').checked = !!c.doubleCopyEnabled;
  $('autoPopupEnabled').checked = !!c.autoPopupEnabled;
  $('ocrEnabled').checked = !!c.ocrEnabled;
  $('blacklist').value = (c.blacklist || []).join(', ');
  $('autoStart').checked = !!c.autoStart;
  $('apiKey').placeholder = c.apiKeySet
    ? '已手填（留空保存 = 保持不变）'
    : '留空则自动读取 opencode 的 opencode-go key';

  const input = $('model');
  input.value = c.model || '';
  refreshModels();
}

async function refreshModels() {
  const input = $('model');
  const current = input.value.trim();
  showMsg('正在获取模型列表…', true);
  const r = await window.huayiSettings.listModels();
  if (!r.ok) {
    showMsg('获取模型列表失败：' + r.error + '（仍可直接输入模型名）', false);
    return;
  }
  // 当前使用的模型排最前，其余去重；输入框保留自由输入能力
  const ids = [current, ...r.ids.filter((id) => id !== current)].filter(Boolean);
  const dl = $('modelList');
  dl.innerHTML = '';
  for (const id of ids) {
    const o = document.createElement('option');
    o.value = id;
    dl.appendChild(o);
  }
  showMsg('模型列表已更新，共 ' + ids.length + ' 个；可直接输入任意模型名', true);
}

async function save() {
  const next = {
    baseUrl: $('baseUrl').value.trim(),
    model: $('model').value.trim(),
    apiKey: $('apiKey').value, // 空 = 不改动；主进程决定语义
    hotkey: $('hotkey').value.trim(),
    hotkeyEnabled: $('hotkeyEnabled').checked,
    doubleCopyEnabled: $('doubleCopyEnabled').checked,
    autoPopupEnabled: $('autoPopupEnabled').checked,
    ocrEnabled: $('ocrEnabled').checked,
    blacklist: parseBlacklist($('blacklist').value),
    autoStart: $('autoStart').checked,
    maxChars: Number($('maxChars').value) || 5000
  };
  const r = await window.huayiSettings.saveConfig(next);
  if (r.ok) showMsg('已保存，立即生效', true);
  else showMsg('保存失败：' + r.error, false);
}

$('save').addEventListener('click', save);
$('refreshModels').addEventListener('click', refreshModels);
load();
