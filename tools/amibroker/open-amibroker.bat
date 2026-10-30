@echo off
REM ============================================================================
REM  "Buka AmiBroker" - the shortcut you click instead of AmiBroker.exe.
REM
REM  What it does, in order:
REM    1. Pulls the export (skips unchanged files, so usually a few KB).
REM    2. Imports into C:\BanyuLangit and saves.
REM    3. Opens AmiBroker for you.
REM
REM  The wait in step 2 is the price of correctness: importing into a running instance makes
REM  the data appear, but only after you have already started looking at the chart. Doing it
REM  before the window opens means the first chart you see is current.
REM
REM  If the pull fails (no Tailscale, server down) it still opens AmiBroker - with a warning.
REM  Refusing to open the program because a download failed would be worse than stale data.
REM ============================================================================

setlocal
set DEST=%~dp0

echo Checking for new data ...
ping -n 1 -w 2000 beavernest.taile871ab.ts.net >nul 2>&1
if errorlevel 1 (
  echo   WARNING: server unreachable - opening AmiBroker with whatever data is local.
  goto :launch
)

call "%DEST%pull.bat"
if errorlevel 1 (
  echo   WARNING: download failed - opening AmiBroker with local data.
  goto :launch
)

echo Importing ...
cscript //nologo "%DEST%sync-amibroker.vbs" >> "%DEST%last-launch.log" 2>&1
if errorlevel 1 (
  echo   WARNING: import reported a problem - see last-launch.log
)

:launch
REM AmiBroker is already running at this point: the import above starts it. A second launch
REM would be a no-op, which is fine. If the import never ran, this starts it.
start "" "C:\Program Files\AmiBroker\Broker.exe"
exit /b 0
