// utils/workerPool.js
const { Worker } = require('worker_threads');
const os = require('os');
const path = require('path');

class WorkerPool {
  constructor(workerPath, maxWorkers = os.cpus().length - 1) {
    this.workerPath = workerPath;
    this.maxWorkers = Math.max(1, maxWorkers);
    this.workers = [];
    this.taskQueue = [];
    this.activeTasks = new Map();
    this.init();
  }

  init() {
    for (let i = 0; i < this.maxWorkers; i++) {
      const worker = new Worker(this.workerPath);
      worker.id = i;
      worker.busy = false;
      
      worker.on('message', (result) => {
        const { taskId, data, error } = result;
        const { resolve, reject } = this.activeTasks.get(taskId);
        
        this.activeTasks.delete(taskId);
        worker.busy = false;
        this.processQueue();
        
        if (error) {
          reject(new Error(error));
        } else {
          resolve(data);
        }
      });
      
      worker.on('error', (error) => {
        console.error(`Worker ${worker.id} error:`, error);
        // Restart worker
        this.restartWorker(worker);
      });
      
      worker.on('exit', (code) => {
        if (code !== 0) {
          console.error(`Worker ${worker.id} stopped with exit code ${code}`);
          this.restartWorker(worker);
        }
      });
      
      this.workers.push(worker);
    }
  }

  async execute(task, data) {
    return new Promise((resolve, reject) => {
      const taskId = Date.now() + Math.random().toString(36).substr(2, 9);
      this.taskQueue.push({ taskId, task, data, resolve, reject });
      this.processQueue();
    });
  }

  processQueue() {
    const availableWorker = this.workers.find(w => !w.busy);
    if (!availableWorker || this.taskQueue.length === 0) return;
    
    const task = this.taskQueue.shift();
    availableWorker.busy = true;
    this.activeTasks.set(task.taskId, {
      resolve: task.resolve,
      reject: task.reject
    });
    
    availableWorker.postMessage({
      taskId: task.taskId,
      task: task.task,
      data: task.data
    });
  }

  restartWorker(failedWorker) {
    const index = this.workers.indexOf(failedWorker);
    if (index > -1) {
      failedWorker.terminate();
      
      const newWorker = new Worker(this.workerPath);
      newWorker.id = failedWorker.id;
      newWorker.busy = false;
      
      newWorker.on('message', (result) => {
        const { taskId, data, error } = result;
        const { resolve, reject } = this.activeTasks.get(taskId);
        
        this.activeTasks.delete(taskId);
        newWorker.busy = false;
        this.processQueue();
        
        if (error) {
          reject(new Error(error));
        } else {
          resolve(data);
        }
      });
      
      this.workers[index] = newWorker;
      this.processQueue();
    }
  }

  async terminate() {
    await Promise.all(this.workers.map(worker => worker.terminate()));
    this.workers = [];
    this.taskQueue = [];
    this.activeTasks.clear();
  }

  getStats() {
    return {
      totalWorkers: this.workers.length,
      busyWorkers: this.workers.filter(w => w.busy).length,
      queueLength: this.taskQueue.length,
      activeTasks: this.activeTasks.size,
      cpuCount: os.cpus().length,
      memoryUsage: process.memoryUsage()
    };
  }
}

// Create analytics worker
const createAnalyticsWorkerPool = () => {
  const workerPath = path.join(__dirname, './workers/analytics.worker.js');
  return new WorkerPool(workerPath, Math.max(1, os.cpus().length - 1));
};

module.exports = { WorkerPool, createAnalyticsWorkerPool };