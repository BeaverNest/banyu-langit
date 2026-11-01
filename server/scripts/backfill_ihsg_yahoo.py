#!/usr/bin/env python3
"""Backfill IHSG (^JKSE) daily OHLCV into Banyu Langit's index_ohlc table.

WHY THIS EXISTS
---------------
`index_ohlc` held 2,413 bars (2016-10-28 -> 2026-10-30) because
`server/scripts/backfill-index-ohlc.js` caps the Yahoo range at 10y for a good
reason: Yahoo SILENTLY DOWNGRADES THE RESOLUTION for long `range=` values.
Measured 2026-11-01 on ^JKSE:

    range=10y    -> 2,461 bars, median gap 1.00 day   (daily, correct)
    range=max    ->   439 bars, median gap 31.00 days (MONTHLY - must never be written)

The escape hatch is the `period1`/`period2` form, which returns FULL DAILY
history in one call:

    period1=1989-01-01, period2=today -> 9,217 bars, 1990-04-06 -> 2026-10-30,
                                         median gap 1.00 day

So this script pages backwards in 10-year windows in *period* form. Every
response is validated for resolution before anything is written, because the
failure mode (monthly bars stored as if daily) produces a chart that looks
plausible and is wrong for years.

SAFETY
------
- Writes only `index_ohlc` where index_code='COMPOSITE'. Never touches
  `idx_indices` (the exchange's own series) or any per-stock table.
- Upsert on (index_code, trade_date): re-running is harmless.
- Refuses to proceed when the median gap of an incoming window is not daily.
- Cross-checks overlapping closes against `index_chart` (the official rail) and
  fails loudly if they disagree by more than 1 point.

USAGE
-----
    python3 backfill_ihsg_yahoo.py            # write
    python3 backfill_ihsg_yahoo.py --dry-run  # report only

Runs on the HOST and talks to the container over `docker exec`, because the
container has no Python and the host has no copy of trading.db. It reaches
Yahoo through curl_cffi (chrome impersonation): plain urllib gets HTTP 429 from
this host, which is why the readiness probe reports Yahoo as BLOCKED.
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import subprocess
import sys
import tempfile
import os

CONTAINER = os.environ.get("BL_CONTAINER", "banyu-langit")
SYMBOL = "^JKSE"
INDEX_CODE = "COMPOSITE"
WINDOW_YEARS = 10
MAX_MEDIAN_GAP_DAYS = 5.0
EARLIEST = dt.date(1989, 1, 1)


def log(msg: str) -> None:
    print(f"[backfill-ihsg] {msg}", flush=True)


def fetch_period(p1: dt.date, p2: dt.date) -> list[dict]:
    """One Yahoo chart call in period form. Returns validated daily bars."""
    from curl_cffi import requests as cr  # imported late: clear error if missing

    t1 = int(dt.datetime(p1.year, p1.month, p1.day, tzinfo=dt.timezone.utc).timestamp())
    t2 = int(dt.datetime(p2.year, p2.month, p2.day, tzinfo=dt.timezone.utc).timestamp())
    url = (f"https://query1.finance.yahoo.com/v8/finance/chart/{SYMBOL.replace('^', '%5E')}"
           f"?interval=1d&period1={t1}&period2={t2}")
    r = cr.get(url, impersonate="chrome", timeout=60)
    r.raise_for_status()
    payload = r.json()
    result = (payload.get("chart") or {}).get("result") or []
    if not result:
        err = (payload.get("chart") or {}).get("error")
        raise RuntimeError(f"Yahoo returned no result: {err}")
    res = result[0]
    ts = res.get("timestamp") or []
    q = (res.get("indicators") or {}).get("quote") or [{}]
    q = q[0]
    if not ts:
        raise RuntimeError("Yahoo returned an empty timestamp array")

    rows: list[dict] = []
    dropped = 0
    for i, t in enumerate(ts):
        close = (q.get("close") or [None])[i]
        if close is None or not isinstance(close, (int, float)) or close <= 0:
            dropped += 1
            continue
        row = {
            "date": dt.datetime.fromtimestamp(t, dt.timezone.utc).date().isoformat(),
            "open": (q.get("open") or [None])[i],
            "high": (q.get("high") or [None])[i],
            "low": (q.get("low") or [None])[i],
            "close": close,
            "volume": (q.get("volume") or [None])[i] or 0,
        }
        for k in ("open", "high", "low"):
            if row[k] is None or not isinstance(row[k], (int, float)) or row[k] <= 0:
                row[k] = row["close"]  # Yahoo null on a live day: fall back, do not drop
        if (row["high"] < row["low"] or row["open"] > row["high"] + 0.01
                or row["open"] < row["low"] - 0.01 or row["close"] > row["high"] + 0.01
                or row["close"] < row["low"] - 0.01):
            dropped += 1
            continue
        rows.append(row)
    if dropped:
        log(f"  {p1}..{p2}: {dropped} bar dropped (bad OHLC shape)")
    return rows


def median_gap_days(rows: list[dict]) -> float:
    days = sorted(
        (dt.date.fromisoformat(rows[i]["date"]) - dt.date.fromisoformat(rows[i - 1]["date"])).days
        for i in range(1, len(rows))
    )
    return float(days[len(days) // 2]) if days else 0.0


def container_sql(sql: str) -> list[dict]:
    """Run a node/better-sqlite3 query inside the Banyu Langit container."""
    js = (
        "const D=require('better-sqlite3');"
        "const db=new D('/app/data/trading.db',{readonly:false});"
        f"const rows=db.prepare({json.dumps(sql)}).all();"
        "console.log(JSON.stringify(rows));"
    )
    with tempfile.NamedTemporaryFile("w", suffix=".js", delete=False) as fh:
        fh.write(js)
        tmp = fh.name
    try:
        subprocess.run(["docker", "cp", tmp, f"{CONTAINER}:/tmp/q.js"], check=True,
                       capture_output=True)
        out = subprocess.run(
            ["docker", "exec", "-e", "NODE_PATH=/app/node_modules", "-w", "/app",
             CONTAINER, "node", "/tmp/q.js"],
            check=True, capture_output=True, text=True).stdout
        return json.loads(out.strip() or "[]")
    finally:
        os.unlink(tmp)


def write_bars(rows: list[dict]) -> int:
    """Upsert bars through one generated node script (one transaction)."""
    payload = json.dumps(rows)
    js = f"""
