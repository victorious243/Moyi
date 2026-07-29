const test = require('node:test');
const assert = require('node:assert/strict');
const {
  describeExecutionImpact,
  scoreAttributionReadiness,
  summarizeTrackingWindow
} = require('../services/measurementService');

test('Phase 4 attribution readiness stays conversion-first when no real revenue source exists', () => {
  const readiness = scoreAttributionReadiness({
    conversionGoalCount: 2,
    trackedConversions: 6,
    identifiedSessions: 4,
    attributedSessions: 5,
    revenueSourceConnected: false
  });

  assert.equal(readiness.score, 80);
  assert.equal(readiness.revenueReady, false);
  assert.match(readiness.revenueStatus, /Revenue attribution stays locked/i);
});

test('Phase 4 page-level traffic quality uses sessions that touched the target page', () => {
  const events = [
    { eventType: 'page_view', sessionId: 's1', url: 'https://moyi.example/pricing?utm=1', resolvedEmail: 'buyer@example.com' },
    { eventType: 'conversion', sessionId: 's1', url: 'https://moyi.example/thank-you', resolvedEmail: 'buyer@example.com' },
    { eventType: 'page_view', sessionId: 's2', url: 'https://moyi.example/pricing', utmSource: 'google' },
    { eventType: 'page_view', sessionId: 's3', url: 'https://moyi.example/blog' },
    { eventType: 'conversion', sessionId: 's3', url: 'https://moyi.example/thank-you' }
  ];

  const summary = summarizeTrackingWindow(events, ['https://moyi.example/pricing']);

  assert.equal(summary.pageViews, 2);
  assert.equal(summary.sessions, 2);
  assert.equal(summary.conversions, 1);
  assert.equal(summary.identifiedSessions, 1);
  assert.equal(summary.attributedSessions, 2);
  assert.equal(summary.conversionRate, 0.5);
  assert.equal(summary.identifiedRate, 0.5);
});

test('Phase 4 execution impact calls out movement and non-movement separately', () => {
  const outcome = describeExecutionImpact({
    comparisonDays: 7,
    visibilityChanges: {
      clicks: { delta: 12 },
      impressions: { delta: 120 },
      ctr: { delta: 0.003 },
      position: { delta: 0 }
    },
    trafficChanges: {
      conversions: { delta: 0 },
      conversionRate: { delta: 0 },
      identifiedSessions: { delta: 3 }
    }
  });

  assert.equal(outcome.status, 'Moved');
  assert.ok(outcome.whatMoved.some((item) => /visibility improved/i.test(item)));
  assert.ok(outcome.whatDidNotMove.some((item) => item.includes('Conversion count')));
});
