const express = require('express');
const asyncHandler = require('express-async-handler');
const { body, param } = require('express-validator');
const User = require('../models/User');
const { requireAuth } = require('../middleware/auth');
const { requirePlatformAdmin } = require('../middleware/platformAdmin');
const { buildAdminDashboard } = require('../services/adminDashboardService');
const { recordAuditEvent } = require('../services/auditLogService');
const { sendCustomerEmail, sendNewsletterEmail } = require('../services/emailService');
const { retryPublishAction } = require('../services/publishRetryService');
const { retryPublishJob } = require('../services/contentDistributionEngineService');
const ContentDraft = require('../models/ContentDraft');
const SocialDraft = require('../models/SocialDraft');
const PublishJob = require('../models/PublishJob');
const { retryWebhookDelivery } = require('../services/webhookService');
const { deleteAccountData } = require('../services/accountDataService');
const AppError = require('../utils/appError');
const handleValidation = require('../utils/validate');

const router = express.Router();

router.use(requireAuth);
router.use(requirePlatformAdmin);

router.get('/', asyncHandler(async (req, res) => {
  const dashboard = await buildAdminDashboard();
  await recordAuditEvent({ user: req.user, eventType: 'admin_dashboard_viewed', req });
  res.render('admin/dashboard', {
    title: 'Operator Dashboard',
    ...dashboard
  });
}));

router.post('/users/:id/delete', [
  param('id').isMongoId(),
  handleValidation
], asyncHandler(async (req, res, next) => {
  if (String(req.params.id) === String(req.user._id)) {
    return next(new AppError('You cannot delete your own admin account.', 422));
  }

  const user = await User.findById(req.params.id);
  if (!user) return next(new AppError('User not found.', 404));

  const emailSnapshot = user.email;
  await deleteAccountData(user._id);
  await User.findByIdAndDelete(user._id);

  await recordAuditEvent({
    user: req.user,
    eventType: 'admin_user_deleted_and_banned',
    metadata: { targetUserId: user._id, targetEmail: emailSnapshot },
    req
  });

  res.redirect('/admin');
}));

router.post('/users/:id', [
  param('id').isMongoId(),
  body('role').isIn(['owner', 'admin', 'member']).withMessage('User role is invalid.'),
  body('plan').isIn(['free', 'starter', 'pro', 'agency']).withMessage('Plan is invalid.'),
  body('subscriptionStatus').optional({ checkFalsy: true }).trim().isLength({ max: 80 }).withMessage('Subscription status is too long.'),
  handleValidation
], asyncHandler(async (req, res, next) => {
  if (String(req.params.id) === String(req.user._id) && req.body.role !== 'admin') {
    return next(new AppError('You cannot remove your own platform admin access.', 422));
  }

  const user = await User.findById(req.params.id);
  if (!user) return next(new AppError('User not found.', 404));

  user.role = req.body.role;
  user.plan = req.body.plan;
  user.subscriptionStatus = req.body.subscriptionStatus || user.subscriptionStatus || 'inactive';
  await user.save();

  await recordAuditEvent({
    user: req.user,
    eventType: 'admin_user_updated',
    metadata: { targetUserId: user._id, targetEmail: user.email, role: user.role, plan: user.plan },
    req
  });
  res.redirect('/admin');
}));

router.post('/users/:id/social-post-credits', [
  param('id').isMongoId(),
  body('credits').isInt({ min: 1, max: 10000 }).withMessage('Credits must be between 1 and 10000.'),
  body('reason').optional({ checkFalsy: true }).trim().isLength({ max: 300 }).withMessage('Reason is too long.'),
  handleValidation
], asyncHandler(async (req, res, next) => {
  const user = await User.findById(req.params.id);
  if (!user) return next(new AppError('User not found.', 404));

  const credits = Number(req.body.credits);
  const usage = await addSocialPostCredits(user._id, credits);
  const { periodStart, periodEnd } = currentPeriod();
  await recordAuditEvent({
    user: req.user,
    eventType: 'admin_social_post_credits_added',
    metadata: {
      targetUserId: user._id,
      targetEmail: user.email,
      credits,
      totalExtraSocialPostCredits: usage.extraSocialPostCredits || 0,
      periodStart,
      periodEnd,
      reason: req.body.reason || ''
    },
    req
  });
  res.redirect('/admin');
}));

router.post('/publish-actions/:id/retry', [param('id').isMongoId(), handleValidation], asyncHandler(async (req, res) => {
  const retry = await retryPublishAction({ actionId: req.params.id });
  await recordAuditEvent({
    user: req.user,
    projectId: retry.projectId,
    eventType: 'admin_publish_retry_queued',
    metadata: { sourceActionId: req.params.id, retryActionId: retry._id, integrationType: retry.integrationType },
    req
  });
  res.redirect('/admin');
}));

router.post('/publish-jobs/:id/retry', [param('id').isMongoId(), handleValidation], asyncHandler(async (req, res, next) => {
  const existing = await PublishJob.findById(req.params.id).lean();
  if (!existing) return next(new AppError('Publish job not found.', 404));
  const job = await retryPublishJob(existing._id);
  await recordAuditEvent({
    user: req.user,
    projectId: existing.projectId,
    eventType: 'admin_native_publish_retry_queued',
    severity: existing.errorCode === 'provider_outcome_unknown' ? 'warning' : 'info',
    metadata: {
      publishJobId: job._id,
      platform: job.platform,
      previousErrorCode: existing.errorCode,
      providerOutcomeWasUnknown: existing.errorCode === 'provider_outcome_unknown'
    },
    req
  });
  res.redirect('/admin');
}));

