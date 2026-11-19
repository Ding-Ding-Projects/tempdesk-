'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('TempDeskReaderSchool', {
  read: () => ipcRenderer.invoke('reader-school:read'),
  enable: (pin, name) => ipcRenderer.invoke('reader-school:change', 'enable', pin, name),
  unlock: pin => ipcRenderer.invoke('reader-school:change', 'unlock', pin),
  rename: (pin, name) => ipcRenderer.invoke('reader-school:change', 'rename', pin, name),
  subscribe: callback => {
    if (typeof callback !== 'function') return undefined;
    const listener = (_event, state) => callback(state);
    ipcRenderer.on('reader-school:changed', listener);
    return () => ipcRenderer.removeListener('reader-school:changed', listener);
  },
});
