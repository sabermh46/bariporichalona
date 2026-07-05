#!/usr/bin/env node
/**
 * process-email-queue.js — cron drainer for the `email_outbox` table.
 *
 * Run by a cPanel Cron Job (every minute). It:
 *   1. Reclaims rows stuck in 'processing' from a previously-crashed run.
 *   2. Atomically CLAIMS a batch of due 'pending' rows (claim_token) so
 *      overlapping runs never send the same email twice.
 *   3. Sends each via SMTP; on success saves rent-receipt PDFs + writes emaillog
 *      and marks 'sent'; on failure retries with backoff or marks 'failed'.
 *   4. Exits (does NOT loop forever) — cron re-invokes it.
 *
 * Standalone: does NOT import the web app. Reads its own env + knex + nodemailer.
 * Idempotency comes from the SQL claim, so it is safe even without an external lock
 * (a flock in the cron line is still recommended as belt-and-suspenders).
 *
 * Env: DB_*, SMTP_*, APP_NAME, EMAIL_BATCH_SIZE, EMAIL_STUCK_MINUTES,
 *      EMAIL_MAX_ATTEMPTS. Loads .env from the repo root.
 */
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

// ---- Tunables --------------------------------------------------------------
const BATCH_SIZE = parseInt(process.env.EMAIL_BATCH_SIZE, 10) || 25;
const STUCK_MINUTES = parseInt(process.env.EMAIL_STUCK_MINUTES, 10) || 15;
const MAX_ATTEMPTS = parseInt(process.env.EMAIL_MAX_ATTEMPTS, 10) || 3;

const PROJECT_ROOT = path.resolve(__dirname, '..');
const UPLOADS_PDFS = path.join(PROJECT_ROOT, 'uploads', 'pdfs');

// ---- Pure helpers (unit-testable, no I/O) ----------------------------------

/**
 * Backoff before the next retry, in minutes. `attempts` is the 1-based count of
 * attempts already made (decideOutcome passes the incremented value):
 * after the 1st failure wait 1 min, then 5, 15, capped at 60.
 */
function backoffMinutes(attempts) {
  const schedule = [1, 5, 15, 60];
  const idx = Math.min(Math.max(attempts - 1, 0), schedule.length - 1);
  return schedule[idx];
}

/** Decide what an email row's next state is after a send attempt. */
function decideOutcome({ attempts, maxAttempts, ok, errorMessage }) {
  if (ok) return { status: 'sent' };
  const nextAttempts = attempts + 1;
  if (nextAttempts >= maxAttempts) {
    return { status: 'failed', attempts: nextAttempts, lastError: errorMessage };
  }
  return {
    status: 'pending',
    attempts: nextAttempts,
    lastError: errorMessage,
    retryInMinutes: backoffMinutes(nextAttempts),
  };
}

/** Build nodemailer mailOptions from an outbox row + decoded attachments. */
function buildMailOptions(row, decodedAttachments) {
  const opts = {
    from: `"${process.env.APP_NAME || 'App'}" <${process.env.SMTP_FROM}>`,
    to: row.to_email,
    subject: row.subject,
    html: row.html,
    text: row.text || (typeof row.html === 'string' ? row.html.replace(/<[^>]*>/g, '') : ''),
  };
  if (decodedAttachments && decodedAttachments.length > 0) {
    opts.attachments = decodedAttachments;
  }
  return opts;
}

/** Parse a JSON column that may be null / already-object / string. */
function safeParse(value, fallback) {
  if (value == null) return fallback;
  if (typeof value === 'object') return value;
  try { return JSON.parse(value); } catch (_) { return fallback; }
}

// ---- I/O helpers -----------------------------------------------------------

function makeDb() {
  const knex = require('knex');
  return knex({
    client: 'mysql2',
    connection: {
      host: process.env.DB_HOST || 'localhost',
      port: process.env.DB_PORT || 3306,
      user: process.env.DB_USER || 'root',
      password: process.env.DB_PASSWORD || '',
      database: process.env.DB_NAME || 'baripknex',
      charset: 'utf8mb4',
    },
    pool: { min: 0, max: 2 },
  });
}

function makeTransporter() {
  const nodemailer = require('nodemailer');
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT || '465', 10),
    secure: process.env.SMTP_SECURE === 'true',
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });
}

/** Persist a rent-receipt PDF to disk and record its path on the rent_payment row. */
async function saveRentInvoicePdf(db, rowId, pdfContent) {
  let existingMeta = {};
  try {
    const [r] = await db('rent_payment').where('id', rowId).select('metadata');
    if (r && r.metadata) existingMeta = safeParse(r.metadata, {});
  } catch (_) { /* ignore */ }

  if (existingMeta.invoicePdfPath) return existingMeta.invoicePdfPath; // already saved

  const folderName = crypto.randomBytes(6).toString('hex');
  const dirPath = path.join(UPLOADS_PDFS, folderName);
  const filePath = path.join(dirPath, 'invoice.pdf');
  fs.mkdirSync(dirPath, { recursive: true });
  fs.writeFileSync(filePath, pdfContent);
  const invoicePdfPath = `/uploads/pdfs/${folderName}/invoice.pdf`;

  try {
    existingMeta.invoicePdfPath = invoicePdfPath;
    await db('rent_payment').where('id', rowId).update({
      metadata: JSON.stringify(existingMeta),
      updated_at: new Date(),
    });
  } catch (dbErr) {
    console.error('[email-queue] Failed to update rent_payment metadata:', dbErr.message);
  }
  return invoicePdfPath;
}

