const test = require('node:test');
const assert = require('node:assert/strict');
const { createProjectTaskService, buildFingerprint } = require('../services/projectTaskService');

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
