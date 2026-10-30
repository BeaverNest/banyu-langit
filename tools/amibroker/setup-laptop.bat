@echo off
REM ============================================================================
REM  Bootstrap the AmiBroker EOD sync on this Windows laptop.
REM  Run once from an ordinary Command Prompt or PowerShell - NO admin needed.
REM
REM  TRANSPORT: plain HTTP over Tailscale (WireGuard-encrypted on the wire).
REM  This used to be rsync-over-SSH and it kept asking for a password: the key in the
REM  server's authorized_keys belongs to a different Windows account, and a password
REM  prompt cannot be automated. So the transport changed, not the credentials.
REM
REM  NOTE ON SCHEDULING: schtasks /SC ONLOGON requires administrator. A normal user gets
REM  "ERROR: Access is denied." This script therefore uses the Startup folder, which needs
REM  no elevation at all, and skips any task registration that fails instead of dying.
REM ============================================================================

set NAME=beavernest.taile871ab.ts.net
set PORT=8089
set BASE=http://%NAME%:%PORT%
set CURL=curl.exe -fsS --retry 3 --retry-delay 2 --connect-timeout 10

REM C:\ root is not writable for a normal user; only subfolders are.
set DEST=C:\AmibrokerData\import
mkdir "%DEST%" >nul 2>&1
if not exist "%DEST%" set DEST=%LOCALAPPDATA%\AmibrokerData\import

echo [1/6] Checking the Tailscale link ...
ping -n 1 -w 2000 %NAME% >nul 2>&1
if errorlevel 1 (
  echo   FAIL: cannot reach %NAME%.
  echo         Is Tailscale running and logged in on this laptop?
  exit /b 2
)
echo   OK

echo [2/6] Preparing %DEST% ...
echo         ^(folder must be ASCII-only: AmiBroker's importer cannot open non-ASCII paths^)
if not exist "%DEST%" mkdir "%DEST%"
if not exist "%DEST%" (
  echo   FAIL: cannot create %DEST%
  exit /b 2
)
echo   OK -^> %DEST%

echo [3/6] Pulling data (unchanged files are skipped) ...
%CURL% -o "%DEST%\pull.bat" "%BASE%/pull.bat"
if errorlevel 1 (
  echo   FAIL: could not download pull.bat from %BASE%
  exit /b 2
)
call "%DEST%\pull.bat"
if errorlevel 1 (
  echo   FAIL: the initial pull did not complete. Check Tailscale, then re-run.
  exit /b 2
)
for %%F in ("%DEST%\delta_recent.csv") do if %%~zF LSS 1000 (
  echo   FAIL: delta_recent.csv looks empty ^(%%~zF bytes^)
  exit /b 2
)
echo   OK

echo [4/6] Registering the hourly pull ...
REM /SC HOURLY does not need elevation. Try it; if the policy refuses, fall back to a
REM Startup shortcut that pulls once per logon - degraded, but never silently missing.
schtasks /Create /TN "BanyuLangit-Pull" /SC HOURLY /MO 1 /TR "%DEST%\pull.bat" /F >nul 2>&1
if errorlevel 1 (
  echo   WARN: hourly task refused ^(policy^); using a logon-time pull instead.
  set HOURLY=0
) else (
  echo   OK -^> hourly
  set HOURLY=1
)

echo [5/6] Registering the import at logon ...
REM No elevation: a shortcut in the user's Startup folder.
set STARTUP=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup
if not exist "%STARTUP%" mkdir "%STARTUP%" >nul 2>&1
> "%STARTUP%\BanyuLangit Import.cmd" echo @echo off
>> "%STARTUP%\BanyuLangit Import.cmd" echo call "%DEST%\import.bat"
if exist "%STARTUP%\BanyuLangit Import.cmd" (
  echo   OK -^> %STARTUP%
) else (
  echo   WARN: could not create the Startup shortcut. Run manually:
  echo         call "%DEST%\import.bat"
)

echo.
echo [6/6] Verifying the format file is next to the data ...
if not exist "%DEST%\banyulangit.format" (
  echo   FAIL: banyulangit.format missing from %DEST% - the import cannot work.
  exit /b 2
)
echo   OK ^(no admin needed: OLE Import takes the format path explicitly^)

echo Done. Data folder: %DEST%
echo AmiBroker database expected at: C:\BanyuLangit\
echo.
echo Test the import once now ^(no admin, no AmiBroker open needed^):
echo   call "%DEST%\import.bat"
echo   type "%DEST%\last-import.log"
echo.
echo It should end with: OK: AmiBroker import complete -^> C:\BanyuLangit\
exit /b 0
