'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('huayiSettings', {
  getConfig: () => ipcRenderer.invoke('huayi:get-config'),
  saveConfig: (next) => ipcRenderer.invoke('huayi:save-config', next),
  listModels: () => ipcRenderer.invoke('huayi:list-models')
});