async function writeEmailLog(db, { row, status, info, error, invoicePdfPath }) {
  const meta = safeParse(row.metadata, {});
  const logMeta = { ...meta };
  const tableName = logMeta.table_name || null;
  const rowId = logMeta.row_id != null ? BigInt(logMeta.row_id) : null;
  delete logMeta.table_name;
  delete logMeta.row_id;
  if (invoicePdfPath) logMeta.invoicePdfPath = invoicePdfPath;
  if (info) { logMeta.messageId = info.messageId; logMeta.envelope = info.envelope; }

  await db('emaillog').insert({
    type: meta.type || 'general',
    toEmail: row.to_email,
    subject: row.subject,
    content: row.html || null,
    status,
    error: error || null,
    table_name: tableName,
    row_id: rowId,
    metadata: Object.keys(logMeta).length ? JSON.stringify(logMeta) : null,
  });
}

/** Send one claimed row and update its outbox state. */
async function processRow(db, transporter, row) {
  const meta = safeParse(row.metadata, {});
  const attachmentsPayload = safeParse(row.attachments, null);
  let decodedAttachments = null;
  if (Array.isArray(attachmentsPayload) && attachmentsPayload.length > 0) {
    decodedAttachments = attachmentsPayload.map((a) => ({
      filename: a.filename || 'attachment',
      content: Buffer.from(a.content, 'base64'),
    }));
  }

  try {
    const info = await transporter.sendMail(buildMailOptions(row, decodedAttachments));

    // Rent-receipt PDFs: persist to disk + link on the rent_payment row.
    let invoicePdfPath = null;
    if (decodedAttachments && meta.table_name === 'rent_payment' && meta.row_id != null) {
      const pdf = decodedAttachments.find(
        (a) => a.filename && a.filename.toLowerCase().endsWith('.pdf')
      );
      if (pdf && pdf.content && pdf.content.length > 0) {
        try {
          invoicePdfPath = await saveRentInvoicePdf(db, BigInt(meta.row_id), pdf.content);
        } catch (fsErr) {
          console.error('[email-queue] Failed to save invoice PDF:', fsErr.message);
        }
      }
    }

    await writeEmailLog(db, { row, status: 'sent', info, invoicePdfPath });
    await db('email_outbox').where('id', row.id).update({
      status: 'sent',
      attempts: row.attempts + 1,
      claim_token: null,
      sent_at: new Date(),
      updated_at: new Date(),
      // Drop the (possibly large) attachment payload once delivered to reclaim space.
      attachments: null,
      last_error: null,
    });
    return { ok: true };
  } catch (err) {
    const outcome = decideOutcome({
      attempts: row.attempts,
      maxAttempts: row.max_attempts || MAX_ATTEMPTS,
      ok: false,
      errorMessage: err.message,
    });
    const update = {
      status: outcome.status,
      attempts: outcome.attempts,
      last_error: (outcome.lastError || '').slice(0, 1000),
      claim_token: null,
      updated_at: new Date(),
    };
    if (outcome.status === 'pending') {
      update.next_attempt_at = new Date(Date.now() + outcome.retryInMinutes * 60 * 1000);
    }
    await db('email_outbox').where('id', row.id).update(update);

    if (outcome.status === 'failed') {
      try {
        await writeEmailLog(db, { row, status: 'failed', error: err.message });
      } catch (logErr) {
        console.error('[email-queue] Failed to write emaillog:', logErr.message);
      }
    }
    return { ok: false, error: err.message };
  }
}

// ---- Main ------------------------------------------------------------------

async function main() {
  const db = makeDb();
  const transporter = makeTransporter();
  let sent = 0;
  let failed = 0;

  try {
    // 1) Reclaim rows a crashed run left in 'processing'.
    const stuckCutoff = new Date(Date.now() - STUCK_MINUTES * 60 * 1000);
    const reclaimed = await db('email_outbox')
      .where('status', 'processing')
      .andWhere('updated_at', '<', stuckCutoff)
      .update({ status: 'pending', claim_token: null, updated_at: new Date() });
    if (reclaimed) console.log(`[email-queue] reclaimed ${reclaimed} stuck row(s)`);

    // 2) Atomically claim a batch of due pending rows.
    const claimToken = crypto.randomBytes(16).toString('hex');
    const claimed = await db('email_outbox')
      .where('status', 'pending')
      .andWhere(function () {
        this.whereNull('next_attempt_at').orWhere('next_attempt_at', '<=', new Date());
      })
      .orderBy('id', 'asc')
      .limit(BATCH_SIZE)
      .update({ status: 'processing', claim_token: claimToken, updated_at: new Date() });

    if (!claimed) {
      console.log('[email-queue] nothing to do');
      return;
    }

    const rows = await db('email_outbox')
      .where('claim_token', claimToken)
      .orderBy('id', 'asc');

    // 3) Send each claimed row.
    for (const row of rows) {
      const res = await processRow(db, transporter, row);
      if (res.ok) sent++;
      else failed++;
    }

    console.log(`[email-queue] processed=${rows.length} sent=${sent} failed=${failed}`);
  } finally {
    try { transporter.close && transporter.close(); } catch (_) { /* ignore */ }
    await db.destroy();
  }
}

// Export pure helpers for unit tests; only run when invoked directly.
module.exports = { backoffMinutes, decideOutcome, buildMailOptions, safeParse };

if (require.main === module) {
  main()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('[email-queue] fatal:', err);
      process.exit(1);
    });
}
