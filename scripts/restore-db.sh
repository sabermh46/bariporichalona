#!/bin/bash
#
# restore-db.sh — restore a gzipped mysqldump produced by backup-db.sh.
#
# Usage:
#   bash scripts/restore-db.sh <path-to-backup.sql.gz> [target_db]
#
# If target_db is omitted, restores into $DB_NAME (default: baripknex).
# Prompts for confirmation before overwriting a non-empty database.
#
# Credentials come from the same MySQL defaults file as backup-db.sh.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [ -f "${SCRIPT_DIR}/backup.env" ]; then
  # shellcheck disable=SC1091
  . "${SCRIPT_DIR}/backup.env"
fi

DB_NAME="${DB_NAME:-baripknex}"
DB_HOST="${DB_HOST:-localhost}"
MYSQL_DEFAULTS_FILE="${MYSQL_DEFAULTS_FILE:-$HOME/.my.cnf}"
MYSQL_BIN="${MYSQL_BIN:-mysql}"

FILE="${1:-}"
TARGET="${2:-$DB_NAME}"

[ -n "${FILE}" ] || { echo "Usage: bash restore-db.sh <path-to-backup.sql.gz> [target_db]" >&2; exit 1; }
[ -f "${FILE}" ] || { echo "ERROR: backup file not found: ${FILE}" >&2; exit 1; }
[ -f "${MYSQL_DEFAULTS_FILE}" ] || { echo "ERROR: MySQL defaults file not found: ${MYSQL_DEFAULTS_FILE}" >&2; exit 1; }
command -v "${MYSQL_BIN}" >/dev/null 2>&1 || { echo "ERROR: mysql client not found (set MYSQL_BIN)" >&2; exit 1; }

mysql_exec() {
  "${MYSQL_BIN}" --defaults-extra-file="${MYSQL_DEFAULTS_FILE}" -h "${DB_HOST}" -N -e "$1"
}

# Warn if the target DB already has tables.
TABLE_COUNT="$(mysql_exec "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='${TARGET}'" 2>/dev/null || echo 0)"

echo "About to restore:"
echo "  source : ${FILE}"
echo "  target : ${TARGET} (host ${DB_HOST})"
if [ "${TABLE_COUNT}" -gt 0 ]; then
  echo "  WARNING: target '${TARGET}' already has ${TABLE_COUNT} table(s); restoring will OVERWRITE matching objects."
fi
printf "Type 'yes' to continue: "
read -r CONFIRM
[ "${CONFIRM}" = "yes" ] || { echo "Aborted."; exit 1; }

# Decompress and pipe into mysql. Verify pipeline status.
set +e
gunzip -c "${FILE}" | "${MYSQL_BIN}" --defaults-extra-file="${MYSQL_DEFAULTS_FILE}" -h "${DB_HOST}" "${TARGET}"
GZ_STATUS=${PIPESTATUS[0]}
SQL_STATUS=${PIPESTATUS[1]}
set -e

if [ "${GZ_STATUS}" -ne 0 ] || [ "${SQL_STATUS}" -ne 0 ]; then
  echo "ERROR: restore failed (gunzip=${GZ_STATUS}, mysql=${SQL_STATUS})" >&2
  exit 1
fi

echo "Restore complete into '${TARGET}'."
