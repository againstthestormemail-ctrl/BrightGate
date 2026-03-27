/**
 * BrightGate — main.js
 * Electron main process
 * v1.6.8
 */

const { app, BrowserWindow, ipcMain, globalShortcut, dialog, shell, session } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execSync, exec } = require('child_process');
const { checkAndUpdate } = require('./updater');

function getLocalIP() {
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) return net.address;
    }
  }
  return '127.0.0.1';
}

const CURRENT_VERSION = '1.7.0';

// ─── DATA ─────────────────────────────────────────────────────────────────────
const userDataPath = app.getPath('userData');
const dataFile = path.join(userDataPath, 'brightgate-data.json');

function loadData() {
  try {
    if (fs.existsSync(dataFile)) {
      const raw = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
      return migrateDataIfNeeded(raw);
    }
  } catch(e) { console.error('Load failed:', e); }
  return getDefaultData();
}

function saveData(data) {
  try {
    fs.mkdirSync(userDataPath, { recursive: true });
    fs.writeFileSync(dataFile, JSON.stringify(data, null, 2), 'utf8');
    return true;
  } catch(e) { console.error('Save failed:', e); return false; }
}

function getDefaultChildProfile(name = 'Child', avatar = '🧒') {
  return {
    id: 'child_' + Date.now() + '_' + Math.random().toString(36).slice(2,7),
    name,
    avatar,
    currentMode: 'locked',
    activeWorld: 'space_station',
    modes: {
      locked: { label: 'LOCKED', tagline: '', color: '#ff3d5a', tiles: [], apps: [], urls: [], urlConfigs: [] }
    },
    schedule: Array(7).fill(null).map(() => ({})),
    timeLimits: {},
    usageToday: {},
    usageDate: null
  };
}

function getDefaultData() {
  const defaultChild = getDefaultChildProfile('My Child', '🧒');
  return {
    // Global settings
    pin: null,
    pinSet: false,
    kioskMode: false,
    blockingEnabled: true,
    startWithWindows: false,
    onboardingComplete: false,
    childName: '',
    urlSettings: { blockAds: true, globalBlockedKeys: [] },
    // Multi-child
    children: [defaultChild],
    activeChildId: defaultChild.id,
    // Legacy flat fields (kept for backwards compat — migrated on load)
    activityLog: [],
    appScanCache: null
  };
}

// ── Migration: convert old flat data to multi-child structure ──
function migrateDataIfNeeded(data) {
  if (data.children && data.children.length > 0 && data.activeChildId) return data; // Already migrated
  console.log('[BrightGate] Migrating data to multi-child structure...');
  const child = getDefaultChildProfile('My Child', '🧒');
  // Copy existing child-specific fields into the first child profile
  if (data.modes) child.modes = data.modes;
  if (data.schedule) child.schedule = data.schedule;
  if (data.timeLimits) child.timeLimits = data.timeLimits;
  if (data.usageToday) child.usageToday = data.usageToday;
  if (data.usageDate) child.usageDate = data.usageDate;
  if (data.currentMode) child.currentMode = data.currentMode;
  data.children = [child];
  data.activeChildId = child.id;
  // Keep global fields
  if (!data.activityLog) data.activityLog = [];
  if (!data.appScanCache) data.appScanCache = null;
  return data;
}

// ── Helper: get active child profile ──
function activeChild() {
  if (!appData || !appData.children) return null;
  return appData.children.find(c => c.id === appData.activeChildId) || appData.children[0];
}

// ─── ALWAYS-BLOCKED PROCESSES ─────────────────────────────────────────────────
// These are always killed regardless of mode allowlist
// ── NEVER kill these — Windows system processes, drivers, security tools ──
// Killing any of these can cause a system crash, BSOD, or forced restart.
const SYSTEM_PROTECTED = new Set([
  // Core Windows processes
  'system','system idle process','smss.exe','csrss.exe','wininit.exe',
  'winlogon.exe','lsass.exe','lsaiso.exe','services.exe','svchost.exe',
  'dwm.exe','explorer.exe','taskhostw.exe','sihost.exe','ctfmon.exe',
  'fontdrvhost.exe','spoolsv.exe','searchindexer.exe','wuauclt.exe',
  'trustedinstaller.exe','tiworker.exe','msiexec.exe','dllhost.exe',
  'conhost.exe','rundll32.exe','regsvr32.exe','wermgr.exe','werfault.exe',
  // Security / antivirus (killing these triggers BSOD on some systems)
  'msmpeng.exe','nissrv.exe','securityhealthservice.exe','wscsvc.exe',
  'mpsvc.exe','antimalware service executable',
  // GPU / display drivers (killing crashes display)
  'nvdisplay.container.exe','nvcontainer.exe','nvidia web helper.exe',
  'nvcplui.exe','nvsphelper64.exe','nvtelemetrycontainer.exe',
  'amdow.exe','amdrsserv.exe','amdext.exe','igfxcuiservice.exe',
  'igfxtray.exe','igfxhk.exe','igfxsrvc.exe',
  // Audio (killing causes audio crash)
  'audiodg.exe','audiosrv.exe',
  // Network (killing drops all network connections)
  'lsass.exe','netsh.exe','netsession_win.exe',
  // Input devices
  'hidserv.exe','inputhost.exe','tabbttnex.exe',
  // Windows shell helpers
  'shellexperiencehost.exe','startmenuexperiencehost.exe',
  'searchhost.exe','runtimebroker.exe','applicationframehost.exe',
  'systemsettings.exe','textinputhost.exe','lockapp.exe',
  // Hardware management
  'wmiprvse.exe','wmiapsrv.exe','wbemstiparsers.exe',
  // Other safe-list items
  'unsecapp.exe','sedsvc.exe','sgrmusicherper.exe',
]);

// ── Block these user-space apps (child escape vectors) ──
const ALWAYS_BLOCKED = new Set([
  'chrome.exe', 'msedge.exe', 'firefox.exe', 'opera.exe', 'brave.exe',
  'iexplore.exe', 'safari.exe', 'vivaldi.exe', 'waterfox.exe', 'tor.exe',
  'taskmgr.exe', 'regedit.exe', 'cmd.exe', 'powershell.exe', 'wscript.exe',
  'cscript.exe', 'mshta.exe', 'wmic.exe', 'control.exe', 'mmc.exe'
]);

// ─── PROCESS MONITOR ──────────────────────────────────────────────────────────
let monitorInterval = null;
let appData = loadData();
let isMonitoring = false;

function getAllowedExes() {
  const child = activeChild();
  if (!child || !child.currentMode) return [];
  const mode = child.modes[child.currentMode];
  if (!mode || !mode.apps) return [];
  return mode.apps
    .filter(a => a.execPath || a.exeName)
    .map(a => path.basename(a.execPath || a.exeName || '').toLowerCase());
}

// Track the currently active session exe so monitor doesn't kill it
let activeSessionExe = null;

ipcMain.handle('session:setActive', (e, exePath) => {
  activeSessionExe = exePath ? path.basename(exePath).toLowerCase() : null;
});

