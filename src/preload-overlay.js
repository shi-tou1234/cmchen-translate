'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('huayiOverlay', {
  select: (rect) => ipcRenderer.send('huayi:ocr-rect', rect),
  cancel: () => ipcRenderer.send('huayi:ocr-cancel')
});
