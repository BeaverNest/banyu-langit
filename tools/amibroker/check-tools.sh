#!/usr/bin/env bash
# ============================================================================
#  Regression gate for the Windows-side scripts in tools/amibroker/.
#
#  Every check here encodes a bug that actually shipped and was reported by the owner:
#    - a 64-bit hardcoded Broker.exe path (his install is 32-bit)
#    - an hourly task that only downloaded and never imported
#    - "daily refresh" printed while the task was still hourly
#
#  Run before publishing: bash tools/amibroker/check-tools.sh
#  Exit 2 = regression present.
# ============================================================================
set -uo pipefail
cd "$(dirname "$0")"
fails=0
chk() { # chk <description> <condition-exit-code>
  if [ "$2" -ne 0 ]; then echo "FAIL: $1"; fails=$((fails+1)); else echo "ok   $1"; fi
}

# 1. The launcher must probe the 32-bit install FIRST. It may mention the 64-bit path as a
#    fallback candidate - that is correct; what must not happen is starting a literal path.
grep -qF 'for %%P in ("C:\Program Files (x86)\AmiBroker\Broker.exe" "C:\Program Files\AmiBroker\Broker.exe")' open-amibroker.bat
chk "open-amibroker.bat probes (x86) before 64-bit" $?

# 2. The launcher must start the exe it resolved, not a literal.
grep -q 'start "" "%ABEXE%"' open-amibroker.bat 2>/dev/null
chk "open-amibroker.bat starts the resolved path" $?

# 3. The scheduled task must be daily, and must target refresh.bat (which imports).
grep -q '/SC DAILY' setup-laptop.bat 2>/dev/null
chk "setup-laptop.bat registers a daily task" $?
grep -q '/TR "%DEST%\\refresh\.bat"' setup-laptop.bat 2>/dev/null
chk "setup-laptop.bat points the task at refresh.bat" $?
grep -q '/SC HOURLY' setup-laptop.bat 2>/dev/null
chk "setup-laptop.bat no longer registers an hourly task" $((!$?))

# 4. The label printed to the owner must match what was registered.
grep -q 'OK -^> daily at 20:00' setup-laptop.bat 2>/dev/null
chk "setup-laptop.bat reports 'daily at 20:00', not 'hourly'" $?

# 5. refresh-core.bat imports; refresh.bat is only the self-swapping launcher that calls it,
#    and pull.bat only downloads. An earlier version of this check looked inside refresh.bat
#    for the import, which stopped being true the moment the launcher/body split landed - it
#    then reported 4 permanent failures that nobody could act on, and a gate that is red for
#    a reason nobody fixes is a gate everybody ignores.
grep -q 'sync-amibroker.vbs' refresh-core.bat 2>/dev/null
chk "refresh-core.bat actually imports" $?
grep -q 'call "%DEST%refresh-core.bat"' refresh.bat 2>/dev/null
chk "refresh.bat calls refresh-core.bat" $?
# The filename may appear in pull.bat's download list; what must not appear is an invocation.
grep -q 'cscript.*sync-amibroker' pull.bat 2>/dev/null
chk "pull.bat does NOT import (single responsibility)" $((!$?))

# 6. Every file the laptop needs must be in the pull list, or it never arrives.
#    refresh.bat is the exception: it is the one file that is never pulled mid-run (it is the
#    swapper), so it is published but must simply exist in the repo set.
for f in open-amibroker.bat setup-laptop.bat verify-persist.vbs sync-amibroker.vbs import.bat needs-full.vbs; do
  grep -q "  $f" pull.bat 2>/dev/null
  chk "pull.bat ships $f" $?
done
[ -f refresh.bat ]
chk "refresh.bat exists in the published set" $?

# 7. The setup must identify itself, so a stale copy on the laptop is visible at a glance.
grep -q 'build %BUILD%' setup-laptop.bat 2>/dev/null
chk "setup-laptop.bat prints a build stamp" $?


# 8. Category files must ship: a market/group pass cannot run without them.
for f in category_assign.csv category_names.csv categories_sector.csv categories_industry.csv \
         banyulangit-sector.format banyulangit-industry.format; do
  grep -q "  $f" pull.bat 2>/dev/null
  chk "pull.bat ships $f" $?