function isProcessAllowed(exeName) {
  const name = exeName.toLowerCase().trim();

  // ALWAYS allow — Windows system processes, drivers, security tools.
  // Killing these can cause a BSOD or forced system restart.
  if (SYSTEM_PROTECTED.has(name)) return true;
  // Allow any svchost variant, system service suffixes
  if (name.startsWith('svchost') || name.endsWith('.tmp') ||
      name.startsWith('msdtc') || name.startsWith('sppsvc')) return true;

  // Always allow BrightGate's own processes
  if (name.includes('electron') || name.includes('brightgate') ||
      name === 'node.exe' || name === 'npm.cmd') return true;
  // Always allow the currently active session app
  if (activeSessionExe && name === activeSessionExe) return true;

  // Always block known child-escape vectors
  if (ALWAYS_BLOCKED.has(name)) return false;

  // If blocking is disabled, allow everything else
  if (!appData.blockingEnabled) return true;

  // If mode is locked, block non-system user apps
  const child = activeChild();
  if (!child || child.currentMode === 'locked') return false;

  // Check against current mode's allowed apps
  const allowed = getAllowedExes();
  return allowed.includes(name);
}

function killProcess(pid, name) {
  try {
    execSync(`taskkill /PID ${pid} /F`, { stdio: 'ignore', timeout: 3000 });
    console.log(`[BrightGate] Killed blocked process: ${name} (PID ${pid})`);
  } catch(e) {
    // Process may have already closed — that's fine
  }
}

// ── Process list helpers — tasklist primary (native binary, ~80ms), CIM fallback ──
function getProcessListTasklist() {
  // tasklist is a native Windows binary — 10x faster than PowerShell CIM (~80ms vs ~800ms)
  const out = execSync(
    'tasklist /FO CSV /NH',
    { encoding: 'utf8', timeout: 8000, stdio: ['pipe','pipe','ignore'] }
  ).trim();
  return out.split('\n')
    .map(l => l.trim().replace(/"/g, '').split(','))
    .filter(p => p.length >= 2)
    .map(p => ({ Name: p[0], ProcessId: parseInt(p[1]) }))
    .filter(p => p.Name && !isNaN(p.ProcessId));
}

function getProcessListCIM() {
  // CIM fallback — more accurate but slow (~800-1200ms per call)
  const ps = `Get-CimInstance Win32_Process | Select-Object Name,ProcessId | ConvertTo-Json -Compress`;
  const out = execSync(
    `powershell -NoProfile -NonInteractive -Command "${ps}"`,
    { encoding: 'utf8', timeout: 8000, stdio: ['pipe','pipe','ignore'] }
  ).trim();
  const arr = JSON.parse(out);
  return Array.isArray(arr) ? arr : [arr];
}

function getProcessList() {
  try {
    return getProcessListTasklist();
  } catch(e) {
    console.warn('[Monitor] tasklist failed, falling back to CIM:', e.message);
    try {
      return getProcessListCIM();
    } catch(e2) {
      console.error('[Monitor] Both process list methods failed:', e2.message);
      return [];
    }
  }
}

function runMonitorCycle() {
  if (!isMonitoring) return;
  try {
    const processes = getProcessList();
    for (const proc of processes) {
      const name = (proc.Name || '').toLowerCase().trim();
      const pid = proc.ProcessId;
      if (!name || !pid || isNaN(pid)) continue;
      if (!isProcessAllowed(name)) {
        killProcess(pid, name);
      }
    }
  } catch(e) {
    // Monitor cycle failure is non-fatal — next cycle will retry
    console.warn('[Monitor] Cycle error:', e.message);
  }
}

function startMonitor() {
  if (monitorInterval) return;
  isMonitoring = true;
  // Delay first cycle by 10 seconds to avoid startup performance hit
  setTimeout(() => {
    if (!isMonitoring) return;
    runMonitorCycle();
    monitorInterval = setInterval(runMonitorCycle, 5000);
  }, 10000);
  console.log('[BrightGate] Process monitor started (first cycle in 10s, then every 5s)');
}

function stopMonitor() {
  isMonitoring = false;
  if (monitorInterval) { clearInterval(monitorInterval); monitorInterval = null; }
  console.log('[BrightGate] Process monitor stopped');
}

// ─── URL RULE ENGINE ──────────────────────────────────────────────────────────
/**
 * URL config object passed from renderer:
 * {
 *   domain:       "khanacademy.org"          — approved domain
 *   allowedPaths: ["/math", "/science"]      — optional: only these subpaths
 *   blockedKeys:  ["games", "play", "forum"] — block any URL containing these
 *   blockExternal: true                      — block links leaving the domain
 * }
 *
 * Global settings in appData.urlSettings:
 * {
 *   globalBlockedKeys: ["games","play","forum","chat","shop","login","signup"]
 *   blockAds: true   — block known ad/tracker domains
 * }
 */

const AD_TRACKER_DOMAINS = [
  'doubleclick.net','googlesyndication.com','googleadservices.com',
  'adnxs.com','adsrvr.org','moatads.com','scorecardresearch.com',
  'amazon-adsystem.com','taboola.com','outbrain.com','pubmatic.com',
  'rubiconproject.com','openx.net','casalemedia.com','rlcdn.com',
  'crwdcntrl.net','bluekai.com','exelator.com','demdex.net'
];

function isAdDomain(hostname) {
  return AD_TRACKER_DOMAINS.some(d => hostname === d || hostname.endsWith('.' + d));
}

function getGlobalBlockedKeys() {
  // Blocked keywords are now per-site per-mode, not global
  return [];
}

/**
 * Main URL check — returns { allowed: bool, reason: string }
 * urlConfig: array of site config objects OR legacy array of rule strings
 */
function checkUrl(urlString, urlConfigs) {
  // Always allow internal pages
  if (!urlString || urlString === 'about:blank' || urlString.startsWith('file://')) {
    return { allowed: true, reason: 'internal' };
  }

  let u;
  try {
    u = new URL(urlString.startsWith('http') ? urlString : 'https://' + urlString);
  } catch(e) {
    return { allowed: false, reason: 'invalid_url' };
  }

  const hostname = u.hostname.replace(/^www\./, '');
  const pathLower = (u.pathname + u.search).toLowerCase();

  // Block known ad/tracker domains (only if enabled)
  if (appData && appData.urlSettings && appData.urlSettings.blockAds !== false) {
    if (isAdDomain(hostname)) {
      return { allowed: false, reason: 'ad_tracker' };
    }
  }

  // If no configs provided, allow everything (open mode)
  if (!urlConfigs || urlConfigs.length === 0) {
    return { allowed: true, reason: 'no_rules_open' };
  }

  // Handle legacy string rules
  if (typeof urlConfigs[0] === 'string') {
    const fullPath = hostname + u.pathname;
    for (const rule of urlConfigs) {
      if (rule.startsWith('!')) continue;
      const clean = rule.replace(/^www\./, '').replace(/\/\*$/, '');
      const ruleDomain = clean.split('/')[0];
      if (hostname === ruleDomain || hostname.endsWith('.' + ruleDomain)) {
        if (clean.includes('/') && !fullPath.startsWith(clean)) continue;
        return { allowed: true, reason: 'legacy_rule' };
      }
    }
    // Legacy: if no rule matched but configs exist, check if blockExternal applies
    return { allowed: false, reason: 'not_in_rules' };
  }

  // New config object mode — find matching domain config
  for (const cfg of urlConfigs) {
    if (!cfg || !cfg.domain) continue;
    const cfgDomain = cfg.domain.replace(/^www\./, '').replace(/\/\*$/, '').split('/')[0];

    // Check domain match (including subdomains like cdn.nationalgeographic.com)
    if (hostname !== cfgDomain && !hostname.endsWith('.' + cfgDomain)) continue;

    // Domain matched — apply per-site rules

    // Check per-site blocked keywords
    if (cfg.blockedKeys && cfg.blockedKeys.length > 0) {
      for (const key of cfg.blockedKeys) {
        if (key && pathLower.includes(key.toLowerCase())) {
          return { allowed: false, reason: 'site_keyword', keyword: key };
        }
      }
    }

    // Check allowed subpaths (only if specified)
    if (cfg.allowedPaths && cfg.allowedPaths.length > 0) {
      const pathOk = cfg.allowedPaths.some(p => {
        const clean = p.startsWith('/') ? p : '/' + p;
        return u.pathname === '/' || u.pathname.startsWith(clean);
      });
      if (!pathOk) return { allowed: false, reason: 'path_not_allowed' };
    }

    return { allowed: true, reason: 'approved_site' };
  }

  // No domain config matched this hostname
  // Only block if blockExternal is set on at least one config
  const anyBlockExternal = urlConfigs.some(c => c && c.blockExternal);
  if (anyBlockExternal) {
    return { allowed: false, reason: 'external_blocked' };
  }

  // No restriction — allow it
  return { allowed: true, reason: 'unrestricted' };
}

// Legacy wrapper — keep old signature working
function isUrlAllowed(urlString, rules) {
  return checkUrl(urlString, rules).allowed;
}

// ─── WEBVIEW WINDOW ───────────────────────────────────────────────────────────
let webviewWindows = {};

function openLockedBrowser(tileLabel, startUrl, urlConfigs) {
  const check = checkUrl(startUrl, urlConfigs);
  if (!check.allowed) {
    if (mainWindow) {
      mainWindow.webContents.send('browser:blocked', { url: startUrl, label: tileLabel, reason: check.reason });
    }
    return;
  }

  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    fullscreen: true,         // Always fullscreen for the browser
    backgroundColor: '#04080f',
    title: tileLabel + ' — BrightGate',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,  // Restored — webview tag works with contextIsolation:true in Electron 28+
      sandbox: false,
      webviewTag: true,        // Required for <webview> tag
      devTools: false,
      webSecurity: false,      // Allow cross-origin in webview (sites need this to load properly)
      allowRunningInsecureContent: true
    }
  });

  win.setMenuBarVisibility(false);
  win.removeMenu();

  // Only block navigation of the SHELL window itself (file:// to file://)
  // The webview handles its own navigation — URL filtering happens client-side in browser.html
  win.webContents.on('will-navigate', (event, url) => {
    // Allow file:// (our shell) — block anything else at the shell level
    if (!url.startsWith('file://')) {
      event.preventDefault();
    }
  });

  // Prevent shell from opening new windows
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

  const fullUrl = startUrl.startsWith('http') ? startUrl : 'https://' + startUrl;

  win.loadFile(path.join(__dirname, 'src', 'browser.html'), {
    query: { url: fullUrl, title: tileLabel, configs: JSON.stringify(urlConfigs) }
  });

  const id = Date.now();
  webviewWindows[id] = win;
  win.on('closed', () => { delete webviewWindows[id]; if(mainWindow&&!mainWindow.isDestroyed())mainWindow.focus(); });
  win.on('minimize', () => win.restore());
}

