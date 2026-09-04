'use strict'
const { contextBridge, ipcRenderer } = require('electron')
contextBridge.exposeInMainWorld('moyu', {
  getData: () => ipcRenderer.invoke('float:getData'),
  next: (dir) => ipcRenderer.invoke('float:next', { dir }),
  markKnown: () => ipcRenderer.invoke('float:markKnown'),
  markWrong: () => ipcRenderer.invoke('float:markWrong'),
  moveBy: (dx, dy) => ipcRenderer.invoke('float:moveBy', { dx, dy }),
  growBy: (dx, dy) => ipcRenderer.invoke('float:growBy', { dx, dy }),
  hover: (inside) => ipcRenderer.invoke('float:hover', { inside }),
  patchConfig: (key, value) => ipcRenderer.invoke('float:patchConfig', { key, value }),
  expand: (h) => ipcRenderer.invoke('float:expand', { h }),
  onEvent: (cb) => ipcRenderer.on('float-event', (e, name, data) => cb(name, data)),
})
