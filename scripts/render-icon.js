'use strict';

// 用 Electron 把 build/icon.svg 栅格化成多尺寸 PNG，并打包成 Windows ICO。
// 运行：node_modules/electron/dist/electron.exe scripts/render-icon.js
// 产物：build/icons/icon-<size>.png + build/icon.ico

const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const svgPath = path.join(root, 'build', 'icon.svg');
const outDir = path.join(root, 'build', 'icons');
const SIZES = [512, 256, 128, 64, 48, 32, 16];

function icoFromPngs(pngBySize) {
  const sizes = [...pngBySize.keys()].sort((a, b) => b - a); // 大→小
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(sizes.length, 4);
  const entries = [];
  const blobs = [];
  let offset = 6 + 16 * sizes.length;
  for (const size of sizes) {
    const png = pngBySize.get(size);
    const entry = Buffer.alloc(16);
    entry[0] = size >= 256 ? 0 : size;
    entry[1] = size >= 256 ? 0 : size;
    entry[2] = 0;
    entry[3] = 0;
    entry.writeUInt16LE(1, 4);
    entry.writeUInt16LE(32, 6);
    entry.writeUInt32LE(png.length, 8);
    entry.writeUInt32LE(offset, 12);
    entries.push(entry);
    blobs.push(png);
    offset += png.length;
  }
  return Buffer.concat([header, ...entries, ...blobs]);
}

function renderPage(svg, size) {
  return new Promise((resolve, reject) => {
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
      html,body{margin:0;padding:0;width:${size}px;height:${size}px;overflow:hidden;background:transparent;}
      svg{display:block;width:${size}px;height:${size}px;}
    </style></head><body>${svg}</body></html>`;
    const win = new BrowserWindow({
      width: size,
      height: size,
      show: false,
      frame: false,
      transparent: true,
      resizable: false,
      webPreferences: { offscreen: true }
    });
    win.webContents.on('did-finish-load', () => {
      // 给合成留一点时间，避免白屏
      setTimeout(async () => {
        try {
          const image = await win.webContents.capturePage({ x: 0, y: 0, width: size, height: size });
          resolve(image);
        } catch (err) {
          reject(err);
        } finally {
          win.destroy();
        }
      }, 250);
    });
    win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
  });
}

app.on('window-all-closed', () => {
  // 渲染循环会反复创建/销毁窗口：全部关闭时不要退出（Windows 默认会 quit）
});

app.whenReady().then(async () => {
  try {
    fs.mkdirSync(outDir, { recursive: true });
    const svg = fs.readFileSync(svgPath, 'utf8');
    const pngBySize = new Map();
    for (const size of SIZES) {
      const image = await renderPage(svg, size);
      const png = image.toPNG();
      pngBySize.set(size, png);
      fs.writeFileSync(path.join(outDir, `icon-${size}.png`), png);
      console.log(`icon-${size}.png written (${png.length} bytes)`);
    }
    // ICO：256 用 PNG；小尺寸用 32bpp BMP（兼容性最好）
    const pngSmall = new Map();
    for (const size of SIZES) {
      if (size === 512) continue;
      pngSmall.set(size, pngBySize.get(size));
    }
    const ico = icoFromPngs(pngSmall);
    fs.writeFileSync(path.join(root, 'build', 'icon.ico'), ico);
    console.log('icon.ico written (' + ico.length + ' bytes)');
    app.exit(0);
  } catch (err) {
    console.error('RENDER-ICON-FAIL:', err && err.message ? err.message : err);
    app.exit(1);
  }
});
