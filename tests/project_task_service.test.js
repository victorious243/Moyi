const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createProjectTaskService,
  buildFingerprint,
  parseRecommendationLimit
} = require('../services/projectTaskService');

test('project task fingerprint is stable across object key order', () => {
  const a = buildFingerprint({
    projectId: 'proj_1',
    type: 'measurement_report',
    payload: { type: 'weekly', filters: { days: 28, channel: 'organic' } }
  });
  const b = buildFingerprint({
    projectId: 'proj_1',
    type: 'measurement_report',
    payload: { filters: { channel: 'organic', days: 28 }, type: 'weekly' }
  });

  assert.equal(a, b);
});

test('project task preserves an unlimited recommendation limit after queue serialization', () => {
  assert.equal(parseRecommendationLimit(null), Infinity);
  assert.equal(parseRecommendationLimit(undefined), Infinity);
  assert.equal(parseRecommendationLimit(3), 3);
});

test('AI report worker does not turn a serialized unlimited limit into zero', async () => {
  const job = {
    _id: 'job_unlimited',
    projectId: 'proj_1',
    userId: 'user_1',
    type: 'ai_report',
    payload: { recommendationLimit: null },
    status: 'queued',
    attemptsMade: 0,
    result: {},
    errorMessage: '',
    async save() {
      return this;
    }
  };
  let receivedLimit;
  const service = createProjectTaskService({
    Project: {
      findById: async () => ({ _id: 'proj_1', websiteUrl: 'https://moyi.example' })
    },
    ProjectJob: {
      findById: async () => job
    },
    generateStrategyPlan: async ({ recommendationLimit }) => {
      receivedLimit = recommendationLimit;
      return {
        recommendations: [{ title: 'Verified finding' }],
        report: { _id: 'report_1' },
        scan: { _id: 'scan_1' }
      };
    }
  });

  await service.processProjectTask('job_unlimited');
  assert.equal(receivedLimit, Infinity);
  assert.equal(job.result.recommendationCount, 1);
});

test('project task service reuses an active matching job instead of enqueueing duplicates', async () => {
  let createCalled = 0;
  let enqueueCalled = 0;

  const service = createProjectTaskService({
    ProjectJob: {
      findOne: () => ({
        sort: async () => ({ _id: 'job_existing', status: 'queued' })
      }),
      create: async () => {
        createCalled += 1;
        return null;
      }
    },
    enqueueProjectTask: async () => {
      enqueueCalled += 1;
      return null;
    }
  });

  const job = await service.queueMeasurementReport({
    projectId: 'proj_1',
    userId: 'user_1',
    type: 'weekly'
  });

  assert.equal(job._id, 'job_existing');
  assert.equal(createCalled, 0);
  assert.equal(enqueueCalled, 0);
});

test('project task service processes measurement report jobs and stores output metadata', async () => {
  const savedStates = [];
  const job = {
    _id: 'job_1',
    projectId: 'proj_1',
    userId: 'user_1',
    type: 'measurement_report',
    payload: { type: 'weekly' },
    status: 'queued',
    attemptsMade: 0,
    result: {},
    errorMessage: '',
    async save() {
      savedStates.push({
        status: this.status,
        attemptsMade: this.attemptsMade,
        resourceId: this.result.resourceId || '',
        errorMessage: this.errorMessage
      });
      return this;
    }
  };

  const service = createProjectTaskService({
    Project: {
      findById: async () => ({ _id: 'proj_1', websiteUrl: 'https://moyi.example' })
    },
    ProjectJob: {
      findById: async () => job
    },
    generateMeasurementReport: async ({ project, userId, type }) => {
      assert.equal(project._id, 'proj_1');
      assert.equal(userId, 'user_1');
      assert.equal(type, 'weekly');
      return { _id: 'report_123' };
    }
  });

  const result = await service.processProjectTask('job_1', { attemptsMade: 0 });
  assert.equal(result.status, 'completed');
  assert.equal(result.result.resourceId, 'report_123');
  assert.equal(savedStates[0].status, 'running');
  assert.equal(savedStates.at(-1).status, 'completed');
});

test('project task service marks failed jobs when the workflow raises an error', async () => {
  const job = {
    _id: 'job_1',
    projectId: 'proj_1',
    userId: 'user_1',
    type: 'ai_report',
    payload: { recommendationLimit: 3 },
    status: 'queued',
    attemptsMade: 0,
    result: {},
    errorMessage: '',
    async save() {
      return this;
    }
  };

  const service = createProjectTaskService({
    Project: {
      findById: async () => ({ _id: 'proj_1', websiteUrl: 'https://moyi.example' })
    },
    ProjectJob: {
      findById: async () => job
    },
    generateStrategyPlan: async () => {
      const error = new Error('scan incomplete');
      error.statusCode = 422;
      throw error;
    }
  });

  await assert.rejects(
    service.processProjectTask('job_1', { attemptsMade: 1 }),
    /scan incomplete/
  );

  assert.equal(job.status, 'failed');
  assert.equal(job.errorMessage, 'scan incomplete');
  assert.equal(job.attemptsMade, 2);
});

test('content pipeline job creates missing assets and returns an approval queue destination', async () => {
  const savedProgress = [];
  const job = {
    _id: 'job_content',
    projectId: 'proj_1',
    userId: 'user_1',
    type: 'content_pipeline',
    payload: {
      recommendationId: 'rec_1',
      requestedType: '',
      keyword: 'evidence-backed marketing'
    },
    status: 'queued',
    attemptsMade: 0,
    result: {},
    errorMessage: '',
    async save() {
      savedProgress.push({ status: this.status, progress: this.progressPercent, step: this.currentStep });
      return this;
    }
  };
  const recommendation = {
    _id: 'rec_1',
    status: 'accepted',
    actionType: 'content',
    async save() {
      return this;
    }
  };
  let usageIncrement = 0;
  let aiOperations = 0;

  const service = createProjectTaskService({
    Project: {
      findById: async () => ({ _id: 'proj_1', websiteUrl: 'https://moyi.example' })
    },
    ProjectJob: {
      findById: async () => job
    },
    Recommendation: {
      findOne: async () => recommendation
    },
    ContentDraft: {
      find: () => ({ sort: async () => [] }),
      insertMany: async (drafts) => drafts.map((draft, index) => ({ ...draft, _id: `draft_${index + 1}` }))
    },
    selectDraftTypes: () => ['content_brief', 'blog_article'],
    generateDraftsForRecommendation: async ({ requestedTypes }) => requestedTypes.map((type) => ({ type })),
    incrementUsage: async (userId, field, amount) => {
      assert.equal(userId, 'user_1');
      assert.equal(field, 'contentDraftsUsed');
      usageIncrement += amount;
    },
    recordAiOperation: async () => {
      aiOperations += 1;
    }
  });

  const result = await service.processProjectTask('job_content');

  assert.equal(result.status, 'completed');
  assert.equal(result.result.createdCount, 2);
  assert.match(result.result.resourcePath, /\/projects\/proj_1\/content\?/);
  assert.equal(recommendation.status, 'in_progress');
  assert.equal(usageIncrement, 2);
  assert.equal(aiOperations, 1);
  assert.ok(savedProgress.some((entry) => entry.progress === 25));
  assert.equal(savedProgress.at(-1).progress, 100);
});
