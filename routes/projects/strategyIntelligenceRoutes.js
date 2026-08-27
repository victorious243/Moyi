const asyncHandler = require('express-async-handler');
const { body, param, query } = require('express-validator');
const StrategicOpportunity = require('../../models/StrategicOpportunity');
const StrategicDecision = require('../../models/StrategicDecision');
const StrategicReview = require('../../models/StrategicReview');
const { acceptOpportunity, applyDecisionAction, strategyDashboard } = require('../../services/strategy/strategicIntelligenceService');

function registerStrategyIntelligenceRoutes(router, context, services = {}) {
  const { findLatestJobs, queueMonthlyStrategyReview, queueStrategicIntelligenceRefresh } = services;

  router.get('/:id/strategy-intelligence', [
    param('id').isMongoId(),
    query('review').optional().isMongoId(),
    context.handleValidation
  ], context.loadProject, asyncHandler(async (req, res) => {
    const [dashboard, jobs] = await Promise.all([
      strategyDashboard(req.project),
      findLatestJobs({ projectId: req.project._id, userId: req.user._id, types: ['strategic_intelligence_refresh', 'monthly_strategy_review'] })
    ]);
    const selectedReview = req.query.review
      ? await StrategicReview.findOne({ _id: req.query.review, projectId: req.project._id }).lean()
      : dashboard.reviews[0] || null;
    res.render('projects/strategy-intelligence', {
      title: `${req.project.name} strategic intelligence`,
      dashboard,
      selectedReview,
      jobs,
      successMessage: req.query.success || '',
      errorMessage: req.query.error || ''
    });
  }));

  router.post('/:id/strategy-intelligence/refresh', [param('id').isMongoId(), context.handleValidation], context.loadProject, asyncHandler(async (req, res) => {
    const job = await queueStrategicIntelligenceRefresh({ projectId: req.project._id, userId: req.user._id });
    if (context.recordAuditEvent) await context.recordAuditEvent({ user: req.user, projectId: req.project._id, eventType: 'strategic_intelligence_refresh_queued', metadata: { jobId: String(job._id) }, req });
    res.redirect(`/projects/${req.project._id}/strategy-intelligence?job=${job._id}&success=${encodeURIComponent('Strategic intelligence refresh queued. Forecasts will remain unavailable where history is insufficient.')}`);
  }));

  router.post('/:id/strategy-intelligence/monthly-review', [param('id').isMongoId(), context.handleValidation], context.loadProject, asyncHandler(async (req, res) => {
    const job = await queueMonthlyStrategyReview({ projectId: req.project._id, userId: req.user._id });
    if (context.recordAuditEvent) await context.recordAuditEvent({ user: req.user, projectId: req.project._id, eventType: 'monthly_strategy_review_queued', metadata: { jobId: String(job._id) }, req });
    res.redirect(`/projects/${req.project._id}/strategy-intelligence?job=${job._id}&success=${encodeURIComponent('Monthly strategy review queued.')}`);
  }));

  router.post('/:id/strategy-intelligence/opportunities/:opportunityId', [
    param('id').isMongoId(),
    param('opportunityId').isMongoId(),
    body('action').isIn(['accept', 'dismiss']),
    context.handleValidation
  ], context.loadProject, asyncHandler(async (req, res) => {
    if (req.body.action === 'accept') {
      const decision = await acceptOpportunity({ projectId: req.project._id, opportunityId: req.params.opportunityId, userId: req.user._id });
      if (decision && context.recordAuditEvent) await context.recordAuditEvent({ user: req.user, projectId: req.project._id, eventType: 'strategic_opportunity_accepted', metadata: { opportunityId: req.params.opportunityId, decisionId: String(decision._id) }, req });
      const message = decision ? 'Opportunity accepted and added to strategic decision history.' : 'Opportunity not found.';
      return res.redirect(`/projects/${req.project._id}/strategy-intelligence?success=${encodeURIComponent(message)}`);
    }
    await StrategicOpportunity.findOneAndUpdate(
      { _id: req.params.opportunityId, projectId: req.project._id, status: { $in: ['open', 'accepted'] } },
      { $set: { status: 'dismissed' } }
    );
    if (context.recordAuditEvent) await context.recordAuditEvent({ user: req.user, projectId: req.project._id, eventType: 'strategic_opportunity_dismissed', metadata: { opportunityId: req.params.opportunityId }, req });
    res.redirect(`/projects/${req.project._id}/strategy-intelligence?success=${encodeURIComponent('Opportunity dismissed. It remains in history for accountability.')}`);
  }));

  router.post('/:id/strategy-intelligence/decisions/:decisionId', [
    param('id').isMongoId(),
    param('decisionId').isMongoId(),
    body('action').isIn(['reject', 'defer', 'start', 'complete']),
    body('reason').optional().trim().isLength({ max: 1000 }),
    context.handleValidation
  ], context.loadProject, asyncHandler(async (req, res) => {
    const decision = await StrategicDecision.findOne({ _id: req.params.decisionId, projectId: req.project._id });
    if (!decision) return res.redirect(`/projects/${req.project._id}/strategy-intelligence?error=${encodeURIComponent('Strategic decision not found.')}`);
    applyDecisionAction(decision, req.body.action, req.body.reason, new Date());
    await decision.save();
    if (context.recordAuditEvent) await context.recordAuditEvent({ user: req.user, projectId: req.project._id, eventType: 'strategic_decision_updated', metadata: { decisionId: String(decision._id), action: req.body.action }, req });
    res.redirect(`/projects/${req.project._id}/strategy-intelligence?success=${encodeURIComponent('Strategic decision updated. Moyi will retain it for outcome measurement.')}`);
  }));
}

module.exports = { registerStrategyIntelligenceRoutes };
