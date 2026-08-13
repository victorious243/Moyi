const mongoose = require('mongoose');
const env = require('../config/env');
const { pingRedis } = require('./redisService');
const { countScanWorkers } = require('../queues/scanQueue');
const { countProjectTaskWorkers } = require('../queues/projectTaskQueue');
const { countPublishWorkers } = require('../queues/publishQueue');
const { countMediaWorkers } = require('../queues/mediaQueue');

const READY_STATE_LABELS = {
  0: 'disconnected',
  1: 'connected',
  2: 'connecting',
  3: 'disconnecting'
};

function createRuntimeHealthService(deps = {}) {
  const services = {
    env,
    mongoose,
    pingRedis,
    queueWorkerCounts,
    ...deps
  };

  function livenessPayload() {
    return {
      checkedAt: new Date().toISOString(),
      environment: services.env.nodeEnv,
      releaseSha: services.env.releaseSha || '',
      status: 'ok',
      uptimeSeconds: Math.round(process.uptime()),
      version: process.env.npm_package_version || '0.0.0'
    };
  }

  function staticIntegrationChecks() {
    const googleConfigured = Boolean(
      services.env.googleClientId &&
      services.env.googleClientSecret &&
      services.env.googleRedirectUri
    );
    const stripeConfigured = Boolean(
      services.env.stripeSecretKey &&
      services.env.stripeWebhookSecret &&
      services.env.stripeStarterPriceId &&
      services.env.stripeProPriceId &&
      services.env.stripeAgencyPriceId
    );

    return {
      ai: {
        detail: services.env.openaiApiKey
          ? 'OpenAI API key is configured.'
          : 'OpenAI API key is missing. AI plan generation will degrade or fail gracefully.',
        required: false,
        status: services.env.openaiApiKey ? 'ready' : 'degraded'
      },
      google: {
        detail: googleConfigured
          ? 'Google OAuth configuration is present.'
          : 'Google OAuth is not fully configured.',
        required: false,
        status: googleConfigured ? 'ready' : 'degraded'
      },
      stripe: {
        detail: stripeConfigured
          ? 'Stripe billing configuration is present.'
          : 'Stripe billing configuration is incomplete.',
        required: false,
        status: stripeConfigured ? 'ready' : 'degraded'
      }
    };
  }

  async function readinessPayload() {
    const problems = services.env.runtimeConfigProblems ? services.env.runtimeConfigProblems(services.env) : [];
    const warnings = services.env.runtimeConfigWarnings ? services.env.runtimeConfigWarnings(services.env) : [];
    const dbState = services.mongoose.connection.readyState;
    const databaseStatus = dbState === 1 ? 'ready' : (dbState === 2 ? 'starting' : 'failed');
    const queueCheck = {
      detail: services.env.queueEnabled
        ? 'Redis-backed queue is required for background jobs.'
        : 'Queue execution is disabled.',
      required: services.env.isProduction || services.env.queueEnabled,
      status: services.env.queueEnabled ? 'starting' : 'disabled'
    };

    if (services.env.queueEnabled) {
      try {
        const result = await services.pingRedis();
        if (result !== 'PONG') {
          queueCheck.status = 'failed';
          queueCheck.detail = `Unexpected Redis ping response: ${result}`;
        } else {
          const workers = await services.queueWorkerCounts();
          const missingWorkers = Object.entries(workers)
            .filter(([, count]) => count < 1)
            .map(([name]) => name);

          queueCheck.status = missingWorkers.length ? 'failed' : 'ready';
          queueCheck.detail = missingWorkers.length
            ? `Redis is healthy, but no worker is registered for: ${missingWorkers.join(', ')}. Run npm start or add an npm run worker process.`
            : `Redis queue connection is healthy. Active workers: scans=${workers.scans}, projectTasks=${workers.projectTasks}, socialPublishing=${workers.socialPublishing}, socialMedia=${workers.socialMedia}.`;
        }
      } catch (error) {
        queueCheck.status = 'failed';
        queueCheck.detail = error.message;
      }
    }

    const checks = {
      database: {
        detail: `MongoDB is ${READY_STATE_LABELS[dbState] || 'unknown'}.`,
        required: true,
        status: databaseStatus
      },
      queue: queueCheck,
      integrations: staticIntegrationChecks()
    };

    const blockingChecks = [];
    if (problems.length) blockingChecks.push('configuration');
    if (checks.database.status !== 'ready') blockingChecks.push('database');
    if (checks.queue.required && checks.queue.status !== 'ready') blockingChecks.push('queue');

    return {
      blockingChecks,
      checkedAt: new Date().toISOString(),
      environment: services.env.nodeEnv,
      problems,
      releaseSha: services.env.releaseSha || '',
      status: blockingChecks.length ? 'not_ready' : 'ready',
      version: process.env.npm_package_version || '0.0.0',
      warnings,
      checks
    };
  }

  return {
    livenessPayload,
    readinessPayload
  };
}

async function queueWorkerCounts() {
  const [scanWorkers, projectTaskWorkers, publishWorkers, mediaWorkers] = await Promise.all([
    countScanWorkers(),
    countProjectTaskWorkers(),
    countPublishWorkers(),
    countMediaWorkers()
  ]);

  return {
    scans: scanWorkers,
    projectTasks: projectTaskWorkers,
    socialPublishing: publishWorkers,
    socialMedia: mediaWorkers
  };
}

module.exports = {
  ...createRuntimeHealthService(),
  createRuntimeHealthService
};