done

# 9. The category formats must NOT auto-add symbols: a typo would invent empty tickers, and
# they must overwrite, because every symbol already exists from the quote import.
for f in banyulangit-sector.format banyulangit-industry.format; do
  grep -q '^\$AUTOADD 0' "$f" 2>/dev/null
  chk "$f keeps AUTOADD 0" $?
  grep -q '^\$OVERWRITE 1' "$f" 2>/dev/null
  chk "$f keeps OVERWRITE 1" $?
done

# 10. Categories must be imported AFTER the quotes, or $OVERWRITE has nothing to overwrite.
qt=$(grep -n 'index_ihsg.csv' sync-amibroker.vbs | head -1 | cut -d: -f1)
ct=$(grep -n 'categories_sector.csv' sync-amibroker.vbs | head -1 | cut -d: -f1)
if [ -n "$qt" ] && [ -n "$ct" ] && [ "$ct" -gt "$qt" ]; then
  chk "categories import after the quote files" 0
else
  chk "categories import after the quote files" 1
fi

# 11. Sector/industry must go in by NAME. MARKET/GROUP take an ID and silently discard a name -
# that is the bug that made the first attempt report rc=0 and change nothing.
grep -q '^\$FORMAT Ticker,SectorName' banyulangit-sector.format 2>/dev/null
chk "sector format uses SectorName" $?
grep -q '^\$FORMAT Ticker,SectorName,IndustryName' banyulangit-industry.format 2>/dev/null
chk "industry format carries its sector" $?

# 12. Group IDs are ONE namespace across markets. Numbering US and IDX both from 1 makes the
# second name write land on the first - the exact bug found before shipping.
grep -q 'let gNext = 1' ../../server/scripts/export-amibroker.js 2>/dev/null
chk "group IDs allocated from one counter" $?
grep -q "gIndex\['US:' + g\] = gNext++" ../../server/scripts/export-amibroker.js 2>/dev/null
chk "US groups numbered from the shared counter" $?

# 13. The assigner must verify from disk, not from the live instance: a memory-only count is
# what made an earlier persistence check lie.
grep -q 'LoadDatabase(DB_PATH)' assign-categories.vbs 2>/dev/null
chk "assigner reloads from disk before counting" $?


# 14. The assigner must run AFTER the import: it assigns symbols, and the quote import is what
# creates them. Running it first would find an empty database and assign nothing.
for f in import.bat refresh-core.bat; do
  si=$(grep -n 'sync-amibroker.vbs' "$f" | head -1 | cut -d: -f1)
  ai=$(grep -n 'assign-categories.vbs' "$f" | head -1 | cut -d: -f1)
  if [ -n "$si" ] && [ -n "$ai" ] && [ "$ai" -gt "$si" ]; then
    chk "$f assigns categories after the import" 0
  else
    chk "$f assigns categories after the import" 1
  fi
done


# 15. CSV line endings. Windows cscript reads a lone \n file unreliably and can report stale
# content, so the published copies must be CRLF. This bit during verification: a correct file
# downloaded from the server was still executed as the previous version.
for f in assign-categories.vbs sync-amibroker.vbs verify-persist.vbs; do
  if grep -q $'\r' "$f" 2>/dev/null; then
    chk "$f uses CRLF" 0
  else
    chk "$f uses CRLF (run unix2dos)" 1
  fi
done

# 16. No dead references: pull.bat must not ship files that no longer exist upstream.
for f in $(grep -oE '^  [a-zA-Z0-9_.-]+\.(csv|vbs|bat|format|abb|json)$' pull.bat | tr -d ' '); do
  if [ ! -f "$f" ] && ! docker exec -w /app banyu-langit test -f "/app/data/export/$f" 2>/dev/null; then
    chk "pull.bat ships an existing file: $f" 1
  fi
done
chk "pull.bat has no dead references" $?


