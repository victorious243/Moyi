const crypto = require('crypto');
const asyncHandler = require('express-async-handler');
const { param, query } = require('express-validator');
const env = require('../../config/env');
const Project = require('../../models/Project');
const PaidAdAccount = require('../../models/PaidAdAccount');
const PaidAdEntity = require('../../models/PaidAdEntity');
const PaidBudgetRecommendation = require('../../models/PaidBudgetRecommendation');
const PaidMetricSnapshot = require('../../models/PaidMetricSnapshot');
const { projectAccessRole, canChangeProjectRole } = require('../../services/projectAccessService');
const { connectPaidAdAccounts } = require('../../services/paidAds/accountService');
const { buildPerformanceMarketingDashboard } = require('../../services/paidAds/performanceService');
const { getPaidAdsProvider } = require('../../services/paidAds/providerRegistry');

const PROVIDERS = ['google_ads', 'meta_ads', 'linkedin_ads', 'tiktok_ads'];

function oauthCookieOptions() {
  const options = {
    httpOnly: true,
    sameSite: 'lax',
    secure: env.isProduction,
    path: '/projects',
    maxAge: 10 * 60 * 1000
  };
  if (env.cookieDomain) options.domain = env.cookieDomain;
  return options;
}

function clearOauthCookies(res) {
  const options = oauthCookieOptions();
  res.clearCookie('paid_ads_oauth_state', options);
  res.clearCookie('paid_ads_oauth_project', options);
  res.clearCookie('paid_ads_oauth_provider', options);
}

function analyticsDays(value) {
  const days = Number(value || 7);
  return [7, 14, 30, 60, 90].includes(days) ? days : 7;
}

function requirePaidAdsManager(req, res, next) {
  if (canChangeProjectRole(req.projectAccessRole)) return next();
  const error = new Error('Only project owners and administrators can manage paid advertising data.');
  error.statusCode = 403;
  return next(error);
}

