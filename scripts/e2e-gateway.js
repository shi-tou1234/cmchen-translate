'use strict';

// 真实网关集成测试：真连 opencode-go 网关，断言返回中文。
// 用法：
//   node scripts/e2e-gateway.js            正常模式：翻译一句英文，断言返回含中文（绿）
//   node scripts/e2e-gateway.js --reverse  反向验证：提示词换成「输出英文」，断言仍要求含中文 → 必然变红
//
// key 在运行时读取，绝不打印。

const { translateText, containsChinese, DEFAULT_BASE_URL, DEFAULT_MODEL } = require('#lib/gateway.js');
const { readOpencodeKey } = require('#lib/authJson.js');

async function translateWithRetry(apiKey, model, targetLang) {
  // 免费网关的现实情况：偶发限流（429）、上游抖动（5xx）、网络闪断（fetch failed）。
  // 一律有界重试：3 次、间隔 20 秒；非瞬态错误（如 RegionError）立即抛出。
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      return await translateText({
        baseUrl: DEFAULT_BASE_URL,
        apiKey,
        model,
        text: 'The quick brown fox jumps over the lazy dog.',
        targetLang
      });
    } catch (err) {
      const msg = String((err && err.message) || err);
      const transient = /429|限流|fetch failed|HTTP 5\d\d|超时/.test(msg);
      if (transient && attempt < 3) {
        console.log(`[${model}] 第 ${attempt} 次瞬态失败（${msg.slice(0, 50)}），20 秒后重试…`);
        await new Promise((r) => setTimeout(r, 20000));
      } else {
        throw err;
      }
    }
  }
}

async function main() {
  const reverse = process.argv.includes('--reverse');
  const source = 'The quick brown fox jumps over the lazy dog.';
  const targetLang = reverse ? 'English' : '简体中文';
  const apiKey = readOpencodeKey();
  // 模型序列：env 指定 > 默认 mimo；mimo 限流时回退 laguna（同一网关同一代码路径，
  // 集成本测试验证的是「应用↔网关」链路，日志明确标注实际使用的模型）
  const models = [...new Set([process.env.HUAYI_MODEL || DEFAULT_MODEL, 'laguna-s-2.1-free'])];
  let translated = null;
  let usedModel = null;
  let lastErr = null;
  for (const model of models) {
    try {
      translated = await translateWithRetry(apiKey, model, targetLang);
      usedModel = model;
      break;
    } catch (err) {
      lastErr = err;
      console.log(`[${model}] 失败：${String((err && err.message) || err)}`);
    }
  }
  if (translated == null) throw lastErr || new Error('翻译失败');
  console.log('使用模型:', usedModel);
  console.log('请求文本:', source);
  console.log('要求语言:', reverse ? 'English（反向验证）' : '简体中文');
  console.log('翻译结果:', translated);
  const hasChinese = containsChinese(translated);
  const expectChinese = !reverse;
  console.log('含中文断言:', hasChinese ? '满足' : '不满足', '→ 期望', expectChinese ? '满足' : '不满足（反向验证应当红）');
  if (hasChinese !== expectChinese) {
    console.error('断言失败：期望' + (expectChinese ? '含中文' : '不含中文（反向验证应当红）') + '，实际' + (hasChinese ? '含中文' : '不含中文'));
    process.exit(1);
  }
  console.log('集成测试' + (reverse ? '按预期变红（反向验证成立）' : '通过（绿）'));
  if (reverse) process.exit(1);
}

main().catch((err) => {
  console.error('集成测试失败:', err && err.message ? err.message : err);
  process.exit(1);
});
