# BrightGate v1.1 — Kid-Safe Desktop Launcher

## Running (Development / Testing)
1. Open cmd in this folder
2. npm install  (first time only)
3. npm start

Or double-click START-BRIGHTGATE.bat
Default PIN: 1234

## Building the .exe Installer
Double-click BUILD.bat — it does everything automatically.
Output goes to the dist\ folder.
- BrightGate Setup 1.0.0.exe = full installer (share this)
- BrightGate 1.0.0.exe = portable, no install needed

Requires internet (downloads ~80MB Electron binaries, one time only).
Takes 5-10 minutes. Run as Administrator if it fails.

## Parent Panel
Access via the PARENT button. Features:
- Switch modes instantly
- Edit tiles per mode
- Create new modes
- Schedule calendar (auto mode changes by time)
- Change PIN
- Enable/disable kiosk mode
- Set auto-start on Windows login
- Exit BrightGate

## Kiosk Mode
Fullscreen lock — blocks Alt+Tab, Windows key, Alt+F4.
Emergency exit: Ctrl+Alt+Delete, Task Manager, end electron.exe

## Settings saved at:
C:\Users\[Name]\AppData\Roaming\brightgate\brightgate-data.json