router.post('/publish-jobs/:id/metrics', [param('id').isMongoId(), handleValidation], asyncHandler(async (req, res, next) => {
  const existing = await PublishJob.findById(req.params.id).lean();
  if (!existing) return next(new AppError('Publish job not found.', 404));
  if (existing.status !== 'published') return next(new AppError('Metrics can only be collected for a published job.', 422));
  const result = await collectMetricsForJob(existing._id);
  await recordAuditEvent({
    user: req.user,
    projectId: existing.projectId,
    eventType: 'admin_social_metrics_collection_requested',
    status: result.success ? 'success' : 'failed',
    metadata: { publishJobId: existing._id, platform: existing.platform, error: result.error || '' },
    req
  });
  res.redirect('/admin');
}));

router.post('/webhook-deliveries/:id/retry', [param('id').isMongoId(), handleValidation], asyncHandler(async (req, res) => {
  const retry = await retryWebhookDelivery({ deliveryId: req.params.id });
  await recordAuditEvent({
    user: req.user,
    projectId: retry.delivery.projectId,
    eventType: 'admin_webhook_retry_sent',
    metadata: { deliveryId: req.params.id, status: retry.status },
    req
  });
  res.redirect('/admin');
}));

router.post('/email/customer', [
  body('to').isEmail().withMessage('Recipient email is required.').normalizeEmail(),
  body('subject').trim().notEmpty().isLength({ max: 160 }).withMessage('Subject is required.'),
  body('heading').trim().notEmpty().isLength({ max: 160 }).withMessage('Heading is required.'),
  body('message').trim().notEmpty().isLength({ max: 5000 }).withMessage('Message is required.'),
  handleValidation
], asyncHandler(async (req, res) => {
  await sendCustomerEmail({
    to: req.body.to,
    subject: req.body.subject,
    heading: req.body.heading,
    bodyHtml: `<p>${String(req.body.message).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>')}</p>`
  });
  await recordAuditEvent({ user: req.user, eventType: 'admin_customer_email_sent', metadata: { to: req.body.to, subject: req.body.subject }, req });
  res.redirect('/admin');
}));

router.post('/email/newsletter', [
  body('recipients').trim().notEmpty().withMessage('At least one recipient is required.'),
  body('subject').trim().notEmpty().isLength({ max: 160 }).withMessage('Subject is required.'),
  body('heading').trim().notEmpty().isLength({ max: 160 }).withMessage('Heading is required.'),
  body('summary').trim().notEmpty().isLength({ max: 5000 }).withMessage('Summary is required.'),
  handleValidation
], asyncHandler(async (req, res) => {
  const recipients = String(req.body.recipients || '').split(/[\n,]+/).map((item) => item.trim().toLowerCase()).filter(Boolean);
  const uniqueRecipients = [...new Set(recipients)].slice(0, 200);
  for (const to of uniqueRecipients) {
    await sendNewsletterEmail({
      to,
      subject: req.body.subject,
      heading: req.body.heading,
      summary: req.body.summary
    });
  }
  await recordAuditEvent({ user: req.user, eventType: 'admin_newsletter_sent', metadata: { count: uniqueRecipients.length, subject: req.body.subject }, req });
  res.redirect('/admin');
}));

router.get('/intello-daily', (req, res) => {
  res.redirect('/admin#intello-daily');
});

router.post('/intello-daily/:id/approve', [
  param('id').isMongoId(),
  handleValidation
], asyncHandler(async (req, res, next) => {
  const draft = await ContentDraft.findById(req.params.id);
  if (!draft) return next(new AppError('Intello Daily draft not found.', 404));

  draft.status = 'approved';
  draft.reviewNotes = `Approved by Operator (${req.user.email}) at ${new Date().toISOString()}`;
  await draft.save();

  // Approve accompanying social drafts
  await SocialDraft.updateMany(
    { sourceContentDraftId: draft._id },
    { $set: { status: 'approved', publishStatus: 'scheduled' } }
  );

  await recordAuditEvent({
    user: req.user,
    eventType: 'admin_intello_daily_approved',
    metadata: { draftId: draft._id, title: draft.title, projectId: draft.projectId },
    req
  });

  res.redirect('/admin#intello-daily');
}));

router.post('/intello-daily/:id/reject', [
  param('id').isMongoId(),
  body('reason').optional({ checkFalsy: true }).trim().isLength({ max: 300 }),
  handleValidation
], asyncHandler(async (req, res, next) => {
  const draft = await ContentDraft.findById(req.params.id);
  if (!draft) return next(new AppError('Intello Daily draft not found.', 404));

  draft.status = 'rejected';
  draft.reviewNotes = req.body.reason || `Rejected by Operator (${req.user.email})`;
  await draft.save();

  await SocialDraft.updateMany(
    { sourceContentDraftId: draft._id },
    { $set: { status: 'rejected' } }
  );

  await recordAuditEvent({
    user: req.user,
    eventType: 'admin_intello_daily_rejected',
    metadata: { draftId: draft._id, title: draft.title, projectId: draft.projectId, reason: req.body.reason },
    req
  });

  res.redirect('/admin#intello-daily');
}));

module.exports = router;
