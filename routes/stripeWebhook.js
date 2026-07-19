const express = require('express');
const asyncHandler = require('express-async-handler');
const { constructWebhookEvent, handleStripeEvent } = require('../services/stripeService');

const router = express.Router();

router.post('/webhooks/stripe', express.raw({ type: 'application/json' }), asyncHandler(async (req, res) => {
  const signature = req.headers['stripe-signature'];
  const event = constructWebhookEvent({ body: req.body, signature });
  await handleStripeEvent(event);
  res.json({ received: true });
}));

module.exports = router;
