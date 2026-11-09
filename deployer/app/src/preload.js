// The only bridge between the sandboxed renderer and the main process. Every call is a named
// invoke; there is no generic channel and no Node access in the renderer.
'use strict';

const { contextBridge, ipcRenderer, webUtils } = require('electron');

const INVOKE = [
  'app:info', 'win:minimize', 'win:maximize', 'win:close', 'win:title',
  'settings:get', 'settings:set', 'settings:export', 'settings:import',
  'school:get', 'school:enable', 'school:disable',
  'wording:get', 'wording:apply', 'wording:pick', 'wording:clear', 'sound:get',
  'dep:list', 'dep:get', 'dep:save', 'dep:delete', 'dep:openFolder', 'dep:envFiles', 'tabs:get', 'tabs:set',
  'engine:start', 'engine:cancel', 'engine:trust', 'engine:sshConsole', 'engine:sshKey', 'engine:prereqs', 'engine:health',
  'file:save', 'file:open', 'file:pickFolder', 'file:pickIso', 'file:reveal', 'file:zip', 'docs:list', 'docs:read', 'shell:open', 'clipboard:write', 'clipboard:read',
  'media:writeKit', 'media:kitPayload', 'media:iso', 'disks:list',
  'ws:info', 'ws:save', 'ws:get', 'ws:flush', 'ws:undo', 'ws:redo', 'ws:restore', 'ws:log', 'ws:diff', 'ws:filesAt', 'ws:snapshot', 'ws:setRemote', 'ws:push',
  'ws:branches', 'ws:switchBranch', 'studio:open', 'studio:openPath', 'studio:save', 'studio:recent', 'studio:watch', 'fs:isDir', 'usb:list', 'usb:write',
  'backup:export', 'backup:import',
  'b64:pick', 'b64:stat', 'b64:start', 'b64:pause', 'b64:resume', 'b64:cancel',
  'update:check', 'update:restart'
];
const EVENTS = ['studio:changed', 'engine:event', 'b64:event', 'update:state', 'win:state', 'theme:system'];

const api = { invoke: {}, on: {} };
for (const ch of INVOKE) api.invoke[ch] = (...args) => ipcRenderer.invoke(ch, ...args);
for (const ch of EVENTS) api.on[ch] = (fn) => { const h = (_e, p) => fn(p); ipcRenderer.on(ch, h); return () => ipcRenderer.removeListener(ch, h); };
// Path of a file dropped on the window (for the Base64 toolkit). Electron 32+ has no File.path.
api.pathForFile = (file) => { try { return webUtils.getPathForFile(file); } catch (e) { return ''; } };

contextBridge.exposeInMainWorld('td', api);
