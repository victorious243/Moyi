const { Queue } = require('bullmq');
const env = require('../config/env');
const { attachRedisErrorHandler, createRedisConnection } = require('../services/redisService');

const MEDIA_QUEUE_NAME = 'social-media-processing';
let queue;
let queueConnection;

function getMediaQueue() {
  if (!queue) {
    queueConnection = createRedisConnection({ lazyConnect: false, label: 'social-media-processing' });
    queue = attachRedisErrorHandler(
      new Queue(MEDIA_QUEUE_NAME, { connection: queueConnection }),
      'social media queue'
    );
  }
  return queue;
}

async function enqueueMediaProcessing(assetId) {
  if (!env.queueEnabled) {
    const error = new Error('Media processing requires the Redis worker. Set DISABLE_QUEUE=false and run npm run worker.');
    error.code = 'media_queue_disabled';
    error.statusCode = 503;
    throw error;
  }
  return getMediaQueue().add(
    'process-media-asset',
    { assetId: String(assetId) },
    {
      attempts: 2,
      backoff: { type: 'exponential', delay: 15000 },
      jobId: `media-process-${assetId}`,
      removeOnComplete: { age: 24 * 60 * 60, count: 5000 },
      removeOnFail: { age: 14 * 24 * 60 * 60, count: 5000 }
    }
  );
}

async function reenqueueMediaProcessing(assetId) {
  if (!env.queueEnabled) return null;
  const existing = await getMediaQueue().getJob(`media-process-${assetId}`);
  if (existing) {
    const state = await existing.getState();
    if (['active', 'waiting', 'delayed'].includes(state)) return existing;
    await existing.remove();
  }
  return enqueueMediaProcessing(assetId);
}

async function cancelMediaProcessing(assetId) {
  if (!env.queueEnabled) return true;
  const job = await getMediaQueue().getJob(`media-process-${assetId}`);
  if (!job) return true;
  const state = await job.getState();
  if (state === 'active') return false;
  await job.remove();
  return true;
}

async function ensureMediaMaintenanceSchedule() {
  if (!env.queueEnabled) return;
  await getMediaQueue().upsertJobScheduler(
    'recover-media-assets',
    { every: 5 * 60 * 1000 },
    { name: 'recover-media-assets', data: {} }
  );
}

async function countMediaWorkers() {
  if (!env.queueEnabled) return 0;
  return (await getMediaQueue().getWorkers()).length;
}

async function closeMediaQueue() {
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
  MEDIA_QUEUE_NAME,
  cancelMediaProcessing,
  closeMediaQueue,
  countMediaWorkers,
  enqueueMediaProcessing,
  ensureMediaMaintenanceSchedule,
  getMediaQueue,
  reenqueueMediaProcessing
};
