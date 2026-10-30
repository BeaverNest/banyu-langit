@echo off
REM ============================================================================
REM  Run the AmiBroker import once and log the outcome.
REM  Called by the logon task (or the Startup shortcut) and safe to run by hand.
REM
REM  This wrapper exists so the scheduled task never needs nested quotes:
REM  schtasks receives one plain path, and the quoting lives here where it can be read.
REM ============================================================================

setlocal
set DEST=%~dp0
set LOG=%DEST%last-import.log

echo ---- %DATE% %TIME% ---- >> "%LOG%"
cscript //nologo "%DEST%sync-amibroker.vbs" >> "%LOG%" 2>&1
set RC=%ERRORLEVEL%
echo exit=%RC% >> "%LOG%"

REM Persistence check: run a second, fresh cscript. A new process can only see what reached
REM disk, so "Symbols before import" in THIS run is the real test of the previous run's save.
REM If the previous run genuinely saved, this run starts from 2000+ symbols and skips the full
REM import; if it did not, this run pays for 337 MB again and the log shows was=0.
REM Cold-start check: closes AmiBroker and reopens it, so this reads from disk only.
REM Without the restart, GetObject attaches to the instance still holding the import in memory
REM and "was 2378" would prove nothing.
echo ---- persistence check (cold start) ---- >> "%LOG%"
cscript //nologo "%DEST%sync-amibroker.vbs" verify >> "%LOG%" 2>&1
set RC2=%ERRORLEVEL%
echo exit=%RC2% >> "%LOG%"
if not "%RC2%"=="0" (
  echo PERSISTENCE CHECK FAILED >> "%LOG%"
  set RC=%RC2%
)

REM Keep the log bounded: it is appended hourly-ish and nobody rotates it.
for %%A in ("%LOG%") do if %%~zA GTR 1048576 del "%LOG%"

exit /b %RC%
