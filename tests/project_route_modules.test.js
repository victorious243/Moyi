const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { registerDiscoveryRoutes } = require('../routes/projects/discoveryRoutes');
const { registerMeasurementRoutes } = require('../routes/projects/measurementRoutes');
const { registerPrioritizationRoutes } = require('../routes/projects/prioritizationRoutes');
const { registerExecutionRoutes } = require('../routes/projects/executionRoutes');

function noop(req, res, next) {
  next();
}

function findRoute(router, method, path) {
  const layer = router.stack.find((item) => item.route && item.route.path === path && item.route.methods[method]);
  assert.ok(layer, `Route ${method.toUpperCase()} ${path} should be registered.`);
  return layer.route.stack.map((item) => item.handle);
}

test('content operations expose the campaign planning route', () => {
  const router = express.Router();
  const context = { handleValidation: noop, loadProject: noop, campaignValidation: [] };
  registerExecutionRoutes(router, context, {});

  assert.ok(findRoute(router, 'post', '/:id/content-plan'));
  assert.ok(findRoute(router, 'get', '/:id/content'));
  assert.ok(findRoute(router, 'get', '/:id/calendar'));
});

test('projects measurement routes expose social performance collection controls', () => {
  const router = express.Router();
  const context = {
    handleValidation: noop,
    loadProject: noop,
    gscOpportunityDraftValidation: [],
    conversionGoalValidation: []
  };
  registerMeasurementRoutes(router, context, {});

  assert.ok(findRoute(router, 'get', '/:id/social-performance'));
  assert.ok(findRoute(router, 'get', '/:id/social-performance/data'));
  assert.ok(findRoute(router, 'post', '/:id/social-performance/jobs/:jobId/metrics'));
});

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
    websiteUrl: 'https://moyi.example',
    targetCountry: '',
    targetCity: '',
    businessModel: ''
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

test('projects measurement route accepts growth opportunity into a valid social draft', async () => {
  const DailyGrowthIntelligence = require('../models/DailyGrowthIntelligence');
  const SocialDraft = require('../models/SocialDraft');
  const Campaign = require('../models/Campaign');
  const originalReportFindOne = DailyGrowthIntelligence.findOne;
  const originalDraftCreate = SocialDraft.create;
  const originalCampaignFindOne = Campaign.findOne;
  const originalCampaignCreate = Campaign.create;

  const savedReport = {
    opportunities: [
      {
        id: 'opp-optimal-timing',
        title: 'Schedule Tomorrow in Peak Window',
        description: 'Publishing on X during the peak window produced better engagement.',
        evidence: 'Validated across 2 historical posts.',
        actionType: 'schedule_slot',
        actionPayload: { platform: 'x', window: '08:00 - 12:00 UTC' },
        status: 'pending'
      }
    ],
    save: async function() {
      this.saved = true;
      return this;
    }
  };
  let createdDraft = null;

  DailyGrowthIntelligence.findOne = () => ({
    sort: async () => savedReport
  });
  Campaign.findOne = () => ({
    sort: async () => null
  });
  Campaign.create = async (payload) => ({ _id: 'campaign_1', ...payload });
  SocialDraft.create = async (payload) => {
    createdDraft = payload;
    assert.ok(payload.campaignId, 'campaignId should be set');
    assert.equal(payload.channel, 'x');
    assert.ok(payload.scheduledFor instanceof Date, 'scheduledFor should be a Date');
    assert.equal(payload.publishStatus, 'pending_approval');
    return { _id: 'draft_1', ...payload };
  };

  try {
    const router = express.Router();
    const context = {
      handleValidation: noop,
      gscOpportunityDraftValidation: [],
      conversionGoalValidation: [],
      loadProject: (req, res, next) => {
        req.project = { _id: 'proj_1', name: 'Moyi' };
        res.locals.project = req.project;
        next();
      }
    };
    registerMeasurementRoutes(router, context, {});
    const response = await runRoute(router, {
      method: 'post',
      path: '/:id/growth-intelligence/opportunities/:oppId/accept',
      req: {
        body: {},
        user: { _id: 'user_1' },
        params: { id: 'proj_1', oppId: 'opp-optimal-timing' },
        query: {}
      }
    });

    assert.ok(savedReport.saved);
    assert.equal(savedReport.opportunities[0].status, 'accepted');
    assert.ok(createdDraft);
    assert.equal(response.redirectedTo, '/projects/proj_1/content?success=Opportunity%20accepted!%20Draft%20post%20has%20been%20prepared%20in%20Content%20Studio%20for%20your%20review.');
  } finally {
    DailyGrowthIntelligence.findOne = originalReportFindOne;
    SocialDraft.create = originalDraftCreate;
    Campaign.findOne = originalCampaignFindOne;
    Campaign.create = originalCampaignCreate;
  }
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

test('projects discovery route queues competitor scan as a background task', async () => {
  const router = express.Router();
  const context = {
    handleValidation: noop,
    loadScan: noop,
    competitorValidation: [],
    loadProject: (req, res, next) => {
      req.project = { _id: 'proj_1', name: 'Moyi' };
      next();
    },
    loadCompetitor: (req, res, next) => {
      req.competitor = { _id: 'comp_1', name: 'Rival' };
      next();
    }
  };
  const services = {
    ensureFeature: () => {},
    queueCompetitorScan: async ({ projectId, userId, competitorId }) => {
      assert.equal(projectId, 'proj_1');
      assert.equal(userId, 'user_1');
      assert.equal(competitorId, 'comp_1');
      return { _id: 'scan_job_1', status: 'queued' };
    },
    upgradeRedirect: () => ''
  };

  registerDiscoveryRoutes(router, context, services);
  const response = await runRoute(router, {
    method: 'post',
    path: '/:id/competitors/:competitorId/scan',
    req: {
      user: { _id: 'user_1' },
      params: { id: 'proj_1', competitorId: 'comp_1' },
      query: {}
    }
  });

  assert.equal(response.redirectedTo, '/projects/proj_1/competitors/comp_1?jobId=scan_job_1');
});

test('projects discovery route queues competitor report generation as a background task', async () => {
  const router = express.Router();
  const context = {
    handleValidation: noop,
    loadScan: noop,
    loadCompetitor: noop,
    competitorValidation: [],
    loadProject: (req, res, next) => {
      req.project = { _id: 'proj_1', name: 'Moyi' };
      next();
    }
  };
  const services = {
    ensureFeature: () => {},
    queueCompetitorReport: async ({ projectId, userId }) => {
      assert.equal(projectId, 'proj_1');
      assert.equal(userId, 'user_1');
      return { _id: 'report_job_1', status: 'queued' };
    },
    upgradeRedirect: () => ''
  };

  registerDiscoveryRoutes(router, context, services);
  const response = await runRoute(router, {
    method: 'post',
    path: '/:id/competitors/report',
    req: {
      user: { _id: 'user_1' },
      params: { id: 'proj_1' },
      query: {}
    }
  });

  assert.equal(response.redirectedTo, '/projects/proj_1/competitors?jobId=report_job_1');
});
