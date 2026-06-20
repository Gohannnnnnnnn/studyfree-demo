@echo off
setlocal
cd /d "%~dp0"

echo [StudyFree] Starting free Windows learning app...
set ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/
set ELECTRON_GET_NO_PROGRESS=1

where node >nul 2>nul
if errorlevel 1 (
  echo [StudyFree] Node.js 20 or newer is required for this development launcher.
  echo [StudyFree] If you want a no-Node version, run build_windows.bat on a development computer and use the packaged release folder.
  pause
  exit /b 1
)

if not exist "node_modules\electron" (
  echo [StudyFree] Installing desktop dependencies...
  call npm.cmd install
  if errorlevel 1 (
    echo [StudyFree] Dependency installation failed.
    pause
    exit /b 1
  )
)

call npm.cmd run desktop
if errorlevel 1 (
  echo [StudyFree] Desktop app exited with an error.
  pause
  exit /b 1
)
