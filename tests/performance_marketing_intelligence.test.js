const test = require('node:test');
const assert = require('node:assert/strict');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret';
process.env.TOKEN_ENCRYPTION_SECRET = process.env.TOKEN_ENCRYPTION_SECRET || 'test-token-secret';

const PaidAdAccount = require('../models/PaidAdAccount');
const PaidAdsProvider = require('../services/paidAds/provider');
const GoogleAdsProvider = require('../services/paidAds/providers/googleAds');
const MetaAdsProvider = require('../services/paidAds/providers/metaAds');
const {
  aggregateMetrics,
  budgetPacing,
  calculateDerivedMetrics
} = require('../services/paidAds/metrics');
const {
  buildBudgetRecommendations,
  campaignHealth,
  detectAlerts
} = require('../services/paidAds/intelligenceService');
const {
  confidenceForEvent,
  providerFromEvent
} = require('../services/paidAds/attributionService');

test('paid performance metric normalization preserves unavailable fields and derives unit economics', () => {
  const metrics = calculateDerivedMetrics({
    spend: 240,
    impressions: 12000,
    clicks: 300,
    conversions: 12,
    attributedRevenue: 960,
    leads: 24,
    qualifiedLeads: 10,
    purchases: 8
  });

  assert.equal(metrics.ctr, 0.025);
  assert.equal(metrics.cpc, 0.8);
  assert.equal(metrics.cpm, 20);
  assert.equal(metrics.cpa, 20);
  assert.equal(metrics.cac, 30);
  assert.equal(metrics.roas, 4);
  assert.equal(metrics.costPerLead, 10);
  assert.equal(metrics.reach, null);
  assert.equal(metrics.frequency, null);
});

test('paid metric aggregation does not manufacture zero for unavailable provider metrics', () => {
  const totals = aggregateMetrics([
    { metrics: { spend: 10, clicks: 5, impressions: 100 } },
    { metrics: { spend: 20, clicks: 5, impressions: 100 } }
  ]);
  assert.equal(totals.spend, 30);
  assert.equal(totals.clicks, 10);
  assert.equal(totals.ctr, 0.05);
  assert.equal(totals.reach, null);
  assert.equal(totals.conversions, null);
  assert.equal(totals.roas, null);
});

test('budget pacing compares elapsed budget with actual spend', () => {
  const pacing = budgetPacing({
    spend: 700,
    budget: 1000,
    periodStart: '2026-08-01T00:00:00Z',
    periodEnd: '2026-08-11T00:00:00Z',
    asOf: '2026-08-06T00:00:00Z'
  });
  assert.equal(pacing.expectedSpend, 500);
  assert.equal(pacing.paceRatio, 1.4);
  assert.equal(pacing.projectedSpend, 1400);
  assert.equal(pacing.status, 'overspending');
});

test('exact paid click IDs receive high-confidence provider attribution', () => {
  const event = {
    utmSource: 'google',
    utmMedium: 'cpc',
    utmCampaign: 'brand-search',
    clickIds: { gclid: 'sensitive-click-id' }
  };
  const source = providerFromEvent(event);
  assert.deepEqual(source, { provider: 'google_ads', clickIdType: 'gclid', clickId: 'sensitive-click-id' });
  assert.deepEqual(confidenceForEvent(event, source), {
    score: 100,
    band: 'high',
    reason: 'Exact gclid click identifier captured.'
  });
});

test('alert engine detects spend waste, cost spikes, ROAS decline, and fatigue', () => {
  const current = { spend: 200, conversions: 0, cpc: 4, cpm: 30, ctr: 0.01, cpa: null, cac: null, roas: 0, frequency: 4 };
  const previous = { spend: 100, conversions: 4, cpc: 2, cpm: 15, ctr: 0.02, cpa: 25, cac: 30, roas: 2, frequency: 2 };
  const alerts = detectAlerts({
    entityName: 'Prospecting',
    current,
    previous,
    pacing: { status: 'overspending', projectedSpend: 1200, paceRatio: 1.3 }
  });
  const types = alerts.map((item) => item.type);
  assert.ok(types.includes('ad_spend_spike'));
  assert.ok(types.includes('ad_spend_no_conversion'));
  assert.ok(types.includes('budget_pacing'));
  assert.ok(types.includes('cpc_spike'));
  assert.ok(types.includes('cpm_spike'));
  assert.ok(types.includes('ctr_drop'));
  assert.ok(types.includes('roas_drop'));
  assert.ok(types.includes('creative_fatigue'));
  assert.ok(types.includes('campaign_underperforming'));

  const audienceTypes = detectAlerts({
    current: { ...current, frequency: 4.2, ctr: 0.01 },
    previous: { ...previous, ctr: 0.02 },
    pacing: { status: 'unknown' },
    entityName: 'High-frequency audience',
    level: 'audience'
  }).map((item) => item.type);
  assert.ok(audienceTypes.includes('audience_saturation'));

  const creativeTypes = detectAlerts({
    current: { ...current, roas: 3.2, conversions: 6 },
    previous,
    pacing: { status: 'unknown' },
    entityName: 'Creative A',
    level: 'creative'
  }).map((item) => item.type);
  assert.ok(creativeTypes.includes('winning_ad_detected'));
});

