const express = require('express');
const asyncHandler = require('express-async-handler');
const { body } = require('express-validator');
const { PLANS, planFor } = require('../config/plans');
const { requireAuth } = require('../middleware/auth');
const handleValidation = require('../utils/validate');
const { createCheckoutSession, createPortalSession } = require('../services/stripeService');
const { getCurrentUsage } = require('../services/usageService');

const router = express.Router();

router.get('/pricing', (req, res) => {
  const billingInterval = req.query.billing === 'annual' ? 'annual' : 'monthly';
  res.render('pricing', {
    title: 'Pricing',
    plans: PLANS,
    billingInterval,
    canceled: req.query.canceled || ''
  });
});

router.get('/billing', requireAuth, asyncHandler(async (req, res) => {
  const usage = await getCurrentUsage(req.user._id);
  res.render('billing/index', {
    title: 'Billing',
    plan: planFor(req.user),
    usage,
    successMessage: req.query.success ? 'Billing updated.' : '',
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
