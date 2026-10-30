@echo off
REM ============================================================================
REM  Bootstrap the AmiBroker EOD sync on this Windows laptop.
REM  Run once from an ordinary Command Prompt (no admin needed).
REM
REM  Passwordless SSH is required: this script generates a key on the laptop and
REM  prints it. Paste that line into the server's ~/.ssh/authorized_keys once
REM  (the server is Linux/Tailscale, IP 100.64.168.90).
REM
REM  Why hourly rather than once at logon: the server exports at 19:25 WIB. A task
REM  that only ran at logon would show yesterday's close to a laptop opened at 08:00.
REM ============================================================================

set SERVER=100.64.168.90
set USER_NAME=beavernest
set SRC=%USER_NAME%@%SERVER%:/home/beavernest/amibroker-export/
set DEST=C:\AmibrokerData\import
set KEY=%USERPROFILE%\.ssh\amibroker_sync

echo [1/6] Checking Tailscale link to %SERVER% ...
ping -n 2 %SERVER% >nul 2>&1
if errorlevel 1 (
  echo   FAIL: cannot reach %SERVER%. Is Tailscale up on both machines?
  exit /b 2
)
echo   OK

echo [2/6] Preparing the SSH key ...
if not exist "%USERPROFILE%\.ssh" mkdir "%USERPROFILE%\.ssh"
if not exist "%KEY%" (
  ssh-keygen -t ed25519 -f "%KEY%" -N "" -C "amibroker-sync@laptop" >nul
  echo   Created %KEY%
) else (
  echo   Key already present.
)
echo.
echo   ---- COPY THE LINE BELOW INTO THE SERVER'S ~/.ssh/authorized_keys ----
type "%KEY%.pub"
echo   ---------------------------------------------------------------------
echo.

echo [3/6] Testing the pull ...
if not exist "%DEST%" mkdir "%DEST%"
ssh -i "%KEY%" -o StrictHostKeyChecking=accept-new %USER_NAME%@%SERVER% "echo link-ok" >nul 2>&1
if errorlevel 1 (
  echo   SSH key not authorised yet. Add the line above to the server, then re-run.
  exit /b 2
)
where rsync >nul 2>&1
if errorlevel 1 (
  echo   rsync not found. Install it ^(Git for Windows ships one^), then re-run.
  exit /b 2
)
rsync -az --delete -e "ssh -i %KEY%" "%SRC%" "%DEST%\"
if errorlevel 1 (
  echo   FAIL: rsync could not pull the folder.
  exit /b 2
)
echo   OK

echo [4/6] Installing the ASCII format ...
if not exist "%ProgramFiles%\AmiBroker" (
  echo   WARN: AmiBroker not found at %ProgramFiles%\AmiBroker - copy
  echo         banyulangit.format into ^<your AmiBroker^>\Formats yourself.
) else (
  copy /Y "%DEST%\banyulangit.format" "%ProgramFiles%\AmiBroker\Formats\banyulangit.format" >nul
  echo   OK
)

echo [5/6] Registering the hourly pull ...
schtasks /Create /TN "BanyuLangit-Export-Pull" /SC HOURLY /MO 1 ^
  /TR "rsync -az --delete -e \"ssh -i %KEY%\" %SRC% %DEST%\" /F >nul
if errorlevel 1 (
  echo   FAIL: schtasks could not register the pull task.
  exit /b 2
)
echo   OK

echo [6/6] Registering the import at logon ...
schtasks /Create /TN "BanyuLangit-Import" /SC ONLOGON ^
  /TR "cscript //nologo \"%DEST%\sync-amibroker.vbs\"" /F >nul
if errorlevel 1 (
  echo   FAIL: schtasks could not register the import task.
  exit /b 2
)
echo   OK

echo.
echo Done. AmiBroker does not need to be open: the logon task starts it, imports, and exits.
echo To test now:  cscript //nologo "%DEST%\sync-amibroker.vbs"
exit /b 0
