'use strict';

const { contextBridge, ipcRenderer } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

// 读取应用图标并转成 base64 data URI（绕开 Electron file:// 协议对 <img> / CSS 的 CSP 限制）
function getIconDataUri() {
  try {
    // 构建时已把 icon-64.png 复制到 resources/app/build/icons/
    const iconPath = path.join(path.dirname(__dirname), 'build', 'icons', 'icon-64.png');
    const buf = fs.readFileSync(iconPath);
    return 'data:image/png;base64,' + buf.toString('base64');
  } catch {
    return '';
  }
}

contextBridge.exposeInMainWorld('huayiSettings', {
  getConfig: () => ipcRenderer.invoke('huayi:get-config'),
  saveConfig: (next) => ipcRenderer.invoke('huayi:save-config', next),
  listModels: () => ipcRenderer.invoke('huayi:list-models'),
  getIconDataUri
});
