# Stock Gateway — consumer contract

What a process on this machine may rely on, and what it may not. If a claim here is not matched by
an endpoint you can call, the document is wrong and should be fixed with the code.

## What the gateway is

One SQLite file (`trading.db`, 61 tables) that holds:

- IDX daily OHLCV per ticker, index levels, top movers, foreign flow
- exchange fundamentals, financial ratios, corporate actions, CA adjustment factors
- macro and commodity series pinned to a single declared source each (`custom_tickers.source`)
- ownership/insider data, BEI/KSEI filings

Writers are the ingest scripts and the upstream pullers. Readers are everything else. **No reader
should re-fetch from a vendor what this file already holds** — that is the point of the gateway, and
it is why a staleness signal exists per series.

## The three mounts, and why the difference matters

| Mount | Endpoints | Auth | Stability |
|---|---:|---|---|
| `/api/v1/idx/*` | 5 | **none, read-only by design** | the agent rail — treat as the stable read contract |
| `/api/v1/*` | 2 | `x-api-key` when `API_KEY` is set | thin, small |
| `/api/*` | 183 | **none** | unstable: changes with the bundled UI |

The 183 unauthenticated routes are not a public API. They exist because the bundled workbench
calls 108 distinct `/api/*` paths across 24 JS modules. Anything that can reach port `3003` can call
them, including the write paths (`POST /api/entries`, `POST /api/idx/custom/upsert`,
`POST /api/entries/<id>` delete). **Network reachability is the only control.**

## Read contract (recommended for agents)

```
GET /api/v1/idx/freshness   per-table as_of, lag, month-completeness, code_version
GET /api/v1/idx/series      series by code, with freshness context
GET /api/v1/idx/indicator   named indicator values
GET /api/v1/idx/scores      stored composite/factor scores
GET /api/v1/idx/            envelope index (what this rail exposes)
```

Every payload carries `code_version` so a caller can tie an answer to the build that produced it.
`freshness` is the honest way to answer "is this number current?" — do not infer freshness from
whether a value is non-null.

## Write contract (rails only)

```
POST /api/idx/custom/upsert   { code, name, category, source, ohlc_mode?, fill_missing?, rows[] }
POST /api/idx/custom/replace  same shape, for source migration only
POST /api/idx/custom/fetch-all  pulls Yahoo for every registered custom code
POST /api/idx/sync/import-all   IDX-API bridge bulk import
```

Rules that callers keep getting wrong:

- `source` pins the series to one writer. Change it only through `/custom/replace`, never by
  posting a different `source` into `/custom/upsert` — a mixed series has no marker and reads as
  one continuous lie.
- The upsert response reports rows **attempted**, not stored. Prove a write landed by re-reading the
  table, not by trusting `rows`.
- Bars on the same `(trade_date, code)` are **overwritten**. Re-pulling a pinned futures series
  rewrites history retroactively on roll. Rewrites are logged in `custom_ohlc_rewrites`.

## Staleness: three different failures, one signal each

| Question | Signal |
|---|---|
| Is our data current for this series? | `lag_sessions` vs `expected_lag_sessions` in `custom_tickers` |
| Did the puller run? | `custom_pull_log` rows for today (WIB), `check-rail-liveness.js` |
| Has the pipeline stopped entirely? | `ctx.pipeline` — `lag1` / `stopped` / `calendar_stale` |

Do not substitute one for another. A frozen frontier makes `lag_sessions=0` and looks healthy; that
is exactly the case `ctx.pipeline` exists to catch.

## What is NOT covered

- No OpenAPI/Swagger document. No versioned compatibility promise on `/api/*`.
- No rate limiting, no request auth on `/api/*`, no per-consumer audit trail.
- No headless mode: the gateway and the workbench are one process. You cannot run the gateway
  without the UI today.
- No push/streaming. Consumers poll.
- `estimated_cost`-style derived metrics are not gateway data; compute them at the consumer.

## If you need this to be a real gateway

The gap is concrete, not philosophical:

1. Move the 183 `/api/*` routes behind a versioned authenticated mount, and give the bundled UI a
   key at boot.
2. Write the OpenAPI document from the route table, and assert it in CI against the live routes.
3. Split the workbench into a separate deployable that consumes the gateway over HTTP.

Until all three are done, "gateway" describes the **data plane** honestly and the **API product**
only aspirationally. Keep the distinction in any README, CV, or pitch.
