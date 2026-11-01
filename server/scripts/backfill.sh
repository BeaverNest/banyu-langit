#!/usr/bin/env bash
# One entry point for every job that writes market data into trading.db.
#
# WHY THIS EXISTS
# ---------------
# Three things write the same database on overlapping schedules: the IDX-API
# monthly sync (systemd timer, 19:04 WIB), the Yahoo backfills, and the AmiBroker
# export that reads the result. Each one had its own lock or no lock at all, so
# the real failure mode was not corruption but a half-written night: the export
# ran mid-sync, shipped a partial IDX file, and the import gate on the laptop
# accepted it because every individual row was valid.
#
# So there is ONE lock, /tmp/banyu-data-write.lock, and every writer takes it:
# this script, and IDX-API/scripts/daily-sync.sh. A second job waits, then skips.
#
# USAGE
#   ./backfill.sh ihsg            # ^JKSE daily OHLCV, 1990 -> today
#   ./backfill.sh idx             # pre-2020 IDX stock OHLCV
#   ./backfill.sh verify          # gates only, no writes
#   ./backfill.sh any --dry-run   # pass-through flags to the python job
#
# Exit codes: 0 ok/skipped, 1 job failed, 4 another writer holds the lock.
set -uo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
LOG="$DIR/data/backfill.log"
LOCK="/tmp/banyu-data-write.lock"
WAIT="${BACKFILL_WAIT:-0}"

# The backfills reach Yahoo through curl_cffi (chrome impersonation); bare
# urllib gets HTTP 429 from this host. That module lives in the yfinance venv,
# not in system python3 -- running the job with plain `python3` fails at import
# with ModuleNotFoundError, which looks like "Yahoo is down" in the log.
PY="${BACKFILL_PYTHON:-/home/beavernest/yfinance-mcp/.venv/bin/python}"
if [ ! -x "$PY" ]; then
  echo "missing interpreter: $PY (set BACKFILL_PYTHON)" | tee -a "$LOG"
  exit 1
fi

mkdir -p "$DIR/data"
exec 9>"$LOCK"
if ! flock -n 9; then
  if [ "$WAIT" -gt 0 ]; then
    echo "[$(date '+%F %T %Z')] waiting up to ${WAIT}s for $LOCK" | tee -a "$LOG"
    if ! flock -w "$WAIT" 9; then
      echo "[$(date '+%F %T %Z')] SKIP: another data writer held the lock for ${WAIT}s" | tee -a "$LOG"
      exit 4
    fi
  else
    echo "[$(date '+%F %T %Z')] SKIP: another data writer holds $LOCK" | tee -a "$LOG"
    exit 4
  fi
fi

job="${1:-}"
shift || true

case "$job" in
  ihsg) script="$DIR/server/scripts/backfill_ihsg_yahoo.py" ;;
  idx)  script="$DIR/server/scripts/backfill_idx_stocks_yahoo.py" ;;
  verify) script="" ;;
  ""|-h|--help)
    sed -n '2,25p' "$0"
    exit 0
    ;;
  *)
    echo "unknown job: $job (ihsg | idx | verify)" >&2
    exit 1
    ;;
esac

stamp="[$(date '+%F %T %Z')] start $job $*"
echo "$stamp" | tee -a "$LOG"

if [ -z "$script" ]; then
  # Gates are read-only but still run under the lock: a report produced while a
  # write is in flight describes a database that no longer exists.
  cd "$DIR" && docker exec -e NODE_PATH=/app/node_modules -w /app banyu-langit \
    node server/scripts/verify-export.js "$@" 2>&1 | tee -a "$LOG"
  rc=${PIPESTATUS[0]}
else
  if [ ! -f "$script" ]; then
    echo "missing: $script" | tee -a "$LOG"; exit 1
  fi
  "$PY" "$script" "$@" 2>&1 | tee -a "$LOG"
  rc=${PIPESTATUS[0]}
fi

# A crashed job leaves the database short; say so in the log rather than only in
# the process exit code that nobody reads.
if [ "$rc" -eq 0 ]; then
  echo "[$(date '+%F %T %Z')] ok $job" | tee -a "$LOG"
else
  echo "[$(date '+%F %T %Z')] FAILED $job rc=$rc" | tee -a "$LOG"
fi
exit "$rc"
