# Email Queue (cPanel cron drainer)

Emails are delivered through a **durable outbox**, the same pattern as Laravel's
`jobs` table + `queue:work`:

1. The web app (`src/services/email.service.js`) only **INSERTs a row** into the
   `email_outbox` table and returns immediately. No SMTP, no PDF work, no worker
   threads in the web process.
2. A **cPanel Cron Job** runs `scripts/process-email-queue.js` every minute. It
   claims pending rows, sends them via SMTP, saves rent-receipt PDFs, writes
   `emaillog`, then **exits** (cron is the scheduler; the script never loops forever).

Why: queued mail now survives Passenger restarts (the old in-memory queue lost
everything on restart), and SMTP latency/failures can never slow or crash a request.

---

## One-time setup

### 1. Run the migration

The `email_outbox` table ships as a Prisma migration
(`prisma/migrations/20260705000000_email_outbox/`). On the server:

```bash
cd $HOME/admin.bariporichalona.com
npm run prod:migrate     # prisma migrate deploy
```

### 2. Find your Node binary

cPanel's *Setup Node.js App* installs Node in a virtualenv:

```bash
ls ~/nodevenv/admin.bariporichalona.com/
# e.g. -> 20
# binary: ~/nodevenv/admin.bariporichalona.com/20/bin/node
```

### 3. Add the cron job

**cPanel → Cron Jobs**, every minute (`* * * * *`):

```
* * * * * cd $HOME/admin.bariporichalona.com && flock -n /tmp/barip-email.lock $HOME/nodevenv/admin.bariporichalona.com/20/bin/node scripts/process-email-queue.js >> $HOME/logs/email-queue.log 2>&1
```

Notes:
- `flock -n` skips a run if the previous one is still going (belt-and-suspenders —
  the SQL claim already prevents double-sends even without it).
- The script reads the same `.env` as the app (repo root), so SMTP/DB config stays in one place.
- Create `$HOME/logs/` once (`mkdir -p ~/logs`).
- Every-minute is fine: when there's nothing to send the run is one indexed
  SELECT/UPDATE and exits in ~1s. If you prefer, `*/2 * * * *` halves the runs
  at the cost of up to 2 min email latency.

---

## How it behaves

- **Batch:** up to 25 rows per run (`EMAIL_BATCH_SIZE`).
- **Retries:** failed sends retry after 1 → 5 → 15 min (max 3 attempts,
  `EMAIL_MAX_ATTEMPTS`), then the row is marked `failed` and logged to `emaillog`.
- **Crash-safety:** rows stuck in `processing` for >15 min (`EMAIL_STUCK_MINUTES`)
  are reclaimed to `pending` on the next run.
- **Space:** attachment payloads are cleared from the row once delivered.
- **Monitoring:** `GET /admin/system-settings/email-stats` now reports live DB
  counts by status (`pending` / `processing` / `sent` / `failed`).

## Verifying it works

1. Trigger any email in the app (e.g. password reset) → row appears:
   `SELECT id, to_email, status FROM email_outbox ORDER BY id DESC LIMIT 5;`
2. Run the drainer by hand:
   `node scripts/process-email-queue.js` → logs `processed=1 sent=1 failed=0`,
   row flips to `sent`, a row lands in `emaillog`, and the mail arrives.
3. Kill test: stop MySQL access or use a bad SMTP password → row goes back to
   `pending` with `next_attempt_at` set; after 3 attempts it's `failed` with the
   error in `last_error`.

## Housekeeping (optional, add later)

Sent rows are kept for audit. To prune old ones, add to the daily cleanup cron:

```sql
DELETE FROM email_outbox WHERE status='sent' AND sent_at < NOW() - INTERVAL 30 DAY;
```
