# Database Backups (cPanel)

Automated **daily** MySQL backups for `baripknex`: a gzipped `mysqldump` kept in a
non-public folder (newest 7 retained), plus optional **dated snapshot databases**
for instant same-server rollback.

- Runs via a **cPanel Cron Job** (independent of the Node app, which Passenger may idle).
- Uses `mysqldump` + `gzip` + bash — no Rust/native engine like Prisma.
- Credentials live in `~/.my.cnf` (never on the command line).

> ⚠️ **Scope:** server-only backups protect against bad data and accidental
> deletes, **not** against losing the server/account. Treat copying a recent dump
> offsite as the next upgrade (see *Follow-up* below).

---

## One-time setup

### 1. Create the MySQL credentials file `~/.my.cnf`

In **cPanel → File Manager**, go to your home directory, enable *Show Hidden Files
(dotfiles)*, and create `.my.cnf` with:

```ini
[client]
user=CPUSER_dbuser
password=YOUR_DB_PASSWORD
host=localhost
```

Use the **cPanel-prefixed** DB username (e.g. `cpuser_barip`) and its password
(cPanel → *MySQL Databases*). Then set permissions to **600**
(File Manager → right-click → *Change Permissions* → `0600`), so only your account
can read it.

### 2. Configure the script

```bash
cp scripts/backup.env.example scripts/backup.env
```

Edit `scripts/backup.env`:
- `DB_NAME` — your real (prefixed) DB name, e.g. `cpuser_baripknex`.
- `BACKUP_DIR` — keep the default `$HOME/db-backups` (it is **outside** `public_html`).
- Leave `BACKUP_SNAPSHOT_DB=0` for now (enable later — step 5).
- If cron can't find the tools, set `MYSQLDUMP_BIN` / `MYSQL_BIN` to full paths.

`backup.env` is gitignored.

### 3. Confirm the tools exist

In **cPanel → Terminal** (or run a one-off cron and read the output):

```bash
which mysqldump mysql gzip flock
```

Note the `mysqldump` / `mysql` paths; put them in `backup.env` if they aren't on
the cron PATH. (`mysqldump` is what cPanel itself uses for backups, so it is
almost always present. If it genuinely isn't, ask for the pure-Node fallback
dumper.)

### 4. Add the cPanel Cron Job

**cPanel → Cron Jobs**, add a job running daily (e.g. 03:15). Replace
`<app-path>` with the directory holding this repo (e.g. `barip-knex` or
`repositories/barip-knex`):

```
15 3 * * *  /bin/bash $HOME/<app-path>/scripts/backup-db.sh >> $HOME/db-backups/cron.out 2>&1
```

The script is quiet on success, so cPanel will only email you when a run fails.

---

## 5. (Optional) Dated snapshot databases — use the spare DB quota

You have ~800 DBs available and use 1. The script can keep dated copies like
`baripknex_bak_20260611` for one-command rollback.

**Requirement:** the MySQL user in `~/.my.cnf` must be able to
`CREATE DATABASE` / `DROP DATABASE`. On many shared cPanel plans the per-DB user
**cannot**. Test it:

```bash
mysql --defaults-extra-file=$HOME/.my.cnf -e "CREATE DATABASE testpriv_xyz; DROP DATABASE testpriv_xyz;"
```

- **No error** → you have the privilege. In `backup.env` set `BACKUP_SNAPSHOT_DB=1`
  and `DB_SNAPSHOT_PREFIX=<your_db>_bak_`, `SNAPSHOT_KEEP=7`.
- **Access denied** → leave `BACKUP_SNAPSHOT_DB=0`. (If you want snapshots anyway,
  they'd have to be created through the cPanel MySQL API / UI, which isn't
  practical for daily dated names — stick with the file dumps.)

If enabled but the privilege is missing at runtime, the script logs
`snapshot skipped: no CREATE privilege` and the **file dump still succeeds**.

> Snapshot DBs live on the **same server** — they're for fast rollback, not
> disaster recovery.

---

## Restoring

**From a file dump** (into the live DB or a scratch DB):

```bash
bash scripts/restore-db.sh $HOME/db-backups/baripknex_20260611_031500.sql.gz
# or into a different DB:
bash scripts/restore-db.sh <file.sql.gz> some_scratch_db
```

It prompts before overwriting a non-empty database.

**From a snapshot DB:** either point the app's `DB_NAME` at the snapshot
temporarily, or copy it back over the main DB:

```bash
mysqldump --defaults-extra-file=$HOME/.my.cnf baripknex_bak_20260611 \
  | mysql --defaults-extra-file=$HOME/.my.cnf baripknex
```

---

## Verifying it works

1. Run once by hand: `bash scripts/backup-db.sh`, then check
   `~/db-backups/` for a non-empty `*.sql.gz` and a line in `~/db-backups/backup.log`.
2. Integrity: `gunzip -t <file>.sql.gz` and `gunzip -c <file>.sql.gz | head`
   (should show real `CREATE TABLE` / `INSERT` SQL).
3. Restore into a scratch DB and compare row counts on key tables
   (`user`, `rent_payment`, `auditlog`).
4. Rotation: temporarily set `KEEP_DAILY=2`, run 3×, confirm only 2 remain.
5. Security: try opening the backup file over HTTP — it must **not** be reachable.

---

## Follow-up (not built yet) — real disaster recovery

Server-only backups die with the server. When ready, add an offsite copy of the
newest dump after each run — e.g. push to remote FTP / cloud storage, or
(if dumps are small) email the gzip. Also consider weekly/monthly retention tiers.
