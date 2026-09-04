'use strict'
// 主窗口（qwerty-learner 页面）与壳的桥：暴露"词窗开关"能力给注入的按钮
const { contextBridge, ipcRenderer } = require('electron')
contextBridge.exposeInMainWorld('moyuHost', {
  toggleFloat: () => ipcRenderer.invoke('host:toggleFloat'),
  currentFloatVisible: () => ipcRenderer.invoke('host:currentFloatVisible'),
  onFloatVisible: (cb) => ipcRenderer.on('host:float-visible', (e, v) => cb(v)),
})
