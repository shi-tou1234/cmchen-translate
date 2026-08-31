'use strict';

// Tesseract 引擎冒烟测试：验证随包语言数据可加载、worker 可启动、recognize 不报错。
// 不验证识别质量（无字 PNG 返回空串是预期），仅证明跨平台 OCR 基础设施就绪。
// 用法：node scripts/spike-tesseract.js

const path = require('node:path');
const { recognizeText, resetWorker } = require('#lib/tesseractOcr.js');

const testImage = path.join(process.cwd(), 'build', 'icons', 'icon-128.png');
const langPath = path.join(process.cwd(), 'build', 'tessdata');

async function main() {
  console.log('start recognize (may take ~5s first load)...');
  const t0 = Date.now();
  let text = '';
  try {
    text = await recognizeText(testImage, { langPath, timeoutMs: 30000 });
  } catch (err) {
    console.error('RECOGNIZE ERROR:', err && err.message);
    process.exitCode = 1;
    return;
  }
  console.log('recognize OK, elapsed(ms):', Date.now() - t0);
  console.log('returned text length:', text.length, '(no-text image => expect 0, acceptable)');
  console.log('TESSERACT SMOKE OK');
  await resetWorker();
}
main();