const { Queue } = require('bullmq');
const env = require('../config/env');
const { runScan } = require('../services/scanRunner');
const { attachRedisErrorHandler, createRedisConnection } = require('../services/redisService');

let queue;
let queueConnection;

function getQueue() {
  if (!queue) {
    queueConnection = createRedisConnection({ lazyConnect: false, label: 'scan-queue' });
    queue = attachRedisErrorHandler(
      new Queue('website-scans', { connection: queueConnection }),
      'website scan queue'
    );
  }

  return queue;
}

async function countScanWorkers() {
  const workers = await getQueue().getWorkers();
  return workers.length;
}

async function enqueueScan(scanId) {
  if (!env.queueEnabled) {
    setImmediate(() => runScan(scanId));
    return null;
  }

  try {
    const workerCount = await countScanWorkers();
    if (workerCount < 1) {
      const message = 'Scan queue has no active worker. Run npm start or add an npm run worker process.';
      if (env.isProduction) {
        const error = new Error(message);
        error.statusCode = 503;
        throw error;
      }

      console.warn(`${message} Running scan inline in ${env.nodeEnv}.`);
      setImmediate(() => runScan(scanId));
      return null;
    }

    return await getQueue().add(
      'run-scan',
      { scanId: scanId.toString() },
      {
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
        jobId: `scan-${scanId}`,
        removeOnComplete: { age: 3600, count: 1000 },
        removeOnFail: { age: 7 * 24 * 60 * 60 }
      }
    );
  } catch (error) {
    if (env.isProduction) {
      error.statusCode = 503;
      error.message = `Scan queue is unavailable: ${error.message}`;
      throw error;
    }

    console.warn(`Queue unavailable, running scan inline: ${error.message}`);
    setImmediate(() => runScan(scanId));
    return null;
  }
}

async function closeQueue() {
  if (queue) {
    await queue.close();
    queue = null;
  }

  if (queueConnection) {
    try {
      await queueConnection.quit();
    } catch (error) {
      queueConnection.disconnect();
    }
    queueConnection = null;
  }
}

module.exports = {
  countScanWorkers,
  closeQueue,
  enqueueScan,
  getQueue
};
