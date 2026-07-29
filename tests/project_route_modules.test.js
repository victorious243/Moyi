const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { registerDiscoveryRoutes } = require('../routes/projects/discoveryRoutes');
const { registerMeasurementRoutes } = require('../routes/projects/measurementRoutes');
const { registerPrioritizationRoutes } = require('../routes/projects/prioritizationRoutes');

function noop(req, res, next) {
  next();
}

function findRoute(router, method, path) {
  const layer = router.stack.find((item) => item.route && item.route.path === path && item.route.methods[method]);
  assert.ok(layer, `Route ${method.toUpperCase()} ${path} should be registered.`);
  return layer.route.stack.map((item) => item.handle);
}

async function runRoute(router, { method, path, req }) {
  const handlers = findRoute(router, method, path);
  const res = {
    locals: {},
    redirectedTo: '',
    redirect(location) {
      this.redirectedTo = location;
      return this;
    },
    render() {
      return this;
    },
    json() {
      return this;
    }
  };

  for (const handler of handlers) {
    let nextCalled = false;
    await new Promise((resolve, reject) => {
      const next = (error) => {
        nextCalled = true;
        if (error) reject(error);
        else resolve();
      };

      try {
        const result = handler(req, res, next);
        if (result && typeof result.then === 'function') {
          result.then(() => resolve()).catch(reject);
          return;
        }
        if (handler.length < 3) {
          resolve();
          return;
        }
        setImmediate(() => {
          if (!nextCalled) resolve();
        });
      } catch (error) {
        reject(error);
      }
    });

    if (!nextCalled) break;
  }

  return res;
}

test('projects discovery route bootstraps a scanned project and redirects to calibration', async () => {
  let received = null;
  const router = express.Router();
  const context = {
    handleValidation: noop,
    normalizeUrl: (value) => value,
    competitorValidation: [],
    competitorLabel: () => '',
    parseJsonField: () => [],
    personaSummary: () => '',
    loadProject: noop,
    loadCompetitor: noop,
    loadScan: noop,
    loadScanViewData: async () => ({}),
    scanJson: () => ({})
  };
  const services = {
    bootstrapDiscoveryProject: async (payload) => {
      received = payload;
      return { project: { _id: 'proj_123' } };
    },
    ensureFeature: () => {},
    ensureProjectLimit: async () => {},
    ensureScanAllowed: async () => {},
    startProjectScan: async () => ({ _id: 'scan_1' }),
    upgradeRedirect: () => ''
  };

  registerDiscoveryRoutes(router, context, services);
  const response = await runRoute(router, {
    method: 'post',
    path: '/scan',
    req: {
      body: {
        name: 'Moyi',
        websiteUrl: 'https://moyi.example'
      },
      user: { _id: 'user_1' },
      params: {},
      query: {}
    }
  });

  assert.equal(response.redirectedTo, '/projects/proj_123/calibration');
  assert.deepEqual(received, {
    userId: 'user_1',
    name: 'Moyi',
    websiteUrl: 'https://moyi.example'
  });
});

test('projects measurement route generates a weekly report and redirects to report detail', async () => {
  const router = express.Router();
  const context = {
    handleValidation: noop,
    gscOpportunityDraftValidation: [],
    conversionGoalValidation: [],
    normalizeDays: () => 28,
    parsePropertySelection: () => ({ siteUrl: '', permissionLevel: '' }),
    loadProject: (req, res, next) => {
      req.project = { _id: 'proj_1', name: 'Moyi' };
      res.locals.project = req.project;
      next();
    },
    AppError: class AppError extends Error {
      constructor(message, statusCode) {
        super(message);
        this.statusCode = statusCode;
      }
    }
  };
  const services = {
    buildAttributionReadiness: async () => ({ score: 0 }),
    createSearchConsoleOpportunityDraft: async () => ({ firstDraft: null }),
    ensureContentDraftAllowed: async () => {},
    ensureFeature: () => {},
    findJobForProject: async () => null,
    findLatestJob: async () => null,
    findLatestJobs: async () => ({ measurement_report: null }),
    queueMeasurementReport: async ({ projectId, userId, type }) => {
      assert.equal(projectId, 'proj_1');
      assert.equal(userId, 'user_1');
      assert.equal(type, 'weekly');
      return { _id: 'job_1', status: 'queued' };
    },
    queueSearchConsoleSync: async () => ({ _id: 'sync_1', status: 'queued' }),
    upgradeRedirect: () => ''
  };

  registerMeasurementRoutes(router, context, services);
  const response = await runRoute(router, {
    method: 'post',
    path: '/:id/reports/weekly',
    req: {
      body: {},
      user: { _id: 'user_1' },
      params: { id: 'proj_1' },
      query: {}
    }
  });

  assert.equal(response.redirectedTo, '/projects/proj_1/reports?job=job_1&queued=1');
});

