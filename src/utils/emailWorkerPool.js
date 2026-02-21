// utils/emailWorkerPool.js
const path = require('path');
const { WorkerPool } = require('./workerPool');

const createEmailWorkerPool = () => {
  const workerPath = path.join(__dirname, './workers/email.worker.js');
  // 2 workers: emails are I/O bound, small pool is enough
  return new WorkerPool(workerPath, 2);
};

let emailPool = null;

const getEmailWorkerPool = () => {
  if (!emailPool) {
    emailPool = createEmailWorkerPool();
  }
  return emailPool;
};

module.exports = { createEmailWorkerPool, getEmailWorkerPool };
