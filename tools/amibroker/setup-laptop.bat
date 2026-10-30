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

echo [1/7] Checking the Tailscale link ...
ping -n 1 -w 2000 %NAME% >nul 2>&1
if errorlevel 1 (
  echo   FAIL: cannot reach %NAME%.
  echo         Is Tailscale running and logged in on this laptop?
  exit /b 2
)
echo   OK

echo [2/7] Preparing %DEST% ...
echo         ^(folder must be ASCII-only: AmiBroker's importer cannot open non-ASCII paths^)
if not exist "%DEST%" mkdir "%DEST%"
if not exist "%DEST%" (
  echo   FAIL: cannot create %DEST%
  exit /b 2
)
echo   OK -^> %DEST%

echo [3/7] Pulling data (unchanged files are skipped) ...
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

echo [4/7] Registering the daily refresh ...
REM Daily at 20:00, NOT hourly. The export only changes once a day (19:25 WIB), so 24 polls
REM would be 23 wasted round-trips. /SC DAILY needs no elevation.
REM Points at refresh.bat, NOT pull.bat: pull only downloads, so a task aimed at it fetches CSVs
REM and never imports them - the files look current while AmiBroker shows the previous close.
schtasks /Create /TN "BanyuLangit-Refresh" /SC DAILY /ST 20:00 /TR "%DEST%\refresh.bat" /F >nul 2>&1
if errorlevel 1 (
  echo   WARN: daily task refused ^(policy^). The logon import and the desktop shortcut still work.
) else (
  echo   OK -^> daily at 20:00
)
REM Remove the old hourly task from earlier installs; leaving it would keep polling 24x a day.
schtasks /Delete /TN "BanyuLangit-Pull" /F >nul 2>&1

echo [5/7] Registering the import at logon ...
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
echo [6/7] Verifying the format file is next to the data ...
if not exist "%DEST%\banyulangit.format" (
  echo   FAIL: banyulangit.format missing from %DEST% - the import cannot work.
  exit /b 2
)
echo   OK ^(no admin needed: OLE Import takes the format path explicitly^)

echo [7/7] Creating the "Buka AmiBroker" shortcut ...
set DESKTOP=%USERPROFILE%\Desktop
set ABEXE=
for %%P in ("C:\Program Files (x86)\AmiBroker\Broker.exe" "C:\Program Files\AmiBroker\Broker.exe") do (
  if exist %%P set ABEXE=%%~P
)
if not defined ABEXE (
  for /f "tokens=2,*" %%A in ('reg query "HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\Broker.exe" /ve 2^>nul ^| find "REG_"') do set ABEXE=%%B
)
if not defined ABEXE (
  echo   WARN: Broker.exe not found; the shortcut will have a default icon.
  set ABEXE=%DEST%open-amibroker.bat
)
set LNK=%TEMP%\banyulangit_open.lnk
> "%TEMP%\mklnk.vbs" echo Set oWS = WScript.CreateObject("WScript.Shell")
>> "%TEMP%\mklnk.vbs" echo sLinkFile = "%LNK%"
>> "%TEMP%\mklnk.vbs" echo Set oLink = oWS.CreateShortcut(sLinkFile)
>> "%TEMP%\mklnk.vbs" echo oLink.TargetPath = "%DEST%\open-amibroker.bat"
>> "%TEMP%\mklnk.vbs" echo oLink.WorkingDirectory = "%DEST%"
>> "%TEMP%\mklnk.vbs" echo oLink.IconLocation = "%ABEXE%,0"
>> "%TEMP%\mklnk.vbs" echo oLink.Description = "Update Banyu Langit data, then open AmiBroker"
>> "%TEMP%\mklnk.vbs" echo oLink.Save
cscript //nologo "%TEMP%\mklnk.vbs" >nul 2>&1
if exist "%LNK%" (
  copy /Y "%LNK%" "%DESKTOP%\Buka AmiBroker.lnk" >nul 2>&1
  echo   OK -^> %DESKTOP%\Buka AmiBroker.lnk
) else (
  echo   WARN: shortcut not created. Run %DEST%\open-amibroker.bat manually.
)

echo Done. Data folder: %DEST%
echo AmiBroker database expected at: C:\BanyuLangit\
echo.
echo Test the import once now ^(no admin, no AmiBroker open needed^):
echo   call "%DEST%\import.bat"
echo   type "%DEST%\last-import.log"
echo.
echo It should end with: OK: AmiBroker import complete -^> C:\BanyuLangit\
exit /b 0