// ─── MAIN WINDOW ──────────────────────────────────────────────────────────────
let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280, height: 800,
    fullscreen: appData.kioskMode,
    kiosk: appData.kioskMode,
    frame: !appData.kioskMode,
    alwaysOnTop: appData.kioskMode,
    resizable: true,
    backgroundColor: '#04080f',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
      webviewTag: true,
      devTools: !appData.kioskMode
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'src', 'launcher.html'));
  mainWindow.removeMenu();

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    // Always block escape shortcuts — even outside kiosk mode
    registerAlwaysBlockedShortcuts();
    registerEmergencyShortcut();
    if (appData.kioskMode) registerKioskShortcuts();
    if (appData.blockingEnabled) startMonitor();

    // Check for updates in background
    setTimeout(() => {
      checkAndUpdate(__dirname, (newVersion) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('update:available', newVersion);
        }
      });
    }, 3000);
  });

  // Refocus — only when parent panel is NOT open (prevents closing overlays)
  mainWindow.on('blur', () => {
    if (parentPanelOpen) return; // Parent is using controls — don't steal focus
    setTimeout(() => {
      if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.webContents.isDevToolsFocused()) {
        mainWindow.focus();
      }
    }, 150);
  });

  mainWindow.on('minimize', () => mainWindow.restore());

  mainWindow.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('file://')) e.preventDefault();
  });
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.on('closed', () => { mainWindow = null; stopMonitor(); });
}

function registerKioskShortcuts() {
  ['Alt+F4','Super+D','Super+Tab','Super+L','Alt+Tab','CommandOrControl+Escape','Super']
    .forEach(k => { try { globalShortcut.register(k, () => {}); } catch(e) {} });
}

// Always block these regardless of kiosk mode — prevents child escaping
function registerAlwaysBlockedShortcuts() {
  ['Alt+Tab','Super+D','Super+Tab','Super','CommandOrControl+Escape']
    .forEach(k => { try { globalShortcut.register(k, () => {}); } catch(e) {} });
}

// Emergency parent override — Ctrl+Shift+P summons PIN gate from anywhere
function registerEmergencyShortcut() {
  try {
    globalShortcut.register('CommandOrControl+Shift+P', () => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.focus();
        mainWindow.webContents.send('emergency:pinGate');
      }
    });
    console.log('[BrightGate] Emergency shortcut registered: Ctrl+Shift+P');
  } catch(e) {
    console.warn('[BrightGate] Could not register emergency shortcut:', e.message);
  }
}

// ─── SCHEDULE ENFORCEMENT ────────────────────────────────────────────────────
function checkSchedule() {
  const child = activeChild();
  if (!child || !child.schedule || !child.modes) return;
  const now = new Date();
  const dayIdx = (now.getDay() + 6) % 7;
  const hour = now.getHours();
  const minute = now.getMinutes();
  const daySchedule = child.schedule[dayIdx];
  if (!daySchedule) return;

  const scheduledMode = daySchedule[hour];
  if (scheduledMode && scheduledMode !== child.currentMode && child.modes[scheduledMode]) {
    child.currentMode = scheduledMode;
    saveData(appData);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('schedule:modeChange', scheduledMode);
    }
    if (restServer?._push) restServer._push('scheduledModeChange', {
      mode: scheduledMode,
      label: child.modes[scheduledMode]?.label,
      child: { name: child.name, avatar: child.avatar }
    });
  }

  if (minute === 55) {
    const nextHour = (hour + 1) % 24;
    const upcomingMode = daySchedule[nextHour];
    if (upcomingMode && upcomingMode !== child.currentMode && child.modes[upcomingMode]) {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('schedule:warning', {
          mode: upcomingMode,
          label: child.modes[upcomingMode].label,
          minutesLeft: 5
        });
      }
    }
  }
}

