@echo off
REM ============================================================================
REM  Bootstrap the AmiBroker EOD sync on this Windows laptop.
REM  Run once from an ordinary Command Prompt (no admin needed).
REM
REM  TRANSPORT: plain HTTP over Tailscale (WireGuard-encrypted on the wire).
REM  This used to be rsync-over-SSH and it kept asking for a password: the key in the
REM  server's authorized_keys belongs to a different Windows account, and a password
REM  prompt cannot be automated. So the transport changed, not the credentials.
REM
REM  Nothing is required from you beyond running this file.
REM ============================================================================

set NAME=beavernest.taile871ab.ts.net
set PORT=8089
set BASE=http://%NAME%:%PORT%
REM C:\ root is not writable for a normal user on Windows (only subfolders are), so fall
REM back to %LOCALAPPDATA% when the preferred folder cannot be created.
set DEST=C:\AmibrokerData\import
mkdir "C:\AmibrokerData\import" >nul 2>&1
if not exist "C:\AmibrokerData\import" (
  set DEST=%LOCALAPPDATA%\AmibrokerData\import
)
set CURL=curl.exe -fsS --retry 3 --retry-delay 2 --connect-timeout 10

echo [1/4] Checking the Tailscale link ...
ping -n 1 -w 2000 %NAME% >nul 2>&1
if errorlevel 1 (
  echo   FAIL: cannot reach %NAME%.
  echo         Is Tailscale running and logged in on this laptop?
  exit /b 2
)
echo   OK

echo [2/4] Preparing %DEST% ...
if not exist "%DEST%" mkdir "%DEST%"
if not exist "%DEST%" (
  echo   FAIL: cannot create %DEST%
  exit /b 2
)
echo   OK

echo [3/4] Pulling data (unchanged files are skipped) ...
REM Fetch pull.bat from the server rather than expecting it next to this script: the
REM user only has to get ONE file onto the laptop, and that file fetches the rest.
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
echo   OK
dir /b "%DEST%\*.csv" | find /c ".csv" >nul

echo [4/4] Registering scheduled tasks ...
schtasks /Create /TN "BanyuLangit-Pull" /SC HOURLY /MO 1 /TR "\"%DEST%\pull.bat\"" /F >nul
if errorlevel 1 (
  echo   FAIL: schtasks could not register the hourly pull.
  exit /b 2
)
schtasks /Create /TN "BanyuLangit-Import" /SC ONLOGON /TR "cscript //nologo \"%DEST%\sync-amibroker.vbs\"" /F >nul
if errorlevel 1 (
  echo   FAIL: schtasks could not register the import task.
  exit /b 2
)
echo   OK

echo.
echo Done. Files are in %DEST%.
echo.
echo Test the import once now:
echo   cscript //nologo %DEST%\sync-amibroker.vbs
echo.
echo It should end with: OK: AmiBroker import complete -^> C:\BanyuLangit\
exit /b 0
