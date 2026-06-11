// utils/workers/audit.worker.js
// Worker thread that performs audit-log inserts off the request path.
// Mirrors email.worker.js: owns its OWN knex connection, resilient on signals.
const { parentPort } = require('worker_threads');
const knex = require('knex');
const path = require('path');

require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });

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
  pool: { min: 1, max: 2 },
});

parentPort.on('message', async ({ taskId, task, data }) => {
  try {
    if (task !== 'insertAuditBatch') {
      throw new Error(`Unknown task: ${task}`);
    }

    const rows = Array.isArray(data?.rows) ? data.rows : [];
    if (rows.length === 0) {
      parentPort.postMessage({ taskId, data: { inserted: 0 } });
      return;
    }

    // Single multi-row insert.
    await db('auditlog').insert(rows);

    parentPort.postMessage({ taskId, data: { inserted: rows.length } });
  } catch (error) {
    parentPort.postMessage({ taskId, error: error.message, data: null });
  }
});

process.on('SIGTERM', async () => {
  try { await db.destroy(); } catch (_) {}
  process.exit(0);
});

process.on('SIGINT', async () => {
  try { await db.destroy(); } catch (_) {}
  process.exit(0);
});
