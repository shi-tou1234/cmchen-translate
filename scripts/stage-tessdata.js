'use strict';

// 把 @tesseract.js-data 的语言数据汇集到 build/tessdata/（chi_sim + eng，.gz 原样拷贝）。
// build/tessdata 不提交仓库，构建时生成；应用打包/部署时随 build/** 一起带上。
// 用法：node scripts/stage-tessdata.js

const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const outDir = path.join(root, 'build', 'tessdata');
const LANGS = ['eng', 'chi_sim'];
const VERSION_DIR = '4.0.0_best_int';

fs.mkdirSync(outDir, { recursive: true });
for (const lang of LANGS) {
  const pkgDir = path.dirname(require.resolve('@tesseract.js-data/' + lang + '/package.json'));
  const src = path.join(pkgDir, VERSION_DIR, lang + '.traineddata.gz');
  if (!fs.existsSync(src)) throw new Error('缺少语言数据: ' + src);
  fs.copyFileSync(src, path.join(outDir, lang + '.traineddata.gz'));
  console.log(lang + ' -> ' + path.join(outDir, lang + '.traineddata.gz'));
}
console.log('TESSDATA STAGED OK');