'use strict';

const $ = (id) => document.getElementById(id);
const msgEl = $('msg');

function showMsg(text, ok) {
  msgEl.textContent = text;
  msgEl.className = ok ? 'ok' : 'err';
}

function parseBlacklist(text) {
  return String(text || '').split(/[,\n，]/).map((s) => s.trim()).filter(Boolean);
}

async function load() {
  // 图标 data URI（sandbox=false 时 preload 可用 fs）
  try {
    const iconUri = window.huayiSettings.getIconDataUri();
    if (iconUri) {
      const el = document.getElementById('appIcon');
      if (el) el.style.backgroundImage = 'url(' + iconUri + ')';
    }
  } catch {}
  const c = await window.huayiSettings.getConfig();
  $('baseUrl').value = c.baseUrl || '';
  $('model').value = c.model || '';
  $('maxChars').value = c.maxChars || 5000;
  $('hotkey').value = c.hotkey || 'Alt+Z';
  $('hotkeyEnabled').checked = !!c.hotkeyEnabled;
  $('doubleCopyEnabled').checked = !!c.doubleCopyEnabled;
  $('autoPopupEnabled').checked = !!c.autoPopupEnabled;
  $('ocrEnabled').checked = !!c.ocrEnabled;
  $('blacklist').value = (c.blacklist || []).join(', ');
  $('autoStart').checked = !!c.autoStart;
  $('apiKey').placeholder = c.apiKeySet
    ? '已手填（留空保存 = 保持不变）'
    : '留空则自动读取 opencode 的 opencode-go key';
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
  const dl = $('modelList');
  dl.innerHTML = '';
  const ids = [current, ...r.ids.filter((id) => id !== current)].filter(Boolean);
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
    apiKey: $('apiKey').value,
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