const D=require('better-sqlite3');
const db=new D('/app/data/trading.db');
const rows=JSON.parse({json.dumps(payload)});
const up=db.prepare(`INSERT INTO index_ohlc
  (index_code, trade_date, open, high, low, close, volume, source)
  VALUES (?,?,?,?,?,?,?,'yahoo:^JKSE')
  ON CONFLICT(index_code, trade_date) DO UPDATE SET
    open=excluded.open, high=excluded.high, low=excluded.low,
    close=excluded.close, volume=excluded.volume,
    source=excluded.source, updated_at=datetime('now')`);
let n=0;
db.transaction(()=>{{
  for (const r of rows) {{ up.run('{INDEX_CODE}', r.date, r.open, r.high, r.low, r.close, r.volume); n++; }}
}})();
console.log(n);
"""
    fd, path = tempfile.mkstemp(suffix=".js")
    with os.fdopen(fd, "w") as fh:
        fh.write(js)
    try:
        subprocess.run(["docker", "cp", path, f"{CONTAINER}:/tmp/w.js"], check=True,
                       capture_output=True)
        out = subprocess.run(
            ["docker", "exec", "-e", "NODE_PATH=/app/node_modules", "-w", "/app",
             CONTAINER, "node", "/tmp/w.js"],
            check=True, capture_output=True, text=True).stdout
        return int(out.strip().splitlines()[-1])
    finally:
        os.unlink(path)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    today = dt.date.today()
    windows: list[tuple[dt.date, dt.date]] = []
    end = today + dt.timedelta(days=1)
    while end > EARLIEST:
        start = max(EARLIEST, end - dt.timedelta(days=365 * WINDOW_YEARS))
        windows.append((start, end))
        end = start
    windows.reverse()

    log(f"container={CONTAINER} symbol={SYMBOL} windows={len(windows)} "
        f"({windows[0][0]} -> {windows[-1][1]})")

    collected: dict[str, dict] = {}
    for i, (p1, p2) in enumerate(windows, 1):
        rows = fetch_period(p1, p2)
        gap = median_gap_days(rows)
        if not rows:
            log(f"  [{i}/{len(windows)}] {p1}..{p2}: 0 bars (pre-listing period, skipped)")
            continue
        log(f"  [{i}/{len(windows)}] {p1}..{p2}: {len(rows)} bars "
            f"({rows[0]['date']} -> {rows[-1]['date']}) median gap {gap:.2f}d")
        if gap > MAX_MEDIAN_GAP_DAYS:
            raise SystemExit(
                f"REFUSED: window {p1}..{p2} came back at {gap:.1f}-day spacing — "
                "Yahoo downgraded the resolution. Nothing written.")
        for r in rows:
            collected[r["date"]] = r

    bars = [collected[d] for d in sorted(collected)]
    log(f"merged distinct sessions: {len(bars)} ({bars[0]['date']} -> {bars[-1]['date']})")

    gap = median_gap_days(bars)
    if gap > MAX_MEDIAN_GAP_DAYS:
        raise SystemExit(f"REFUSED: merged series median gap {gap:.1f}d is not daily")

    years = (dt.date.fromisoformat(bars[-1]["date"])
             - dt.date.fromisoformat(bars[0]["date"])).days / 365.25
    log(f"span {years:.1f} years, {len(bars) / years:.0f} bars/year")

    if args.dry_run:
        log("--dry-run: nothing written")
        return 0

    n = write_bars(bars)
    log(f"upserted {n} bars")

    stat = container_sql(
        "SELECT COUNT(*) c, MIN(trade_date) a, MAX(trade_date) b, "
        f"COUNT(DISTINCT trade_date) d FROM index_ohlc WHERE index_code='{INDEX_CODE}'")[0]
    log(f"index_ohlc now: {stat['c']:,} rows / {stat['d']:,} sessions "
        f"({stat['a']} -> {stat['b']})")

    chk = container_sql(
        "SELECT COUNT(*) c, MAX(ABS(io.close - ic.value)) mx FROM index_ohlc io "
        "JOIN index_chart ic ON ic.index_code = io.index_code "
        "AND ic.chart_date = io.trade_date "
        f"WHERE io.index_code='{INDEX_CODE}'")[0]
    mx = chk["mx"]
    log(f"vs index_chart: overlap={chk['c']} max diff={'-' if mx is None else f'{mx:.4f}'} pts")
    if mx is not None and mx > 1:
        log("FAIL: close disagrees with the official rail by more than 1 point")
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
