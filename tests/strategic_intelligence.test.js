const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { buildForecast, probabilityOfGoal, weightedStats } = require('../services/strategy/forecastingService');
const { detectSearchDemandShifts, isCommercialQuery } = require('../services/strategy/searchDemandService');
const { detectAudienceShifts, segmentSummary } = require('../services/strategy/audienceIntelligenceService');
const { detectCompetitorChanges, pageRecord } = require('../services/strategy/competitorMonitoringService');
const { applyDecisionAction, forecastAlertType, measurementForOpportunity, reviewSections } = require('../services/strategy/strategicIntelligenceService');
const StrategicOpportunity = require('../models/StrategicOpportunity');
const StrategicDecision = require('../models/StrategicDecision');

function points(count, valueFor, start = '2026-07-01T00:00:00.000Z') {
  return Array.from({ length: count }, (_item, index) => ({
    date: new Date(new Date(start).getTime() + index * 86400000),
    value: valueFor(index)
  }));
}

test('forecasting requires seven observed days and does not invent a value', () => {
  const forecast = buildForecast({ metric: 'revenue', points: points(6, () => 10), periodStart: '2026-07-01', periodEnd: '2026-07-31', now: new Date('2026-07-06') });
  assert.equal(forecast.method, 'insufficient_data');
  assert.equal(forecast.forecastValue, null);
  assert.equal(forecast.confidence.band, 'insufficient');
});

test('additive forecasting exposes trend, range, and a bounded goal probability', () => {
  const forecast = buildForecast({ metric: 'leads', points: points(20, (index) => 5 + index), periodStart: '2026-07-01', periodEnd: '2026-07-31', targetValue: 300, now: new Date('2026-07-20T12:00:00Z') });
  assert.equal(forecast.method, 'linear_daily_trend');
  assert.ok(forecast.forecastValue > forecast.currentValue);
  assert.ok(forecast.lowerBound < forecast.forecastValue);
  assert.ok(forecast.upperBound > forecast.forecastValue);
  assert.ok(forecast.goalAchievementProbability >= 0 && forecast.goalAchievementProbability <= 100);
});

test('ratio forecasting uses a recent-value weighted mean', () => {
  const stats = weightedStats([1, 1, 1, 4]);
  assert.ok(stats.mean > 1);
  const forecast = buildForecast({ metric: 'roas', points: points(8, (index) => index < 7 ? 1 : 4), periodStart: '2026-07-01', periodEnd: '2026-07-31', now: new Date('2026-07-08') });
  assert.equal(forecast.method, 'weighted_ratio');
  assert.ok(forecast.forecastValue > 1);
  assert.ok(forecast.forecastValue < 4);
});

test('goal alert comparison respects confidence and target direction', () => {
  assert.equal(forecastAlertType({ direction: 'increase', targetValue: 100 }, { confidence: { band: 'insufficient' }, goalAchievementProbability: null }), '');
  assert.equal(forecastAlertType({ direction: 'increase', targetValue: 100 }, { confidence: { band: 'high' }, goalAchievementProbability: 20, forecastValue: 80 }), 'goal_at_risk');
  assert.equal(forecastAlertType({ direction: 'decrease', targetValue: 20 }, { confidence: { band: 'high' }, goalAchievementProbability: 60, forecastValue: 25 }), 'forecast_below_target');
  assert.ok(probabilityOfGoal({ forecastValue: 120, standardError: 10, targetValue: 100 }) > 50);
});

test('search intelligence separates demand from ranking movement and captures disappearing demand', () => {
  const current = [
    { query: 'podcast software pricing', impressions: 200, clicks: 20, position: 4 },
    { query: 'podcast editor', impressions: 220, clicks: 15, position: 3 }
  ];
  const previous = [
    { query: 'podcast software pricing', impressions: 100, clicks: 10, position: 4.5 },
    { query: 'podcast editor', impressions: 100, clicks: 8, position: 8 },
    { query: 'old podcast tool', impressions: 80, clicks: 4, position: 5 }
  ];
  const signals = detectSearchDemandShifts(current, previous, 'VicPods');
  assert.equal(signals.find((item) => item.query === 'podcast software pricing').kind, 'demand_increase');
  assert.equal(signals.find((item) => item.query === 'podcast editor').kind, 'ranking_change');
  assert.equal(signals.find((item) => item.query === 'old podcast tool').kind, 'demand_decline');
  assert.equal(isCommercialQuery('best podcast software pricing'), true);
});

