@echo off
title BrightGate — Build Installer
color 0A
echo.
echo  ============================================================
echo   BRIGHTGATE — Building Windows Installer
echo  ============================================================
echo.

:: Must be run from the brightgate folder
cd /d "%~dp0"

:: Check Node
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo  ERROR: Node.js not found. Install from https://nodejs.org
    pause & exit /b 1
)

:: Install deps if needed
if not exist "node_modules\" (
    echo  Installing dependencies first...
    call npm install
    if %errorlevel% neq 0 ( echo  npm install failed. & pause & exit /b 1 )
)

:: Install electron-builder if not present
if not exist "node_modules\electron-builder\" (
    echo  Installing electron-builder...
    call npm install electron-builder --save-dev
    if %errorlevel% neq 0 ( echo  electron-builder install failed. & pause & exit /b 1 )
)

echo.
echo  Building installer... this takes 5-10 minutes.
echo  Do NOT close this window.
echo.

call npm run build

if %errorlevel% neq 0 (
    echo.
    echo  ============================================================
    echo   BUILD FAILED — read the error above
    echo  ============================================================
    echo.
    echo  Common fixes:
    echo  - Make sure you have an internet connection
    echo  - Try running this as Administrator (right-click the .bat)
    echo  - Make sure assets\icon.ico exists
    echo.
    pause
    exit /b 1
)

echo.
echo  ============================================================
echo   BUILD COMPLETE!
echo  ============================================================
echo.
echo  Your installer is in the  dist\  folder:
echo.
dir /b dist\*.exe 2>nul
dir /b dist\*.msi 2>nul
echo.
echo  - BrightGate Setup *.exe   = Full installer (recommended)
echo  - BrightGate *.exe         = Portable (no install needed)
echo.
echo  Share the Setup .exe with anyone — they don't need Node.js.
echo.

:: Open the dist folder automatically
explorer dist

pause
