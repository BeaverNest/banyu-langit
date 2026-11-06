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
set LOCK=%DEST%refresh.lock

REM ---- single-instance lock ------------------------------------------------
REM Two Import() calls against C:\BanyuLangit at the same time is not a clean
REM failure: the loser writes a partial dataset while still returning rc=0, and a
REM gate that only counts symbols will not notice. Measured 2026-11-01, when a
REM manual run collided with the scheduled one and the log carried
REM "The process cannot access the file because it is being used by another
REM process." The data happened to survive; that is luck, not design.
REM
REM A second launch now waits up to LOCK_WAIT seconds for the first to finish and
REM then gives up quietly with exit 4. Giving up is correct for the hourly task:
REM the next hour pulls again, and a skipped refresh is harmless while a collided
REM import is not.
if not exist "%LOCK%" goto lock_acquire

REM A lock left behind by a crash would stall every later refresh silently, so a
REM lock older than 30 minutes is treated as dead and removed. Anything younger is
REM a genuinely running import.
set LOCK_STATE=BUSY
for /f %%S in ('powershell -NoProfile -Command "if (((Get-Date) - (Get-Item '%LOCK%').LastWriteTime).TotalMinutes -gt 30) {'STALE'} else {'BUSY'}" 2^>nul') do set LOCK_STATE=%%S
if "%LOCK_STATE%"=="STALE" (
  echo ---- %DATE% %TIME% ---- STALE lock removed >> "%LOG%"
  del "%LOCK%" 2>nul
  goto lock_acquire
)

set /a LOCK_WAIT=0
:wait_lock
if not exist "%LOCK%" goto lock_acquire
ping -n 3 -w 1000 127.0.0.1 >nul 2>&1
set /a LOCK_WAIT+=2
if %LOCK_WAIT% LSS 300 goto wait_lock
echo ---- %DATE% %TIME% ---- SKIP: another refresh held the lock for %LOCK_WAIT%s >> "%LOG%"
exit /b 4

:lock_acquire
echo %DATE% %TIME% > "%LOCK%"

REM Tapis: without Tailscale there is nothing to pull, and the import below would run on
REM stale files while reporting success.
ping -n 1 -w 2000 beavernest.taile871ab.ts.net >nul 2>&1
if errorlevel 1 exit /b 3

REM ---- HOW MUCH TO PULL ----------------------------------------------------
REM pull.bat fetches everything the manifest declares as changed, and the exporter
REM rewrites every CSV on each publish - so an ordinary evening used to re-download
REM ~434 MB of part files to feed an import that read ~5 MB of delta. Measured
REM 2026-11-06: 1 h 31 min of transfer, none of the part files read by the import.
REM
REM needs-full.vbs answers "does this run need the 10-year snapshot" from files alone
REM (no OLE, so it works with AmiBroker closed) and answers FULL whenever it cannot
REM prove otherwise. A wrong FULL is slow; a wrong DELTA would be silently stale -
REM only the slow direction is allowed to be wrong.
set NEEDFULL=1
if not exist "%DEST%needs-full.vbs" goto :pull_choose
cscript //nologo "%DEST%needs-full.vbs" >> "%LOG%" 2>&1
set NEEDFULL=%ERRORLEVEL%

:pull_choose
if not "%NEEDFULL%"=="0" goto :pull_full
echo ---- delta-only pull ---- >> "%LOG%"
call "%DEST%pull.bat" quick
goto :pull_done

:pull_full
echo ---- full pull (needs-full rc=%NEEDFULL%) ---- >> "%LOG%"
call "%DEST%pull.bat"

:pull_done
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
REM Pass the folder explicitly: assign-categories.vbs defaults to "category_assign.csv"
REM relative to the CURRENT DIRECTORY, and the scheduled task starts in C:\Windows\system32.
REM It therefore printed "FAIL: cannot find category_assign.csv" on every scheduled run
REM while working fine from a hand-run in this folder - a failure that only exists in
REM the one context nobody watches.
cscript //nologo "%DEST%assign-categories.vbs" "%DEST%category_assign.csv" > "%DEST%cat-out.txt" 2>&1
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

REM ---- gate: the newest PUBLISHED session must be in the database ----------
REM Every gate below this point asks "did the file parse" or "does some value
REM exist". Neither catches the real failure: an import of an OLD delta returns
REM rc=0 and produces a green log. On 2026-11-02 that is exactly what happened -
REM the IDX delta stayed at 31 Oct, today's bars never landed, and this script
REM still exited 0. This gate compares the database against manifest.json.
echo ---- verify-freshness ---- >> "%LOG%"
cscript //nologo "%DEST%verify-freshness.vbs" "%DEST:~0,-1%" > "%DEST%vf-out.txt" 2>&1
set RC6=%ERRORLEVEL%
type "%DEST%vf-out.txt" >> "%LOG%"
type "%DEST%vf-out.txt"
if not "%RC6%"=="0" (
  echo FRESHNESS GATE FAILED >> "%LOG%"
  if "%RC%"=="0" set RC=%RC6%
)

REM ---- gate: prove the GLOBAL market actually holds bars ------------------
REM The import prints "ok" per FILE, not per BAR. A series can be added and still carry 0 in
REM Open/High/Low, and the log would look perfectly healthy. This reads the database back and
REM fails loudly instead of leaving a silent hole behind a green log line.
echo ---- verify-global ---- >> "%LOG%"
cscript //nologo "%DEST%verify-global.vbs" > "%DEST%vg-out.txt" 2>&1
set RC4=%ERRORLEVEL%
type "%DEST%vg-out.txt" >> "%LOG%"
REM Print to the console too. A gate whose result only ever lands in a log nobody opens is
REM indistinguishable from a gate that never ran.
findstr /C:"OK:" /C:"FAIL:" /C:"MISSING" "%DEST%vg-out.txt"
if not "%RC4%"=="0" (
  echo GLOBAL VERIFY FAILED >> "%LOG%"
  if "%RC%"=="0" set RC=%RC4%
)

REM ---- gate: prove the IDX foreign flow actually landed -------------------
REM Same reason as the global gate: Import() returning rc=0 only means the file parsed. A missing
REM AUX column produces a clean log and an empty column, which looks exactly like "no foreign
REM trading" on every chart. Read it back.
echo ---- verify-idx-aux ---- >> "%LOG%"
cscript //nologo "%DEST%verify-idx-aux.vbs" > "%DEST%va-out.txt" 2>&1
set RC5=%ERRORLEVEL%
type "%DEST%va-out.txt" >> "%LOG%"
findstr /C:"OK:" /C:"FAIL:" /C:"MISSING" "%DEST%va-out.txt"
if not "%RC5%"=="0" (
  echo IDX AUX VERIFY FAILED >> "%LOG%"
  if "%RC%"=="0" set RC=%RC5%
)

REM Keep the log bounded: this appends 24 times a day.
for %%A in ("%LOG%") do if %%~zA GTR 1048576 del "%LOG%"

REM Release the lock last, after the gates. Releasing before them would let a
REM waiting run start an import while this one is still reading back.
del "%LOCK%" 2>nul

exit /b %RC%
