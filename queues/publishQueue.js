const { Queue } = require('bullmq');
const env = require('../config/env');
const { attachRedisErrorHandler, createRedisConnection } = require('../services/redisService');

const QUEUE_NAME = 'social-publishing';
let queue;
let queueConnection;

function getPublishQueue() {
  if (!queue) {
    queueConnection = createRedisConnection({ lazyConnect: false, label: 'social-publishing' });
    queue = attachRedisErrorHandler(
      new Queue(QUEUE_NAME, { connection: queueConnection }),
      'social publishing queue'
    );
  }
  return queue;
}

async function enqueuePublishJob(jobId, scheduledAt = null) {
  if (!env.queueEnabled) return null;
  const runAt = scheduledAt ? new Date(scheduledAt).getTime() : Date.now();
  const delay = Math.max(0, runAt - Date.now());
  return getPublishQueue().add(
    'publish-social-job',
    { jobId: String(jobId) },
    {
      attempts: 1,
      delay,
      jobId: `social-publish-${jobId}`,
      removeOnComplete: { age: 24 * 60 * 60, count: 5000 },
      removeOnFail: { age: 14 * 24 * 60 * 60, count: 5000 }
    }
  );
}

async function enqueueProviderStatusCheck(jobId, { delayMs = 30000, checkNumber = 0 } = {}) {
  if (!env.queueEnabled) return null;
  return getPublishQueue().add(
    'check-provider-publish-status',
    { jobId: String(jobId) },
    {
      attempts: 3,
      backoff: { type: 'exponential', delay: 5000 },
      delay: Math.max(5000, delayMs),
      jobId: `social-status-${jobId}-${checkNumber}`,
      removeOnComplete: { age: 24 * 60 * 60, count: 10000 },
      removeOnFail: { age: 14 * 24 * 60 * 60, count: 10000 }
    }
  );
}

async function reenqueuePublishJob(jobId, scheduledAt = null) {
  if (!env.queueEnabled) return null;
  const existing = await getPublishQueue().getJob(`social-publish-${jobId}`);
  if (existing) {
    const state = await existing.getState();
    if (state === 'active') return existing;
    await existing.remove();
  }
  return enqueuePublishJob(jobId, scheduledAt);
}

async function ensurePublishJobEnqueued(jobId, scheduledAt = null) {
  if (!env.queueEnabled) return null;
  const existing = await getPublishQueue().getJob(`social-publish-${jobId}`);
  if (!existing) return enqueuePublishJob(jobId, scheduledAt);
  const state = await existing.getState();
  if (['completed', 'failed'].includes(state)) {
    await existing.remove();
    return enqueuePublishJob(jobId, scheduledAt);
  }
  return existing;
}

async function ensurePublishMaintenanceSchedules() {
  if (!env.queueEnabled) return;
  const publishQueue = getPublishQueue();
  await publishQueue.upsertJobScheduler(
    'social-token-refresh',
    { every: 15 * 60 * 1000 },
    { name: 'refresh-social-tokens', data: {} }
  );
  await publishQueue.removeJobScheduler('collect-social-engagement').catch(() => null);
  await publishQueue.upsertJobScheduler(
    'recover-due-publish-jobs',
    { every: 60 * 1000 },
    { name: 'recover-due-publish-jobs', data: {} }
  );
}

async function countPublishWorkers() {
  if (!env.queueEnabled) return 0;
  return (await getPublishQueue().getWorkers()).length;
}

async function closePublishQueue() {
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
  QUEUE_NAME,
  closePublishQueue,
  countPublishWorkers,
  enqueueProviderStatusCheck,
  enqueuePublishJob,
  ensurePublishJobEnqueued,
  ensurePublishMaintenanceSchedules,
  getPublishQueue,
  reenqueuePublishJob
};
