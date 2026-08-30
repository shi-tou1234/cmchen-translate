'use strict';

const test = require('node:test');
const assert = require('node:assert');
const {
  isPublicHttpUrl,
  containsChinese,
  buildMessages,
  friendlyError,
  translateText,
  dedupeModels,
  freeModelsOnly,
  DEFAULT_BASE_URL,
  DEFAULT_MODEL,
  SYSTEM_PROMPT
} = require('#lib/gateway.js');

// 测试专用假 key：运行时合成，不是任何真实凭据（也不允许是）
const FAKE_KEY = 'test-' + 'k'.repeat(12);

function ok(url) {
  const r = isPublicHttpUrl(url);
  assert.equal(r.ok, true, `期望 ${url} 通过，实际: ${JSON.stringify(r)}`);
}
function bad(url, why) {
  const r = isPublicHttpUrl(url);
  assert.equal(r.ok, false, `期望 ${url} 被拒绝`);
  if (why) assert.ok(r.reason.includes(why), `拒绝理由应包含「${why}」，实际: ${r.reason}`);
}

test('isPublicHttpUrl: 公网 https 通过', () => ok('https://opencode.ai/zen/v1'));
test('isPublicHttpUrl: 公网 http 通过', () => ok('http://api.example.com/v1'));
test('isPublicHttpUrl: 带端口与路径通过', () => ok('https://opencode.ai:443/zen/v1/'));
test('isPublicHttpUrl: 空/垃圾输入拒绝', () => {
  bad('', '为空');
  bad('   ', '为空');
  bad('not a url', '解析');
  bad('opencode.ai/zen', '解析');
});
test('isPublicHttpUrl: 非 http(s) 协议拒绝', () => {
  bad('ftp://opencode.ai', 'http/https');
  bad('file:///etc/passwd', 'http/https');
  bad('javascript:alert(1)', 'http/https');
});
test('isPublicHttpUrl: localhost 拒绝', () => {
  bad('http://localhost:8080/v1', '本地');
  bad('http://localhost.example', '本地');
  bad('http://web.local/v1', '本地');
});
test('isPublicHttpUrl: 环回/通配 IPv4 拒绝', () => {
  bad('http://127.0.0.1/v1', '私有');
  bad('http://0.0.0.0/v1', '私有');
});
test('isPublicHttpUrl: 私有 IPv4 拒绝', () => {
  bad('http://10.1.2.3/v1', '私有');
  bad('http://192.168.1.1/v1', '私有');
  bad('http://172.16.0.1/v1', '私有');
  bad('http://172.31.255.255/v1', '私有');
  bad('http://169.254.1.1/v1', '私有');
  bad('http://100.64.0.1/v1', '私有');
});
test('isPublicHttpUrl: 保留段 IPv4 拒绝', () => {
  bad('http://224.0.0.1/v1', '保留');
  bad('http://250.1.1.1/v1', '保留');
  bad('http://198.18.0.1/v1', '保留');
  // 999.1.1.1 是 WHATWG URL 解析就拒绝的非法地址——只要被拒即可，不规定理由文本
  assert.equal(isPublicHttpUrl('http://999.1.1.1/v1').ok, false);
});
test('isPublicHttpUrl: 172.32 是公网（边界）', () => ok('http://172.32.0.1/v1'));
test('isPublicHttpUrl: IPv6 环回/私有拒绝', () => {
  bad('http://[::1]/v1', '环回');
  bad('http://[::]/v1', '环回');
  bad('http://[fc00::1]/v1', 'IPv6');
  bad('http://[fe80::1]/v1', 'IPv6');
  bad('http://[ff02::1]/v1', '组播');
  bad('http://[::ffff:127.0.0.1]/v1', '私有');
});
test('isPublicHttpUrl: 公网 IPv6 通过', () => ok('http://[2606:4700::1111]/v1'));
test('isPublicHttpUrl: 单标签主机名拒绝', () => bad('http://myhost/v1', '单标签'));

test('containsChinese: 中英混合/纯英文/空', () => {
  assert.ok(containsChinese('敏捷的狐狸'));
  assert.ok(containsChinese('abc 翻译 abc'));
  assert.ok(!containsChinese('quick brown fox'));
  assert.ok(!containsChinese(''));
  assert.ok(!containsChinese(undefined));
});

test('buildMessages: 默认要求简体中文', () => {
  const m = buildMessages('hello', '简体中文');
  assert.equal(m.length, 2);
  assert.ok(m[0].content.includes('简体中文'));
  assert.equal(m[1].content, 'hello');
});
test('buildMessages: English 模式切换系统提示词', () => {
  const m = buildMessages('hello', 'English');
  assert.ok(m[0].content.includes('English'));
  assert.ok(!m[0].content.includes('简体中文'));
});

