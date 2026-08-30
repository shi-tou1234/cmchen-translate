'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('huayi', {
  onPending: (cb) => ipcRenderer.on('huayi:pending', (_e, data) => cb(data)),
  onResult: (cb) => ipcRenderer.on('huayi:result', (_e, data) => cb(data)),
  hide: () => ipcRenderer.send('huayi:hide'),
  copy: (text) => ipcRenderer.send('huayi:copy', text),
  retry: () => ipcRenderer.send('huayi:retry')
});
