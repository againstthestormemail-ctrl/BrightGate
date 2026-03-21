@echo off
title BrightGate Launcher
echo.
echo  ██████╗ ██████╗ ██╗ ██████╗ ██╗  ██╗████████╗ ██████╗  █████╗ ████████╗███████╗
echo  ██╔══██╗██╔══██╗██║██╔════╝ ██║  ██║╚══██╔══╝██╔════╝ ██╔══██╗╚══██╔══╝██╔════╝
echo  ██████╔╝██████╔╝██║██║  ███╗███████║   ██║   ██║  ███╗███████║   ██║   █████╗
echo  ██╔══██╗██╔══██╗██║██║   ██║██╔══██║   ██║   ██║   ██║██╔══██║   ██║   ██╔══╝
echo  ██████╔╝██║  ██║██║╚██████╔╝██║  ██║   ██║   ╚██████╔╝██║  ██║   ██║   ███████╗
echo  ╚═════╝ ╚═╝  ╚═╝╚═╝ ╚═════╝ ╚═╝  ╚═╝   ╚═╝    ╚═════╝ ╚═╝  ╚═╝   ╚═╝   ╚══════╝
echo.
echo  Kid-Safe Desktop Launcher
echo  ───────────────────────────────────────────────────────────────────────────────
echo.

:: Check if Node.js is installed
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo  ERROR: Node.js is not installed.
    echo.
    echo  Please go to https://nodejs.org and install the LTS version.
    echo  Then run this file again.
    echo.
    pause
    exit /b 1
)

for /f "tokens=*" %%i in ('node --version') do set NODE_VER=%%i
echo  Node.js %NODE_VER% found.
echo.

:: Install dependencies if node_modules doesn't exist
if not exist "node_modules\" (
    echo  First run — installing dependencies. This takes 2-5 minutes...
    echo  Please wait and do not close this window.
    echo.
    call npm install
    if %errorlevel% neq 0 (
        echo.
        echo  ERROR: Failed to install dependencies.
        echo  Make sure you have an internet connection and try again.
        echo.
        pause
        exit /b 1
    )
    echo.
    echo  Dependencies installed successfully!
    echo.
)

echo  Starting BrightGate...
echo.
call npm start

:: If it exits with an error, keep window open so user can read it
if %errorlevel% neq 0 (
    echo.
    echo  BrightGate exited with an error (code %errorlevel%).
    echo  Read the output above and copy any red error text.
    echo.
    pause
)
