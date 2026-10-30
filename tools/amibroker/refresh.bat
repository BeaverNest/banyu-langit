@echo off
REM ============================================================================
REM  Hourly refresh: pull the export, then import what changed into AmiBroker.
REM  Registered as the scheduled task "BanyuLangit-Pull".
REM
REM  WHY THIS IS SEPARATE FROM import.bat:
REM  import.bat runs the cold-start persistence check, which KILLS broker.exe. That is right
REM  once at logon and completely wrong every hour - it would close AmiBroker while you are
REM  using it. This wrapper only pulls and imports; it attaches to a running instance and
REM  never terminates one.
REM
REM  Cost per hour: the delta is ~5 MB and importing it takes seconds. Unchanged files return
REM  304 and transfer nothing, so an idle night costs nothing at all.
REM ============================================================================

setlocal
set DEST=%~dp0
set LOG=%DEST%last-refresh.log

REM Tapis: without Tailscale there is nothing to pull, and the import below would run on
REM stale files while reporting success.
ping -n 1 -w 2000 beavernest.taile871ab.ts.net >nul 2>&1
if errorlevel 1 exit /b 3

call "%DEST%pull.bat"
if errorlevel 1 exit /b 2

REM Only import when the pull actually brought something new. Delta mtime changes whenever
REM the server regenerated it; an unchanged night leaves the file alone.
echo ---- %DATE% %TIME% ---- >> "%LOG%"
cscript //nologo "%DEST%sync-amibroker.vbs" >> "%LOG%" 2>&1
set RC=%ERRORLEVEL%
echo exit=%RC% >> "%LOG%"

REM ============================================================================
REM  Categories: name the markets and assign every symbol.
REM
REM  Runs AFTER sync-amibroker.vbs on purpose. Sector and industry are imported by
REM  sync-amibroker.vbs (ASCII SECTORNAME/INDUSTRYNAME); market and group have no
REM  importable name field at all - MARKET/GROUP take a numeric ID - so they are
REM  set over OLE here, after the symbols exist.
REM
REM  Idempotent: symbols already assigned correctly are skipped, so this costs one
REM  pass over the symbol table on a normal night, not 2,377 writes.
REM ============================================================================
echo ---- categories ---- >> "%LOG%"
cscript //nologo "%DEST%assign-categories.vbs" > "%DEST%cat-out.txt" 2>&1
set RC3=%ERRORLEVEL%
type "%DEST%cat-out.txt" >> "%LOG%"
REM Also print to the console: the log on this machine has shown stale content after a run,
REM and a result nobody can see is indistinguishable from a result that never happened.
type "%DEST%cat-out.txt"
echo exit=%RC3% >> "%LOG%"
if not "%RC3%"=="0" (
  echo CATEGORY ASSIGNMENT FAILED >> "%LOG%"
  set RC=%RC3%
)

REM Keep the log bounded: this appends 24 times a day.
for %%A in ("%LOG%") do if %%~zA GTR 1048576 del "%LOG%"

exit /b %RC%
