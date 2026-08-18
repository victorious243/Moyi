const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const { createRuntimeHealthService } = require('../services/runtimeHealthService');
const { buildHealthRouter } = require('../routes/health');
const {
  buildBackupAndMonitoringPlan,
  buildSecurityReview,
  statusPagePayload
} = require('../services/enterpriseHardeningService');
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

test('production deployment cannot silently reuse stale distribution adapters', () => {
  const deployScript = fs.readFileSync(path.join(__dirname, '../scripts/deploy-production.sh'), 'utf8');
  const buildScript = fs.readFileSync(path.join(__dirname, '../scripts/build-distribution.js'), 'utf8');

  assert.match(deployScript, /npm ci --include=dev/);
  assert.match(deployScript, /REQUIRE_DISTRIBUTION_BUILD=true npm run build:distribution/);
  assert.match(buildScript, /REQUIRE_DISTRIBUTION_BUILD === 'true'/);
  assert.match(buildScript, /process\.exit\(1\)/);
});

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

test('production runtime config requires persistent media and dedicated upload paths', () => {
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
    CONTENT_IMAGE_STORAGE_PATH: '/var/lib/moyi/content-images',
    MEDIA_STORAGE_PROVIDER: 'machine',
    MEDIA_STORAGE_PATH: '',
    MEDIA_UPLOAD_TEMP_PATH: '/tmp'
  }, () => {
    const env = freshEnvModule();
    const problems = env.runtimeConfigProblems().join('\n');
    assert.match(problems, /MEDIA_STORAGE_PATH must point to a persistent writable volume/);
    assert.match(problems, /MEDIA_UPLOAD_TEMP_PATH is too broad/);
  });
});

test('social provider readiness reports missing keys and callback URLs', () => {
  withEnv({
    APP_URL: 'https://moyi.example',
    LINKEDIN_CLIENT_ID: 'linkedin-client',
    LINKEDIN_CLIENT_SECRET: 'linkedin-secret',
    LINKEDIN_REDIRECT_URI: 'https://moyi.example/integrations/social/linkedin/callback',
    TWITTER_CLIENT_ID: '',
    TWITTER_CLIENT_SECRET: '',
    TWITTER_REDIRECT_URI: '',
    META_APP_ID: '',
    META_APP_SECRET: '',
    META_REDIRECT_URI: ''
  }, () => {
    const env = freshEnvModule();
    const readiness = env.socialProviderReadiness();

    assert.equal(readiness.ready, false);
    assert.equal(readiness.providers.linkedin.ready, true);
    assert.deepEqual(readiness.providers.linkedin.callbackProblems, []);
    assert.equal(readiness.providers.x.ready, false);
    assert.deepEqual(readiness.providers.x.missingKeys, ['TWITTER_CLIENT_ID', 'TWITTER_REDIRECT_URI']);
    assert.equal(readiness.providers.meta.callbackUrl, 'https://moyi.example/integrations/social/meta/callback');
    assert.match(env.runtimeConfigWarnings().join('\n'), /One-click social publishing is not fully configured/);
  });
});

test('social provider readiness rejects callbacks outside the exact Moyi route and origin', () => {
  withEnv({
    NODE_ENV: 'production',
    APP_URL: 'https://moyi.example',
    TWITTER_CLIENT_ID: 'twitter-client',
    TWITTER_REDIRECT_URI: 'https://auth.example/integrations/x/callback'
  }, () => {
    const env = freshEnvModule();
    const provider = env.socialProviderReadiness().providers.x;

    assert.equal(provider.ready, false);
    assert.match(provider.callbackProblems.join('\n'), /integrations\/social\/x\/callback/);
    assert.match(provider.callbackProblems.join('\n'), /same origin as APP_URL/);
    assert.match(env.runtimeConfigProblems().join('\n'), /TWITTER_REDIRECT_URI/);
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
    queueWorkerCounts: async () => ({ scans: 1, projectTasks: 1, socialPublishing: 1, socialMedia: 1 })
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
    queueWorkerCounts: async () => ({ scans: 0, projectTasks: 0, socialPublishing: 0, socialMedia: 0 })
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

test('public status route exposes safe component health without config details', async () => {
  const router = buildHealthRouter({
    livenessPayload: () => ({ status: 'ok', uptimeSeconds: 10 }),
    readinessPayload: async () => ({
      status: 'not_ready',
      blockingChecks: ['queue'],
      checkedAt: '2026-08-14T09:00:00.000Z',
      problems: ['TOKEN_ENCRYPTION_SECRET is weak'],
      warnings: ['Stripe billing configuration is incomplete.'],
      checks: {
        database: { status: 'ready', required: true },
        queue: { status: 'failed', required: true },
        integrations: {
          stripe: { status: 'degraded', required: false }
        }
      }
    })
  });

  const response = await runRoute(router, { method: 'get', path: '/status.json' });

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.status, 'degraded');
  assert.equal(response.body.components.find((component) => component.key === 'background_jobs').status, 'outage');
  assert.equal(response.body.problems, undefined);
  assert.equal(response.body.warnings, undefined);
});

test('enterprise status payload marks database outages as public incidents', () => {
  const payload = statusPagePayload({
    status: 'not_ready',
    checks: {
      database: { status: 'failed', required: true },
      queue: { status: 'ready', required: true },
      integrations: {}
    }
  });

  assert.equal(payload.status, 'incident');
  assert.equal(payload.components.find((component) => component.key === 'database').status, 'outage');
});

test('enterprise hardening review tracks security controls and deferred public API', () => {
  const security = buildSecurityReview({
    supportEmail: 'customersupport@moyi-cmo.com',
    tokenEncryptionSecret: 'a'.repeat(40)
  });
  const backup = buildBackupAndMonitoringPlan({
    mediaStorageProvider: 's3',
    mediaStoragePath: '',
    supportEmail: 'customersupport@moyi-cmo.com'
  });

  assert.equal(security.needsReviewCount, 0);
  assert.equal(security.items.find((item) => item.key === 'rate_limits').status, 'implemented');
  assert.equal(security.items.find((item) => item.key === 'public_api').status, 'deferred');
  assert.equal(security.roleCapabilities.find((role) => role.role === 'analyst').publishing, false);
  assert.equal(backup.items.find((item) => item.key === 'media_storage').status, 'configured');
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