test('projects prioritization route queues AI report generation and redirects to latest view', async () => {
  const router = express.Router();
  const context = {
    handleValidation: noop,
    loadProject: (req, res, next) => {
      req.project = { _id: 'proj_1', name: 'Moyi' };
      res.locals.project = req.project;
      next();
    },
    Recommendation: { find: async () => [] },
    Report: { findOne: () => ({ sort: async () => null }) }
  };
  const services = {
    ensureAiReportAllowed: async () => ({ key: 'pro' }),
    findJobForProject: async () => null,
    findLatestJob: async () => null,
    pipelineAssetOptions: () => [],
    queueStrategyPlan: async ({ projectId, userId, recommendationLimit }) => {
      assert.equal(projectId, 'proj_1');
      assert.equal(userId, 'user_1');
      assert.equal(recommendationLimit, Infinity);
      return { _id: 'job_ai_1', status: 'queued' };
    },
    upgradeRedirect: () => ''
  };

  registerPrioritizationRoutes(router, context, services);
  const response = await runRoute(router, {
    method: 'post',
    path: '/:id/ai-report',
    req: {
      body: {},
      user: { _id: 'user_1' },
      params: { id: 'proj_1' },
      query: {}
    }
  });

  assert.equal(response.redirectedTo, '/projects/proj_1/ai-report/latest?job=job_ai_1&queued=1');
});

test('projects measurement route queues search console sync and redirects back to performance', async () => {
  const router = express.Router();
  const context = {
    handleValidation: noop,
    gscOpportunityDraftValidation: [],
    conversionGoalValidation: [],
    normalizeDays: () => 28,
    parsePropertySelection: () => ({ siteUrl: '', permissionLevel: '' }),
    loadProject: (req, res, next) => {
      req.project = { _id: 'proj_1', name: 'Moyi' };
      res.locals.project = req.project;
      next();
    },
    AppError: class AppError extends Error {
      constructor(message, statusCode) {
        super(message);
        this.statusCode = statusCode;
      }
    }
  };
  const services = {
    buildAttributionReadiness: async () => ({ score: 0 }),
    createSearchConsoleOpportunityDraft: async () => ({ firstDraft: null }),
    ensureContentDraftAllowed: async () => {},
    ensureFeature: () => {},
    findJobForProject: async () => null,
    findLatestJob: async () => null,
    findLatestJobs: async () => ({ measurement_report: null }),
    queueMeasurementReport: async () => ({ _id: 'job_1', status: 'queued' }),
    queueSearchConsoleSync: async ({ projectId, userId, days }) => {
      assert.equal(projectId, 'proj_1');
      assert.equal(userId, 'user_1');
      assert.equal(days, 28);
      return { _id: 'sync_1', status: 'queued' };
    },
    upgradeRedirect: () => ''
  };

  registerMeasurementRoutes(router, context, services);
  const response = await runRoute(router, {
    method: 'post',
    path: '/:id/search-console/sync',
    req: {
      body: { days: 28 },
      user: { _id: 'user_1' },
      params: { id: 'proj_1' },
      query: {}
    }
  });

  assert.equal(response.redirectedTo, '/projects/proj_1/search-console/performance?days=28&syncJob=sync_1&queued=1');
});
