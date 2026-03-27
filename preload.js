/**
 * BrightGate — preload.js v1.6.0
 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('labdesk', {
  // Data
  loadData:         ()                  => ipcRenderer.invoke('data:load'),
  saveData:         (data)              => ipcRenderer.invoke('data:save', data),
  setMode:          (key)               => ipcRenderer.invoke('data:setMode', key),

  // Auth
  verifyPin:        (pin)               => ipcRenderer.invoke('auth:verifyPin', pin),
  setPin:           (pin)               => ipcRenderer.invoke('auth:setPin', pin),

  // Children
  listChildren:     ()                  => ipcRenderer.invoke('child:list'),
  addChild:         (name, avatar)      => ipcRenderer.invoke('child:add', name, avatar),
  removeChild:      (id)                => ipcRenderer.invoke('child:remove', id),
  setActiveChild:   (id)                => ipcRenderer.invoke('child:setActive', id),
  updateChild:      (id, updates)       => ipcRenderer.invoke('child:update', id, updates),
  onChildSwitched:  (cb)               => ipcRenderer.on('child:switched', (_, id) => cb(id)),

  // Apps
  launchApp:        (p)                 => ipcRenderer.invoke('app:launch', p),
  killApp:          (p)                 => ipcRenderer.invoke('app:kill', p),
  scanApps:         ()                  => ipcRenderer.invoke('apps:scan'),

  // App exit watcher
  startAppWatch:    (exePath)           => ipcRenderer.invoke('appwatch:start', exePath),
  stopAppWatch:     ()                  => ipcRenderer.invoke('appwatch:stop'),
  onAppClosed:      (cb)               => ipcRenderer.on('app:closedExternally', () => cb()),

  // Scan cache
  loadScanCache:    ()                  => ipcRenderer.invoke('scanCache:load'),
  saveScanCache:    (r)                 => ipcRenderer.invoke('scanCache:save', r),

  // Activity log
  logActivity:      (entry)             => ipcRenderer.invoke('activity:log', entry),

  // Usage / time limits
  tickUsage:        (mode, secs)        => ipcRenderer.invoke('usage:tick', mode, secs),
  getUsage:         ()                  => ipcRenderer.invoke('usage:get'),
  setTimeLimit:     (mode, mins)        => ipcRenderer.invoke('timelimit:set', mode, mins),
  onUsageReset:     (cb)               => ipcRenderer.on('usage:reset', () => cb()),
  onLimitReached:   (cb)               => ipcRenderer.on('usage:limitReached', (_, m) => cb(m)),

  // Push notifications
  pushNotify:       (event, data)       => ipcRenderer.invoke('push:notify', event, data),

  // URLs
  openUrl:          (url, lbl, cfgs)    => ipcRenderer.invoke('app:openUrl', url, lbl, cfgs),
  checkUrl:         (url, cfgs)         => ipcRenderer.invoke('url:check', url, cfgs),
  getUrlSettings:   ()                  => ipcRenderer.invoke('urlSettings:get'),
  saveUrlSettings:  (s)                 => ipcRenderer.invoke('urlSettings:save', s),

  // Session tracking
  setSessionActive: (exePath)           => ipcRenderer.invoke('session:setActive', exePath),
  setParentOpen:    (open)              => ipcRenderer.invoke('parent:setOpen', open),

  // Settings
  setBlocking:      (enabled)           => ipcRenderer.invoke('blocking:set', enabled),
  setKiosk:         (enabled)           => ipcRenderer.invoke('settings:setKiosk', enabled),
  setStartup:       (enabled)           => ipcRenderer.invoke('settings:setStartup', enabled),

  // System
  getVersion:       ()                  => ipcRenderer.invoke('app:version'),
  checkUpdate:      ()                  => ipcRenderer.invoke('app:checkUpdate'),
  getLocalIP:       ()                  => ipcRenderer.invoke('system:localIP'),
  emailRemoteLink:  ()                  => ipcRenderer.invoke('system:emailRemoteLink'),
  quit:             ()                  => ipcRenderer.invoke('app:quit'),
  reload:           ()                  => ipcRenderer.invoke('app:reload'),

  // Events from main → renderer
  onUpdate:         (cb)               => ipcRenderer.on('update:available', (_, v) => cb(v)),
  onScheduleChange: (cb)               => ipcRenderer.on('schedule:modeChange', (_, m) => cb(m)),
  onScheduleWarning:(cb)               => ipcRenderer.on('schedule:warning', (_, d) => cb(d)),
  onRemoteMode:     (cb)               => ipcRenderer.on('remote:modeChange', (_, m) => cb(m)),
  onRemoteBlocking: (cb)               => ipcRenderer.on('remote:blockingChange', (_, v) => cb(v)),
  onRemoteLimits:   (cb)               => ipcRenderer.on('remote:timeLimitsChange', (_, v) => cb(v)),
  onEmergencyPin:   (cb)               => ipcRenderer.on('emergency:pinGate', () => cb()),
  checkScheduleNow: ()                  => ipcRenderer.invoke('schedule:checkNow'),
  browseForApp:     ()                  => ipcRenderer.invoke('app:browse'),
  completeOnboarding:(name)             => ipcRenderer.invoke('onboarding:complete', name),
  setWorld:         (worldId)           => ipcRenderer.invoke('world:set', worldId),
  launchWithSteam:  (exePath)             => ipcRenderer.invoke('app:launchWithSteam', exePath),
  startSteamHide:   ()                    => ipcRenderer.invoke('steam:startHideWatcher'),
  stopSteamHide:    ()                    => ipcRenderer.invoke('steam:stopHideWatcher'),

  // Credentials
  saveCreds:        (domain, u, p)       => ipcRenderer.invoke('creds:save', domain, u, p),
  getCreds:         (domain)             => ipcRenderer.invoke('creds:get', domain),
  listCreds:        ()                   => ipcRenderer.invoke('creds:list'),
  deleteCreds:      (domain)             => ipcRenderer.invoke('creds:delete', domain),

  // Cookies
  extractCookies:   (domain)             => ipcRenderer.invoke('cookies:extractFromBrowser', domain),
  injectCookies:    (domain, cookies)    => ipcRenderer.invoke('cookies:inject', domain, cookies),

  isElectron:       true,
  platform:         process.platform,
  version:          '1.7.0'
});