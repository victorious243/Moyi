require('dotenv').config();

const { Worker } = require('bullmq');
const mongoose = require('mongoose');
const connectDatabase = require('../config/db');
const env = require('../config/env');
const { createRedisConnection } = require('../services/redisService');
const { processProjectTask } = require('../services/projectTaskService');
const { runScan } = require('../services/scanRunner');

async function startWorker() {
  env.assertRuntimeConfig();
  await connectDatabase();
  const scanConnection = createRedisConnection({ lazyConnect: false, label: 'scan-worker' });
  const taskConnection = createRedisConnection({ lazyConnect: false, label: 'project-task-worker' });
  const concurrency = env.workerConcurrency;

  const scanWorker = new Worker(
    'website-scans',
    async (job) => runScan(job.data.scanId),
    { connection: scanConnection, concurrency }
  );

  const taskWorker = new Worker(
    'project-tasks',
    async (job) => processProjectTask(job.data.jobId, { attemptsMade: job.attemptsMade || 0 }),
    { connection: taskConnection, concurrency }
  );

  scanWorker.on('completed', (job) => console.log(`Scan job completed: ${job.id}`));
  scanWorker.on('failed', (job, error) => console.error(`Scan job failed: ${job && job.id}`, error));
  taskWorker.on('completed', (job) => console.log(`Project task completed: ${job.id}`));
  taskWorker.on('failed', (job, error) => console.error(`Project task failed: ${job && job.id}`, error));

  installSignalHandlers([scanWorker, taskWorker], [scanConnection, taskConnection]);

  return { scanWorker, taskWorker, scanConnection, taskConnection };
}

if (require.main === module) {
  startWorker().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

let shuttingDown = false;

function installSignalHandlers(workers, connections) {
  ['SIGINT', 'SIGTERM'].forEach((signal) => {
    process.on(signal, () => gracefulShutdown(signal, workers, connections));
  });
}

async function gracefulShutdown(signal, workers, connections) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`Received ${signal}. Shutting down scan worker...`);

  const forceExitTimer = setTimeout(() => {
    console.error('Forced worker shutdown after timeout.');
    process.exit(1);
  }, 10000);
  forceExitTimer.unref();

  try {
    await Promise.all(workers.map((worker) => worker.close()));
    await Promise.all(connections.map(async (connection) => {
      try {
        await connection.quit();
      } catch (error) {
        connection.disconnect();
      }
    }));
    await mongoose.connection.close(false);
    clearTimeout(forceExitTimer);
    process.exit(0);
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
}

module.exports = {
  startWorker
};
