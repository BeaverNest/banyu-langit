@echo off
REM ============================================================================
REM  "Buka AmiBroker" - the shortcut you click instead of AmiBroker.exe.
REM
REM  What it does, in order:
REM    1. Runs refresh.bat: pull (delta-only when the snapshot is not needed, see
REM       needs-full.vbs), import, categories, then the freshness/global/AUX gates.
REM    2. Opens AmiBroker for you.
REM
REM  WHY THROUGH refresh.bat AND NOT pull.bat + sync-amibroker.vbs DIRECTLY: the direct
REM  path skipped the single-instance lock and every gate, so a click during the scheduled
REM  window could collide with the running import (the loser still reports rc=0 over
REM  partially written data) and a stale chart opened with no signal at all. The cost is the
REM  gates: a few seconds on a normal run.
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

REM AmiBroker ships as 32-bit, so on a 64-bit Windows it installs under "Program Files (x86)".
REM Probing both instead of hardcoding one: a wrong path here fails as "warning: not found"
REM and the program never opens, which is how this bit us once already.
set ABEXE=
for %%P in ("C:\Program Files (x86)\AmiBroker\Broker.exe" "C:\Program Files\AmiBroker\Broker.exe") do (
  if exist %%P set ABEXE=%%~P
)
if not defined ABEXE (
  for /f "tokens=2,*" %%A in ('reg query "HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\Broker.exe" /ve 2^>nul ^| find "REG_"') do set ABEXE=%%B
)
if not defined ABEXE (
  echo   WARNING: Broker.exe not found. Edit this file and set ABEXE by hand.
  pause
  exit /b 2
)

echo Checking for new data ...
ping -n 1 -w 2000 beavernest.taile871ab.ts.net >nul 2>&1
if errorlevel 1 (
  echo   WARNING: server unreachable - opening AmiBroker with whatever data is local.
  goto :launch
)

REM refresh.bat swaps in a pending pull.bat / refresh-core.bat first, then runs the whole
REM cycle under its lock. Exit 3 = no Tailscale, 2 = the pull failed, 4 = another refresh
REM holds the lock. All three end in the same place: open the program with the local data.
echo Checking for new data ...
call "%DEST%refresh.bat"
if errorlevel 1 (
  echo   WARNING: refresh did not finish cleanly - opening AmiBroker with local data.
  echo            The gate verdicts are in last-refresh.log.
  goto :launch
)

:launch
REM AmiBroker is already running at this point: the import above starts it. A second launch
REM would be a no-op, which is fine. If the import never ran, this starts it.
start "" "%ABEXE%"
exit /b 0