function registerPerformanceMarketingRoutes(router, context, services = {}) {
  const { findLatestJob, queuePaidAdsSync } = services;

  router.get('/paid-ads/:provider/callback', [
    param('provider').isIn(PROVIDERS),
    context.handleValidation
  ], asyncHandler(async (req, res) => {
    const expectedState = req.cookies.paid_ads_oauth_state;
    const projectId = req.cookies.paid_ads_oauth_project;
    const expectedProvider = req.cookies.paid_ads_oauth_provider;
    clearOauthCookies(res);
    const redirect = projectId && /^[a-f\d]{24}$/i.test(projectId)
      ? `/projects/${projectId}/performance-marketing`
      : '/dashboard';

    if (req.query.error) {
      return res.redirect(`${redirect}?error=${encodeURIComponent(req.query.error_description || req.query.error)}`);
    }
    if (!expectedState || req.query.state !== expectedState || expectedProvider !== req.params.provider) {
      return res.redirect(`${redirect}?error=${encodeURIComponent('Paid advertising connection could not be verified. Please try again.')}`);
    }
    if (!req.query.code || !projectId) {
      return res.redirect(`${redirect}?error=${encodeURIComponent('The provider did not return a usable authorization code.')}`);
    }
    const project = await Project.findById(projectId);
    const role = project ? await projectAccessRole({ project, userId: req.user._id }) : null;
    if (!project || !canChangeProjectRole(role)) {
      return res.redirect(`${redirect}?error=${encodeURIComponent('You no longer have permission to connect this advertising account.')}`);
    }

    try {
      const accounts = await connectPaidAdAccounts({
        projectId,
        userId: req.user._id,
        providerName: req.params.provider,
        code: String(req.query.code)
      });
      return res.redirect(`${redirect}?success=${encodeURIComponent(`Connected ${accounts.length} advertising account${accounts.length === 1 ? '' : 's'}. Run a data sync to begin analysis.`)}`);
    } catch (error) {
      return res.redirect(`${redirect}?error=${encodeURIComponent(error.message)}`);
    }
  }));

  router.get('/:id/performance-marketing', [
    param('id').isMongoId(),
    query('days').optional().isIn(['7', '14', '30', '60', '90']),
    context.handleValidation
  ], context.loadProject, asyncHandler(async (req, res) => {
    const days = analyticsDays(req.query.days);
    const [dashboard, latestSyncJob] = await Promise.all([
      buildPerformanceMarketingDashboard(req.project._id, days),
      findLatestJob({ projectId: req.project._id, userId: req.user._id, type: 'paid_ads_sync' })
    ]);
    res.render('projects/performance-marketing', {
      title: `${req.project.name} performance marketing`,
      dashboard,
      days,
      latestSyncJob,
      successMessage: req.query.success || '',
      errorMessage: req.query.error || ''
    });
  }));

  router.get('/:id/performance-marketing/connect/:provider', [
    param('id').isMongoId(),
    param('provider').isIn(PROVIDERS),
    context.handleValidation
  ], context.loadProject, (req, res) => {
    const state = crypto.randomBytes(24).toString('hex');
    try {
      if (!canChangeProjectRole(req.projectAccessRole)) {
        const error = new Error('You do not have permission to connect advertising accounts to this project.');
        error.statusCode = 403;
        throw error;
      }
      const provider = getPaidAdsProvider(req.params.provider);
      const request = provider.getAuthorizationRequest({ state });
      const options = oauthCookieOptions();
      res.cookie('paid_ads_oauth_state', state, options);
      res.cookie('paid_ads_oauth_project', String(req.project._id), options);
      res.cookie('paid_ads_oauth_provider', req.params.provider, options);
      res.redirect(request.url);
    } catch (error) {
      clearOauthCookies(res);
      res.redirect(`/projects/${req.project._id}/performance-marketing?error=${encodeURIComponent(error.message)}`);
    }
  });

  router.post('/:id/performance-marketing/sync', [
    param('id').isMongoId(),
    context.handleValidation
  ], context.loadProject, requirePaidAdsManager, asyncHandler(async (req, res) => {
    const days = analyticsDays(req.body.days || 30);
    const accountCount = await PaidAdAccount.countDocuments({ projectId: req.project._id, status: { $ne: 'disabled' } });
    if (!accountCount) {
      return res.redirect(`/projects/${req.project._id}/performance-marketing?error=${encodeURIComponent('Connect at least one advertising account before syncing data.')}`);
    }
    const job = await queuePaidAdsSync({ projectId: req.project._id, userId: req.user._id, days });
    res.redirect(`/projects/${req.project._id}/performance-marketing?days=${days}&success=${encodeURIComponent(job.status === 'running' || job.status === 'queued' ? 'Paid performance sync queued.' : 'Paid performance sync started.')}`);
  }));

  router.post('/:id/performance-marketing/accounts/:accountId/disconnect', [
    param('id').isMongoId(),
    param('accountId').isMongoId(),
    context.handleValidation
  ], context.loadProject, requirePaidAdsManager, asyncHandler(async (req, res) => {
    const account = await PaidAdAccount.findOne({ _id: req.params.accountId, projectId: req.project._id });
    if (!account) return res.redirect(`/projects/${req.project._id}/performance-marketing?error=${encodeURIComponent('Advertising account not found.')}`);
    const entityIds = await PaidAdEntity.find({ accountId: account._id }).distinct('_id');
    await Promise.all([
      PaidMetricSnapshot.deleteMany({ accountId: account._id }),
      PaidAdEntity.deleteMany({ _id: { $in: entityIds } }),
      account.deleteOne()
    ]);
    res.redirect(`/projects/${req.project._id}/performance-marketing?success=${encodeURIComponent('Advertising account disconnected and its imported provider metrics removed.')}`);
  }));

  router.post('/:id/performance-marketing/recommendations/:recommendationId/approve', [
    param('id').isMongoId(),
    param('recommendationId').isMongoId(),
    context.handleValidation
  ], context.loadProject, requirePaidAdsManager, asyncHandler(async (req, res) => {
    const recommendation = await PaidBudgetRecommendation.findOneAndUpdate(
      { _id: req.params.recommendationId, projectId: req.project._id, status: 'proposed' },
      { $set: { status: 'approved', approvedBy: req.user._id, approvedAt: new Date() } },
      { returnDocument: 'after' }
    );
    const message = recommendation
      ? 'Recommendation approved for human implementation. Moyi did not modify any provider budget.'
      : 'Recommendation is no longer awaiting approval.';
    res.redirect(`/projects/${req.project._id}/performance-marketing?success=${encodeURIComponent(message)}`);
  }));
}

module.exports = { registerPerformanceMarketingRoutes };
