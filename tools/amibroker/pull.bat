@echo off
REM ============================================================================
REM  Pull the Banyu Langit export into C:\AmibrokerData\import.
REM  Called by refresh.bat (the launcher the scheduled task runs).
REM
REM  WHAT THIS GUARANTEES, and why each guarantee exists:
REM
REM  1. A file counts as updated only after it has been downloaded, moved onto
REM     the live name, and READ BACK at the size the manifest declares.
REM
REM  2. If any size disagrees, every declared file is fetched again WITHOUT
REM     curl -z. -z trusts the local mtime, and a truncated local copy can be
REM     newer than the server - it would then answer 304 Not Modified forever.
REM
REM  3. -z on the first pass means an unchanged export transfers nothing, so the
REM     hourly run costs a few KB instead of ~400 MB.
REM
REM  4. pull.bat and refresh-core.bat cannot overwrite themselves while running,
REM     so they arrive as <name>.new and refresh.bat swaps them on its next start.
REM
REM  WHY EVERY PATH IS BUILT AS %VAR%%.ext AND NOT %VAR%%.ext IN ONE TOKEN:
REM  cmd expands %NAME% by scanning to the NEXT percent sign. In "%DEST%%F.tmp"
REM  the trailing ".tmp" leaves no closing percent for %F, so the whole tail is
REM  pasted literally: the download lands in a file called F.tmp, the move
REM  "succeeds" on that same wrong name, the live file is never touched, and every
REM  step still reports success. That is the shape of the 2026-11-02 failure:
REM  delta_idx_aux.csv kept its 31 Oct content while the run logged OK.
REM
REM  Exit codes: 0 ok, 1 a file could not be verified, 2 Tailscale is down.
REM ============================================================================

setlocal enabledelayedexpansion
set NAME=beavernest.taile871ab.ts.net
set PORT=8089
set BASE=http://%NAME%:%PORT%
set DEST=%~dp0
set LOG=%DEST%pull.log
set CURL=curl.exe -fsS --retry 3 --retry-delay 2 --connect-timeout 10

REM WHICH PAYLOAD. "quick" pulls only the small files a delta import consumes; the part files
REM are the 10-year snapshot and are read ONLY by a full import. refresh-core.bat asks
REM needs-full.vbs before choosing a mode, and that advisor answers FULL whenever it cannot
REM prove otherwise, so this switch can only make a run slower - never staler.
REM Measured 2026-11-06: a plain (full) pull spent 1 h 31 min delivering ~434 MB so that the
REM import could read ~5 MB of it.
set MODE=full
if /I "%~1"=="quick" set MODE=quick

REM Reachability gate first. A dead Tailscale link must fail here, not half-way
REM through a partition, leaving a truncated CSV for the importer to eat.
ping -n 1 -w 2000 %NAME% >nul 2>&1
if errorlevel 1 exit /b 2

REM manifest.json is the reference for the gate below, so it goes first and its
REM failure is fatal: without it nothing on disk can be judged.
call :fetch manifest.json
if errorlevel 1 exit /b 1

call :fetch_all
call :verify
if not errorlevel 1 goto done

echo NOTE: manifest mismatch - forcing a full re-fetch of the payload>> "%LOG%"
call :fetch_all force
call :verify
if errorlevel 1 (
  echo FAIL: files still do not match the manifest after a forced re-fetch>> "%LOG%"
  exit /b 1
)

:done
call :fetch_new pull.bat
call :fetch_new refresh-core.bat
exit /b 0

REM ---------------------------------------------------------------------------
:fetch_all
set FORCE=%~1
for %%F in (
  delta_recent.csv
  delta_index.csv
  index_ihsg.csv
  global_all.csv
  global_close.csv
  banyulangit-close.format
  banyulangit-idx-aux.format
  delta_idx_aux.csv
  symbol_info.csv
  banyulangit-symbolinfo.format
  verify-idx-aux.vbs
  verify-symbolinfo.vbs
  verify-global.vbs
  verify-freshness.vbs
  verify-pull.vbs
  banyulangit-sector.format
  banyulangit-industry.format
  banyulangit.format
  import-all.abb
  import.bat
  sync-amibroker.vbs
  verify-persist.vbs
  diag-amibroker.vbs
  diag2-amibroker.vbs
  assign-categories.vbs
  category_assign.csv
  needs-full.vbs
  category_names.csv
  categories_sector.csv
  categories_industry.csv
  open-amibroker.bat
  setup-laptop.bat
) do (
  call :fetch %%F
)
if /I "%MODE%"=="quick" goto parts_skipped
REM ---- the snapshot payload: only a full import reads these ------------------
for %%F in (
  us_part01.csv us_part02.csv us_part03.csv us_part04.csv us_part05.csv
  idx_part01.csv idx_part02.csv idx_part03.csv idx_part04.csv
) do (
  call :fetch %%F
)
:parts_skipped
exit /b 0

