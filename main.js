/**
 * BrightGate — main.js
 * Electron main process
 * v1.2 — adds process monitor + locked webview browser
 */

const { app, BrowserWindow, ipcMain, globalShortcut, dialog, shell, session } = require('electron');
const path = require('path');
const fs = require('fs');
const { execSync, exec } = require('child_process');
const { checkAndUpdate } = require('./updater');

const CURRENT_VERSION = '1.2.0';

// ─── DATA ─────────────────────────────────────────────────────────────────────
const userDataPath = app.getPath('userData');
const dataFile = path.join(userDataPath, 'brightgate-data.json');

function loadData() {
  try {
    if (fs.existsSync(dataFile)) return JSON.parse(fs.readFileSync(dataFile, 'utf8'));
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

function getDefaultData() {
  return {
    pin: '1234',
    currentMode: 'learning',
    modes: {
      learning: {
        label: 'LEARNING', tagline: 'Explore. Learn. Build.', color: '#00c8ff',
        tiles: [
          { icon: '🧮', label: 'Math Trainer', c: '#00c8ff' },
          { icon: '🌐', label: 'Khan Academy', c: '#00c8ff', url: 'khanacademy.org' },
          { icon: '📖', label: 'Reading Lab', c: '#42d4f5' },
          { icon: '🔬', label: 'Science Videos', c: '#42d4f5' },
          { icon: '✏️', label: 'Writing Tools', c: '#00c8ff' },
          { icon: '🗺️', label: 'Geography Quiz', c: '#5cbcf5' }
        ],
        apps: [], urls: []
      },
      funtime: {
        label: 'FUN TIME', tagline: 'Play. Create. Explore.', color: '#ff60b0',
        tiles: [
          { icon: '🎮', label: 'Minecraft', c: '#ff60b0' },
          { icon: '🎨', label: 'Paint Studio', c: '#b060ff' },
          { icon: '🎵', label: 'Music Maker', c: '#ff60b0' },
          { icon: '🦖', label: 'Dino Game', c: '#ff9040' },
          { icon: '🧩', label: 'Puzzle World', c: '#b060ff' }
        ],
        apps: [], urls: []
      },
      watchtime: {
        label: 'WATCH TIME', tagline: 'Relax. Watch. Enjoy.', color: '#b060ff',
        tiles: [
          { icon: '▶️', label: 'YouTube Kids', c: '#b060ff', url: 'youtube.com/kids' },
          { icon: '🎬', label: 'Movie Club', c: '#b060ff' },
          { icon: '🌿', label: 'Nature Docs', c: '#6b42f5' }
        ],
        apps: [], urls: []
      },
      locked: { label: 'LOCKED', tagline: '', color: '#ff3d5a', tiles: [], apps: [], urls: [] }
    },
    schedule: Array(7).fill(null).map(() => ({})),
    kioskMode: false,
    blockingEnabled: true,
    startWithWindows: false
  };
}

// ─── ALWAYS-BLOCKED PROCESSES ─────────────────────────────────────────────────
// These are always killed regardless of mode allowlist
const ALWAYS_BLOCKED = [
  'chrome.exe', 'msedge.exe', 'firefox.exe', 'opera.exe', 'brave.exe',
  'iexplore.exe', 'safari.exe', 'vivaldi.exe', 'waterfox.exe', 'tor.exe',
  'taskmgr.exe', 'regedit.exe', 'cmd.exe', 'powershell.exe', 'wscript.exe',
  'cscript.exe', 'mshta.exe', 'wmic.exe', 'control.exe', 'mmc.exe'
];

// ─── PROCESS MONITOR ──────────────────────────────────────────────────────────
let monitorInterval = null;
let appData = loadData();
let isMonitoring = false;

function getAllowedExes() {
  if (!appData || !appData.currentMode) return [];
  const mode = appData.modes[appData.currentMode];
  if (!mode || !mode.apps) return [];
  // Extract exe names from app entries
  return mode.apps
    .filter(a => a.execPath || a.exeName)
    .map(a => {
      const p = a.execPath || a.exeName || '';
      return path.basename(p).toLowerCase();
    });
}

function isProcessAllowed(exeName) {
  const name = exeName.toLowerCase().trim();
  // Always allow BrightGate's own processes
  if (name.includes('electron') || name.includes('brightgate') ||
      name === 'node.exe' || name === 'npm.cmd') return true;
  // Always block dangerous processes
  if (ALWAYS_BLOCKED.includes(name)) return false;
  // If blocking disabled, allow everything else
  if (!appData.blockingEnabled) return true;
  // If mode is locked, block everything not BrightGate
  if (appData.currentMode === 'locked') return false;
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

function runMonitorCycle() {
  if (!isMonitoring) return;
  try {
    // Get all running processes with PIDs
    const output = execSync(
      'wmic process get Name,ProcessId /format:csv',
      { encoding: 'utf8', timeout: 5000, stdio: ['pipe','pipe','ignore'] }
    );
    const lines = output.split('\n').filter(l => l.trim() && !l.startsWith('Node'));
    for (const line of lines) {
      const parts = line.split(',');
      if (parts.length < 3) continue;
      const name = (parts[1] || '').trim().toLowerCase();
      const pid = parseInt((parts[2] || '').trim());
      if (!name || !pid || isNaN(pid)) continue;
      if (!isProcessAllowed(name)) {
        killProcess(pid, name);
      }
    }
  } catch(e) {
    // wmic may fail occasionally — not critical
  }
}

function startMonitor() {
  if (monitorInterval) return;
  isMonitoring = true;
  monitorInterval = setInterval(runMonitorCycle, 3000);
  console.log('[BrightGate] Process monitor started');
}

function stopMonitor() {
  isMonitoring = false;
  if (monitorInterval) { clearInterval(monitorInterval); monitorInterval = null; }
  console.log('[BrightGate] Process monitor stopped');
}

// ─── URL RULE ENGINE ──────────────────────────────────────────────────────────
/**
 * Check if a URL is allowed given an array of rules.
 * Rule formats:
 *   "khanacademy.org"          → allows entire domain + subdomains
 *   "khanacademy.org/*"        → same (explicit wildcard)
 *   "youtube.com/kids"         → allows youtube.com/kids and youtube.com/kids/*
 *   "youtube.com/kids/*"       → same (explicit subpath lock)
 *   "!youtube.com/games"       → explicit block (overrides above)
 */
function isUrlAllowed(urlString, rules) {
  try {
    const u = new URL(urlString.startsWith('http') ? urlString : 'https://' + urlString);
    const hostname = u.hostname.replace(/^www\./, '');
    const fullPath = hostname + u.pathname;

    // Check explicit blocks first (rules starting with !)
    for (const rule of rules) {
      if (!rule.startsWith('!')) continue;
      const blocked = rule.slice(1).replace(/^www\./, '').replace(/\/\*$/, '');
      if (fullPath.startsWith(blocked)) return false;
    }

    // Check allows
    for (const rule of rules) {
      if (rule.startsWith('!')) continue;
      const clean = rule.replace(/^www\./, '').replace(/\/\*$/, '');
      // Domain-only rule — allow everything on that domain
      if (!clean.includes('/')) {
        if (hostname === clean || hostname.endsWith('.' + clean)) return true;
      } else {
        // Path rule — allow domain + that path prefix
        if (fullPath.startsWith(clean)) return true;
      }
    }
    return false;
  } catch(e) { return false; }
}

// ─── WEBVIEW WINDOW ───────────────────────────────────────────────────────────
let webviewWindows = {};

function openLockedBrowser(tileLabel, startUrl, rules) {
  // Check initial URL is allowed
  if (!isUrlAllowed(startUrl, rules)) {
    if (mainWindow) {
      mainWindow.webContents.send('browser:blocked', { url: startUrl, label: tileLabel });
    }
    return;
  }

  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    fullscreen: appData.kioskMode,
    parent: mainWindow,
    backgroundColor: '#04080f',
    title: tileLabel + ' — BrightGate',
    webPreferences: {
      preload: path.join(__dirname, 'browser-preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      // Disable DevTools access
      devTools: false
    }
  });

  // Hide menu bar
  win.setMenuBarVisibility(false);
  win.removeMenu();

  // Block navigation to non-allowed URLs
  win.webContents.on('will-navigate', (event, url) => {
    if (!isUrlAllowed(url, rules)) {
      event.preventDefault();
      win.webContents.send('bg:blocked', url);
    }
  });

  // Block new window/popup attempts
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isUrlAllowed(url, rules)) {
      win.loadURL(url);
    }
    return { action: 'deny' };
  });

  // Block redirects too
  win.webContents.on('will-redirect', (event, url) => {
    if (!isUrlAllowed(url, rules)) {
      event.preventDefault();
    }
  });

  const fullUrl = startUrl.startsWith('http') ? startUrl : 'https://' + startUrl;

  // Load our browser shell which wraps the target in a locked chrome
  win.loadFile(path.join(__dirname, 'src', 'browser.html'), {
    query: { url: fullUrl, title: tileLabel, rules: JSON.stringify(rules) }
  });

  const id = Date.now();
  webviewWindows[id] = win;
  win.on('closed', () => { delete webviewWindows[id]; });

  if (appData.kioskMode) {
    win.on('minimize', () => win.restore());
  }
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
      devTools: !appData.kioskMode
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'src', 'launcher.html'));
  mainWindow.removeMenu();

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    // Always block escape shortcuts — even outside kiosk mode
    registerAlwaysBlockedShortcuts();
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

  // Always refocus — prevents Alt+Tab from leaving the app
  mainWindow.on('blur', () => {
    setTimeout(() => {
      if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.webContents.isDevToolsFocused()) {
        mainWindow.focus();
      }
    }, 100);
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

// ─── LIFECYCLE ────────────────────────────────────────────────────────────────
app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('window-all-closed', () => { stopMonitor(); globalShortcut.unregisterAll(); if (process.platform !== 'darwin') app.quit(); });
app.on('will-quit', () => { stopMonitor(); globalShortcut.unregisterAll(); });

// ─── IPC ──────────────────────────────────────────────────────────────────────
ipcMain.handle('data:load', () => { appData = loadData(); return appData; });
ipcMain.handle('data:save', (e, data) => { appData = data; return saveData(data); });
ipcMain.handle('data:setMode', (e, key) => { appData.currentMode = key; return saveData(appData); });
ipcMain.handle('auth:verifyPin', (e, pin) => pin === appData.pin);
ipcMain.handle('auth:setPin', (e, pin) => { appData.pin = pin; return saveData(appData); });
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

// Open URL in locked browser
ipcMain.handle('app:openUrl', (e, url, tileLabel, rules) => {
  try {
    openLockedBrowser(tileLabel || 'Web', url, rules || [url]);
    return { success: true };
  } catch(err) { return { success: false, error: err.message }; }
});

// Check if URL is allowed
ipcMain.handle('url:check', (e, url, rules) => isUrlAllowed(url, rules));

// Toggle blocking
ipcMain.handle('blocking:set', (e, enabled) => {
  appData.blockingEnabled = enabled;
  saveData(appData);
  if (enabled) startMonitor(); else stopMonitor();
  return true;
});

ipcMain.handle('settings:setKiosk', (e, enabled) => {
  appData.kioskMode = enabled;
  saveData(appData);
  dialog.showMessageBox(mainWindow, {
    type: 'info', title: 'BrightGate',
    message: 'Kiosk mode change takes effect after restarting BrightGate.',
    buttons: ['OK']
  });
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
