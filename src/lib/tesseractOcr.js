'use strict';

// 跨平台 OCR 引擎（macOS/Linux 使用）：Tesseract WASM，语言数据随应用打包，运行时不联网。
// Windows 仍用系统自带 WinRT OCR（src/../scripts/ocr.ps1），本模块只在非 Windows 平台启用。
// 语言数据由 scripts/stage-tessdata.js 汇集到 build/tessdata/（chi_sim + eng）。

const path = require('node:path');

const LANGS_PATH = null; // 运行时由调用方传入 app 内路径

let workerPromise = null;

// langPath：build/tessdata 目录，内含 chi_sim.traineddata.gz 与 eng.traineddata.gz
function getWorker(langPath) {
  if (!workerPromise) {
    const { createWorker } = require('tesseract.js');
    workerPromise = createWorker('chi_sim+eng', 1 /* LSTM_ONLY */, { langPath });
  }
  return workerPromise;
}

// 识别图片文件中的文字；识别结束即可用。异常向上抛出由调用方转成人话。
async function recognizeText(imagePath, opts) {
  const o = opts || {};
  const langPath = o.langPath || path.join('build', 'tessdata');
  const timeoutMs = o.timeoutMs || 90000;
  const worker = await getWorker(langPath);
  const timer = setTimeout(() => {
    throw new Error('OCR 超时（' + Math.round(timeoutMs / 1000) + ' 秒）');
  }, timeoutMs);
  try {
    const { data } = await worker.recognize(imagePath);
    return (data && typeof data.text === 'string') ? data.text : '';
  } finally {
    clearTimeout(timer);
  }
}

// 测试辅助：完全重置 worker（避免测试间共享状态）
async function resetWorker() {
  if (workerPromise) {
    try {
      const w = await workerPromise;
      await w.terminate();
    } catch {}
    workerPromise = null;
  }
}

module.exports = { recognizeText, resetWorker };