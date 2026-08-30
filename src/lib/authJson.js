'use strict';

// opencode 凭据文件读取。key 只在运行时读入内存，绝不打印、不写入任何文件。
// 测试可用环境变量 HUAYI_AUTH_JSON 指向临时凭据文件。

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function defaultAuthJsonPath() {
  // %USERPROFILE%\.local\share\opencode\auth.json
  const home = path.resolve(os.homedir());
  return path.resolve(home, '.local', 'share', 'opencode', 'auth.json');
}

function authJsonPath() {
  const override = process.env.HUAYI_AUTH_JSON;
  if (override) {
    const resolved = path.resolve(override);
    if (resolved.includes('..')) {
      throw new Error('HUAYI_AUTH_JSON 指向的路径不合法');
    }
    return resolved;
  }
  return defaultAuthJsonPath();
}

// 返回指定 provider 的 key；读不到、文件坏、字段缺失都给出可行动的错误。
function readOpencodeKey(providerId) {
  const id = providerId || 'opencode-go';
  const file = authJsonPath();
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    throw new Error('读不到 opencode 凭据文件（' + file + '）：' + err.message);
  }
  const entry = parsed && parsed[id];
  const key = entry && entry.key;
  if (typeof key !== 'string' || !key) {
    throw new Error('opencode 凭据文件里没有 ' + id + '.key，请先在 opencode 里登录');
  }
  return key;
}

module.exports = { readOpencodeKey, authJsonPath };
