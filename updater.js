/**
 * BrightGate — updater.js
 * Lightweight auto-updater using GitHub raw file hosting.
 * Checks for new versions of launcher.html and main.js on startup.
 * No server needed — uses public GitHub repository as CDN.
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

// ─── CONFIG ───────────────────────────────────────────────────────────────────
const GITHUB_USER = 'againstthestormemail-ctrl';
const GITHUB_REPO = 'BrightGate';
const GITHUB_BRANCH = 'main';

// Base URL for raw file downloads
const RAW_BASE = `https://raw.githubusercontent.com/${GITHUB_USER}/${GITHUB_REPO}/${GITHUB_BRANCH}`;

// Version file on GitHub — we check this first to avoid downloading everything
const VERSION_URL = `${RAW_BASE}/version.json`;

// Files to update — local path relative to __dirname, remote path on GitHub
const UPDATE_FILES = [
  { remote: 'src/launcher.html', local: 'src/launcher.html' },
  { remote: 'src/browser.html',  local: 'src/browser.html'  },
];

// ─── HELPERS ──────────────────────────────────────────────────────────────────
function fetchText(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { timeout: 8000 }, (res) => {
      // Follow redirects
      if (res.statusCode === 301 || res.statusCode === 302) {
        return fetchText(res.headers.location).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
      }
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Request timed out')); });
  });
}

function getCurrentVersion(appDir) {
  try {
    const vf = path.join(appDir, 'version.json');
    if (fs.existsSync(vf)) {
      return JSON.parse(fs.readFileSync(vf, 'utf8'));
    }
  } catch(e) {}
  return { version: '1.0.0', build: 0 };
}

function compareVersions(a, b) {
  // Returns true if b is newer than a
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pb[i]||0) > (pa[i]||0)) return true;
    if ((pb[i]||0) < (pa[i]||0)) return false;
  }
  return false;
}

// ─── MAIN UPDATE FUNCTION ─────────────────────────────────────────────────────
/**
 * checkAndUpdate(appDir, onUpdateAvailable)
 * 
 * appDir          — __dirname from main.js
 * onUpdateAvailable(newVersion) — called when update was downloaded,
 *                                 use to show toast in renderer
 */
async function checkAndUpdate(appDir, onUpdateAvailable) {
  try {
    console.log('[Updater] Checking for updates...');

    // 1. Fetch remote version.json
    let remoteVersionData;
    try {
      const raw = await fetchText(VERSION_URL);
      remoteVersionData = JSON.parse(raw);
    } catch(e) {
      console.log('[Updater] Could not reach update server — skipping.', e.message);
      return { updated: false, reason: 'unreachable' };
    }

    const localVersion = getCurrentVersion(appDir);
    const remoteVersion = remoteVersionData.version || '1.0.0';

    console.log(`[Updater] Local: ${localVersion.version} | Remote: ${remoteVersion}`);

    // 2. Compare versions
    if (!compareVersions(localVersion.version, remoteVersion)) {
      console.log('[Updater] Already up to date.');
      return { updated: false, reason: 'current' };
    }

    console.log(`[Updater] Update available: ${remoteVersion} — downloading...`);

    // 3. Download each update file
    const downloaded = [];
    for (const file of UPDATE_FILES) {
      try {
        const url = `${RAW_BASE}/${file.remote}`;
        const content = await fetchText(url);
        const localPath = path.join(appDir, file.local);

        // Backup existing file
        if (fs.existsSync(localPath)) {
          fs.copyFileSync(localPath, localPath + '.backup');
        }

        // Write new file
        fs.mkdirSync(path.dirname(localPath), { recursive: true });
        fs.writeFileSync(localPath, content, 'utf8');
        downloaded.push(file.local);
        console.log(`[Updater] Updated: ${file.local}`);
      } catch(e) {
        console.error(`[Updater] Failed to update ${file.remote}:`, e.message);
        // Restore backup if download failed
        const localPath = path.join(appDir, file.local);
        const backup = localPath + '.backup';
        if (fs.existsSync(backup)) {
          fs.copyFileSync(backup, localPath);
        }
      }
    }

    // 4. Update local version.json
    fs.writeFileSync(
      path.join(appDir, 'version.json'),
      JSON.stringify({ version: remoteVersion, updatedAt: new Date().toISOString() }, null, 2),
      'utf8'
    );

    console.log(`[Updater] Update complete. Files updated: ${downloaded.join(', ')}`);

    // 5. Notify caller
    if (downloaded.length > 0 && onUpdateAvailable) {
      onUpdateAvailable(remoteVersion);
    }

    return { updated: true, version: remoteVersion, files: downloaded };

  } catch(e) {
    console.error('[Updater] Update check failed:', e.message);
    return { updated: false, reason: 'error', error: e.message };
  }
}

module.exports = { checkAndUpdate };
