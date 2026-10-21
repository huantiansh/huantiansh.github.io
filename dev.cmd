@echo off
cd /d "%~dp0"
set "PATH=%~dp0tools\hugo;%PATH%"
if not defined HTTPS_PROXY set "HTTPS_PROXY=http://127.0.0.1:7890"
set "NODE_USE_ENV_PROXY=1"
npm run dev
pause
