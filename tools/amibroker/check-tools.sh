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

# 5. refresh.bat imports; pull.bat only downloads.
grep -q 'sync-amibroker.vbs' refresh.bat 2>/dev/null
chk "refresh.bat actually imports" $?
# The filename may appear in pull.bat's download list; what must not appear is an invocation.
grep -q 'cscript' pull.bat 2>/dev/null
chk "pull.bat does NOT import (single responsibility)" $((!$?))

# 6. Every file the laptop needs must be in the pull list, or it never arrives.
for f in refresh.bat open-amibroker.bat verify-persist.vbs sync-amibroker.vbs import.bat; do
  grep -q "  $f" pull.bat 2>/dev/null
  chk "pull.bat ships $f" $?
done

if [ "$fails" -ne 0 ]; then
  echo "$fails regression(s)"
  exit 2
fi
echo "all tool checks pass"
