// utils/houseOwnerWorkerPool.js
//
// This used to be a near-identical copy of WorkerPool with the same two bugs
// (unguarded activeTasks lookup + never rejecting a crashed worker's task).
// It now reuses the single hardened WorkerPool implementation so there is one
// place to maintain the crash/hang/timeout handling.
const path = require('path');
const { WorkerPool } = require('./workerPool');

// Same env cap as the analytics pool — do NOT size from os.cpus() on shared hosting.
const POOL_SIZE = Math.max(1, parseInt(process.env.WORKER_POOL_SIZE, 10) || 1);

let houseOwnerWorkerPoolInstance = null;

const createHouseOwnerWorkerPool = () => {
  if (!houseOwnerWorkerPoolInstance) {
    const workerPath = path.join(__dirname, './workers/houseOwnerAnalytics.worker.js');
    houseOwnerWorkerPoolInstance = new WorkerPool(workerPath, POOL_SIZE);
  }
  return houseOwnerWorkerPoolInstance;
};

module.exports = { createHouseOwnerWorkerPool };
