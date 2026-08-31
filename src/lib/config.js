'use strict';

// 配置存取：%APPDATA%\划译\config.json。
// 纯逻辑与文件操作分离，fs 可注入以便测试。

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { readOpencodeKey } = require('#lib/authJson.js');

// 领导拍板：只能使用 opencode 的免费模型（模型 id 以 -free 结尾）
const FREE_MODEL_SUFFIX = '-free';

const DEFAULTS = Object.freeze({
  baseUrl: 'https://opencode.ai/zen/v1',
  model: 'mimo-v2.5-free',
  apiKey: '', // 空 = 运行时从 opencode auth.json 读取
  hotkeyEnabled: true,
  hotkey: 'Alt+Z',
  doubleCopyEnabled: true,
  doubleCopyWindowMs: 600,
  autoPopupEnabled: false,
  ocrEnabled: true,
  blacklist: ['WindowsTerminal', 'powershell', 'cmd', 'conhost'],
  autoStart: false,
  maxChars: 5000
});

function defaultConfigDir() {
  const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
  return path.join(appData, '划译');
}

function defaultConfigPath() {
  return path.join(defaultConfigDir(), 'config.json');
}

// 用默认值补齐缺失字段；blacklist 保证是数组；数字字段夹在合理范围。
function mergeDefaults(saved) {
  const src = saved && typeof saved === 'object' ? saved : {};
  const merged = { ...DEFAULTS, ...src };
  if (!Array.isArray(merged.blacklist)) merged.blacklist = [...DEFAULTS.blacklist];
  merged.blacklist = merged.blacklist.filter((s) => typeof s === 'string' && s.trim()).map((s) => String(s).trim());
  merged.doubleCopyWindowMs = clampNumber(merged.doubleCopyWindowMs, 100, 3000, DEFAULTS.doubleCopyWindowMs);
  merged.maxChars = clampNumber(merged.maxChars, 100, 20000, DEFAULTS.maxChars);
  if (typeof merged.baseUrl !== 'string') merged.baseUrl = DEFAULTS.baseUrl;
  if (typeof merged.model !== 'string' || !merged.model || !merged.model.endsWith(FREE_MODEL_SUFFIX)) {
    // 非免费模型一律回退到默认免费模型
    merged.model = DEFAULTS.model;
  }
  if (typeof merged.hotkey !== 'string' || !merged.hotkey) merged.hotkey = DEFAULTS.hotkey;
  merged.hotkeyEnabled = !!merged.hotkeyEnabled;
  merged.doubleCopyEnabled = !!merged.doubleCopyEnabled;
  merged.autoPopupEnabled = !!merged.autoPopupEnabled;
  merged.autoStart = !!merged.autoStart;
  merged.apiKey = typeof merged.apiKey === 'string' ? merged.apiKey : '';
  return merged;
}

function clampNumber(v, min, max, fallback) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

function loadConfig(file, fsImpl) {
  const f = file || defaultConfigPath();
  const io = fsImpl || fs;
  let saved = null;
  try {
    saved = JSON.parse(io.readFileSync(f, 'utf8'));
  } catch (err) {
    if (err && err.code !== 'ENOENT') {
      throw new Error('配置文件损坏（' + f + '）：' + err.message);
    }
    // 文件不存在 = 首次启动，用默认值
  }
  return mergeDefaults(saved);
}

function saveConfig(config, file, fsImpl) {
  const f = file || defaultConfigPath();
  const io = fsImpl || fs;
  io.mkdirSync(path.dirname(f), { recursive: true });
  const tmp = f + '.tmp';
  io.writeFileSync(tmp, JSON.stringify(config, null, 2) + '\n', 'utf8');
  io.renameSync(tmp, f);
  return f;
}

// key 解析：优先用配置里手填的 key，否则读 opencode auth.json。
function resolveApiKey(config) {
  const inline = config && typeof config.apiKey === 'string' ? config.apiKey.trim() : '';
  if (inline) return inline;
  return readOpencodeKey();
}

module.exports = { DEFAULTS, defaultConfigDir, defaultConfigPath, mergeDefaults, loadConfig, saveConfig, resolveApiKey };
