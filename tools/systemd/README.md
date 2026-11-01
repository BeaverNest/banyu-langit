# Scheduled jobs (systemd --user)

These units are the *source of truth* for the scheduler; the copies under
`~/.config/systemd/user/` are what actually runs. Keeping them here means a
rebuilt machine can restore the schedule instead of remembering it.

```bash
cp tools/systemd/banyu-backfill.* ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now banyu-backfill.timer
systemctl --user list-timers banyu-backfill.timer
```

## What runs when

| unit | schedule (WIB) | does |
|---|---|---|
| `banyu-backfill.service` | Sat 04:30 (timer) | `server/scripts/backfill.sh ihsg` then `idx` |

The IDX-API monthly sync is a separate unit (`idx-api-sync-month.timer`, 19:04
daily, owned by that repo). Both take the same `/tmp/banyu-data-write.lock`, so
the two cannot interleave — that lock is the thing to preserve if you rewrite
either job.

`Persistent=true` on the timer means a machine that was off at 04:30 runs the
job at the next boot instead of silently skipping a week.