# 17. VBScript: a Dim inside a loop body re-executes and, under Option Explicit, aborts with
# "Variable is undefined". It cost a saved-then-failed run. Every Dim must sit at column 0 of
# its scope, before the loop that uses it.
bad=$(awk '/^ *(For|Do|While)\b/{depth++} /^ *Next\b|^ *Loop\b/{if(depth>0)depth--} /^ *Dim /{if(depth>0) print FILENAME":"FNR}' *.vbs 2>/dev/null)
if [ -z "$bad" ]; then
  chk "no Dim inside a loop in any .vbs" 0
else
  echo "  $bad"
  chk "no Dim inside a loop in any .vbs" 1
fi


# 18. The GLOBAL block must never overwrite an equity. Renaming is allowed, dropping is not:
# 'CORN' is both a US ticker and the agricultural contract, and refusing to export the contract
# would be a silent data loss.
grep -q "US_NAMES" ../../server/scripts/export-amibroker.js 2>/dev/null
chk "global block checks US name collisions" $?
grep -q "name = 'Us' + t.code" ../../server/scripts/export-amibroker.js 2>/dev/null
chk "colliding global series is renamed, not dropped" $?

# 19. Global series have their own floor: macro is monthly releases, so requiring 60 bars would
# empty the category, and padding it to look daily would put a fiction in the database.
grep -q "global-min-bars" ../../server/scripts/export-amibroker.js 2>/dev/null
chk "global has its own min-bars floor" $?


# 20. Symbol information must ship and must actually overwrite. $AUTOADD alone changes nothing
# because all 2,464 symbols already exist; $NOQUOTES is required because the file carries no
# price or date. Both wrong == silent rc=0 and an empty FullName column.
grep -q "symbol_info.csv" tools/amibroker/pull.bat 2>/dev/null || grep -q "symbol_info.csv" pull.bat 2>/dev/null
chk "pull ships symbol_info.csv" $?
grep -q '\$NOQUOTES 1' tools/amibroker/banyulangit-symbolinfo.format 2>/dev/null || grep -q '\$NOQUOTES 1' banyulangit-symbolinfo.format 2>/dev/null
chk "symbolinfo format uses NOQUOTES" $?
grep -q '\$OVERWRITE 1' tools/amibroker/banyulangit-symbolinfo.format 2>/dev/null || grep -q '\$OVERWRITE 1' banyulangit-symbolinfo.format 2>/dev/null
chk "symbolinfo format uses OVERWRITE" $?

# 21. Fundamental fields must NOT be imported while idx_fundamental holds 0 in those columns.
# 0 is a missing value, not a ratio; PER 0.00 in AmiBroker reads as "free".
if grep -q "PRICE_TO_EARNINGS\|BOOK_VALUE\|MARKET_CAP" tools/amibroker/banyulangit-symbolinfo.format 2>/dev/null; then
  echo "FAIL: symbolinfo format imports fundamental fields that are 0 in the database"
  fails=$((fails + 1))
else
  echo "ok   symbolinfo format leaves empty fundamentals out"
fi

if [ "$fails" -ne 0 ]; then
  echo "$fails regression(s)"
  exit 2
fi

# --- IDX foreign flow (AUX1/AUX2) ---
# NOTE: chk() takes an EXIT CODE, so every test is written as a command, never as a
# "$( ... && echo 0 || echo 1)" substitution. The substitution form runs inside a subshell and
# chk's numeric compare then reads the string, which is always nonzero -> always "ok". The first
# version of this block used it and reported a clean pass on a deliberately broken format.
chk "idx-aux format exists" $([ -f banyulangit-idx-aux.format ]; echo $?)
chk "idx-aux gate exists" $([ -f verify-idx-aux.vbs ]; echo $?)
chk "idx-aux format keeps 9-column order" $(grep -q '^\$FORMAT Ticker,Date_YMD,Open,High,Low,Close,Volume,AUX1,AUX2' banyulangit-idx-aux.format; echo $?)
# AmiBroker 6.30 ACCEPTS Frequency and Turnover in $FORMAT and then discards them, shifting AUX1
# into the Frequency slot (measured: OpenInt came back 0, AUX1 held the frequency). Leaving them
# in the format moves every foreign-flow value one column left with no error at all.
chk "idx-aux format avoids Frequency/Turnover" $(! grep -q '^\$FORMAT.*\(Frequency\|Turnover\)' banyulangit-idx-aux.format; echo $?)
chk "pull ships delta_idx_aux.csv" $(grep -q 'delta_idx_aux.csv' pull.bat; echo $?)
chk "pull ships idx-aux format" $(grep -q 'banyulangit-idx-aux.format' pull.bat; echo $?)
chk "pull ships idx-aux gate" $(grep -q 'verify-idx-aux.vbs' pull.bat; echo $?)
chk "refresh-core runs idx-aux gate" $(grep -q 'verify-idx-aux.vbs' refresh-core.bat; echo $?)
chk "sync imports IDX parts with AUX format" $(grep -q 'ImportOne(p, fmtAux)' sync-amibroker.vbs; echo $?)
chk "sync defines fmtAux" $(grep -q 'fmtAux = FMT_DIR' sync-amibroker.vbs; echo $?)

