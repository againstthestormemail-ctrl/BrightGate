/**
 * BrightGate — preload.js
 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('labdesk', {
  loadData:        ()                    => ipcRenderer.invoke('data:load'),
  saveData:        (data)                => ipcRenderer.invoke('data:save', data),
  setMode:         (key)                 => ipcRenderer.invoke('data:setMode', key),
  verifyPin:       (pin)                 => ipcRenderer.invoke('auth:verifyPin', pin),
  setPin:          (pin)                 => ipcRenderer.invoke('auth:setPin', pin),
  launchApp:       (p)                   => ipcRenderer.invoke('app:launch', p),
  openUrl:         (url, lbl, configs)   => ipcRenderer.invoke('app:openUrl', url, lbl, configs),
  checkUrl:        (url, configs)        => ipcRenderer.invoke('url:check', url, configs),
  getUrlSettings:  ()                    => ipcRenderer.invoke('urlSettings:get'),
  saveUrlSettings: (s)                   => ipcRenderer.invoke('urlSettings:save', s),
  setBlocking:     (enabled)             => ipcRenderer.invoke('blocking:set', enabled),
  scanApps:        ()                    => ipcRenderer.invoke('apps:scan'),
  getVersion:      ()                    => ipcRenderer.invoke('app:version'),
  checkUpdate:     ()                    => ipcRenderer.invoke('app:checkUpdate'),
  onUpdate:        (cb)                  => ipcRenderer.on('update:available', (_, v) => cb(v)),
  onUrlBlocked:    (cb)                  => ipcRenderer.on('url-blocked', (_, d) => cb(d)),
  setKiosk:        (enabled)             => ipcRenderer.invoke('settings:setKiosk', enabled),
  setStartup:      (enabled)             => ipcRenderer.invoke('settings:setStartup', enabled),
  quit:            ()                    => ipcRenderer.invoke('app:quit'),
  reload:          ()                    => ipcRenderer.invoke('app:reload'),
  isElectron:      true,
  platform:        process.platform,
  version:         '1.3.6'
});
