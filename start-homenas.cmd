@echo off
rem Double-click to run HomeNAS. Keep this window open; closing it stops the NAS.
title HomeNAS
cd /d "%~dp0"

where node >nul 2>nul || (
  echo Node.js is not installed. Get version 24 or newer from https://nodejs.org and run this again.
  pause
  exit /b 1
)

rem node_modules holds parts built for one kind of computer. If this folder came from another one, reinstall.
if exist node_modules (
  node --input-type=module -e "await import('sharp')" >nul 2>nul
  if errorlevel 1 (
    echo Components were installed on a different computer. Reinstalling...
    rmdir /s /q node_modules
  )
)

if not exist node_modules (
  echo Installing components, first run only...
  call npm install || goto :failed
)

if not exist dist\index.html (
  echo Building the web interface, first run only...
  call npm run build || goto :failed
)

node server\index.ts --prod
echo.
echo HomeNAS stopped.
pause
exit /b 0

:failed
echo.
echo Something went wrong. Scroll up for the error.
pause
exit /b 1
