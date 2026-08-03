const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { createRuntimeHealthService } = require('../services/runtimeHealthService');
const { buildHealthRouter } = require('../routes/health');
const { createProjectWorkflowService } = require('../services/projectWorkflowService');

function withEnv(overrides, run) {
  const previous = {};

  Object.keys(overrides).forEach((key) => {
    previous[key] = process.env[key];
    const value = overrides[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  });

  try {
    return run();
  } finally {
    Object.keys(overrides).forEach((key) => {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    });
  }
}

function freshEnvModule() {
  delete require.cache[require.resolve('../config/env')];
  return require('../config/env');
}

function findRoute(router, method, path) {
  const layer = router.stack.find((item) => item.route && item.route.path === path && item.route.methods[method]);
  assert.ok(layer, `Route ${method.toUpperCase()} ${path} should exist.`);
  return layer.route.stack.map((item) => item.handle);
}

async function runRoute(router, { method, path }) {
  const handlers = findRoute(router, method, path);
  const response = {
    body: null,
    statusCode: 200,
    json(payload) {
      this.body = payload;
      return this;
    },
    status(code) {
      this.statusCode = code;
      return this;
    }
  };

  for (const handler of handlers) {
    await new Promise((resolve, reject) => {
      const next = (error) => {
        if (error) reject(error);
        else resolve();
      };

      try {
        const result = handler({ accepts: () => 'json' }, response, next);
        if (result && typeof result.then === 'function') {
          result.then(resolve).catch(reject);
          return;
        }
        if (handler.length < 3) {
          resolve();
        }
      } catch (error) {
        reject(error);
      }
    });
  }

  return response;
}

test('production runtime config rejects insecure app URL and disabled queue', () => {
  withEnv({
    NODE_ENV: 'production',
    APP_URL: 'http://moyi.example',
    DISABLE_QUEUE: 'true',
    JWT_SECRET: 'a'.repeat(32),
    TOKEN_ENCRYPTION_SECRET: 'b'.repeat(32),
    MONGODB_URI: 'mongodb://127.0.0.1:27017/moyi',
    REDIS_URL: 'redis://127.0.0.1:6379',
    TRUST_PROXY_HOPS: '1'
  }, () => {
    const env = freshEnvModule();
    assert.throws(() => env.assertRuntimeConfig(), /APP_URL must use https in production/);
    assert.match(env.runtimeConfigProblems().join('\n'), /DISABLE_QUEUE cannot be true in production/);
  });
});

test('production runtime config rejects unsafe image storage paths', () => {
  withEnv({
    NODE_ENV: 'production',
    APP_URL: 'https://moyi.example',
    DISABLE_QUEUE: 'false',
    JWT_SECRET: 'a'.repeat(32),
    TOKEN_ENCRYPTION_SECRET: 'b'.repeat(32),
    MONGODB_URI: 'mongodb://127.0.0.1:27017/moyi',
    REDIS_URL: 'redis://127.0.0.1:6379',
    TRUST_PROXY_HOPS: '1',
    SMTP_HOST: 'smtp.example.com',
    SMTP_USER: 'user',
    SMTP_PASS: 'pass',
    SMTP_FROM: 'Moyi <no-reply@example.com>',
    CONTENT_IMAGE_STORAGE_PROVIDER: 'machine',
    CONTENT_IMAGE_STORAGE_PATH: '/var/www'
  }, () => {
    const env = freshEnvModule();
    assert.match(env.runtimeConfigProblems().join('\n'), /CONTENT_IMAGE_STORAGE_PATH is too broad/);
  });
});

test('production runtime config requires S3 credentials when S3 storage is enabled', () => {
  withEnv({
    NODE_ENV: 'production',
    APP_URL: 'https://moyi.example',
    DISABLE_QUEUE: 'false',
    JWT_SECRET: 'a'.repeat(32),
    TOKEN_ENCRYPTION_SECRET: 'b'.repeat(32),
    MONGODB_URI: 'mongodb://127.0.0.1:27017/moyi',
    REDIS_URL: 'redis://127.0.0.1:6379',
    TRUST_PROXY_HOPS: '1',
    SMTP_HOST: 'smtp.example.com',
    SMTP_USER: 'user',
    SMTP_PASS: 'pass',
    SMTP_FROM: 'Moyi <no-reply@example.com>',
    CONTENT_IMAGE_STORAGE_PROVIDER: 's3',
    CONTENT_IMAGE_STORAGE_PATH: undefined,
    S3_BUCKET: '',
    S3_REGION: 'eu-west-1',
    S3_ACCESS_KEY_ID: '',
    S3_SECRET_ACCESS_KEY: ''
  }, () => {
    const env = freshEnvModule();
    assert.match(env.runtimeConfigProblems().join('\n'), /S3 storage requires/);
  });
});

test('runtime health reports ready only when database and queue are healthy', async () => {
  const health = createRuntimeHealthService({
    env: {
      isProduction: true,
      nodeEnv: 'production',
      openaiApiKey: 'key',
      googleClientId: '',
      googleClientSecret: '',
      googleRedirectUri: '',
      queueEnabled: true,
      releaseSha: 'abc123',
      runtimeConfigProblems: () => [],
      runtimeConfigWarnings: () => [],
      stripeAgencyPriceId: '',
      stripeProPriceId: '',
      stripeSecretKey: '',
      stripeStarterPriceId: '',
      stripeWebhookSecret: ''
    },
    mongoose: {
      connection: { readyState: 1 }
    },
    pingRedis: async () => 'PONG',
    queueWorkerCounts: async () => ({ scans: 1, projectTasks: 1 })
  });

  const payload = await health.readinessPayload();
  assert.equal(payload.status, 'ready');
  assert.equal(payload.checks.database.status, 'ready');
  assert.equal(payload.checks.queue.status, 'ready');
});

test('runtime health fails queue readiness when workers are not running', async () => {
  const health = createRuntimeHealthService({
    env: {
      isProduction: true,
      nodeEnv: 'production',
      openaiApiKey: 'key',
      googleClientId: '',
      googleClientSecret: '',
      googleRedirectUri: '',
      queueEnabled: true,
      releaseSha: 'abc123',
      runtimeConfigProblems: () => [],
      runtimeConfigWarnings: () => [],
      stripeAgencyPriceId: '',
      stripeProPriceId: '',
      stripeSecretKey: '',
      stripeStarterPriceId: '',
      stripeWebhookSecret: ''
    },
    mongoose: {
      connection: { readyState: 1 }
    },
    pingRedis: async () => 'PONG',
    queueWorkerCounts: async () => ({ scans: 0, projectTasks: 0 })
  });

  const payload = await health.readinessPayload();
  assert.equal(payload.status, 'not_ready');
  assert.equal(payload.checks.queue.status, 'failed');
  assert.match(payload.checks.queue.detail, /Run npm start/);
});

test('health routes reflect readiness status codes', async () => {
  const router = buildHealthRouter({
    livenessPayload: () => ({ status: 'ok', uptimeSeconds: 10 }),
    readinessPayload: async () => ({ status: 'not_ready', blockingChecks: ['queue'] })
  });

  const healthz = await runRoute(router, { method: 'get', path: '/healthz' });
  const readyz = await runRoute(router, { method: 'get', path: '/readyz' });

  assert.equal(healthz.statusCode, 200);
  assert.equal(healthz.body.status, 'ok');
  assert.equal(readyz.statusCode, 503);
  assert.equal(readyz.body.status, 'not_ready');
});

test('project workflow marks scan as failed when queue scheduling fails', async () => {
  const scan = {
    _id: 'scan_1',
    completedAt: null,
    currentStep: '',
    errorMessage: '',
    saveCalls: 0,
    status: 'pending',
    async save() {
      this.saveCalls += 1;
      return this;
    }
  };

  const workflow = createProjectWorkflowService({
    Scan: {
      create: async () => scan
    },
    enqueueScan: async () => {
      throw new Error('queue down');
    },
    incrementUsage: async () => {
      throw new Error('incrementUsage should not be called when enqueueing fails.');
    }
  });

  await assert.rejects(
    workflow.startProjectScan({ projectId: 'project_1', userId: 'user_1' }),
    /queue down/
  );

  assert.equal(scan.status, 'failed');
  assert.equal(scan.currentStep, 'Failed before scan start');
  assert.equal(scan.errorMessage, 'queue down');
  assert.equal(scan.saveCalls, 1);
});
