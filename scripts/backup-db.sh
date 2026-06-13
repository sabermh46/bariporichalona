#!/bin/bash
#
# backup-db.sh — daily MySQL backup for the bari-porichalona app on cPanel.
#
# Produces a gzipped mysqldump (.sql.gz) in a NON-PUBLIC folder, rotates to keep
# the newest N, and optionally maintains dated snapshot databases for instant
# same-server rollback. Designed to be run by a cPanel Cron Job (not the Node
# app), so it works even when Passenger has idled the app.
#
# Credentials are read from a MySQL defaults file (~/.my.cnf, chmod 600) so the
# password never appears on the command line / process list.
#
# Config: edit scripts/backup.env (copy from backup.env.example) OR pass via the
# cron environment. All values have safe defaults.
#
# See scripts/README-backup.md for the one-time cPanel setup.

set -euo pipefail

# --- Load optional config file (sourced if present) -------------------------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [ -f "${SCRIPT_DIR}/backup.env" ]; then
  # shellcheck disable=SC1091
  . "${SCRIPT_DIR}/backup.env"
fi

# --- Configuration (env-overridable) ----------------------------------------
DB_NAME="${DB_NAME:-baripknex}"
DB_HOST="${DB_HOST:-localhost}"
MYSQL_DEFAULTS_FILE="${MYSQL_DEFAULTS_FILE:-$HOME/.my.cnf}"
BACKUP_DIR="${BACKUP_DIR:-$HOME/db-backups}"
KEEP_DAILY="${KEEP_DAILY:-7}"

BACKUP_SNAPSHOT_DB="${BACKUP_SNAPSHOT_DB:-0}"
DB_SNAPSHOT_PREFIX="${DB_SNAPSHOT_PREFIX:-${DB_NAME}_bak_}"
SNAPSHOT_KEEP="${SNAPSHOT_KEEP:-7}"

MYSQLDUMP_BIN="${MYSQLDUMP_BIN:-mysqldump}"
MYSQL_BIN="${MYSQL_BIN:-mysql}"

# --- Helpers ----------------------------------------------------------------
log() {
  # Append a timestamped line to the rolling log; also echo for cron capture.
  local msg="$1"
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] ${msg}" >> "${BACKUP_DIR}/backup.log"
}
die() {
  # Errors go to stderr so cPanel cron emails them to the account.
  echo "ERROR: $1" >&2
  log "ERROR: $1"
  exit 1
}

mysql_cmd() {
  # Run a SQL statement against the server (no specific DB) using the creds file.
  "${MYSQL_BIN}" --defaults-extra-file="${MYSQL_DEFAULTS_FILE}" -h "${DB_HOST}" -N -e "$1"
}

# --- Preflight --------------------------------------------------------------
mkdir -p "${BACKUP_DIR}"
[ -f "${MYSQL_DEFAULTS_FILE}" ] || die "MySQL defaults file not found: ${MYSQL_DEFAULTS_FILE} (see README-backup.md)"
command -v "${MYSQLDUMP_BIN}" >/dev/null 2>&1 || die "mysqldump not found (set MYSQLDUMP_BIN to its full path)"

# --- Single-instance lock (avoid overlapping runs) --------------------------
LOCK_FILE="${BACKUP_DIR}/.backup.lock"
exec 9>"${LOCK_FILE}"
if command -v flock >/dev/null 2>&1; then
  flock -n 9 || die "another backup run is in progress (lock held: ${LOCK_FILE})"
fi

TS="$(date +%Y%m%d_%H%M%S)"
OUT_FILE="${BACKUP_DIR}/${DB_NAME}_${TS}.sql.gz"

# --- 1) File dump -----------------------------------------------------------
# --single-transaction: consistent snapshot without locking (InnoDB).
# PIPESTATUS check ensures a mysqldump failure isn't masked by a successful gzip.
set +e
"${MYSQLDUMP_BIN}" --defaults-extra-file="${MYSQL_DEFAULTS_FILE}" -h "${DB_HOST}" \
  --single-transaction --quick --routines --triggers --events \
  "${DB_NAME}" | gzip > "${OUT_FILE}"
DUMP_STATUS=${PIPESTATUS[0]}
GZIP_STATUS=${PIPESTATUS[1]}
set -e

if [ "${DUMP_STATUS}" -ne 0 ] || [ "${GZIP_STATUS}" -ne 0 ]; then
  rm -f "${OUT_FILE}"
  die "mysqldump/gzip failed (mysqldump=${DUMP_STATUS}, gzip=${GZIP_STATUS}) for DB '${DB_NAME}'"
fi
if [ ! -s "${OUT_FILE}" ]; then
  rm -f "${OUT_FILE}"
  die "backup file is empty: ${OUT_FILE}"
fi

FILE_SIZE="$(du -h "${OUT_FILE}" | cut -f1)"

# --- 2) Rotate file dumps (keep newest KEEP_DAILY) --------------------------
# shellcheck disable=SC2012
ls -1t "${BACKUP_DIR}/${DB_NAME}_"*.sql.gz 2>/dev/null | tail -n +$((KEEP_DAILY + 1)) | xargs -r rm -f

SNAP_STATUS="disabled"

# --- 3) Optional: dated snapshot database -----------------------------------
if [ "${BACKUP_SNAPSHOT_DB}" = "1" ]; then
  SNAP="${DB_SNAPSHOT_PREFIX}$(date +%Y%m%d)"
  # Attempt to create the snapshot DB; gracefully degrade if no CREATE privilege.
  if mysql_cmd "CREATE DATABASE IF NOT EXISTS \`${SNAP}\`" 2>/dev/null; then
    set +e
    "${MYSQLDUMP_BIN}" --defaults-extra-file="${MYSQL_DEFAULTS_FILE}" -h "${DB_HOST}" \
      --single-transaction --quick --routines --triggers \
      "${DB_NAME}" | "${MYSQL_BIN}" --defaults-extra-file="${MYSQL_DEFAULTS_FILE}" -h "${DB_HOST}" "${SNAP}"
    COPY_DUMP=${PIPESTATUS[0]}
    COPY_LOAD=${PIPESTATUS[1]}
    set -e
    if [ "${COPY_DUMP}" -ne 0 ] || [ "${COPY_LOAD}" -ne 0 ]; then
      SNAP_STATUS="copy-failed(dump=${COPY_DUMP},load=${COPY_LOAD})"
    else
      SNAP_STATUS="created:${SNAP}"
      # Rotate snapshot DBs: drop all but the newest SNAPSHOT_KEEP (names sort lexically = chronologically).
      mapfile -t SNAPS < <(mysql_cmd "SHOW DATABASES LIKE '${DB_SNAPSHOT_PREFIX}%'" | sort)
      EXCESS=$(( ${#SNAPS[@]} - SNAPSHOT_KEEP ))
      if [ "${EXCESS}" -gt 0 ]; then
        for ((i = 0; i < EXCESS; i++)); do
          mysql_cmd "DROP DATABASE IF EXISTS \`${SNAPS[$i]}\`" 2>/dev/null \
            && log "dropped old snapshot DB: ${SNAPS[$i]}" \
            || log "WARN: failed to drop snapshot DB: ${SNAPS[$i]}"
        done
      fi
    fi
  else
    SNAP_STATUS="skipped: no CREATE privilege"
  fi
fi

# --- 4) Result line ---------------------------------------------------------
log "OK file=${OUT_FILE} size=${FILE_SIZE} keep=${KEEP_DAILY} snapshot=${SNAP_STATUS}"

# Quiet on success: nothing on stdout so cPanel cron only emails on error.
exit 0