# --- Pull economy: delta-only vs full snapshot (2026-11-06) -------------------
# The launcher used to re-download ~434 MB of part files on every click so that a delta import
# could read ~5 MB of them. These checks keep the two-mode pull honest and, more importantly,
# keep the advisor's fail-safe direction intact: unknown must mean FULL, never DELTA.
chk "pull.bat accepts a quick mode" $(grep -q 'if /I "%~1"=="quick" set MODE=quick' pull.bat; echo $?)
chk "pull.bat skips the snapshot in quick mode" $(grep -q 'if /I "%MODE%"=="quick" goto parts_skipped' pull.bat; echo $?)
chk "quick mode verifies only what it fetched" $(grep -q 'verify-pull.vbs" "%DEST:~0,-1%" quick' pull.bat; echo $?)
chk "verify-pull.vbs implements quick mode" $(grep -q 'IsPartFile' verify-pull.vbs; echo $?)
chk "refresh-core consults the advisor before pulling" $(grep -q 'needs-full.vbs' refresh-core.bat; echo $?)
chk "refresh-core defaults to a full pull when the advisor is missing" $(grep -q 'if not exist "%DEST%needs-full.vbs" goto :pull_choose' refresh-core.bat; echo $?)
chk "advisor answers unknown with a full pull" $(grep -q 'WScript.Quit 2' needs-full.vbs; echo $?)
# The advisor PREDICTS the rule sync applies. If the constants diverge it confidently answers for
# a rule the importer does not use, which is worse than having no advisor at all.
s=$(grep -oE 'FULL_REIMPORT_DAYS = [0-9]+' sync-amibroker.vbs | grep -oE '[0-9]+$' | head -1)
n=$(grep -oE 'FULL_REIMPORT_DAYS = [0-9]+' needs-full.vbs | grep -oE '[0-9]+$' | head -1)
[ -n "$s" ] && [ "$s" = "$n" ]
chk "advisor mirrors sync's FULL_REIMPORT_DAYS (${s:-?} vs ${n:-?})" $?
chk "freshness gate leaves a verdict for the advisor" $(grep -q 'last_import_ok.txt' verify-freshness.vbs; echo $?)
chk "gate records a FAILED verdict so the next run takes the snapshot" $(grep -q 'WriteState DIR, "failed"' verify-freshness.vbs; echo $?)
chk "launcher runs the cycle through refresh.bat (lock + gates)" $(grep -q 'call "%DEST%refresh.bat"' open-amibroker.bat; echo $?)
if grep -q $'\r' needs-full.vbs 2>/dev/null; then
  chk "needs-full.vbs uses CRLF" 0
else
  chk "needs-full.vbs uses CRLF (run unix2dos)" 1
fi

# The exit status IS the gate. Earlier this script printed "all tool checks pass" unconditionally
# and never called exit, so a run with FAIL lines still returned 0 and every caller believed it.
# A gate that cannot fail is worse than no gate - the same defect as verify-global.vbs, which
# printed FAIL and returned 0 for weeks.
if [ "$fails" -ne 0 ]; then
  echo "GATE FAILED: $fails check(s) red"
  exit 2
fi
echo "all tool checks pass"
