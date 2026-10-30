@echo off
REM ============================================================================
REM  Hourly pull of the Banyu Langit export into C:\AmibrokerData\import.
REM  Registered by setup-laptop.bat as the scheduled task "BanyuLangit-Pull".
REM
REM  curl -z sends If-Modified-Since and the server answers 304 when the file has not
REM  changed, so an unchanged night transfers nothing. Only the delta (5 MB) and any
REM  regenerated partition actually move.
REM ============================================================================

setlocal
set NAME=beavernest.taile871ab.ts.net
set PORT=8089
set BASE=http://%NAME%:%PORT%
set DEST=%~dp0
set CURL=curl.exe -fsS --retry 3 --retry-delay 2 --connect-timeout 10

REM Quick reachability gate: a dead Tailscale link should fail here, not silently
REM half-download a partition and leave a truncated CSV for the importer to eat.
ping -n 1 -w 2000 %NAME% >nul 2>&1
if errorlevel 1 exit /b 2

for %%F in (
  manifest.json
  delta_recent.csv
  delta_index.csv
  index_ihsg.csv
  global_all.csv
  global_close.csv
  banyulangit-close.format
  verify-global.vbs
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
  category_names.csv
  categories_sector.csv
  categories_industry.csv
  refresh.bat
  open-amibroker.bat
  setup-laptop.bat
  us_part01.csv us_part02.csv us_part03.csv us_part04.csv us_part05.csv
  idx_part01.csv idx_part02.csv idx_part03.csv idx_part04.csv
) do (
  REM Atomic replace: download to .tmp, then move over the target. Writing straight onto a file
  REM that Windows (or a script still executing) holds produces a truncated or stale copy that
  REM keeps executing as the previous version - which is exactly what happened during testing.
  %CURL% -o "%DEST%%%F.tmp" "%BASE%/%%F"
  if errorlevel 1 (
    echo WARN: %%F failed
  ) else (
    move /Y "%DEST%%%F.tmp" "%DEST%%%F" >nul 2>&1
    if errorlevel 1 (
      echo WARN: %%F could not be replaced - a process may be holding it
      del "%DEST%%%F.tmp" >nul 2>&1
    )
  )
  REM Small stagger between files. Without it several curl processes can hit the same file
  REM while AmiBroker is opening the folder, and Windows answers "being used by another
  REM process" - which looks like a failed download but is a sharing conflict.
  %SystemRoot%\System32\ping.exe -n 1 -w 60 127.0.0.1 >nul
)

exit /b 0
