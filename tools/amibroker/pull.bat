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
  banyulangit-categories.format
  banyulangit-sector.format
  banyulangit-industry.format
  categories_idx.csv
  categories_us.csv
  banyulangit.format
  import-all.abb
  import.bat
  sync-amibroker.vbs
  verify-persist.vbs
  assign-categories.vbs
  diag-categories.vbs
  diag-categories2.vbs
  diag-categories3.vbs
  diag-categories4.vbs
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
  %CURL% -o "%DEST%%%F" -z "%DEST%%%F" "%BASE%/%%F"
  if errorlevel 1 echo WARN: %%F failed
)

exit /b 0
