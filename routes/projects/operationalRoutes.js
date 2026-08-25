const asyncHandler = require('express-async-handler');
const mongoose = require('mongoose');
const { body, param } = require('express-validator');
const MarketingGoal = require('../../models/MarketingGoal');
const NotificationDelivery = require('../../models/NotificationDelivery');
const NotificationEndpoint = require('../../models/NotificationEndpoint');
const NotificationRoute = require('../../models/NotificationRoute');
const Project = require('../../models/Project');
const { recordAuditEvent } = require('../../services/auditLogService');
const {
  createNotificationEndpoint
} = require('../../services/notificationEndpointService');
const { createAndDispatchNotification } = require('../../services/notificationDeliveryService');
const { projectStakeholders } = require('../../services/notificationRoutingService');
const {
  evaluateGoal,
  evaluateGoalForecast,
  metricDirection,
  periodDates
} = require('../../services/goalIntelligenceService');
const { queueMarketingGoalEvaluation: queueMarketingGoalEvaluationHelper } = require('../../services/projectTaskService');

const ROUTE_CATEGORIES = [
  ['general', 'General growth'],
  ['revenue', 'Revenue and critical'],
  ['content_approval', 'Content approvals'],
  ['tracking', 'Tracking failures'],
  ['executive_briefing', 'Executive briefings'],
  ['goals', 'Goals and KPIs']
];
const CHANNELS = ['in_app', 'email', 'slack', 'teams', 'discord', 'webhook'];
const ENDPOINT_CHANNELS = ['slack', 'teams', 'discord', 'webhook'];
const GOAL_METRICS = [
  'revenue', 'marketing_attributed_revenue', 'qualified_leads', 'signups',
  'conversion_rate', 'organic_traffic', 'paid_traffic', 'cac', 'cpa', 'roas',
  'followers', 'engagement', 'custom'
];

function arrayValue(value) {
  if (Array.isArray(value)) return value;
  return value ? [value] : [];
}

function validTimezone(value) {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value }).format();
    return true;
  } catch (error) {
    return false;
  }
}

function timezoneOptions(selected) {
  const zones = typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : ['UTC'];
  return [...new Set(['UTC', selected, ...zones].filter(Boolean))];
}

function parseExternalEmails(value) {
  const emails = String(value || '').split(',').map((item) => item.trim().toLowerCase()).filter(Boolean);
  const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (emails.length > 20 || emails.some((email) => !emailPattern.test(email))) {
    const error = new Error('Enter no more than 20 valid stakeholder email addresses.');
    error.statusCode = 422;
    throw error;
  }
  return [...new Set(emails)];
}

function notificationPreferenceUpdate(bodyValue = {}) {
  const channels = new Set(arrayValue(bodyValue.channels));
  return {
    timezone: bodyValue.timezone,
    'cmoNotifications.dailyGrowthIntelligence.enabled': bodyValue.dailyGrowthEnabled === 'on',
    'cmoNotifications.dailyGrowthIntelligence.deliveryTime': bodyValue.dailyGrowthDeliveryTime,
    'cmoNotifications.dailyGrowthIntelligence.reportingHour': Number(String(bodyValue.dailyGrowthDeliveryTime || '07:00').split(':')[0]),
    'cmoNotifications.dailyContentIntelligence.enabled': bodyValue.dailyContentEnabled === 'on',
    'cmoNotifications.dailyContentIntelligence.deliveryTime': bodyValue.dailyContentDeliveryTime,
    'cmoNotifications.weeklyBriefing.enabled': bodyValue.weeklyBriefingEnabled === 'on',
    'cmoNotifications.weeklyBriefing.deliveryDay': bodyValue.weeklyDeliveryDay,
    'cmoNotifications.weeklyBriefing.deliveryTime': bodyValue.weeklyDeliveryTime,
    'cmoNotifications.monthlyStrategyReview.enabled': bodyValue.monthlyReviewEnabled === 'on',
    'cmoNotifications.monthlyStrategyReview.deliveryDate': Number(bodyValue.monthlyDeliveryDate),
    'cmoNotifications.monthlyStrategyReview.deliveryTime': bodyValue.monthlyDeliveryTime,
    'cmoNotifications.growthAlerts.enabled': bodyValue.alertsEnabled === 'on',
    'cmoNotifications.growthAlerts.minSeverity': bodyValue.minSeverity,
    'cmoNotifications.contentApprovalNudges.enabled': bodyValue.contentNudgesEnabled === 'on',
    'cmoNotifications.channels.inApp': channels.has('in_app'),
    'cmoNotifications.channels.email': channels.has('email'),
    'cmoNotifications.channels.slack': channels.has('slack'),
    'cmoNotifications.channels.teams': channels.has('teams'),
    'cmoNotifications.channels.discord': channels.has('discord'),
    'cmoNotifications.channels.webhook': channels.has('webhook')
  };
}