test('budget recommendation requires measured evidence and remains a proposal', () => {
  const recommendations = buildBudgetRecommendations([
    { name: 'Google Search', provider: 'google_ads', metrics: { spend: 240, qualifiedLeads: 10, conversions: 10, cpa: 24 } },
    { name: 'Meta', provider: 'meta_ads', metrics: { spend: 460, qualifiedLeads: 10, conversions: 10, cpa: 46 } }
  ], { start: new Date('2026-08-01'), end: new Date('2026-08-07') });
  assert.equal(recommendations.length, 1);
  assert.equal(recommendations[0].sourceProvider, 'meta_ads');
  assert.equal(recommendations[0].destinationProvider, 'google_ads');
  assert.equal(recommendations[0].proposedShiftPercent, 15);
  assert.match(recommendations[0].proposedChange, /Consider moving 15%/);
});

test('campaign health reports evidence coverage instead of pretending every dimension is known', () => {
  const health = campaignHealth({ roas: 3, cpa: 20, leads: null, frequency: null, websiteSessions: null }, {
    pacing: { status: 'unknown', paceRatio: null }
  });
  assert.equal(health.score, 100);
  assert.equal(health.grade, 'A');
  assert.ok(health.coverage < 50);
  assert.equal(health.dimensions.conversionQuality, null);
});

test('Google Ads normalization converts micros and preserves unsupported reach as null', () => {
  const provider = new GoogleAdsProvider();
  const row = provider.normalizeRow({
    campaign: { id: '11', name: 'High Intent', status: 'ENABLED', advertisingChannelType: 'SEARCH' },
    campaignBudget: { amountMicros: '50000000' },
    segments: { date: '2026-08-20' },
    metrics: {
      costMicros: '24000000', impressions: '1200', clicks: '60', conversions: 4,
      conversionsValue: 120, averageCpc: '400000', averageCpm: '20000000'
    }
  }, 'campaign', 'EUR');
  assert.equal(row.metrics.spend, 24);
  assert.equal(row.metrics.budget, 50);
  assert.equal(row.metrics.cpc, 0.4);
  assert.equal(row.metrics.roas, 5);
  assert.equal(row.metrics.reach, null);
});

test('Meta Ads normalization maps action metrics without assuming identical provider fields', () => {
  const provider = new MetaAdsProvider();
  const row = provider.normalizeRow({
    campaign_id: '22', campaign_name: 'Prospecting', date_start: '2026-08-20',
    spend: '100', impressions: '10000', reach: '7000', clicks: '150', ctr: '1.5',
    actions: [{ action_type: 'lead', value: '8' }],
    action_values: []
  }, 'campaign', 'EUR');
  assert.equal(row.metrics.leads, 8);
  assert.equal(row.metrics.ctr, 0.015);
  assert.equal(row.metrics.costPerLead, 12.5);
  assert.equal(row.metrics.conversionValue, null);
});

test('provider token failures distinguish reconnect and rate-limit handling', () => {
  const provider = new PaidAdsProvider('test');
  assert.deepEqual(provider.classifyError({ response: { status: 401 } }), {
    code: 'token_expired', reconnectRequired: true, retryable: false
  });
  assert.deepEqual(provider.classifyError({ response: { status: 429 } }), {
    code: 'rate_limited', reconnectRequired: false, retryable: true
  });
});

test('paid account secrets are excluded from ordinary queries', () => {
  assert.equal(PaidAdAccount.schema.path('encryptedAccessToken').options.select, false);
  assert.equal(PaidAdAccount.schema.path('encryptedRefreshToken').options.select, false);
});
