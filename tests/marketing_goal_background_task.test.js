const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const path = require('path');
const ejs = require('ejs');

const MarketingGoal = require('../models/MarketingGoal');
const ProjectJob = require('../models/ProjectJob');
const { createProjectTaskService, typeLabel } = require('../services/projectTaskService');
const { evaluateGoalForecast } = require('../services/goalIntelligenceService');

test('MarketingGoal model accepts calculating status enum', () => {
  const goal = new MarketingGoal({
    projectId: new mongoose.Types.ObjectId(),
    createdBy: new mongoose.Types.ObjectId(),
    name: 'Q3 Enterprise Signups',
    metric: 'signups',
    targetValue: 500,
    currentValue: 50,
    period: 'quarterly',
    periodStart: new Date('2026-07-01'),
    periodEnd: new Date('2026-09-30'),
    status: 'calculating'
  });

  const validationError = goal.validateSync();
  assert.equal(validationError, undefined, 'MarketingGoal should validate with calculating status');
  assert.equal(goal.status, 'calculating');
});

test('ProjectJob accepts marketing_goal_evaluation type and typeLabel resolves', () => {
  const job = new ProjectJob({
    projectId: new mongoose.Types.ObjectId(),
    userId: new mongoose.Types.ObjectId(),
    type: 'marketing_goal_evaluation',
    payload: { goalId: '66c000000000000000000001', notify: false }
  });

  const validationError = job.validateSync();
  assert.equal(validationError, undefined, 'ProjectJob should validate with marketing_goal_evaluation');
  assert.equal(typeLabel('marketing_goal_evaluation'), 'goal evaluation and forecasting');
});

test('processProjectTask executes marketing_goal_evaluation job in background worker', async () => {
  const goalId = new mongoose.Types.ObjectId();
  const projectId = new mongoose.Types.ObjectId();
  const userId = new mongoose.Types.ObjectId();

  const mockGoal = {
    _id: goalId,
    projectId,
    name: 'ARR Target',
    metric: 'revenue',
    targetValue: 100000,
    currentValue: 25000,
    period: 'monthly',
    periodStart: new Date('2026-08-01'),
    periodEnd: new Date('2026-08-31'),
    status: 'calculating',
    save: async function () { return this; }
  };

  const mockJob = {
    _id: new mongoose.Types.ObjectId(),
    projectId,
    userId,
    type: 'marketing_goal_evaluation',
    payload: { goalId: goalId.toString(), notify: false },
    status: 'queued',
    save: async function () { return this; }
  };

  const mockProject = {
    _id: projectId,
    name: 'CloudScale AI'
  };

  const taskService = createProjectTaskService({
    Project: { findById: async () => mockProject, findOne: async () => mockProject },
    ProjectJob: { findById: async () => mockJob, findOne: async () => mockJob },
    MarketingGoal: { findById: async () => mockGoal, findOne: async () => mockGoal }
  });

  const processedJob = await taskService.processProjectTask({
    job: mockJob,
    onProgress: async () => {}
  });

  assert.equal(processedJob.status, 'completed');
  assert.equal(processedJob.result.resourceType, 'marketing_goal');
  assert.ok(processedJob.result.status);
});

test('views/projects/goals.ejs renders calculating status badge cleanly', async () => {
  const projectId = new mongoose.Types.ObjectId();
  const goals = [
    {
      _id: new mongoose.Types.ObjectId(),
      name: 'Monthly MQLs',
      metric: 'qualified_leads',
      period: 'monthly',
      targetValue: 200,
      currentValue: 10,
      forecastValue: null,
      progressPercent: 5,
      status: 'calculating',
      unit: 'leads',
      ownerUserId: { name: 'Alex' }
    }
  ];

  const html = await ejs.renderFile(
    path.join(__dirname, '../views/projects/goals.ejs'),
    {
      appName: 'Moyi',
      title: 'Goals & KPIs',
      currentUser: { _id: new mongoose.Types.ObjectId() },
      project: { _id: projectId, name: 'GrowthCorp' },
      activeSection: 'goals',
      goals,
      stakeholders: [],
      goalMetrics: ['revenue', 'qualified_leads', 'signups'],
      canManageProject: true,
      message: 'Marketing goal created.',
      goalError: ''
    }
  );

  assert.match(html, /Calculating AI forecast/);
  assert.match(html, /goal-status-calculating/);
});