function requireManager(req, context) {
  if (!context.canChangeProjectRole(req.projectAccessRole)) {
    throw new context.AppError('Only project administrators can manage operational settings.', 403);
  }
}

function registerOperationalRoutes(router, context, services = {}) {
  router.get('/:id/settings/notifications', [param('id').isMongoId(), context.handleValidation], context.loadProject, asyncHandler(async (req, res) => {
    requireManager(req, context);
    const project = await Project.findById(req.project._id).populate('owner', 'name email');
    const [stakeholders, endpoints, routes, deliveries] = await Promise.all([
      projectStakeholders(project),
      NotificationEndpoint.find({ projectId: project._id }).sort({ channel: 1, name: 1 }).lean(),
      NotificationRoute.find({ projectId: project._id }).lean(),
      NotificationDelivery.find({ projectId: project._id }).sort({ createdAt: -1 }).limit(20).lean()
    ]);
    const routeByCategory = new Map(routes.map((route) => [route.category, route]));
    res.render('projects/notifications', {
      title: `${project.name} notifications`,
      project,
      stakeholders,
      endpoints,
      deliveries,
      routeByCategory,
      routeCategories: ROUTE_CATEGORIES,
      channels: CHANNELS,
      timezoneOptions: timezoneOptions(project.timezone),
      message: req.query.message || '',
      settingsError: req.query.error || ''
    });
  }));

  router.post('/:id/settings/notifications', [
    param('id').isMongoId(),
    body('timezone').trim().custom(validTimezone).withMessage('Choose a valid project timezone.'),
    body('dailyGrowthDeliveryTime').matches(/^([01]\d|2[0-3]):[0-5]\d$/).withMessage('Choose a valid daily growth delivery time.'),
    body('dailyContentDeliveryTime').matches(/^([01]\d|2[0-3]):[0-5]\d$/).withMessage('Choose a valid daily content delivery time.'),
    body('weeklyDeliveryTime').matches(/^([01]\d|2[0-3]):[0-5]\d$/).withMessage('Choose a valid weekly delivery time.'),
    body('monthlyDeliveryTime').matches(/^([01]\d|2[0-3]):[0-5]\d$/).withMessage('Choose a valid monthly delivery time.'),
    body('weeklyDeliveryDay').isIn(['monday', 'friday', 'sunday']).withMessage('Choose a valid weekly briefing day.'),
    body('monthlyDeliveryDate').isInt({ min: 1, max: 28 }).withMessage('Monthly delivery date must be from 1 to 28.'),
    body('minSeverity').isIn(['all', 'important', 'high', 'critical']).withMessage('Choose a valid alert sensitivity.'),
    context.handleValidation
  ], context.loadProject, asyncHandler(async (req, res) => {
    requireManager(req, context);
    const update = notificationPreferenceUpdate(req.body);
    await Project.updateOne({ _id: req.project._id }, { $set: update });
    await recordAuditEvent({
      user: req.user,
      projectId: req.project._id,
      eventType: 'notification_preferences_updated',
      metadata: { timezone: req.body.timezone, minSeverity: req.body.minSeverity, channels: arrayValue(req.body.channels) },
      req
    });
    res.redirect(`/projects/${req.project._id}/settings/notifications?message=${encodeURIComponent('Notification preferences saved.')}`);
  }));

  router.post('/:id/settings/notifications/endpoints', [
    param('id').isMongoId(),
    body('name').trim().notEmpty().isLength({ max: 100 }).withMessage('Endpoint name is required.'),
    body('channel').isIn(ENDPOINT_CHANNELS).withMessage('Choose a valid endpoint type.'),
    body('url').trim().isLength({ max: 1000 }).withMessage('Webhook URL is too long.'),
    body('signingSecret').optional({ checkFalsy: true }).isLength({ min: 16, max: 200 }).withMessage('Signing secret must be 16 to 200 characters.'),
    context.handleValidation
  ], context.loadProject, asyncHandler(async (req, res) => {
    requireManager(req, context);
    await createNotificationEndpoint({
      projectId: req.project._id,
      userId: req.user._id,
      name: req.body.name,
      channel: req.body.channel,
      url: req.body.url,
      signingSecret: req.body.signingSecret || ''
    });
    await recordAuditEvent({ user: req.user, projectId: req.project._id, eventType: 'notification_endpoint_created', metadata: { name: req.body.name, channel: req.body.channel }, req });
    res.redirect(`/projects/${req.project._id}/settings/notifications?message=${encodeURIComponent('Delivery endpoint added.')}`);
  }));

  router.post('/:id/settings/notifications/endpoints/:endpointId/remove', [
    param('id').isMongoId(), param('endpointId').isMongoId(), context.handleValidation
  ], context.loadProject, asyncHandler(async (req, res) => {
    requireManager(req, context);
    const endpoint = await NotificationEndpoint.findOneAndDelete({ _id: req.params.endpointId, projectId: req.project._id });
    if (endpoint) {
      await NotificationRoute.updateMany({ projectId: req.project._id }, { $pull: { endpointIds: endpoint._id } });
      await recordAuditEvent({
        user: req.user,
        projectId: req.project._id,
        eventType: 'notification_endpoint_removed',
        metadata: { endpointId: endpoint._id, name: endpoint.name, channel: endpoint.channel },
        req
      });
    }
    res.redirect(`/projects/${req.project._id}/settings/notifications?message=${encodeURIComponent('Delivery endpoint removed.')}`);
  }));

  router.post('/:id/settings/notifications/endpoints/:endpointId/test', [
    param('id').isMongoId(), param('endpointId').isMongoId(), context.handleValidation
  ], context.loadProject, asyncHandler(async (req, res) => {
    requireManager(req, context);
    const endpoint = await NotificationEndpoint.findOne({ _id: req.params.endpointId, projectId: req.project._id }).lean();
    if (!endpoint) throw new context.AppError('Notification endpoint not found.', 404);
    const project = await Project.findById(req.project._id).populate('owner', 'name email');
    const result = await createAndDispatchNotification({
      project,
      force: true,
      routing: { channels: [endpoint.channel], users: [], emails: [], endpoints: [endpoint] },
      type: 'scan_completed',
      category: 'general',
      severity: 'info',
      title: 'Moyi delivery test',
      summary: 'This destination is ready to receive project notifications.',
      recommendedAction: 'No action is required.',
      ctaUrl: `/projects/${project._id}/settings/notifications`,
      ctaLabel: 'Open Notification Settings'
    });
    const message = result.failed ? 'Test failed. Review the delivery log below.' : 'Test notification delivered.';
    await recordAuditEvent({
      user: req.user,
      projectId: project._id,
      eventType: 'notification_endpoint_tested',
      status: result.failed ? 'failed' : 'success',
      severity: result.failed ? 'warning' : 'info',
      metadata: { endpointId: endpoint._id, channel: endpoint.channel, sent: result.sent || 0, failed: result.failed || 0 },
      req
    });
    res.redirect(`/projects/${req.project._id}/settings/notifications?message=${encodeURIComponent(message)}`);
  }));

  router.post('/:id/settings/notifications/routes/:category', [
    param('id').isMongoId(),
    param('category').isIn(ROUTE_CATEGORIES.map(([value]) => value)).withMessage('Notification category is invalid.'),
    context.handleValidation
  ], context.loadProject, asyncHandler(async (req, res) => {
    requireManager(req, context);
    const project = await Project.findById(req.project._id).populate('owner', 'name email');
    const stakeholders = await projectStakeholders(project);
    const allowedMemberIds = new Set(stakeholders.map((user) => String(user._id)));
    const memberIds = arrayValue(req.body.memberIds)
      .filter((id) => mongoose.isValidObjectId(id) && allowedMemberIds.has(String(id)));
    const endpointIds = arrayValue(req.body.endpointIds).filter(mongoose.isValidObjectId);
    const validEndpoints = endpointIds.length
      ? await NotificationEndpoint.find({ _id: { $in: endpointIds }, projectId: project._id }).distinct('_id')
      : [];
    const channels = arrayValue(req.body.routeChannels).filter((channel) => CHANNELS.includes(channel));
    await NotificationRoute.findOneAndUpdate(
      { projectId: project._id, category: req.params.category },
      {
        projectId: project._id,
        category: req.params.category,
        enabled: req.body.enabled === 'on',
        includeOwner: req.body.includeOwner === 'on',
        memberIds,
        externalEmails: parseExternalEmails(req.body.externalEmails),
        endpointIds: validEndpoints,
        channels
      },
      { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true, runValidators: true }
    );
    await recordAuditEvent({ user: req.user, projectId: project._id, eventType: 'notification_route_updated', metadata: { category: req.params.category, memberCount: memberIds.length, endpointCount: validEndpoints.length, channels }, req });
    res.redirect(`/projects/${project._id}/settings/notifications?message=${encodeURIComponent('Stakeholder route saved.')}`);
  }));

  router.get('/:id/goals', [param('id').isMongoId(), context.handleValidation], context.loadProject, asyncHandler(async (req, res) => {
    const project = await Project.findById(req.project._id).populate('owner', 'name email');
    const [goals, stakeholders] = await Promise.all([
      MarketingGoal.find({ projectId: project._id }).sort({ periodEnd: 1, createdAt: -1 }).populate('ownerUserId', 'name email'),
      projectStakeholders(project)
    ]);
    goals.forEach((goal) => {
      if (goal.status === 'calculating' && !goal.lastEvaluatedAt) {
        return;
      }
      const current = evaluateGoalForecast(goal);
      goal.status = current.status;
      goal.forecastValue = current.forecastValue;
      goal.progressPercent = current.progressPercent;
    });
    res.render('projects/goals', {
      title: `${project.name} goals`, project, goals, stakeholders,
      goalMetrics: GOAL_METRICS,
      message: req.query.message || '',
      goalError: req.query.error || ''
    });
  }));

  router.post('/:id/goals', [
    param('id').isMongoId(),
    body('name').trim().notEmpty().isLength({ max: 120 }).withMessage('Goal name is required.'),
    body('metric').isIn(GOAL_METRICS).withMessage('Choose a valid KPI.'),
    body('customMetricName').optional({ checkFalsy: true }).trim().isLength({ max: 100 }).withMessage('Custom KPI name is too long.'),
    body('targetValue').isFloat({ min: 0 }).withMessage('Target must be zero or greater.'),
    body('currentValue').optional({ checkFalsy: true }).isFloat({ min: 0 }).withMessage('Current value must be zero or greater.'),
    body('period').isIn(['weekly', 'monthly', 'quarterly', 'annual', 'custom']).withMessage('Choose a valid target period.'),
    body('warningThreshold').isInt({ min: 1, max: 100 }).withMessage('Warning threshold must be from 1 to 100.'),
    body('dataSource').isIn(['manual', 'search_console', 'tracking', 'social', 'ads', 'crm', 'custom']).withMessage('Choose a valid data source.'),
    body('notes').optional({ checkFalsy: true }).trim().isLength({ max: 1000 }).withMessage('Notes are too long.'),
    context.handleValidation
  ], context.loadProject, asyncHandler(async (req, res) => {
    requireManager(req, context);
    const project = await Project.findById(req.project._id).populate('owner', 'name email');
    const stakeholders = await projectStakeholders(project);
    const ownerUserId = mongoose.isValidObjectId(req.body.ownerUserId)
      && stakeholders.some((user) => String(user._id) === String(req.body.ownerUserId))
      ? req.body.ownerUserId : req.user._id;
    const defaults = periodDates(req.body.period);
    const periodStart = req.body.period === 'custom' ? new Date(req.body.periodStart) : defaults.start;
    const periodEnd = req.body.period === 'custom' ? new Date(req.body.periodEnd) : defaults.end;
    if (!Number.isFinite(periodStart.getTime()) || !Number.isFinite(periodEnd.getTime()) || periodEnd <= periodStart) {
      throw new context.AppError('Choose a valid goal period.', 422);
    }
    if (req.body.metric === 'custom' && !String(req.body.customMetricName || '').trim()) {
      throw new context.AppError('Name the custom KPI.', 422);
    }
    const goal = await MarketingGoal.create({
      projectId: project._id,
      createdBy: req.user._id,
      name: req.body.name,
      metric: req.body.metric,
      customMetricName: req.body.customMetricName || '',
      direction: metricDirection(req.body.metric),
      targetValue: Number(req.body.targetValue),
      currentValue: Number(req.body.currentValue || 0),
      unit: req.body.unit || '',
      period: req.body.period,
      periodStart,
      periodEnd,
      ownerUserId,
      dataSource: req.body.dataSource,
      warningThreshold: Number(req.body.warningThreshold),
      notes: req.body.notes || '',
      status: 'calculating'
    });

    const queueEvaluation = services.queueMarketingGoalEvaluation || queueMarketingGoalEvaluationHelper;
    await queueEvaluation({
      projectId: project._id,
      userId: req.user._id,
      goalId: goal._id,
      notify: false
    }).catch((err) => {
      console.warn(`[MarketingGoalQueue] Failed to enqueue evaluation for goal ${goal._id}:`, err.message);
      setImmediate(() => evaluateGoal(goal, { notify: false }).catch(() => null));
    });

    await recordAuditEvent({
      user: req.user,
      projectId: project._id,
      eventType: 'marketing_goal_created',
      metadata: { goalId: goal._id, metric: goal.metric, period: goal.period },
      req
    });
    res.redirect(`/projects/${project._id}/goals?message=${encodeURIComponent('Marketing goal created. Baseline calculations and AI forecasting are running in the background.')}`);
  }));

  router.post('/:id/goals/:goalId/progress', [
    param('id').isMongoId(), param('goalId').isMongoId(),
    body('currentValue').isFloat({ min: 0 }).withMessage('Current value must be zero or greater.'),
    context.handleValidation
  ], context.loadProject, asyncHandler(async (req, res) => {
    requireManager(req, context);
    const goal = await MarketingGoal.findOne({ _id: req.params.goalId, projectId: req.project._id });
    if (!goal) throw new context.AppError('Marketing goal not found.', 404);
    goal.currentValue = Number(req.body.currentValue);
    goal.currentValueUpdatedAt = new Date();
    await goal.save();

    const queueEvaluation = services.queueMarketingGoalEvaluation || queueMarketingGoalEvaluationHelper;
    await queueEvaluation({
      projectId: req.project._id,
      userId: req.user._id,
      goalId: goal._id,
      notify: true
    }).catch((err) => {
      console.warn(`[MarketingGoalProgressQueue] Failed to enqueue evaluation for goal ${goal._id}:`, err.message);
      setImmediate(() => evaluateGoal(goal, { notify: true }).catch(() => null));
    });

    await recordAuditEvent({
      user: req.user,
      projectId: req.project._id,
      eventType: 'marketing_goal_progress_updated',
      metadata: { goalId: goal._id, currentValue: goal.currentValue, status: goal.status },
      req
    });
    res.redirect(`/projects/${req.project._id}/goals?message=${encodeURIComponent('Goal progress updated. Forecasts are updating in the background.')}`);
  }));

  router.post('/:id/goals/:goalId/remove', [
    param('id').isMongoId(), param('goalId').isMongoId(), context.handleValidation
  ], context.loadProject, asyncHandler(async (req, res) => {
    requireManager(req, context);
    const goal = await MarketingGoal.findOneAndDelete({ _id: req.params.goalId, projectId: req.project._id });
    if (!goal) throw new context.AppError('Marketing goal not found.', 404);
    await recordAuditEvent({
      user: req.user,
      projectId: req.project._id,
      eventType: 'marketing_goal_removed',
      metadata: { goalId: goal._id, name: goal.name, metric: goal.metric },
      req
    });
    res.redirect(`/projects/${req.project._id}/goals?message=${encodeURIComponent('Goal removed.')}`);
  }));
}

module.exports = {
  CHANNELS,
  GOAL_METRICS,
  ROUTE_CATEGORIES,
  arrayValue,
  notificationPreferenceUpdate,
  parseExternalEmails,
  registerOperationalRoutes,
  timezoneOptions,
  validTimezone
};
