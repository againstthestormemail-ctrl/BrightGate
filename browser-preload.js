/**
 * BrightGate — browser-preload.js
 * Minimal preload for the locked browser window.
 * Intentionally limited — no filesystem, no IPC to main.
 */
const { contextBridge } = require('electron');

// Expose nothing — the browser window is intentionally isolated.
// URL checking happens in main.js via will-navigate events.
contextBridge.exposeInMainWorld('bgBrowser', {
  isLocked: true,
  version: '1.0.0'
});
