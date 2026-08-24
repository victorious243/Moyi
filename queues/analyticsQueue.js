const { Queue } = require('bullmq');
const env = require('../config/env');
const { attachRedisErrorHandler, createRedisConnection } = require('../services/redisService');

const ANALYTICS_QUEUE_NAME = 'marketing-analytics';
let queue;
let queueConnection;

function getAnalyticsQueue() {
  if (!queue) {
    queueConnection = createRedisConnection({ lazyConnect: false, label: 'marketing-analytics' });
    queue = attachRedisErrorHandler(
      new Queue(ANALYTICS_QUEUE_NAME, { connection: queueConnection }),
      'marketing analytics queue'
    );
  }
  return queue;
}

async function ensureAnalyticsSchedules() {
  if (!env.queueEnabled) return;
  await getAnalyticsQueue().upsertJobScheduler(
    'collect-provider-analytics',
    { every: 5 * 60 * 1000 },
    { name: 'collect-provider-analytics', data: {} }
  );
}

async function closeAnalyticsQueue() {
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
  ANALYTICS_QUEUE_NAME,
  closeAnalyticsQueue,
  ensureAnalyticsSchedules,
  getAnalyticsQueue
};
