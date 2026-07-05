// utils/workerPool.js
const { Worker } = require('worker_threads');
const os = require('os');
const path = require('path');

// Per-task timeout: a hung worker must not stall the awaiting HTTP request forever.
const DEFAULT_TASK_TIMEOUT_MS = parseInt(process.env.WORKER_TASK_TIMEOUT_MS, 10) || 30000;
// Backpressure: reject new work rather than growing the queue without bound.
const DEFAULT_MAX_QUEUE = parseInt(process.env.WORKER_MAX_QUEUE, 10) || 200;

class WorkerPool {
  constructor(workerPath, maxWorkers = 1, opts = {}) {
    this.workerPath = workerPath;
    this.maxWorkers = Math.max(1, maxWorkers);
    this.taskTimeoutMs = opts.taskTimeoutMs || DEFAULT_TASK_TIMEOUT_MS;
    this.maxQueue = opts.maxQueue || DEFAULT_MAX_QUEUE;
    this.workers = [];
    this.taskQueue = [];
    // taskId -> { resolve, reject, timer, workerId }
    this.activeTasks = new Map();
    this.init();
  }

  init() {
    for (let i = 0; i < this.maxWorkers; i++) {
      this.spawnWorker(i);
    }
  }

  spawnWorker(id) {
    const worker = new Worker(this.workerPath);
    worker.id = id;
    worker.busy = false;
    this.attachHandlers(worker);
    this.workers.push(worker);
    return worker;
  }

  attachHandlers(worker) {
    worker.on('message', (result) => this.handleMessage(worker, result));
    worker.on('error', (error) => {
      console.error(`Worker ${worker.id} error:`, error);
      this.restartWorker(worker);
    });
    worker.on('exit', (code) => {
      if (code !== 0) {
        console.error(`Worker ${worker.id} stopped with exit code ${code}`);
        this.restartWorker(worker);
      }
    });
  }

  handleMessage(worker, result) {
    const { taskId, data, error } = result || {};
    worker.busy = false;
    const entry = this.activeTasks.get(taskId);
    // Stray / duplicate / late message (e.g. arrived after a timeout settled the
    // task): nothing to resolve. Guarding here prevents a destructure-of-undefined
    // TypeError from escaping this emitter callback and crashing the process.
    if (entry) {
      this.settle(taskId, entry, error ? { error } : { data });
    }
    this.processQueue();
  }

  // Single place that resolves/rejects a task and clears its timeout.
  settle(taskId, entry, outcome) {
    if (entry.timer) clearTimeout(entry.timer);
    this.activeTasks.delete(taskId);
    if (outcome.error) entry.reject(new Error(outcome.error));
    else entry.resolve(outcome.data);
  }

  async execute(task, data) {
    return new Promise((resolve, reject) => {
      if (this.taskQueue.length >= this.maxQueue) {
        return reject(new Error(`Worker pool queue is full (${this.maxQueue})`));
      }
      const taskId = `${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
      this.taskQueue.push({ taskId, task, data, resolve, reject });
      this.processQueue();
    });
  }

  processQueue() {
    const availableWorker = this.workers.find((w) => w && !w.busy);
    if (!availableWorker || this.taskQueue.length === 0) return;

    const task = this.taskQueue.shift();
    availableWorker.busy = true;

    const timer = setTimeout(() => {
      const entry = this.activeTasks.get(task.taskId);
      if (!entry) return;
      this.settle(task.taskId, entry, {
        error: `Worker task '${task.task}' timed out after ${this.taskTimeoutMs}ms`,
      });
      // The worker is likely wedged — replace it to reclaim capacity.
      const w = this.workers.find((x) => x && x.id === entry.workerId);
      if (w) this.restartWorker(w);
    }, this.taskTimeoutMs);
    if (timer.unref) timer.unref();

    this.activeTasks.set(task.taskId, {
      resolve: task.resolve,
      reject: task.reject,
      timer,
      workerId: availableWorker.id,
    });

    availableWorker.postMessage({
      taskId: task.taskId,
      task: task.task,
      data: task.data,
    });
  }

  restartWorker(failedWorker) {
    const index = this.workers.indexOf(failedWorker);
    // 'error' and 'exit' can both fire for one crash; once we've removed the
    // worker the second call is a no-op.
    if (index === -1) return;

    // Reject any in-flight task that was running on the dead worker so the
    // awaiting request fails fast instead of hanging forever.
    for (const [taskId, entry] of this.activeTasks) {
      if (entry.workerId === failedWorker.id) {
        this.settle(taskId, entry, { error: 'Worker crashed while processing task' });
      }
    }

    try { failedWorker.terminate(); } catch (_) { /* already dead */ }
    this.workers.splice(index, 1);
    // Spawn a replacement WITH full error/exit/message handlers so a second
    // crash is also recoverable (the previous code attached only 'message').
    this.spawnWorker(failedWorker.id);
    this.processQueue();
  }

  async terminate() {
    for (const [, entry] of this.activeTasks) {
      if (entry.timer) clearTimeout(entry.timer);
    }
    await Promise.all(this.workers.map((worker) => worker.terminate()));
    this.workers = [];
    this.taskQueue = [];
    this.activeTasks.clear();
  }

  getStats() {
    return {
      totalWorkers: this.workers.length,
      busyWorkers: this.workers.filter((w) => w && w.busy).length,
      queueLength: this.taskQueue.length,
      activeTasks: this.activeTasks.size,
      maxWorkers: this.maxWorkers,
      cpuCount: os.cpus().length,
      memoryUsage: process.memoryUsage(),
    };
  }
}

// Worker count is capped by env (default 1) rather than os.cpus().length, which
// on shared cPanel/Passenger reports the PHYSICAL HOST core count (16-32), not
// this account's 2-vCPU allocation — spawning dozens of isolates and exhausting
// the MySQL connection limit. Override with WORKER_POOL_SIZE only on a bigger box.
const POOL_SIZE = Math.max(1, parseInt(process.env.WORKER_POOL_SIZE, 10) || 1);

const createAnalyticsWorkerPool = () => {
  const workerPath = path.join(__dirname, './workers/analytics.worker.js');
  return new WorkerPool(workerPath, POOL_SIZE);
};

module.exports = { WorkerPool, createAnalyticsWorkerPool };
