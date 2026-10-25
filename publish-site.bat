@echo off
setlocal EnableExtensions
chcp 65001 >nul
title Blog Publish

set "PROJECT_DIR=%~dp0"
if defined BLOG_PROJECT_DIR set "PROJECT_DIR=%BLOG_PROJECT_DIR%"
if "%PROJECT_DIR:~-1%"=="\" set "PROJECT_DIR=%PROJECT_DIR:~0,-1%"

if not exist "%PROJECT_DIR%\scripts\publish.mjs" (
  echo [ERROR] Publish script not found:
  echo %PROJECT_DIR%\scripts\publish.mjs
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

echo Publishing: commit, push, wait for GitHub Pages...
echo.
node "%PROJECT_DIR%\scripts\publish.mjs" %*
set "RESULT=%ERRORLEVEL%"

echo.
if "%RESULT%"=="0" (
  echo Publish command finished.
) else (
  echo Publish failed. Read the error above.
)
echo.
pause
exit /b %RESULT%
