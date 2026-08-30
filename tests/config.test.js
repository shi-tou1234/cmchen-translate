'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DEFAULTS, mergeDefaults, loadConfig, saveConfig, resolveApiKey, defaultConfigPath } = require('#lib/config.js');

// 测试专用假 key：运行时合成，不是任何真实凭据
const FAKE_KEY = 'cfg-' + 'k'.repeat(12);

function tmpFile(name) {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'huayi-cfg-')), name);
}

test('默认配置：三触发开关与任务书一致', () => {
  assert.equal(DEFAULTS.hotkeyEnabled, true);
  assert.equal(DEFAULTS.doubleCopyEnabled, true);
  assert.equal(DEFAULTS.autoPopupEnabled, false);
  assert.equal(DEFAULTS.hotkey, 'Alt+Q');
  assert.equal(DEFAULTS.model, 'mimo-v2.5-free');
  assert.deepEqual(DEFAULTS.blacklist, ['WindowsTerminal', 'powershell', 'cmd', 'conhost']);
});

test('mergeDefaults: 缺失字段补默认', () => {
  const m = mergeDefaults({});
  assert.equal(m.baseUrl, DEFAULTS.baseUrl);
  assert.equal(m.maxChars, DEFAULTS.maxChars);
  assert.deepEqual(m.blacklist, DEFAULTS.blacklist);
});

test('mergeDefaults: 非法输入安全降级', () => {
  assert.deepEqual(mergeDefaults(null).blacklist, DEFAULTS.blacklist);
  const m = mergeDefaults({ blacklist: 'not-an-array', maxChars: 999999, doubleCopyWindowMs: -5 });
  assert.deepEqual(m.blacklist, DEFAULTS.blacklist);
  assert.equal(m.maxChars, 20000);
  assert.equal(m.doubleCopyWindowMs, 100);
});

test('mergeDefaults: 保留用户自定义', () => {
  const m = mergeDefaults({ model: 'nemotron-3.5-lightning-free' });
  assert.equal(m.model, 'nemotron-3.5-lightning-free');
});

test('mergeDefaults: 非免费模型自动回退到默认免费模型', () => {
  assert.equal(mergeDefaults({ model: 'gemini-3.7-flash' }).model, DEFAULTS.model);
  assert.equal(mergeDefaults({ model: '' }).model, DEFAULTS.model);
  assert.equal(mergeDefaults({ model: 'free' }).model, DEFAULTS.model);
});

test('loadConfig: 文件不存在返回默认值', () => {
  const c = loadConfig(tmpFile('nope.json'));
  assert.equal(c.model, DEFAULTS.model);
  assert.equal(c.autoPopupEnabled, false);
});

test('loadConfig: 保存再读取一致（roundtrip）', () => {
  const f = tmpFile('config.json');
  const saved = mergeDefaults({ model: 'laguna-s-2.1-free', autoPopupEnabled: true });
  saveConfig(saved, f);
  const loaded = loadConfig(f);
  assert.equal(loaded.model, 'laguna-s-2.1-free');
  assert.equal(loaded.autoPopupEnabled, true);
  assert.equal(JSON.parse(fs.readFileSync(f, 'utf8')).model, 'laguna-s-2.1-free');
});

test('loadConfig: 损坏文件明确报错（不静默吞掉）', () => {
  const f = tmpFile('broken.json');
  fs.writeFileSync(f, '{not json', 'utf8');
  assert.throws(() => loadConfig(f), /配置文件损坏/);
});

test('resolveApiKey: 优先用配置里的 key', () => {
  const key = resolveApiKey({ apiKey: '  ' + FAKE_KEY + '  ' });
  assert.equal(key, FAKE_KEY);
});

test('resolveApiKey: 未手填时读 auth.json（临时 fixture）', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'huayi-auth-'));
  const file = path.join(dir, 'auth.json');
  fs.writeFileSync(file, JSON.stringify({ 'opencode-go': { type: 'api', key: 'fixture-' + 'k'.repeat(10) } }), 'utf8');
  process.env.HUAYI_AUTH_JSON = file;
  try {
    const key = resolveApiKey({ apiKey: '' });
    assert.ok(key.startsWith('fixture-'));
  } finally {
    delete process.env.HUAYI_AUTH_JSON;
  }
});

test('resolveApiKey: 两处都没有时给可行动的错误', () => {
  process.env.HUAYI_AUTH_JSON = path.join(os.tmpdir(), 'huayi-definitely-missing-' + Date.now() + '.json');
  try {
    assert.throws(() => resolveApiKey({ apiKey: '' }), /凭据文件/);
  } finally {
    delete process.env.HUAYI_AUTH_JSON;
  }
});

test('defaultConfigPath: 落在 %APPDATA%\\划译 下', () => {
  const p = defaultConfigPath();
  assert.ok(p.endsWith(path.join('划译', 'config.json')));
});
