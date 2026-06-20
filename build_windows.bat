@echo off
setlocal
cd /d "%~dp0"

echo [StudyFree] Preparing Windows package...
set ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/
set ELECTRON_GET_NO_PROGRESS=1

where node >nul 2>nul
if errorlevel 1 (
  echo [StudyFree] Node.js 20 or newer is required to build the package.
  pause
  exit /b 1
)

call npm.cmd install
if errorlevel 1 (
  echo [StudyFree] Dependency installation failed.
  pause
  exit /b 1
)

call npm.cmd test
if errorlevel 1 (
  echo [StudyFree] Tests failed. Package was not created.
  pause
  exit /b 1
)

call npm.cmd run package:windows
if errorlevel 1 (
  echo [StudyFree] Packaging failed.
  pause
  exit /b 1
)

echo [StudyFree] Package ready:
echo release\StudyFree-win32-x64\StudyFree.exe
pause
