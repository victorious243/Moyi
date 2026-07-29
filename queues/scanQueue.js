const { Queue } = require('bullmq');
const env = require('../config/env');
const { runScan } = require('../services/scanRunner');
const { createRedisConnection } = require('../services/redisService');

let queue;
let queueConnection;

function getQueue() {
  if (!queue) {
    queueConnection = createRedisConnection({ lazyConnect: false, label: 'scan-queue' });
    queue = new Queue('website-scans', { connection: queueConnection });
  }

  return queue;
}

async function enqueueScan(scanId) {
  if (!env.queueEnabled) {
    setImmediate(() => runScan(scanId));
    return null;
  }

  try {
    return await getQueue().add(
      'run-scan',
      { scanId: scanId.toString() },
      {
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
        jobId: `scan:${scanId}`,
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
  closeQueue,
  enqueueScan,
  getQueue
};
