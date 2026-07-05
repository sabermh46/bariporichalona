#!/usr/bin/env node
/**
 * generate-monthly-fees.js — create the month's pending app-fee payments.
 *
 * Run by a cPanel Cron Job once a month (e.g. the 1st). Calls the same
 * AppFeePaymentController.generateMonthlyFees() the admin API uses
 * (POST /app-fees/payments/generate-monthly), but directly — no HTTP, no JWT.
 * The method is idempotent per owner: it skips owners that already have a
 * pending payment (hasPendingPayment check), so an accidental double run or a
 * manual API trigger in the same month cannot double-bill.
 *
 * Reads .env from the repo root via config/knex (same DB as the app).
 */
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const db = require('../src/config/knex');
const controller = require('../src/controllers/appFeePayment.controller');

async function main() {
  console.log('[monthly-fees] generating...');
  const results = await controller.generateMonthlyFees();
  if (results.length === 0) {
    console.log('[monthly-fees] nothing to generate (all owners already pending or no active houses)');
  } else {
    for (const r of results) {
      console.log(`[monthly-fees] owner=${r.ownerId} payment=${r.paymentId} amount=${r.amount}`);
    }
    console.log(`[monthly-fees] generated ${results.length} payment(s)`);
  }
}

main()
  .then(() => db.destroy())
  .then(() => process.exit(0))
  .catch(async (err) => {
    console.error('[monthly-fees] fatal:', err.message);
    try { await db.destroy(); } catch (_) { /* ignore */ }
    process.exit(1);
  });
