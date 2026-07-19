require('dotenv').config();

const { Worker } = require('bullmq');
const IORedis = require('ioredis');
const connectDatabase = require('../config/db');
const env = require('../config/env');
const { runScan } = require('../services/scanRunner');

async function startWorker() {
  await connectDatabase();
  const connection = new IORedis(env.redisUrl, { maxRetriesPerRequest: null });

  const worker = new Worker(
    'website-scans',
    async (job) => runScan(job.data.scanId),
    { connection, concurrency: 2 }
  );

  worker.on('completed', (job) => console.log(`Scan job completed: ${job.id}`));
  worker.on('failed', (job, error) => console.error(`Scan job failed: ${job && job.id}`, error));
}

startWorker().catch((error) => {
  console.error(error);
  process.exit(1);
});
