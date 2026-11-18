const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('buildDesk',{
  language:code=>ipcRenderer.invoke('build:language',code),
  state:()=>ipcRenderer.invoke('build:status'),
  start:action=>ipcRenderer.invoke('build:start',action),
  cancel:()=>ipcRenderer.invoke('build:cancel'),
  open:()=>ipcRenderer.invoke('build:open'),
  listen:callback=>ipcRenderer.on('build:status',(_,value)=>callback(value))
});
