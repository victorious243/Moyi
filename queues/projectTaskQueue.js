const { Queue } = require('bullmq');
const env = require('../config/env');
const { createRedisConnection } = require('../services/redisService');

let queue;
let queueConnection;

function getProjectTaskQueue() {
  if (!queue) {
    queueConnection = createRedisConnection({ lazyConnect: false, label: 'project-tasks' });
    queue = new Queue('project-tasks', { connection: queueConnection });
  }

  return queue;
}

async function enqueueProjectTask(jobId) {
  if (!env.queueEnabled) {
    return null;
  }

  return getProjectTaskQueue().add(
    'run-project-task',
    { jobId: jobId.toString() },
    {
      attempts: 3,
      backoff: { type: 'exponential', delay: 5000 },
      jobId: `project-task:${jobId}`,
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
  closeProjectTaskQueue,
  enqueueProjectTask,
  getProjectTaskQueue
};
