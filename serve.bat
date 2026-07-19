@echo off
setlocal
cd /d "%~dp0"

REM Always Bypass so this works even when ExecutionPolicy blocks .ps1 files.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0serve.ps1" %*
set ERR=%ERRORLEVEL%
if %ERR% NEQ 0 (
  echo.
  echo Server failed to start (exit %ERR%).
  pause
)
exit /b %ERR%
