const { Worker } = require('bullmq');
const mongoose = require('mongoose');
const connectDatabase = require('../config/db');
const env = require('../config/env');
const { createRedisConnection } = require('../services/redisService');
const { processProjectTask } = require('../services/projectTaskService');
const { runScan } = require('../services/scanRunner');
const { QUEUE_NAME, closePublishQueue, ensurePublishMaintenanceSchedules } = require('../queues/publishQueue');
const {
  MEDIA_QUEUE_NAME,
  closeMediaQueue,
  ensureMediaMaintenanceSchedule
} = require('../queues/mediaQueue');
const {
  executePublishJob,
  executeProviderStatusCheck,
  recoverDuePublishJobs,
  recoverStalledPublishJob,
  refreshBatchSummary
} = require('../services/contentDistributionEngineService');
const { refreshExpiringSocialAccounts } = require('../services/socialTokenRefreshService');
const { collectDueMetrics } = require('../services/engagementMetricsService');
const { processMediaAsset, recoverMediaAssets } = require('../services/mediaProcessingService');

async function startWorker() {
  env.assertRuntimeConfig();
  await connectDatabase();
  const scanConnection = createRedisConnection({ lazyConnect: false, label: 'scan-worker' });
  const taskConnection = createRedisConnection({ lazyConnect: false, label: 'project-task-worker' });
  const publishConnection = createRedisConnection({ lazyConnect: false, label: 'social-publish-worker' });
  const mediaConnection = createRedisConnection({ lazyConnect: false, label: 'social-media-worker' });
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

  const publishWorker = new Worker(
    QUEUE_NAME,
    async (job) => {
      if (job.name === 'refresh-social-tokens') return refreshExpiringSocialAccounts();
      if (job.name === 'recover-due-publish-jobs') return recoverDuePublishJobs();
      if (job.name === 'collect-social-engagement') return collectDueMetrics();
      if (job.name === 'check-provider-publish-status') {
        return executeProviderStatusCheck({ jobId: job.data.jobId });
      }
      if (job.name !== 'publish-social-job') throw new Error(`Unknown social publishing job: ${job.name}`);
      const result = await executePublishJob({ jobId: job.data.jobId });
      if (!result.success) {
        return {
          status: result.job.status,
          retryScheduled: Boolean(result.retryScheduled),
          deadLettered: Boolean(result.deadLettered),
          errorCode: result.job.errorCode || 'publish_failed'
        };
      }
      return {
        platformPostId: result.platformPostId || '',
        platformUrl: result.platformUrl || ''
      };
    },
    { connection: publishConnection, concurrency }
  );

  const mediaWorker = new Worker(
    MEDIA_QUEUE_NAME,
    async (job) => {
      if (job.name === 'recover-media-assets') return recoverMediaAssets();
      if (job.name !== 'process-media-asset') throw new Error(`Unknown media processing job: ${job.name}`);
      const maxAttempts = Number(job.opts.attempts || 1);
      const asset = await processMediaAsset(job.data.assetId, {
        finalAttempt: job.attemptsMade + 1 >= maxAttempts
      });
      return { assetId: String(asset._id), status: asset.status };
    },
    { connection: mediaConnection, concurrency: env.mediaWorkerConcurrency }
  );

  await ensurePublishMaintenanceSchedules();
  await ensureMediaMaintenanceSchedule();
  await recoverDuePublishJobs().catch((error) => console.error(`Social publishing recovery failed: ${error.message}`));
  await recoverMediaAssets().catch((error) => console.error(`Media processing recovery failed: ${error.message}`));
  await refreshExpiringSocialAccounts().catch((error) => console.error(`Social token refresh failed: ${error.message}`));

  scanWorker.on('completed', (job) => console.log(`Scan job completed: ${job.id}`));
  scanWorker.on('failed', (job, error) => console.error(`Scan job failed: ${job && job.id}`, error));
  taskWorker.on('completed', (job) => console.log(`Project task completed: ${job.id}`));
  taskWorker.on('failed', (job, error) => console.error(`Project task failed: ${job && job.id}`, error));
  publishWorker.on('completed', (job) => console.log(`Social publishing job completed: ${job.id}`));
  publishWorker.on('failed', (job, error) => console.error(`Social publishing job failed: ${job && job.id}`, error.message));
  publishWorker.on('stalled', async (jobId) => {
    const publishJobId = String(jobId || '').replace(/^social-publish-/, '');
    if (!/^[a-f\d]{24}$/i.test(publishJobId)) return;
    await recoverStalledPublishJob(publishJobId).catch(() => null);
  });
  mediaWorker.on('completed', (job) => console.log(`Media processing job completed: ${job.id}`));
  mediaWorker.on('failed', (job, error) => console.error(`Media processing job failed: ${job && job.id}`, error.message));

  installSignalHandlers(
    [scanWorker, taskWorker, publishWorker, mediaWorker],
    [scanConnection, taskConnection, publishConnection, mediaConnection]
  );

  return { scanWorker, taskWorker, publishWorker, mediaWorker, scanConnection, taskConnection, publishConnection, mediaConnection };
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
  console.log(`Received ${signal}. Shutting down background workers...`);

  const forceExitTimer = setTimeout(() => {
    console.error('Forced worker shutdown after timeout.');
    process.exit(1);
  }, 10000);
  forceExitTimer.unref();

  try {
    await Promise.all(workers.map((worker) => worker.close()));
    await closePublishQueue();
    await closeMediaQueue();
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
