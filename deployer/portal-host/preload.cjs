'use strict';

const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('portalHost', {
  state: () => ipcRenderer.invoke('portal-host:state'),
  check: () => ipcRenderer.invoke('portal-host:check'),
  choose: kind => ipcRenderer.invoke('portal-host:choose', kind),
  clearOverlay: () => ipcRenderer.invoke('portal-host:clear-overlay'),
  configure: value => ipcRenderer.invoke('portal-host:configure', value),
  start: () => ipcRenderer.invoke('portal-host:start'),
  recheck: () => ipcRenderer.invoke('portal-host:recheck'),
  cancel: () => ipcRenderer.invoke('portal-host:cancel'),
  open: role => ipcRenderer.invoke('portal-host:open', role),
  onState(callback) {
    const listener = (_, state) => callback(state);
    ipcRenderer.on('portal-host:state-changed', listener);
    return () => ipcRenderer.removeListener('portal-host:state-changed', listener);
  },
});
