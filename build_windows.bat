@echo off
setlocal
cd /d "%~dp0"

echo [医邦教育] Preparing Windows package...
set ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/
set ELECTRON_GET_NO_PROGRESS=1

where node >nul 2>nul
if errorlevel 1 (
  echo [医邦教育] Node.js 20 or newer is required to build the package.
  pause
  exit /b 1
)

call npm.cmd install
if errorlevel 1 (
  echo [医邦教育] Dependency installation failed.
  pause
  exit /b 1
)

call npm.cmd test
if errorlevel 1 (
  echo [医邦教育] Tests failed. Package was not created.
  pause
  exit /b 1
)

call npm.cmd run package:windows
if errorlevel 1 (
  echo [医邦教育] Packaging failed.
  pause
  exit /b 1
)

echo [医邦教育] Package ready:
echo release\医邦教育-win32-x64\医邦教育.exe
pause
