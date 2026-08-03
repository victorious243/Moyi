const test = require('node:test');
const assert = require('node:assert/strict');
const {
  describeExecutionImpact,
  scoreAttributionReadiness,
  summarizeTrackingWindow
} = require('../services/measurementService');
const {
  buildEvidenceSnapshot,
  buildSystemReport
} = require('../services/cmoReportService');

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

test('CMO measurement report separates zero metrics from real scan evidence', () => {
  const measurementSnapshot = {
    tracking: {
      current: { sessions: 0, pageViews: 0 },
      changes: {
        conversions: { current: 0, previous: 0, delta: 0, percent: null }
      }
    },
    executionImpact: {
      summary: {
        movedCount: 0,
        backwardCount: 0,
        noMovementCount: 0
      }
    },
    attributionReadiness: {
      score: 0,
      conversionGoalCount: 0,
      revenueStatus: 'Revenue attribution stays locked until a real payment or CRM source is connected.'
    }
  };
  const operationalContext = {
    latestScan: { pagesScanned: 12, pagesFound: 15 },
    issueCounts: { critical: 2, warning: 5, opportunity: 4 },
    recommendationStatusCounts: { pending: 3, accepted: 1, done: 2 },
    contentDraftStatusCounts: { approved: 1, published_manually: 1 },
    contentActionsCompleted: [{ title: 'Approved post' }],
    openRecommendations: [
      { title: 'Fix missing meta descriptions' },
      { title: 'Add H1 to homepage' }
    ]
  };
  const metricsSnapshot = {
    searchConsoleConnected: false,
    current: { clicks: 0, impressions: 0, ctr: 0, position: 0 },
    changes: {
      clicks: { delta: 0, percent: null },
      impressions: { delta: 0, percent: null }
    },
    topGainingPages: [],
    topLosingPages: [],
    lowCtrOpportunities: []
  };

  const evidence = buildEvidenceSnapshot({ operationalContext, measurementSnapshot });
  const report = buildSystemReport({
    type: 'weekly',
    metricsSnapshot,
    operationalContext,
    measurementSnapshot,
    evidenceSnapshot: evidence
  });

  assert.equal(evidence.pagesScanned, 12);
  assert.equal(evidence.openRecommendations, 4);
  assert.match(report.summary, /12 pages scanned/);
  assert.match(report.summary, /2 critical issues/);
  assert.ok(report.losses.some((item) => /critical SEO issue/i.test(item)));
  assert.ok(report.opportunities.some((item) => /Connect and sync Search Console/i.test(item)));
});