test('audience intelligence requires samples and detects channel, conversion, and engagement shifts', () => {
  const sparse = detectAudienceShifts({ totalSessions: 5, sources: { x: 5 }, countries: {}, conversionRate: 0, returningVisitors: 0, pagesPerSession: 1 }, { totalSessions: 5, sources: { x: 0 }, countries: {}, conversionRate: 0, returningVisitors: 0, pagesPerSession: 1 });
  assert.deepEqual(sparse, []);
  const current = { totalSessions: 100, sources: { x: 60, direct: 40 }, countries: { IE: 60 }, conversionRate: 0.08, returningVisitors: 40, pagesPerSession: 2 };
  const previous = { totalSessions: 100, sources: { x: 30, direct: 70 }, countries: { IE: 30 }, conversionRate: 0.03, returningVisitors: 20, pagesPerSession: 1.2 };
  const signals = detectAudienceShifts(current, previous);
  assert.ok(signals.some((item) => item.type === 'channel'));
  assert.ok(signals.some((item) => item.type === 'conversion_behavior'));
  assert.ok(signals.some((item) => item.type === 'engagement_quality'));
});

test('session summaries are based on distinct first-party sessions', () => {
  const events = [
    { sessionId: 'a', visitorId: 'new', eventType: 'page_view', utmSource: 'x', country: 'IE' },
    { sessionId: 'a', visitorId: 'new', eventType: 'conversion', utmSource: 'x', country: 'IE' },
    { sessionId: 'b', visitorId: 'known', eventType: 'page_view', utmSource: 'google', country: 'US' }
  ];
  const summary = segmentSummary(events, new Set(['known']));
  assert.equal(summary.totalSessions, 2);
  assert.equal(summary.conversions, 1);
  assert.equal(summary.returningVisitors, 1);
});

test('competitor monitoring detects only observable public-page changes', () => {
  const oldPage = pageRecord({ url: 'https://example.com/pricing', title: 'Simple plans', h1: ['Pricing'], headings: [], wordCount: 300 });
  const newPage = pageRecord({ url: 'https://example.com/pricing', title: 'New enterprise price plans', h1: ['Pricing'], headings: [], wordCount: 350 });
  const campaign = pageRecord({ url: 'https://example.com/webinar', title: 'Register now for our webinar', h1: [], headings: [], wordCount: 200 });
  const changes = detectCompetitorChanges({ pages: [oldPage], summary: { positioningTerms: [] } }, [newPage, campaign]);
  assert.ok(changes.some((item) => item.type === 'pricing_change'));
  assert.ok(changes.some((item) => item.type === 'new_campaign'));
});

test('opportunities and decisions enforce dedupe and lifecycle values', () => {
  const projectId = new mongoose.Types.ObjectId();
  const opportunity = new StrategicOpportunity({ projectId, type: 'search', title: 'Demand shift', opportunity: 'Capture demand', evidence: { impressions: 100 }, evidenceSummary: 'Observed in Search Console.', confidence: 75, potentialImpact: 'high', difficulty: 'medium', recommendedAction: 'Test a relevant page.', dedupeKey: 'search:demand:podcast' });
  assert.equal(opportunity.validateSync(), undefined);
  const invalid = new StrategicDecision({ projectId, ownerId: new mongoose.Types.ObjectId(), title: 'Decision', recommendation: 'Test', evidenceAtDecision: {}, confidenceAtDecision: 70, decision: 'automatic' });
  assert.match(invalid.validateSync().message, /decision/);
  const indexes = StrategicOpportunity.schema.indexes();
  assert.ok(indexes.some(([fields, options]) => fields.projectId === 1 && fields.dedupeKey === 1 && options.unique));
  const decision = { decision: 'accepted', executionStatus: 'not_started', decisionReason: '' };
  applyDecisionAction(decision, 'start', '', new Date('2026-08-01'));
  assert.equal(decision.executionStatus, 'in_progress');
  applyDecisionAction(decision, 'complete', 'Executed by owner', new Date('2026-08-02'));
  assert.equal(decision.executionStatus, 'completed');
  assert.equal(decision.measurementDueAt.toISOString(), '2026-09-01T00:00:00.000Z');
  assert.equal(measurementForOpportunity({ type: 'search', evidence: { query: 'podcast software', current: { impressions: 200 } } }).beforeValue, 200);
});

test('monthly review sections stay evidence-backed and preserve unavailable sections', () => {
  const sections = reviewSections({
    dashboard: {
      forecasts: [{ metric: 'revenue', horizon: 'end_of_month', forecastValue: null, lowerBound: null, upperBound: null, confidence: { band: 'insufficient' } }],
      alerts: [], opportunities: [], competitorSnapshots: [], decisions: []
    },
    periodStart: new Date('2026-07-01'), periodEnd: new Date('2026-07-31')
  });
  assert.match(sections.revenuePipeline[0], /unavailable/);
  assert.deepEqual(sections.majorOpportunities, []);
});
