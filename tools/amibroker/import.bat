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

REM Keep the log bounded: it is appended hourly-ish and nobody rotates it.
for %%A in ("%LOG%") do if %%~zA GTR 1048576 del "%LOG%"

exit /b %RC%
