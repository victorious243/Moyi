const { Queue } = require('bullmq');
const env = require('../config/env');
const { attachRedisErrorHandler, createRedisConnection } = require('../services/redisService');

let queue;
let queueConnection;

function getProjectTaskQueue() {
  if (!queue) {
    queueConnection = createRedisConnection({ lazyConnect: false, label: 'project-tasks' });
    queue = attachRedisErrorHandler(
      new Queue('project-tasks', { connection: queueConnection }),
      'project task queue'
    );
  }

  return queue;
}

async function countProjectTaskWorkers() {
  const workers = await getProjectTaskQueue().getWorkers();
  return workers.length;
}

async function enqueueProjectTask(jobId) {
  if (!env.queueEnabled) {
    return null;
  }

  const workerCount = await countProjectTaskWorkers();
  if (workerCount < 1) {
    if (env.isProduction) {
      const error = new Error('Project task queue has no active worker. Run npm start or add an npm run worker process.');
      error.statusCode = 503;
      throw error;
    }

    console.warn(`Project task queue has no active worker. Running job inline in ${env.nodeEnv}.`);
    return null;
  }

  return getProjectTaskQueue().add(
    'run-project-task',
    { jobId: jobId.toString() },
    {
      attempts: 3,
      backoff: { type: 'exponential', delay: 5000 },
      jobId: `project-task-${jobId}`,
      removeOnComplete: { age: 3600, count: 1000 },
      removeOnFail: { age: 7 * 24 * 60 * 60 }
    }
  );
}

async function closeProjectTaskQueue() {
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
  countProjectTaskWorkers,
  closeProjectTaskQueue,
  enqueueProjectTask,
  getProjectTaskQueue
};
