@echo off
REM ============================================================================
REM  Launcher for the hourly Banyu Langit refresh. This is the file the scheduled
REM  task "BanyuLangit-Refresh" runs, and it is the only one that never changes.
REM
REM  WHY IT EXISTS: pull.bat downloads the server's current pull.bat and
REM  refresh-core.bat as <name>.new, but Windows will not let a running script
REM  replace itself. This file is not published by the exporter, so it can swap
REM  them safely before the work starts. Without it, pull.bat on the laptop stayed
REM  at its 30 Oct version for three days while the server shipped fixes - and
REM  nothing anywhere reported the drift.
REM ============================================================================

setlocal
set DEST=%~dp0

if exist "%DEST%pull.bat.new" (
  move /Y "%DEST%pull.bat.new" "%DEST%pull.bat" >nul 2>&1
)
if exist "%DEST%refresh-core.bat.new" (
  move /Y "%DEST%refresh-core.bat.new" "%DEST%refresh-core.bat" >nul 2>&1
)

call "%DEST%refresh-core.bat"
exit /b %ERRORLEVEL%
