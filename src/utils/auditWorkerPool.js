// utils/auditWorkerPool.js
const path = require('path');
const { WorkerPool } = require('./workerPool');

const createAuditWorkerPool = () => {
  const workerPath = path.join(__dirname, './workers/audit.worker.js');
  // 1 worker is enough: batching coalesces writes and keeps insert ordering simple.
  return new WorkerPool(workerPath, 1);
};

let auditPool = null;

const getAuditWorkerPool = () => {
  if (!auditPool) {
    auditPool = createAuditWorkerPool();
  }
  return auditPool;
};

module.exports = { createAuditWorkerPool, getAuditWorkerPool };
