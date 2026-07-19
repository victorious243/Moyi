const { Queue } = require('bullmq');
const IORedis = require('ioredis');
const env = require('../config/env');
const { runScan } = require('../services/scanRunner');

let queue;

function getQueue() {
  if (!queue) {
    const connection = new IORedis(env.redisUrl, { maxRetriesPerRequest: null });
    queue = new Queue('website-scans', { connection });
  }

  return queue;
}

async function enqueueScan(scanId) {
  if (process.env.DISABLE_QUEUE === 'true') {
    setImmediate(() => runScan(scanId));
    return null;
  }

  try {
    return await getQueue().add('run-scan', { scanId: scanId.toString() }, { attempts: 2, backoff: { type: 'exponential', delay: 5000 } });
  } catch (error) {
    console.warn(`Queue unavailable, running scan inline: ${error.message}`);
    setImmediate(() => runScan(scanId));
    return null;
  }
}

module.exports = {
  enqueueScan,
  getQueue
};
