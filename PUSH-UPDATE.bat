@echo off
title BrightGate — Push Update to GitHub
cd /d "%~dp0"

echo.
echo  ============================================================
echo   BRIGHTGATE — Publish Update
echo  ============================================================
echo.

:: Check git is installed
where git >nul 2>&1
if %errorlevel% neq 0 (
    echo  ERROR: Git is not installed.
    echo.
    echo  Install it from: https://git-scm.com/download/win
    echo  Then run this again.
    pause & exit /b 1
)

:: Initialize git repo if needed
if not exist ".git\" (
    echo  Setting up Git for the first time...
    git init
    git remote add origin https://github.com/againstthestormemail-ctrl/BrightGate.git
    git branch -M main
    echo.
)

:: Ask for version number
set /p NEW_VERSION="Enter new version number (e.g. 1.2.1): "
if "%NEW_VERSION%"=="" ( echo Version required. & pause & exit /b 1 )

:: Ask for update notes
set /p UPDATE_NOTES="Enter update notes (e.g. Fixed tile editor): "

:: Update version.json
echo { > version.json
echo   "version": "%NEW_VERSION%", >> version.json
echo   "updatedAt": "%DATE%", >> version.json
echo   "notes": "%UPDATE_NOTES%" >> version.json
echo } >> version.json

echo.
echo  Version set to %NEW_VERSION%
echo  Pushing to GitHub...
echo.

:: Stage and push
git add src/launcher.html src/browser.html version.json main.js preload.js updater.js
git commit -m "v%NEW_VERSION% — %UPDATE_NOTES%"
git push origin main

if %errorlevel% neq 0 (
    echo.
    echo  Push failed. You may need to log in to GitHub.
    echo  Run: git push origin main
    echo  And enter your GitHub username + Personal Access Token when prompted.
    echo.
    echo  To create a token: GitHub → Settings → Developer Settings
    echo  → Personal Access Tokens → Tokens (classic) → New token
    echo  → Select 'repo' scope → Generate → copy the token
    pause & exit /b 1
)

echo.
echo  ============================================================
echo   UPDATE PUBLISHED!
echo  ============================================================
echo.
echo  Version %NEW_VERSION% is now live on GitHub.
echo  All installed copies of BrightGate will update automatically
echo  the next time they are opened.
echo.
pause
