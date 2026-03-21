/**
 * BrightGate — preload.js
 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('labdesk', {
  loadData:     ()                  => ipcRenderer.invoke('data:load'),
  saveData:     (data)              => ipcRenderer.invoke('data:save', data),
  setMode:      (key)               => ipcRenderer.invoke('data:setMode', key),
  verifyPin:    (pin)               => ipcRenderer.invoke('auth:verifyPin', pin),
  setPin:       (pin)               => ipcRenderer.invoke('auth:setPin', pin),
  launchApp:    (p)                 => ipcRenderer.invoke('app:launch', p),
  openUrl:      (url, lbl, rules)   => ipcRenderer.invoke('app:openUrl', url, lbl, rules),
  checkUrl:     (url, rules)        => ipcRenderer.invoke('url:check', url, rules),
  setBlocking:  (enabled)           => ipcRenderer.invoke('blocking:set', enabled),
  scanApps:     ()                  => ipcRenderer.invoke('apps:scan'),
  getVersion:   ()                  => ipcRenderer.invoke('app:version'),
  checkUpdate:  ()                  => ipcRenderer.invoke('app:checkUpdate'),
  onUpdate:     (cb)                => ipcRenderer.on('update:available', (_, v) => cb(v)),
  setKiosk:     (enabled)           => ipcRenderer.invoke('settings:setKiosk', enabled),
  setStartup:   (enabled)           => ipcRenderer.invoke('settings:setStartup', enabled),
  quit:         ()                  => ipcRenderer.invoke('app:quit'),
  reload:       ()                  => ipcRenderer.invoke('app:reload'),
  isElectron:   true,
  platform:     process.platform,
  version:      '1.2.0'
});
