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
const { retryWebhookDelivery } = require('../services/webhookService');
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

module.exports = router;