// ─── LIFECYCLE ────────────────────────────────────────────────────────────────
app.whenReady().then(() => {
  createWindow();
  startRestApi();
  setInterval(checkSchedule, 60000);
  setInterval(checkUsageReset, 60000); // Check midnight reset every minute
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('window-all-closed', () => { stopMonitor(); globalShortcut.unregisterAll(); if (process.platform !== 'darwin') app.quit(); });
app.on('will-quit', () => {
  stopMonitor();
  globalShortcut.unregisterAll();
  if (restServer) { try { restServer.close(); } catch(e) {} }
});

// ─── LOCAL REST API ───────────────────────────────────────────────────────────
// Listens on localhost:7743 for PIN-authenticated remote control commands.
// This is the foundation for the phone app remote control feature.
const http = require('http');

let restServer = null;

function startRestApi() {
  if (restServer) return;
  // SSE clients for push notifications
  const sseClients = new Set();

  function pushNotification(event, data) {
    const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const client of sseClients) {
      try { client.write(msg); } catch(e) { sseClients.delete(client); }
    }
  }

  restServer = http.createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-BrightGate-PIN');

    if (req.method === 'OPTIONS') { res.writeHead(200); res.end(); return; }

    // Serve the phone web app (no auth needed for the HTML shell)
    if (req.method === 'GET' && (req.url === '/' || req.url === '/remote')) {
      const appHtml = path.join(__dirname, 'src', 'remote.html');
      try {
        const html = fs.readFileSync(appHtml, 'utf8');
        res.setHeader('Content-Type', 'text/html');
        res.writeHead(200);
        res.end(html);
        return;
      } catch(e) {
        res.setHeader('Content-Type', 'text/plain');
        res.writeHead(404);
        res.end('remote.html not found');
        return;
      }
    }

    // All API endpoints require PIN auth
    res.setHeader('Content-Type', 'application/json');
    const pin = req.headers['x-brightgate-pin'];
    const clientIP = req.socket.remoteAddress || 'unknown';

    // Rate limit: track failed PIN attempts per IP
    if (!restServer._failedAttempts) restServer._failedAttempts = {};
    if (!restServer._lockoutUntil)   restServer._lockoutUntil   = {};

    const now = Date.now();
    const lockedUntil = restServer._lockoutUntil[clientIP] || 0;
    if (lockedUntil > now) {
      const secsLeft = Math.ceil((lockedUntil - now) / 1000);
      res.writeHead(429);
      res.end(JSON.stringify({ error: `Too many attempts — locked for ${secsLeft}s` }));
      return;
    }

    if (!pin || pin !== appData.pin) {
      // Track failed attempt
      restServer._failedAttempts[clientIP] = (restServer._failedAttempts[clientIP] || 0) + 1;
      if (restServer._failedAttempts[clientIP] >= 5) {
        restServer._lockoutUntil[clientIP] = now + 10 * 60 * 1000; // 10 min lockout
        restServer._failedAttempts[clientIP] = 0;
        console.warn(`[REST] IP ${clientIP} locked out for 10 minutes after 5 failed PIN attempts`);
        // Push notification to parent
        if (restServer._push) restServer._push('remotePinLockout', { ip: clientIP, lockedUntil: restServer._lockoutUntil[clientIP] });
      }
      res.writeHead(401);
      res.end(JSON.stringify({ error: 'Invalid PIN', attemptsRemaining: Math.max(0, 5 - (restServer._failedAttempts[clientIP] || 0)) }));
      return;
    }

    // Successful auth — reset failed attempts for this IP
    restServer._failedAttempts[clientIP] = 0;

    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const parsed = body ? JSON.parse(body) : {};
        handleRestRequest(req.method, req.url, parsed, res);
      } catch(e) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: 'Invalid JSON' }));
      }
    });
  });

  // Attach helpers after server is created
  restServer._sseClients = sseClients;
  restServer._push = pushNotification;

  restServer.listen(7743, '0.0.0.0', () => {
    const ip = getLocalIP();
    console.log(`[BrightGate] REST API listening on ${ip}:7743 (LAN accessible)`);
  });

  restServer.on('error', (e) => {
    console.error('[BrightGate] REST API error:', e.message);
    // If port is in use, try alternate port
    if (e.code === 'EADDRINUSE') {
      console.warn('[BrightGate] Port 7743 in use — retrying on 7744');
      restServer.listen(7744, '0.0.0.0');
    }
  });
}

function handleRestRequest(method, url, body, res) {
  const send = (code, data) => { res.writeHead(code); res.end(JSON.stringify(data)); };

  // GET /status — current state
  if (method === 'GET' && url === '/status') {
    const child = activeChild();
    const modes = child ? child.modes || {} : {};
    send(200, {
      activeChild: child ? { id: child.id, name: child.name, avatar: child.avatar } : null,
      children: (appData.children || []).map(c => ({ id: c.id, name: c.name, avatar: c.avatar })),
      currentMode: child ? child.currentMode : 'locked',
      modes: Object.keys(modes).map(k => ({
        key: k,
        label: modes[k].label,
        color: modes[k].color,
        icon: modes[k].icon || '🎯',
        tileCount: (modes[k].tiles || []).length
      })),
      blocking: appData.blockingEnabled,
      kiosk: appData.kioskMode,
      timeLimits: child ? child.timeLimits || {} : {},
      usageToday: child ? child.usageToday || {} : {},
      version: CURRENT_VERSION
    });
    return;
  }

  // GET /activity — recent activity log
  if (method === 'GET' && url === '/activity') {
    const child = activeChild();
    const log = (child?.activityLog || appData.activityLog || []).slice(0, 50);
    send(200, { log, child: child ? { name: child.name, avatar: child.avatar } : null });
    return;
  }

  // POST /mode — switch mode
  if (method === 'POST' && url === '/mode') {
    const { mode, childId } = body;
    // Optionally switch active child first
    if (childId) {
      const c = (appData.children||[]).find(x=>x.id===childId);
      if (c) appData.activeChildId = childId;
    }
    const child = activeChild();
    if (!mode || !child || !child.modes[mode]) { send(404, { error: 'Mode not found' }); return; }
    child.currentMode = mode;
    saveData(appData);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('remote:modeChange', mode);
    }
    if (restServer?._push) restServer._push('modeChanged', { mode, label: child?.modes[mode]?.label });
    send(200, { ok: true, mode });
    return;
  }

  // POST /lock — switch to locked mode
  if (method === 'POST' && url === '/lock') {
    const child = activeChild();
    if (child) child.currentMode = 'locked';
    saveData(appData);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('remote:modeChange', 'locked');
    }
    send(200, { ok: true, mode: 'locked' });
    return;
  }

  // POST /blocking — toggle process blocking
  if (method === 'POST' && url === '/blocking') {
    const { enabled } = body;
    appData.blockingEnabled = !!enabled;
    saveData(appData);
    if (appData.blockingEnabled) startMonitor(); else stopMonitor();
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('remote:blockingChange', appData.blockingEnabled);
    }
    send(200, { ok: true, blocking: appData.blockingEnabled });
    return;
  }

  // POST /timelimit — set daily time limit for a mode
  if (method === 'POST' && url === '/timelimit') {
    const { mode, minutes, childId } = body;
    if (!mode || typeof minutes !== 'number') { send(400, { error: 'mode and minutes required' }); return; }
    // Route to specified child or active child
    const targetChild = childId
      ? (appData.children || []).find(c => c.id === childId)
      : activeChild();
    if (!targetChild) { send(404, { error: 'Child not found' }); return; }
    if (!targetChild.timeLimits) targetChild.timeLimits = {};
    if (minutes <= 0) delete targetChild.timeLimits[mode];
    else targetChild.timeLimits[mode] = Math.round(minutes);
    saveData(appData);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('remote:timeLimitsChange', targetChild.timeLimits);
    }
    send(200, { ok: true, timeLimits: targetChild.timeLimits });
    return;
  }

  if (method === 'GET' && url === '/ping') { send(200, { ok: true, version: CURRENT_VERSION }); return; }

  // GET /events — SSE stream for push notifications
  if (method === 'GET' && url.startsWith('/events')) {
    // SSE auth via query param (EventSource API can't send custom headers)
    const urlObj = new URL('http://localhost' + url);
    const tokenPin = urlObj.searchParams.get('pin');
    if (!tokenPin || tokenPin !== appData.pin) {
      res.writeHead(401, { 'Content-Type': 'text/plain' });
      res.end('Unauthorized');
      return;
    }
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*'
    });
    res.write('event: connected\ndata: {"ok":true}\n\n');
    const sseClients = restServer._sseClients;
    if (sseClients) sseClients.add(res);
    req.on('close', () => { if(sseClients) sseClients.delete(res); });
    return;
  }

  // POST /child/switch — switch active child
  if (method === 'POST' && url === '/child/switch') {
    const { childId } = body;
    const child = (appData.children||[]).find(c=>c.id===childId);
    if (!child) { send(404, { error: 'Child not found' }); return; }
    appData.activeChildId = childId;
    saveData(appData);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('child:switched', childId);
    }
    send(200, { ok: true, child: { id: child.id, name: child.name, avatar: child.avatar } });
    return;
  }

  send(404, { error: 'Unknown endpoint' });
}

