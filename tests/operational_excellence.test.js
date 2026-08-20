const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

const Project = require('../models/Project');
const {
  createNotificationDeliveryService,
  passesSeverityFilter,
  safeEvidence
} = require('../services/notificationDeliveryService');
const {
  isPrivateIp,
  parseNotificationEndpointUrl
} = require('../services/notificationEndpointService');
const {
  selectRoutedStakeholders
} = require('../services/notificationRoutingService');
const {
  evaluateGoalForecast,
  metricDirection,
  periodDates
} = require('../services/goalIntelligenceService');
const {
  getProjectLocalTime,
  isLocalDeliveryDue
} = require('../services/dailyGrowthScheduler');
const { notificationPreferenceUpdate } = require('../routes/projects/operationalRoutes');

test('Phase 4 operational excellence', async (t) => {
  await t.test('notification preferences have persistent production defaults', () => {
    const project = new Project({
      owner: new mongoose.Types.ObjectId(),
      name: 'Accountable Growth',
      websiteUrl: 'https://example.com'
    });
    assert.equal(project.timezone, 'UTC');
    assert.equal(project.cmoNotifications.dailyGrowthIntelligence.deliveryTime, '07:00');
    assert.equal(project.cmoNotifications.dailyContentIntelligence.enabled, false);
    assert.equal(project.cmoNotifications.weeklyBriefing.deliveryTime, '08:00');
    assert.equal(project.cmoNotifications.monthlyStrategyReview.deliveryDate, 1);
    assert.equal(project.cmoNotifications.channels.inApp, true);
    assert.equal(project.cmoNotifications.channels.webhook, false);
    const update = notificationPreferenceUpdate({
      timezone: 'Europe/Dublin',
      dailyGrowthEnabled: 'on', dailyGrowthDeliveryTime: '06:45',
      dailyContentDeliveryTime: '09:30',
      weeklyBriefingEnabled: 'on', weeklyDeliveryDay: 'friday', weeklyDeliveryTime: '08:15',
      monthlyReviewEnabled: 'on', monthlyDeliveryDate: '5', monthlyDeliveryTime: '10:00',
      alertsEnabled: 'on', minSeverity: 'important', contentNudgesEnabled: 'on',
      channels: ['in_app', 'slack']
    });
    assert.equal(update.timezone, 'Europe/Dublin');
    assert.equal(update['cmoNotifications.dailyGrowthIntelligence.reportingHour'], 6);
    assert.equal(update['cmoNotifications.weeklyBriefing.deliveryDay'], 'friday');
    assert.equal(update['cmoNotifications.monthlyStrategyReview.deliveryDate'], 5);
    assert.equal(update['cmoNotifications.growthAlerts.minSeverity'], 'important');
    assert.equal(update['cmoNotifications.channels.slack'], true);
    assert.equal(update['cmoNotifications.channels.email'], false);
  });

  await t.test('severity sensitivity filters match the four policy levels', () => {
    assert.equal(passesSeverityFilter('info', 'all'), true);
    assert.equal(passesSeverityFilter('info', 'important'), false);
    assert.equal(passesSeverityFilter('growth_opportunity', 'important'), true);
    assert.equal(passesSeverityFilter('growth_opportunity', 'high'), false);
    assert.equal(passesSeverityFilter('warning', 'high'), true);
    assert.equal(passesSeverityFilter('warning', 'critical'), false);
    assert.equal(passesSeverityFilter('critical', 'critical'), true);
  });

  await t.test('recipient routing only selects allowed project stakeholders', () => {
    const ownerId = new mongoose.Types.ObjectId();
    const memberId = new mongoose.Types.ObjectId();
    const outsiderId = new mongoose.Types.ObjectId();
    const result = selectRoutedStakeholders({
      project: { owner: ownerId, cmoNotifications: {} },
      route: {
        includeOwner: false,
        memberIds: [memberId, outsiderId],
        externalEmails: ['Board@Example.com'],
        channels: ['email', 'slack', 'webhook']
      },
      stakeholders: [
        { _id: ownerId, email: 'owner@example.com' },
        { _id: memberId, email: 'member@example.com' }
      ],
      allowedChannels: ['email', 'slack']
    });
    assert.deepEqual(result.channels, ['email', 'slack']);
    assert.deepEqual(result.users.map((user) => String(user._id)), [String(memberId)]);
    assert.deepEqual(result.emails, ['member@example.com', 'board@example.com']);
  });

  await t.test('timezone delivery runs after local configured time and preserves local date', () => {
    const base = new Date('2026-08-20T12:30:00Z');
    const dublin = getProjectLocalTime('Europe/Dublin', base);
    const newYork = getProjectLocalTime('America/New_York', base);
    assert.equal(dublin.dateString, '2026-08-20');
    assert.equal(dublin.hour, 13);
    assert.equal(newYork.hour, 8);
    assert.equal(isLocalDeliveryDue(newYork, '08:15'), true);
    assert.equal(isLocalDeliveryDue(newYork, '09:00'), false);
  });

  await t.test('duplicate digest keys are treated as idempotent skips', async () => {
    const service = createNotificationDeliveryService({
      GrowthAlert: { create: async () => { const error = new Error('duplicate'); error.code = 11000; throw error; } }
    });
    const result = await service.createAndDispatchNotification({
      project: {
        _id: new mongoose.Types.ObjectId(),
        owner: new mongoose.Types.ObjectId(),
        name: 'Project',
        websiteUrl: 'https://example.com',
        cmoNotifications: { growthAlerts: { enabled: true, minSeverity: 'all' } }
      },
      routing: { channels: ['in_app'], users: [], emails: [], endpoints: [] },
      force: true,
      type: 'weekly_briefing',
      category: 'executive_briefing',
      severity: 'info',
      title: 'Weekly brief',
      summary: 'Ready',
      dedupeKey: 'weekly:project:2026-08-20'
    });
    assert.equal(result.skipped, true);
    assert.equal(result.duplicate, true);
  });

  await t.test('goal forecasts cover ahead, at-risk, achieved, and cost direction', () => {
    const now = new Date('2026-08-16T00:00:00Z');
    const base = {
      metric: 'qualified_leads', direction: 'increase', targetValue: 200,
      periodStart: new Date('2026-08-01T00:00:00Z'), periodEnd: new Date('2026-08-31T23:59:59Z'),
      warningThreshold: 85
    };
    assert.equal(evaluateGoalForecast({ ...base, currentValue: 110, status: 'on_track' }, now).status, 'ahead');
    const risk = evaluateGoalForecast({ ...base, currentValue: 60, status: 'on_track' }, now);
    assert.equal(risk.status, 'at_risk');
    assert.ok(risk.forecastValue > 115 && risk.forecastValue < 130);
    assert.equal(evaluateGoalForecast({ ...base, currentValue: 200, status: 'on_track' }, now).status, 'achieved');
    assert.equal(metricDirection('cac'), 'decrease');
    assert.equal(metricDirection('revenue'), 'increase');
    const monthly = periodDates('monthly', now);
    assert.equal(monthly.start.toISOString().slice(0, 10), '2026-08-01');
  });

  await t.test('webhook URLs and payload evidence reject unsafe destinations and secrets', () => {
    assert.throws(() => parseNotificationEndpointUrl('http://hooks.example.com'), /HTTPS/);
    assert.throws(() => parseNotificationEndpointUrl('https://127.0.0.1/hook'), /public internet host/);
    assert.throws(() => parseNotificationEndpointUrl('https://example.com/hook', 'slack'), /Slack/);
    assert.equal(parseNotificationEndpointUrl('https://hooks.slack.com/services/a/b/c', 'slack').hostname, 'hooks.slack.com');
    assert.equal(isPrivateIp('192.168.1.10'), true);
    assert.deepEqual(safeEvidence({ clicks: 4, accessToken: 'secret', nested: { password: 'hidden', value: 2 } }), { clicks: 4, nested: { value: 2 } });
  });

  await t.test('webhook failures retry three times and record terminal failure', async () => {
    const delivery = {
      status: 'pending', attempts: 0, errorMessage: '',
      save: async () => delivery
    };
    const endpointUpdates = [];
    let attempts = 0;
    const service = createNotificationDeliveryService({
      NotificationDelivery: { create: async () => delivery },
      NotificationEndpoint: { updateOne: async (...args) => endpointUpdates.push(args) },
      getCredentials: async () => ({ url: 'https://hooks.example.com/moyi', signingSecret: 'a'.repeat(32) }),
      validateEndpoint: async (url) => url,
      http: { post: async () => { attempts += 1; throw new Error('connection refused'); } },
      sleep: async () => {}
    });
    await assert.rejects(() => service.deliverWebhook({
      project: { _id: new mongoose.Types.ObjectId(), name: 'Project', websiteUrl: 'https://example.com' },
      alert: {
        _id: new mongoose.Types.ObjectId(), title: 'Tracking failed', severity: 'warning', category: 'tracking',
        summary: 'No conversion events received.', urgency: 'high', confidence: 90, createdAt: new Date(),
        evidenceData: {}, ctaUrl: '/projects/example', ctaLabel: 'Open Analysis'
      },
      endpoint: { _id: new mongoose.Types.ObjectId(), channel: 'webhook', urlHint: 'hooks.example.com/...' }
    }), /connection refused/);
    assert.equal(attempts, 3);
    assert.equal(delivery.status, 'failed');
    assert.equal(delivery.attempts, 3);
    assert.equal(endpointUpdates.length, 1);
  });
});