test('friendlyError: RegionError 转成人话', () => {
  const msg = friendlyError(new Error('HTTP 400：RegionError: not available in your country'));
  assert.ok(msg.includes('更换模型'));
});
test('friendlyError: 超时转成人话', () => {
  assert.ok(friendlyError(new Error('The operation was aborted')).includes('超时'));
});

function fakeRes(ok, body) {
  return {
    ok,
    status: ok ? 200 : 500,
    json: async () => body
  };
}

test('translateText: 成功返回去空白的译文', async () => {
  let captured = null;
  const fetchImpl = async (url, init) => {
    captured = { url, init };
    return fakeRes(true, { choices: [{ message: { content: '  敏捷的棕色狐狸  ' } }] });
  };
  const out = await translateText({ apiKey: FAKE_KEY, text: 'The fox.', fetchImpl });
  assert.equal(out, '敏捷的棕色狐狸');
  assert.ok(captured.url.endsWith('/chat/completions'));
  assert.equal(captured.init.headers.Authorization, 'Bearer ' + FAKE_KEY);
  const body = JSON.parse(captured.init.body);
  assert.equal(body.model, DEFAULT_MODEL);
  assert.equal(body.messages[1].content, 'The fox.');
});

test('translateText: key 只出现在 Authorization 头，不进请求体', async () => {
  let init = null;
  const fetchImpl = async (url, i) => {
    init = i;
    return fakeRes(true, { choices: [{ message: { content: '译文' } }] });
  };
  await translateText({ apiKey: FAKE_KEY, text: 'hi', fetchImpl });
  assert.equal(init.headers.Authorization, 'Bearer ' + FAKE_KEY);
  assert.ok(init.body.indexOf(FAKE_KEY) === -1, '请求体不得包含 key');
});

test('translateText: 缺 key 直接报错', async () => {
  await assert.rejects(() => translateText({ text: 'hi', fetchImpl: async () => fakeRes(true, {}) }), /缺少 API key/);
});

test('translateText: 空文本直接报错', async () => {
  await assert.rejects(() => translateText({ apiKey: FAKE_KEY, text: '   ', fetchImpl: async () => fakeRes(true, {}) }), /没有可翻译/);
});

test('translateText: 内网地址被拒（根本不发请求）', async () => {
  await assert.rejects(
    () =>
      translateText({
        baseUrl: 'http://127.0.0.1:1234',
        apiKey: FAKE_KEY,
        text: 'hi',
        fetchImpl: async () => {
          throw new Error('不该发请求');
        }
      }),
    /被拒绝/
  );
});

test('translateText: HTTP 错误带状态与详情', async () => {
  const fetchImpl = async () => fakeRes(false, { error: { message: 'Model is unavailable.' } });
  await assert.rejects(() => translateText({ apiKey: FAKE_KEY, text: 'hi', fetchImpl }), /HTTP 500.*Model is unavailable/s);
});

test('translateText: 空结果报错', async () => {
  const fetchImpl = async () => fakeRes(true, { choices: [{ message: { content: '' } }] });
  await assert.rejects(() => translateText({ apiKey: FAKE_KEY, text: 'hi', fetchImpl }), /空结果/);
});

test('translateText: 网络异常转友好错误', async () => {
  const fetchImpl = async () => {
    throw new Error('fetch failed');
  };
  await assert.rejects(() => translateText({ apiKey: FAKE_KEY, text: 'hi', fetchImpl }), /fetch failed/);
});

test('translateText: 默认地址是 opencode 网关', () => {
  assert.equal(DEFAULT_BASE_URL, 'https://opencode.ai/zen/v1');
  assert.ok(SYSTEM_PROMPT.includes('简体中文'));
});

test('dedupeModels: 当前使用的模型排最前且保留（即使不在网关列表里）', () => {
  const out = dedupeModels(['a', 'b', 'c'], 'my-custom-model');
  assert.deepEqual(out, ['my-custom-model', 'a', 'b', 'c']);
});

test('dedupeModels: 去重去空、跳过非法项', () => {
  const out = dedupeModels(['a', 'a', '', null, 'b', ' a ', 42, {}], 'b');
  assert.deepEqual(out, ['b', 'a']);
});

test('dedupeModels: 空列表与空当前值安全', () => {
  assert.deepEqual(dedupeModels(null, ''), []);
  assert.deepEqual(dedupeModels(undefined, 'm'), ['m']);
});

test('freeModelsOnly: 只保留 -free 结尾的模型', () => {
  const out = freeModelsOnly(['mimo-v2.5-free', 'gemini-3.7-flash', ' laguna-s-2.1-free ', 'x', 'free']);
  assert.deepEqual(out, ['mimo-v2.5-free', 'laguna-s-2.1-free']);
});

test('freeModelsOnly: 非法输入安全', () => {
  assert.deepEqual(freeModelsOnly(null), []);
  assert.deepEqual(freeModelsOnly('not-a-list'), []);
});
