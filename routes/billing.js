const express = require('express');
const asyncHandler = require('express-async-handler');
const { body } = require('express-validator');
const { PLANS, planFor } = require('../config/plans');
const { requireAuth } = require('../middleware/auth');
const handleValidation = require('../utils/validate');
const { createCheckoutSession, createPortalSession } = require('../services/stripeService');
const { getCurrentUsage, socialPostAllowance } = require('../services/usageService');

const router = express.Router();

router.get('/pricing', (req, res) => {
  const billingInterval = req.query.billing === 'annual' ? 'annual' : 'monthly';
  res.render('pricing', {
    title: 'Transparent AI CMO Pricing & Plans',
    seoDescription: 'Transparent pricing for Moyi-CMO. Autonomous SEO audits, content drafts, and social publishing starting at €49/mo.',
    plans: PLANS,
    billingInterval,
    canceled: req.query.canceled || ''
  });
});

router.get('/billing', requireAuth, asyncHandler(async (req, res) => {
  const usage = await getCurrentUsage(req.user._id);
  const plan = planFor(req.user);
  res.render('billing/index', {
    title: 'Billing',
    plan,
    publicPlans: PLANS,
    usage,
    socialPostAllowance: socialPostAllowance(plan, usage),
    successMessage: req.query.success ? 'Thank you! Your subscription has been successfully updated.' : '',
    isCheckoutSuccess: Boolean(req.query.success),
    errorMessage: req.query.error || ''
  });
}));

router.post(
  '/billing/create-checkout-session',
  requireAuth,
  [
    body('plan').isIn(['starter', 'pro', 'agency']).withMessage('Plan is invalid.'),
    body('billingInterval').optional().isIn(['monthly', 'annual']).withMessage('Billing interval is invalid.'),
    handleValidation
  ],
  asyncHandler(async (req, res) => {
    try {
      const session = await createCheckoutSession({
        user: req.user,
        plan: req.body.plan,
        billingInterval: req.body.billingInterval || 'monthly'
      });
      res.redirect(session.url);
    } catch (error) {
      res.redirect(`/billing?error=${encodeURIComponent(error.message)}`);
    }
  })
);

router.post('/billing/create-portal-session', requireAuth, asyncHandler(async (req, res) => {
  try {
    const session = await createPortalSession(req.user);
    res.redirect(session.url);
  } catch (error) {
    res.redirect(`/billing?error=${encodeURIComponent(error.message)}`);
  }
}));

module.exports = router;