REM ---------------------------------------------------------------------------
:fetch
REM %1 = file name.
set F=%~1
set TMP=%DEST%%F%.tmp
set LIVE=%DEST%%F%

REM A leftover .tmp from a killed run must not be mistaken for this run's data.
if exist "%TMP%" del /f /q "%TMP%" >nul 2>&1

if /I "%~2"=="force" set FORCE=force
if /I "%FORCE%"=="force" (
  %CURL% -o "%TMP%" "%BASE%/%F%"
) else (
  %CURL% -z "%LIVE%" -o "%TMP%" "%BASE%/%F%"
)
if errorlevel 1 (
  echo WARN: %F% download failed>> "%LOG%"
  exit /b 1
)
REM No .tmp after a zero exit means 304 Not Modified - the live file is current.
if not exist "%TMP%" exit /b 0

for %%A in ("%TMP%") do set SZ=%%~zA
if "!SZ!"=="0" (
  del /f /q "%TMP%" >nul 2>&1
  echo WARN: %F% downloaded empty>> "%LOG%"
  exit /b 1
)
call :replace "%TMP%" "%LIVE%" "!SZ!" %F%
exit /b 0

REM ---------------------------------------------------------------------------
:replace
REM %1 = tmp path, %2 = live path, %3 = expected size, %4 = name for logging.
set TRY=0
:replace_retry
move /Y %1 %2 >nul 2>&1
if not errorlevel 1 goto replace_check
set /a TRY+=1
if !TRY! GEQ 3 goto replace_failed
ping -n 2 -w 1000 127.0.0.1 >nul 2>&1
goto replace_retry

:replace_check
for %%A in (%2) do if "%%~zA"=="%~3" exit /b 0
echo WARN: %~4 landed with the wrong size>> "%LOG%"
goto replace_failed

:replace_failed
del /f /q %1 >nul 2>&1
echo FAIL: %~4 could not be replaced - a process may be holding it>> "%LOG%"
exit /b 1

REM ---------------------------------------------------------------------------
:fetch_new
REM %1 = live name. Fetches the file the server publishes under that name and
REM keeps it as <name>.new for refresh.bat to swap in on its next start.
REM It must ask for "%1", not "%1.new": that path returns 404 and the script
REM would then never update, silently, forever.
set F=%~1
set TMPN=%DEST%%F%.new
if exist "%TMPN%" del /f /q "%TMPN%" >nul 2>&1
%CURL% -o "%TMPN%" "%BASE%/%F%"
if errorlevel 1 (
  echo WARN: %F%.new could not be downloaded>> "%LOG%"
  del /f /q "%TMPN%" >nul 2>&1
  exit /b 1
)
for %%A in ("%TMPN%") do if %%~zA EQU 0 (
  del /f /q "%TMPN%" >nul 2>&1
  echo WARN: %F%.new downloaded empty>> "%LOG%"
  exit /b 1
)
exit /b 0

REM ---------------------------------------------------------------------------
:verify
REM In quick mode the part files are deliberately absent-or-old, so the gate must judge only the
REM files this run was supposed to deliver. Comparing them against the manifest would fail on
REM bytes nobody asked for and force a full re-fetch of the whole payload.
if /I "%MODE%"=="quick" goto verify_quick
cscript //nologo "%DEST%verify-pull.vbs" "%DEST:~0,-1%" >> "%LOG%" 2>&1
exit /b %ERRORLEVEL%

:verify_quick
cscript //nologo "%DEST%verify-pull.vbs" "%DEST:~0,-1%" quick >> "%LOG%" 2>&1
exit /b %ERRORLEVEL%
