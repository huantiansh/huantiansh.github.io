@echo off
setlocal EnableExtensions
chcp 65001 >nul
title Blog Admin

set "PROJECT_DIR=%~dp0"
if defined BLOG_PROJECT_DIR set "PROJECT_DIR=%BLOG_PROJECT_DIR%"
if "%PROJECT_DIR:~-1%"=="\" set "PROJECT_DIR=%PROJECT_DIR:~0,-1%"

if not exist "%PROJECT_DIR%\package.json" (
  echo [ERROR] Project not found:
  echo %PROJECT_DIR%
  echo.
  pause
  exit /b 1
)
cd /d "%PROJECT_DIR%"

where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js was not found. Install Node.js 18 or newer.
  echo.
  pause
  exit /b 1
)
node -e "const major=Number(process.versions.node.split('.')[0]); process.exit(major>=18?0:1)"
if errorlevel 1 (
  echo [ERROR] Node.js is too old. Version 18 or newer is required.
  node -v
  echo.
  pause
  exit /b 1
)

powershell -NoProfile -ExecutionPolicy Bypass -Command "try { $r=Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 'http://127.0.0.1:4321/'; if($r.StatusCode -eq 200){Start-Process 'http://127.0.0.1:4321/'; exit 0} } catch {} exit 1"
if not errorlevel 1 (
  echo Admin is already running. Browser opened.
  exit /b 0
)

if not exist "%PROJECT_DIR%\node_modules\sharp\package.json" (
  echo Installing admin dependencies for the first run...
  call npm install
  if errorlevel 1 (
    echo.
    echo [ERROR] npm install failed.
    pause
    exit /b 1
  )
)

echo Starting admin: http://127.0.0.1:4321/
echo Close this window or press Ctrl+C to stop the server.
echo.
node admin/server.mjs --open
if errorlevel 1 (
  echo.
  echo [ERROR] Admin server failed to start.
  pause
  exit /b 1
)
exit /b 0
