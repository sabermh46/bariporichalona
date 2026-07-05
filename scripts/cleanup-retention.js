#!/usr/bin/env node
/**
 * cleanup-retention.js — daily housekeeping for tables that otherwise grow forever.
 *
 * Run by a cPanel Cron Job (daily). Deletes, in small batches (gentle on shared
 * MySQL — no long locks):
 *   - auditlog rows older than AUDIT_RETENTION_DAYS        (default 90)
 *   - notification rows expired (expiresAt < now) or older
 *     than NOTIFICATION_RETENTION_DAYS                     (default 90)
 *   - pushnotificationlog rows older than PUSHLOG_RETENTION_DAYS (default 90)
 *   - pushsubscription rows expired or unused for PUSH_STALE_DAYS (default 120)
 *   - email_outbox rows sent > OUTBOX_SENT_RETENTION_DAYS  (default 30)
 *     and failed > OUTBOX_FAILED_RETENTION_DAYS            (default 90)
 *
 * All FKs referencing these tables are ON DELETE SET NULL (verified in the
 * migration SQL), so order does not matter. `emaillog` is intentionally NOT
 * touched — it is business history (receipts/audit of what was sent).
 *
 * Standalone: reads .env from the repo root; does not import the web app.
 */
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const BATCH = parseInt(process.env.CLEANUP_BATCH_SIZE, 10) || 5000;
const days = (name, def) => parseInt(process.env[name], 10) || def;
const cutoff = (d) => new Date(Date.now() - d * 24 * 60 * 60 * 1000);

const knex = require('knex');
const db = knex({
  client: 'mysql2',
  connection: {
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'baripknex',
    charset: 'utf8mb4',
  },
  pool: { min: 0, max: 1 },
});

/** Delete in LIMIT-batches until the predicate matches no more rows. */
async function batchDelete(label, buildQuery) {
  let total = 0;
  for (;;) {
    const n = await buildQuery().limit(BATCH).del();
    total += n;
    if (n < BATCH) break;
  }
  if (total > 0) console.log(`[cleanup] ${label}: deleted ${total}`);
  return total;
}

async function main() {
  const started = Date.now();
  let grandTotal = 0;

  grandTotal += await batchDelete(
    `auditlog older than ${days('AUDIT_RETENTION_DAYS', 90)}d`,
    () => db('auditlog').where('createdAt', '<', cutoff(days('AUDIT_RETENTION_DAYS', 90)))
  );

  grandTotal += await batchDelete(
    'notification expired',
    () => db('notification').whereNotNull('expiresAt').andWhere('expiresAt', '<', new Date())
  );
  grandTotal += await batchDelete(
    `notification older than ${days('NOTIFICATION_RETENTION_DAYS', 90)}d`,
    () => db('notification').where('createdAt', '<', cutoff(days('NOTIFICATION_RETENTION_DAYS', 90)))
  );

  grandTotal += await batchDelete(
    `pushnotificationlog older than ${days('PUSHLOG_RETENTION_DAYS', 90)}d`,
    () => db('pushnotificationlog').where('sentAt', '<', cutoff(days('PUSHLOG_RETENTION_DAYS', 90)))
  );

  grandTotal += await batchDelete(
    'pushsubscription expired',
    () => db('pushsubscription').whereNotNull('expiresAt').andWhere('expiresAt', '<', new Date())
  );
  grandTotal += await batchDelete(
    `pushsubscription unused for ${days('PUSH_STALE_DAYS', 120)}d`,
    () => db('pushsubscription').where('lastUsed', '<', cutoff(days('PUSH_STALE_DAYS', 120)))
  );

  grandTotal += await batchDelete(
    `email_outbox sent > ${days('OUTBOX_SENT_RETENTION_DAYS', 30)}d`,
    () => db('email_outbox').where('status', 'sent').andWhere('sent_at', '<', cutoff(days('OUTBOX_SENT_RETENTION_DAYS', 30)))
  );
  grandTotal += await batchDelete(
    `email_outbox failed > ${days('OUTBOX_FAILED_RETENTION_DAYS', 90)}d`,
    () => db('email_outbox').where('status', 'failed').andWhere('updated_at', '<', cutoff(days('OUTBOX_FAILED_RETENTION_DAYS', 90)))
  );

  console.log(`[cleanup] done: ${grandTotal} row(s) in ${Date.now() - started}ms`);
}

main()
  .then(() => db.destroy())
  .then(() => process.exit(0))
  .catch(async (err) => {
    console.error('[cleanup] fatal:', err.message);
    try { await db.destroy(); } catch (_) { /* ignore */ }
    process.exit(1);
  });