// ─── IPC ──────────────────────────────────────────────────────────────────────
// Track whether parent panel is open so blur refocus is suppressed
let parentPanelOpen = false;
ipcMain.handle('parent:setOpen', (e, open) => { parentPanelOpen = !!open; });

ipcMain.handle('data:load', () => { appData = loadData(); return appData; });
ipcMain.handle('data:save', (e, data) => { appData = data; return saveData(data); });
ipcMain.handle('data:setMode', (e, key) => {
  const child = activeChild();
  if (child) child.currentMode = key;
  return saveData(appData);
});
ipcMain.handle('auth:verifyPin', (e, pin) => { if(!appData.pin) return false; return pin === appData.pin; });
ipcMain.handle('auth:setPin', (e, pin) => { appData.pin = pin; appData.pinSet = true; return saveData(appData); });
ipcMain.handle('app:quit', () => { stopMonitor(); globalShortcut.unregisterAll(); app.quit(); });
ipcMain.handle('app:reload', () => { if (mainWindow) mainWindow.reload(); });
ipcMain.handle('app:version', () => CURRENT_VERSION);
ipcMain.handle('app:checkUpdate', async () => {
  return await checkAndUpdate(__dirname, (newVersion) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('update:available', newVersion);
    }
  });
});

ipcMain.handle('app:launch', (e, execPath) => {
  try { shell.openPath(execPath); return { success: true }; }
  catch(err) { return { success: false, error: err.message }; }
});

ipcMain.handle('app:kill', (e, execPath) => {
  try {
    // Use Get-CimInstance to find PID by exact executable path (WMIC deprecated in Win11)
    const safePathPs = execPath.replace(/'/g, "''"); // PowerShell single-quote escape
    const ps = `Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -eq '${safePathPs}' } | Select-Object ProcessId | ConvertTo-Json -Compress`;
    const out = execSync(
      `powershell -NoProfile -NonInteractive -Command "${ps}"`,
      { encoding: 'utf8', timeout: 5000, stdio: ['pipe','pipe','ignore'] }
    ).trim();
    if (out) {
      const result = JSON.parse(out);
      const items = Array.isArray(result) ? result : [result];
      for (const item of items) {
        const pid = item.ProcessId;
        if (pid) {
          try { execSync(`taskkill /PID ${pid} /F /T`, { stdio: 'ignore', timeout: 3000 }); } catch(e) {}
        }
      }
    }
    return { success: true };
  } catch(err) {
    // Fallback: kill by exe name (less precise but reliable)
    try {
      const exeName = path.basename(execPath);
      execSync(`taskkill /F /IM "${exeName}" /T`, { stdio: 'ignore', timeout: 3000 });
      return { success: true, method: 'name-fallback' };
    } catch(e) {}
    return { success: false, error: err.message };
  }
});

// app:openUrl — now handled in-window by session manager in renderer
// This handler is kept for backwards compat but should not be called in normal flow
ipcMain.handle('app:openUrl', (e, url, tileLabel, urlConfigs) => {
  console.warn('[BrightGate] app:openUrl called — websites should open via in-window session manager');
  return { success: false, reason: 'use_in_window_session' };
});

// Activity log — append entry
ipcMain.handle('activity:log', (e, entry) => {
  const child = activeChild();
  const target = child || appData; // Fall back to global if no child
  if (!target.activityLog) target.activityLog = [];
  target.activityLog.unshift({
    ...entry,
    childId: child?.id,
    childName: child?.name,
    ts: Date.now(),
    date: new Date().toLocaleString()
  });
  if (target.activityLog.length > 500) target.activityLog = target.activityLog.slice(0, 500);
  saveData(appData);
  return true;
});

// ─── MANUAL APP REGISTRATION ─────────────────────────────────────────────────

// Browse for EXE — opens file dialog, returns app info
ipcMain.handle('app:browse', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Select Application',
    filters: [
      { name: 'Applications', extensions: ['exe'] },
      { name: 'All Files', extensions: ['*'] }
    ],
    properties: ['openFile']
  });
  if (result.canceled || !result.filePaths.length) return null;
  const exePath = result.filePaths[0];
  const exeName = path.basename(exePath, '.exe');
  // Try to get file description from PowerShell
  let label = exeName;
  let icon = '📦';
  try {
    const ps = `(Get-Item '${exePath.replace(/'/g, "''")}').VersionInfo.FileDescription`;
    const desc = execSync(
      `powershell -NoProfile -NonInteractive -Command "${ps}"`,
      { encoding: 'utf8', timeout: 3000, stdio: ['pipe','pipe','ignore'] }
    ).trim();
    if (desc && desc.length > 0 && desc.length < 80) label = desc;
  } catch(e) {}
  // Auto-detect if this exe lives inside a Steam library — flag requiresSteam
  const isSteamGame = exePath.toLowerCase().includes('steamapps') ||
                      exePath.toLowerCase().includes('steam\\games');

  return {
    name: label,
    label,
    execPath: exePath,
    exeName: path.basename(exePath),
    icon,
    requiresSteam: isSteamGame,
    source: 'manual'
  };
});

// App scan cache — store results to avoid re-scanning every time
ipcMain.handle('scanCache:save', (e, results) => {
  appData.appScanCache = { results, ts: Date.now() };
  saveData(appData);
  return true;
});
ipcMain.handle('scanCache:load', () => {
  if (!appData.appScanCache) return null;
  // Cache valid for 24 hours
  if (Date.now() - appData.appScanCache.ts > 86400000) return null;
  return appData.appScanCache.results;
});

// Check if URL is allowed — returns full result object
ipcMain.handle('url:check', (e, url, urlConfigs) => {
  return checkUrl(url, urlConfigs);
});

// Get/set global URL settings
ipcMain.handle('urlSettings:get', () => {
  return appData.urlSettings || {
    globalBlockedKeys: [], // keywords are now per-site in each mode
    blockAds: true
  };
});
ipcMain.handle('urlSettings:save', (e, settings) => {
  appData.urlSettings = settings;
  return saveData(appData);
});

// Toggle blocking
ipcMain.handle('blocking:set', (e, enabled) => {
  appData.blockingEnabled = enabled;
  saveData(appData);
  if (enabled) startMonitor(); else stopMonitor();
  return true;
});

ipcMain.handle('settings:setKiosk', async (e, enabled) => {
  appData.kioskMode = enabled;
  saveData(appData);
  // Make sure blur refocus doesn't steal the window while dialog is showing
  parentPanelOpen = true;
  await dialog.showMessageBox(mainWindow, {
    type: 'info', title: 'BrightGate',
    message: `Kiosk mode ${enabled ? 'enabled' : 'disabled'} — restart BrightGate to apply the change.`,
    buttons: ['OK']
  });
  parentPanelOpen = false;
  return true;
});

