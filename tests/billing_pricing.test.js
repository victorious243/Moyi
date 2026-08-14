const test = require('node:test');
const assert = require('node:assert/strict');

test('annual plans charge ten months and report the correct saving', () => {
  const { PLANS } = require('../config/plans');

  ['starter', 'pro', 'agency'].forEach((key) => {
    const plan = PLANS[key];
    assert.equal(plan.annualPrice, plan.monthlyPrice * 10);
    assert.equal(plan.annualSavings, plan.monthlyPrice * 2);
    assert.equal(plan.currency, 'EUR');
  });
});

test('plans include monthly social publishing allowances across all platforms', () => {
  const { PLANS } = require('../config/plans');
  const { socialPostAllowance } = require('../services/usageService');

  assert.equal(PLANS.free.socialPostsPerMonth, 5);
  assert.equal(PLANS.starter.socialPostsPerMonth, 50);
  assert.equal(PLANS.pro.socialPostsPerMonth, 200);
  assert.equal(PLANS.agency.socialPostsPerMonth, 1000);
  assert.equal(socialPostAllowance(PLANS.free, { extraSocialPostCredits: 12 }), 17);
});

test('Stripe price mapping keeps monthly and annual prices separate', () => {
  const values = {
    STRIPE_STARTER_PRICE_ID: 'price_starter_month',
    STRIPE_PRO_PRICE_ID: 'price_pro_month',
    STRIPE_AGENCY_PRICE_ID: 'price_agency_month',
    STRIPE_STARTER_ANNUAL_PRICE_ID: 'price_starter_year',
    STRIPE_PRO_ANNUAL_PRICE_ID: 'price_pro_year',
    STRIPE_AGENCY_ANNUAL_PRICE_ID: 'price_agency_year'
  };
  const previous = {};

  Object.entries(values).forEach(([key, value]) => {
    previous[key] = process.env[key];
    process.env[key] = value;
  });

  delete require.cache[require.resolve('../config/env')];
  delete require.cache[require.resolve('../services/stripeService')];
  const { priceIdForPlan } = require('../services/stripeService');

  assert.equal(priceIdForPlan('starter', 'monthly'), 'price_starter_month');
  assert.equal(priceIdForPlan('starter', 'annual'), 'price_starter_year');
  assert.equal(priceIdForPlan('pro', 'annual'), 'price_pro_year');
  assert.equal(priceIdForPlan('agency', 'annual'), 'price_agency_year');
  assert.equal(priceIdForPlan('free', 'annual'), '');

  Object.entries(previous).forEach(([key, value]) => {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  });
});