ipcMain.handle('settings:setStartup', (e, enabled) => {
  try {
    const startCmd = `"${process.execPath}" "${__dirname}"`;
    if (enabled) {
      execSync(`reg add "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run" /v "BrightGate" /t REG_SZ /d "${startCmd}" /f`);
    } else {
      execSync(`reg delete "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run" /v "BrightGate" /f`);
    }
    appData.startWithWindows = enabled;
    saveData(appData);
    return { success: true };
  } catch(err) { return { success: false }; }
});

// Fire schedule check on demand (called from renderer on startup)
ipcMain.handle('schedule:checkNow', () => { checkSchedule(); return true; });

// ─── WORLD SYSTEM ────────────────────────────────────────────────────────────
ipcMain.handle('world:set', (e, worldId) => {
  const child = activeChild();
  if (child) {
    child.activeWorld = worldId;
    saveData(appData);
  }
  return { ok: true };
});

ipcMain.handle('world:get', () => {
  const child = activeChild();
  return child?.activeWorld || 'space_station';
});

// ─── ONBOARDING ──────────────────────────────────────────────────────────────
ipcMain.handle('onboarding:complete', (e, childName) => {
  appData.onboardingComplete = true;
  if (childName) appData.childName = childName;
  saveData(appData);
  return { ok: true };
});

ipcMain.handle('onboarding:status', () => {
  return {
    complete: !!appData.onboardingComplete,
    childName: appData.childName || ''
  };
});

// ─── USAGE TRACKING ───────────────────────────────────────────────────────────

// Midnight reset — clear daily usage if date has changed
function checkUsageReset() {
  const today = new Date().toISOString().slice(0, 10);
  let changed = false;
  for (const child of (appData.children || [])) {
    if (child.usageDate !== today) {
      child.usageDate = today;
      child.usageToday = {};
      changed = true;
    }
  }
  if (changed) {
    saveData(appData);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('usage:reset');
    }
    console.log('[BrightGate] Daily usage reset for', today);
  }
}

ipcMain.handle('usage:tick', (e, modeKey, seconds) => {
  const child = activeChild();
  if (!child) return { limitReached: false };
  if (!child.usageToday) child.usageToday = {};
  child.usageToday[modeKey] = (child.usageToday[modeKey] || 0) + seconds;
  const limitMins = child.timeLimits?.[modeKey];
  if (limitMins && child.usageToday[modeKey] >= limitMins * 60) {
    child.currentMode = 'locked';
    saveData(appData);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('usage:limitReached', modeKey);
    }
    if (restServer?._push) restServer._push('timeLimitReached', {
      mode: modeKey,
      child: child ? { name: child.name, avatar: child.avatar } : null
    });
    return { limitReached: true };
  }
  if (child.usageToday[modeKey] % 30 === 0) saveData(appData);
  return { limitReached: false, used: child.usageToday[modeKey] };
});

ipcMain.handle('usage:get', () => {
  const child = activeChild();
  return {
    today: child?.usageToday || {},
    limits: child?.timeLimits || {},
    date: child?.usageDate || null
  };
});

ipcMain.handle('timelimit:set', (e, modeKey, minutes) => {
  const child = activeChild();
  if (!child) return false;
  if (!child.timeLimits) child.timeLimits = {};
  if (!minutes || minutes <= 0) delete child.timeLimits[modeKey];
  else child.timeLimits[modeKey] = Math.round(minutes);
  return saveData(appData);
});

// ─── APP EXIT DETECTION ───────────────────────────────────────────────────────
// Poll for the active session app process — if it disappears, auto-exit the session

let appWatchInterval = null;
let watchingExePath = null;

ipcMain.handle('appwatch:start', (e, exePath) => {
  watchingExePath = exePath;
  if (appWatchInterval) clearInterval(appWatchInterval);
  appWatchInterval = setInterval(() => {
    if (!watchingExePath) { clearInterval(appWatchInterval); return; }
    try {
      // Try CIM first, fall back to tasklist
      let isRunning = false;
      try {
        const safePs = watchingExePath.replace(/'/g, "''");
        const ps = `(Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -eq '${safePs}' } | Measure-Object).Count`;
        const countOut = execSync(
          `powershell -NoProfile -NonInteractive -Command "${ps}"`,
          { encoding: 'utf8', timeout: 3000, stdio: ['pipe','pipe','ignore'] }
        ).trim();
        isRunning = parseInt(countOut) > 0;
      } catch(e) {
        // Tasklist fallback
        const exeName = path.basename(watchingExePath).replace(/['"]/g, '');
        const out = execSync(
          `tasklist /FI "IMAGENAME eq ${exeName}" /FO CSV /NH`,
          { encoding: 'utf8', timeout: 3000, stdio: ['pipe','pipe','ignore'] }
        ).trim();
        isRunning = out.toLowerCase().includes(exeName.toLowerCase()) && !out.includes('No tasks');
      }
      if (!isRunning) {
        clearInterval(appWatchInterval);
        appWatchInterval = null;
        watchingExePath = null;
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('app:closedExternally');
        }
      }
    } catch(e) { /* Watch cycle non-fatal */ }
  }, 2000);
  return true;
});

ipcMain.handle('appwatch:stop', () => {
  if (appWatchInterval) clearInterval(appWatchInterval);
  appWatchInterval = null;
  watchingExePath = null;
  return true;
});

// Time limit management IPC
ipcMain.handle('remote:getStatus', () => {
  const child = activeChild();
  return {
    currentMode: child?.currentMode || 'locked',
    blocking: appData.blockingEnabled,
    timeLimits: child?.timeLimits || {},
    usageToday: child?.usageToday || {}
  };
});

// ─── STEAM CONTAINMENT ────────────────────────────────────────────────────────
// When a tile is flagged requiresSteam, we:
//   1. Find Steam.exe on this machine
//   2. Launch Steam minimised (if not already running)
//   3. Wait up to 8s for Steam to be ready
//   4. Launch the game exe
//   5. Watch for and hide any Steam window the child tries to open

const STEAM_REGISTRY_KEYS = [
  'HKLM\\SOFTWARE\\Valve\\Steam',
  'HKLM\\SOFTWARE\\WOW6432Node\\Valve\\Steam',
  'HKCU\\SOFTWARE\\Valve\\Steam',
];

const STEAM_DEFAULT_PATHS = [
  'C:\\Program Files (x86)\\Steam\\steam.exe',
  'C:\\Program Files\\Steam\\steam.exe',
];

function findSteamExe() {
  // 1. Try registry
  for (const key of STEAM_REGISTRY_KEYS) {
    try {
      const out = execSync(
        `reg query "${key}" /v InstallPath`,
        { encoding: 'utf8', timeout: 3000, stdio: ['pipe','pipe','ignore'] }
      ).trim();
      const match = out.match(/InstallPath\s+REG_SZ\s+(.+)/i);
      if (match) {
        const installPath = match[1].trim();
        const steamExe = path.join(installPath, 'steam.exe');
        if (fs.existsSync(steamExe)) return steamExe;
      }
    } catch(e) {}
  }
  // 2. Try default paths
  for (const p of STEAM_DEFAULT_PATHS) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

function isSteamRunning() {
  try {
    const ps = `(Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'steam.exe' } | Measure-Object).Count`;
    const out = execSync(
      `powershell -NoProfile -NonInteractive -Command "${ps}"`,
      { encoding: 'utf8', timeout: 3000, stdio: ['pipe','pipe','ignore'] }
    ).trim();
    return parseInt(out) > 0;
  } catch(e) {
    try {
      const out = execSync('tasklist /FI "IMAGENAME eq steam.exe" /FO CSV /NH',
        { encoding: 'utf8', timeout: 3000, stdio: ['pipe','pipe','ignore'] }).trim();
      return out.toLowerCase().includes('steam.exe') && !out.includes('No tasks');
    } catch(e2) { return false; }
  }
}

// Hide Steam window using PowerShell (SW_MINIMIZE = 6, SW_HIDE = 0)
function hideSteamWindow() {
  try {
    const ps = `
      Add-Type -TypeDefinition @"
        using System; using System.Runtime.InteropServices;
        public class Win32 {
          [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
          [DllImport("user32.dll")] public static extern IntPtr FindWindow(string lpClassName, string lpWindowName);
        }
"@
      $hwnd = [Win32]::FindWindow("vguiPopupWindow", "Steam")
      if ($hwnd -ne [IntPtr]::Zero) { [Win32]::ShowWindow($hwnd, 0) }
      $hwnd2 = [Win32]::FindWindow("SDL_app", $null)
      if ($hwnd2 -ne [IntPtr]::Zero) { [Win32]::ShowWindow($hwnd2, 0) }
    `;
    execSync(`powershell -NoProfile -NonInteractive -Command "${ps.replace(/\n/g,' ')}"`,
      { timeout: 3000, stdio: 'ignore' });
  } catch(e) {}
}

let steamHideInterval = null;

ipcMain.handle('app:launchWithSteam', async (e, gameExePath) => {
  try {
    const steamExe = findSteamExe();
    if (!steamExe) {
      // Steam not found — try launching game directly anyway
      console.warn('[Steam] Steam.exe not found — launching game directly');
      shell.openPath(gameExePath);
      return { success: true, steamFound: false };
    }

    // Start Steam minimised if not already running
    if (!isSteamRunning()) {
      console.log('[Steam] Launching Steam minimised...');
      exec(`"${steamExe}" -silent`, (err) => {
        if (err) console.warn('[Steam] Launch error:', err.message);
      });
      // Wait for Steam to initialise (up to 8s)
      let waited = 0;
      while (!isSteamRunning() && waited < 8000) {
        await new Promise(r => setTimeout(r, 500));
        waited += 500;
      }
      console.log(`[Steam] Ready after ${waited}ms`);
    }

    // Hide Steam window immediately
    hideSteamWindow();

    // Launch the game
    console.log('[Steam] Launching game:', gameExePath);
    shell.openPath(gameExePath);

    return { success: true, steamFound: true };
  } catch(err) {
    console.error('[Steam] launchWithSteam failed:', err.message);
    return { success: false, error: err.message };
  }
});

ipcMain.handle('steam:startHideWatcher', () => {
  if (steamHideInterval) return true;
  // Poll every 1.5s and hide Steam if visible
  steamHideInterval = setInterval(hideSteamWindow, 1500);
  console.log('[Steam] Hide watcher started');
  return true;
});

ipcMain.handle('steam:stopHideWatcher', () => {
  if (steamHideInterval) { clearInterval(steamHideInterval); steamHideInterval = null; }
  console.log('[Steam] Hide watcher stopped');
  return true;
});

// ─── CHILD MANAGEMENT IPC ────────────────────────────────────────────────────

ipcMain.handle('child:list', () => appData.children || []);

ipcMain.handle('child:add', (e, name, avatar) => {
  const child = getDefaultChildProfile(name || 'New Child', avatar || '🧒');
  if (!appData.children) appData.children = [];
  appData.children.push(child);
  saveData(appData);
  return child;
});

ipcMain.handle('child:remove', (e, childId) => {
  if (!appData.children || appData.children.length <= 1) {
    return { error: 'Cannot remove the last child profile' };
  }
  appData.children = appData.children.filter(c => c.id !== childId);
  if (appData.activeChildId === childId) {
    appData.activeChildId = appData.children[0].id;
  }
  saveData(appData);
  return { ok: true };
});

ipcMain.handle('child:setActive', (e, childId) => {
  const child = (appData.children || []).find(c => c.id === childId);
  if (!child) return { error: 'Child not found' };
  appData.activeChildId = childId;
  saveData(appData);
  // Notify renderer of child switch
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('child:switched', childId);
  }
  return { ok: true, child };
});

ipcMain.handle('child:update', (e, childId, updates) => {
  const child = (appData.children || []).find(c => c.id === childId);
  if (!child) return { error: 'Child not found' };
  if (updates.name) child.name = updates.name;
  if (updates.avatar) child.avatar = updates.avatar;
  saveData(appData);
  return { ok: true };
});

// Push custom notification from renderer (e.g. blocked site)
ipcMain.handle('push:notify', (e, event, data) => {
  if (restServer?._push) restServer._push(event, data);
  return true;
});

// Get local IP for remote app link
ipcMain.handle('system:localIP', () => getLocalIP());

// Open mailto link to share remote URL
ipcMain.handle('system:emailRemoteLink', () => {
  const ip = getLocalIP();
  const url = `http://${ip}:7743`;
  const subject = encodeURIComponent('BrightGate Remote Control');
  const body = encodeURIComponent(
    `Hi,

Here is the link to control BrightGate from your phone:

${url}

` +
    `Make sure you are connected to the same WiFi network as the child's PC.
` +
    `You will need your parent PIN to log in.

— BrightGate`
  );
  shell.openExternal(`mailto:?subject=${subject}&body=${body}`);
  return { url };
});

// ─── CREDENTIAL & SESSION STORE ──────────────────────────────────────────────
// Credentials are stored encrypted using a simple XOR with machine ID as key.
// Not cryptographically strong — this is convenience storage, not a vault.
// Cookies extracted from Edge/Chrome are stored in appData and injected into webview sessions.

const crypto = require('crypto');

function getMachineKey() {
  // Use a combination of machine-stable values as encryption key
  const hostname = os.hostname();
  const user = process.env.USERNAME || process.env.USER || 'user';
  return crypto.createHash('sha256').update(hostname + user + 'brightgate').digest('hex').slice(0, 32);
}

function encryptCredential(text) {
  try {
    const key = getMachineKey();
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-cbc', Buffer.from(key), iv);
    const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
    return iv.toString('hex') + ':' + encrypted.toString('hex');
  } catch(e) { return text; } // Fallback: store plain
}

function decryptCredential(enc) {
  if (!enc) return '';
  // Encrypted format: 32-char ivHex + ':' + dataHex
  // If string is not in this format (e.g. legacy plain text), return as-is
  const colonIdx = enc.indexOf(':');
  if (colonIdx !== 32) return enc; // Not encrypted — legacy plain text, safe to use directly
  try {
    const ivHex = enc.slice(0, 32);
    const dataHex = enc.slice(33);
    const key = getMachineKey();
    const iv = Buffer.from(ivHex, 'hex');
    const decipher = crypto.createDecipheriv('aes-256-cbc', Buffer.from(key), iv);
    return decipher.update(Buffer.from(dataHex, 'hex')) + decipher.final('utf8');
  } catch(e) {
    console.warn('[Creds] Decrypt failed — returning raw value');
    return enc;
  }
}

// Save login credentials for a site
ipcMain.handle('creds:save', (e, domain, username, password) => {
  if (!appData.credentials) appData.credentials = {};
  appData.credentials[domain] = {
    username,
    password: encryptCredential(password),
    savedAt: Date.now()
  };
  saveData(appData);
  return { ok: true };
});

// Get credentials for a site (decrypted)
ipcMain.handle('creds:get', (e, domain) => {
  const cred = appData.credentials?.[domain];
  if (!cred) return null;
  return {
    username: cred.username,
    password: decryptCredential(cred.password),
    savedAt: cred.savedAt
  };
});

// List all saved credential domains
ipcMain.handle('creds:list', () => {
  return Object.keys(appData.credentials || {}).map(domain => ({
    domain,
    username: appData.credentials[domain].username,
    savedAt: appData.credentials[domain].savedAt
  }));
});

// Delete credentials for a site
ipcMain.handle('creds:delete', (e, domain) => {
  if (appData.credentials) delete appData.credentials[domain];
  saveData(appData);
  return { ok: true };
});

// Extract cookies from Edge or Chrome for a given domain
ipcMain.handle('cookies:extractFromBrowser', async (e, domain) => {
  const hostname = domain.replace(/^https?:\/\//, '').split('/')[0];

  // Primary: read cookies from BrightGate's persistent session (persist:brightgate partition)
  // These accumulate as children use the app — no cross-browser extraction needed.
  try {
    const ses = session.fromPartition('persist:brightgate');
    const cookies = await ses.cookies.get({ domain: hostname });
    console.log(`[Cookies] Found ${cookies.length} session cookies for ${hostname}`);
    return {
      cookies: cookies.map(c => ({
        name: c.name, value: c.value, domain: c.domain,
        path: c.path, secure: c.secure, httpOnly: c.httpOnly,
        source: 'brightgate_session'
      })),
      domain: hostname
    };
  } catch(e) {
    console.log('[Cookies] Session read failed:', e.message);
    return { cookies: [], domain: hostname };
  }
});

// Inject credentials into the webview session (called when opening a site)
ipcMain.handle('cookies:inject', async (e, domain, cookies) => {
  try {
    const ses = session.fromPartition('persist:brightgate');
    let count = 0;
    for (const cookie of (cookies || [])) {
      try {
        await ses.cookies.set({
          url: `https://${cookie.domain || domain}`,
          name: cookie.name,
          value: cookie.value,
          domain: cookie.domain || domain,
          path: cookie.path || '/',
          secure: cookie.secure || false,
          httpOnly: cookie.httpOnly || false
        });
        count++;
      } catch(ce) {}
    }
    await ses.cookies.flushStore();
    console.log(`[Cookies] Injected ${count} cookies for ${domain}`);
    return { ok: true, count };
  } catch(e) {
    return { ok: false, error: e.message };
  }
});

// ─── APP SCANNER ──────────────────────────────────────────────────────────────
ipcMain.handle('apps:scan', async () => {
  const found = new Map();

  function addApp(name, exePath) {
    if (!name || !exePath) return;
    const key = exePath.toLowerCase();
    if (found.has(key)) return;
    const base = path.basename(exePath).toLowerCase();
    const skip = ['uninstall','update','crash','helper','setup','install','repair','redist'];
    if (skip.some(s => base.includes(s))) return;
    try { if (!fs.existsSync(exePath)) return; } catch(e) { return; }
    found.set(key, { name: name.trim(), exePath, exeName: path.basename(exePath), icon: '📦' });
  }

  // 1. Registry uninstall keys
  const regKeys = [
    'HKLM\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
    'HKLM\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
    'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
  ];
  for (const regKey of regKeys) {
    try {
      const out = execSync(`reg query "${regKey}" /s 2>nul`, { encoding:'utf8', timeout:12000, stdio:['pipe','pipe','ignore'] });
      const blocks = out.split(/\r?\n(?=HKEY)/);
      for (const block of blocks) {
        const nameMatch = block.match(/DisplayName\s+REG_SZ\s+(.+)/);
        const locMatch = block.match(/InstallLocation\s+REG_SZ\s+(.+)/);
        const exeMatch = block.match(/DisplayIcon\s+REG_SZ\s+([^,\n]+\.exe)/i);
        const name = nameMatch?.[1]?.trim();
        if (!name) continue;
        // Prefer DisplayIcon (usually the main exe)
        if (exeMatch?.[1]) {
          const exePath = exeMatch[1].trim().replace(/^"(.+)"$/, '$1');
          addApp(name, exePath); continue;
        }
        // Fall back to InstallLocation scan
        const loc = locMatch?.[1]?.trim();
        if (loc && fs.existsSync(loc)) {
          try {
            const files = fs.readdirSync(loc);
            const exe = files.find(f => f.endsWith('.exe') && !['uninstall','update','setup','crash','helper'].some(s=>f.toLowerCase().includes(s)));
            if (exe) addApp(name, path.join(loc, exe));
          } catch(e) {}
        }
      }
    } catch(e) {}
  }

  // 2. Start Menu .lnk shortcuts → resolve to exe via PowerShell
  const startMenuPaths = [
    path.join(process.env.APPDATA||'', 'Microsoft\\Windows\\Start Menu\\Programs'),
    'C:\\ProgramData\\Microsoft\\Windows\\Start Menu\\Programs',
  ];
  for (const startDir of startMenuPaths) {
    if (!fs.existsSync(startDir)) continue;
    const scanDir = (dir, depth=0) => {
      if (depth > 3) return;
      try {
        for (const entry of fs.readdirSync(dir, { withFileTypes:true })) {
          const full = path.join(dir, entry.name);
          if (entry.isDirectory()) { scanDir(full, depth+1); continue; }
          if (!entry.name.endsWith('.lnk')) continue;
          try {
            const safePath = full.replace(/'/g, "''");
            const target = execSync(
              `powershell -NoProfile -NonInteractive -Command "$s=(New-Object -COM WScript.Shell).CreateShortcut('${safePath}');$s.TargetPath"`,
              { encoding:'utf8', timeout:2000, stdio:['pipe','pipe','ignore'] }
            ).trim();
            if (target && target.toLowerCase().endsWith('.exe')) {
              addApp(entry.name.replace('.lnk',''), target);
            }
          } catch(e) {}
        }
      } catch(e) {}
    };
    scanDir(startDir);
  }

  // 3. Program Files direct scan
  const progDirs = ['C:\\Program Files','C:\\Program Files (x86)',
    path.join(process.env.LOCALAPPDATA||'','Programs')];
  for (const progDir of progDirs) {
    if (!fs.existsSync(progDir)) continue;
    try {
      for (const appDir of fs.readdirSync(progDir, { withFileTypes:true }).filter(e=>e.isDirectory())) {
        const appPath = path.join(progDir, appDir.name);
        try {
          const exes = fs.readdirSync(appPath).filter(f => f.toLowerCase().endsWith('.exe') &&
            !['uninstall','update','crash','helper','setup','repair'].some(s=>f.toLowerCase().includes(s)));
          if (!exes.length) continue;
          const folderSlug = appDir.name.toLowerCase().replace(/[^a-z0-9]/g,'');
          const best = exes.find(e=>e.toLowerCase().replace(/[^a-z0-9]/g,'').includes(folderSlug)) || exes[0];
          addApp(appDir.name, path.join(appPath, best));
        } catch(e) {}
      }
    } catch(e) {}
  }

  const results = Array.from(found.values()).sort((a,b)=>a.name.localeCompare(b.name));
  console.log(`[AppScanner] Found ${results.length} apps`);
  return results;
});
