const test = require('node:test');
const assert = require('node:assert/strict');
const {
  MIN_PLATFORM_SAMPLE,
  buildCalendarIntelligence,
  classifyContent,
  confidenceFor
} = require('../services/calendarIntelligenceService');

const NOW = new Date('2026-08-26T12:00:00.000Z');

function dateAt(days, hour = 12) {
  const date = new Date(NOW);
  date.setUTCDate(date.getUTCDate() + days);
  date.setUTCHours(hour, 0, 0, 0);
  return date;
}

function performance(index, options = {}) {
  const rate = options.rate;
  const engagement = options.engagement;
  const metric = rate !== undefined
    ? { family: 'socialEngagementRate', value: rate, status: 'verified' }
    : engagement !== undefined
      ? { family: 'meaningfulEngagement', value: engagement, status: 'verified' }
      : null;
  return {
    _id: `performance-${index}`,
    draftId: `historical-draft-${index}`,
    platform: options.platform || 'linkedin',
    contentType: options.contentType || 'image',
    publishedAt: options.publishedAt || dateAt(-index - 1, options.hour ?? 18),
    lastObservedAt: options.lastObservedAt || dateAt(-1),
    latestNormalizedMetrics: metric ? [metric] : [],
    confidence: { score: 0.8, label: 'strong' }
  };
}

function draft(index, options = {}) {
  return {
    _id: options._id || `draft-${index}`,
    campaignId: options.campaignId || null,
    channel: options.channel || 'linkedin',
    title: options.title || 'How to improve your marketing workflow',
    body: options.body || 'A practical guide and checklist for building a better marketing workflow.',
    metadata: options.metadata || { contentType: 'image' },
    status: options.status || 'draft',
    publishStatus: options.publishStatus || 'approved',
    scheduledFor: options.scheduledFor === null ? null : (options.scheduledFor || dateAt(index + 1, 10))
  };
}

test('new projects keep the calendar usable and report insufficient performance data', () => {
  const result = buildCalendarIntelligence({ drafts: [], performances: [], now: NOW });
  assert.equal(result.dataQuality.status, 'insufficient');
  assert.match(result.dataQuality.message, /needs more published-post performance data/i);
  assert.equal(result.insights.some((item) => item.type === 'stronger_timing_window'), false);
});

test('one measured post never produces a performance winner', () => {
  const result = buildCalendarIntelligence({ performances: [performance(1, { rate: 0.04 })], now: NOW });
  assert.equal(result.dataQuality.status, 'building');
  assert.equal(result.dataQuality.measuredPosts, 1);
  assert.equal(result.insights.some((item) => /timing|advantage/.test(item.type)), false);
});

test('sufficient same-platform history produces an evidence-backed timing recommendation', () => {
  const performances = [
    performance(1, { rate: 0.04, publishedAt: dateAt(-1, 18) }),
    performance(2, { rate: 0.045, publishedAt: dateAt(-8, 18) }),
    performance(3, { rate: 0.05, publishedAt: dateAt(-15, 18) }),
    performance(4, { rate: 0.01, publishedAt: dateAt(-2, 10) }),
    performance(5, { rate: 0.012, publishedAt: dateAt(-3, 10) }),
    performance(6, { rate: 0.015, publishedAt: dateAt(-4, 13) })
  ];
  const result = buildCalendarIntelligence({ drafts: [draft(1)], performances, now: NOW, timezone: 'UTC' });
  const insight = result.insights.find((item) => item.type === 'stronger_timing_window');
  assert.ok(insight);
  assert.equal(insight.classification, 'measured');
  assert.ok(insight.evidence.lines.some((line) => line.includes(`${MIN_PLATFORM_SAMPLE} comparable`)));
  assert.match(insight.evidence.correlationNotice, /not proven/i);
});

test('median timing comparisons resist one extreme viral outlier', () => {
  const performances = [
    performance(1, { rate: 0.02, publishedAt: dateAt(-1, 18) }),
    performance(2, { rate: 0.02, publishedAt: dateAt(-8, 18) }),
    performance(3, { rate: 1, publishedAt: dateAt(-15, 18) }),
    performance(4, { rate: 0.01, publishedAt: dateAt(-2, 10) }),
    performance(5, { rate: 0.01, publishedAt: dateAt(-3, 10) }),
    performance(6, { rate: 0.01, publishedAt: dateAt(-4, 13) })
  ];
  const result = buildCalendarIntelligence({ performances, now: NOW, timezone: 'UTC' });
  const insight = result.insights.find((item) => item.type === 'stronger_timing_window');
  assert.ok(insight);
  assert.doesNotMatch(insight.summary, /[3-9][0-9]{2,}%/);
  assert.match(result.methodology.outliers, /Medians/);
});

test('platform performance is compared only with the same platform', () => {
  const linkedin = [
    performance(1, { rate: 0.04, publishedAt: dateAt(-1, 18) }),
    performance(2, { rate: 0.045, publishedAt: dateAt(-8, 18) }),
    performance(3, { rate: 0.05, publishedAt: dateAt(-15, 18) }),
    performance(4, { rate: 0.01, publishedAt: dateAt(-2, 10) }),
    performance(5, { rate: 0.01, publishedAt: dateAt(-3, 10) }),
    performance(6, { rate: 0.01, publishedAt: dateAt(-4, 10) })
  ];
  const x = Array.from({ length: 6 }, (_, index) => performance(index + 20, { platform: 'x', rate: 0.5, publishedAt: dateAt(-(index + 1), 9) }));
  const result = buildCalendarIntelligence({ performances: [...linkedin, ...x], now: NOW });
  const linkedinTiming = result.insights.find((item) => item.type === 'stronger_timing_window' && /Linkedin/.test(item.title));
  assert.ok(linkedinTiming);
  assert.match(linkedinTiming.evidence.lines.join(' '), /6 comparable Linkedin posts/);
});

test('missing engagement fields do not become zero-valued evidence', () => {
  const performances = Array.from({ length: 8 }, (_, index) => performance(index + 1));
  const result = buildCalendarIntelligence({ performances, now: NOW });
  assert.equal(result.dataQuality.measuredPosts, 0);
  assert.equal(result.insights.some((item) => /advantage|timing/.test(item.type)), false);
});

test('format recommendations reuse matching canonical GrowthSignal evidence', () => {
  const performances = [
    ...Array.from({ length: 3 }, (_, index) => performance(index + 1, { rate: 0.05, contentType: 'carousel' })),
    ...Array.from({ length: 3 }, (_, index) => performance(index + 10, { rate: 0.01, contentType: 'text' }))
  ];
  const growthSignals = [{
    _id: 'signal-1',
    platform: 'linkedin',
    observedAt: dateAt(-1),
    evidence: { contentType: 'carousel' }
  }];
  const result = buildCalendarIntelligence({ performances, growthSignals, now: NOW });
  const insight = result.insights.find((item) => item.type === 'content_format_advantage');
  assert.ok(insight);
  assert.deepEqual(insight.evidence.growthSignalIds, ['signal-1']);
});

test('gap detection uses the project recent cadence and connected platform', () => {
  const performances = Array.from({ length: 8 }, (_, index) => performance(index + 1, { rate: 0.02, publishedAt: dateAt(-(index + 1)) }));
  const result = buildCalendarIntelligence({
    performances,
    accounts: [{ platform: 'linkedin', status: 'connected' }],
    drafts: [],
    now: NOW
  });
  const insight = result.insights.find((item) => item.type === 'platform_content_gap');
  assert.ok(insight);
  assert.match(insight.summary, /2 posts per week/);
  assert.equal(insight.recommendedAction.label, 'Generate content');
});

test('campaign coverage identifies an active campaign with no upcoming content', () => {
  const campaign = { _id: 'campaign-1', name: 'September Launch', status: 'active', startDate: dateAt(-3), endDate: dateAt(6) };
  const result = buildCalendarIntelligence({ campaigns: [campaign], drafts: [], now: NOW });
  const insight = result.insights.find((item) => item.type === 'campaign_content_gap');
  assert.ok(insight);
  assert.equal(result.campaignCoverage[0].upcomingPosts, 0);
  assert.match(insight.summary, /ends in 6 days/);
});

test('content mix classification stays structured and leaves unknown copy unclassified', () => {
  assert.equal(classifyContent({ body: 'How to build a useful checklist for your team' }), 'educational');
  assert.equal(classifyContent({ body: 'Use code SAVE20 for this limited time offer' }), 'promotional');
  assert.equal(classifyContent({ body: 'Hello world' }), 'unknown');
  const result = buildCalendarIntelligence({
    drafts: [
      draft(1),
      draft(2),
      draft(3, { body: 'Use code SAVE20 for this limited time offer' }),
      draft(4, { body: 'Customer case study and proof from the latest launch' })
    ],
    now: NOW
  });
  assert.equal(result.contentMix.reduce((sum, item) => sum + item.percentage, 0), 100);
  assert.ok(result.contentMix.some((item) => item.category === 'educational'));
});

test('content mix advice appears only when measured category history supports it', () => {
  const historicalDrafts = [
    ...Array.from({ length: 3 }, (_, index) => draft(index, { _id: `historical-draft-${index + 1}`, body: 'How to use this practical tutorial and checklist', scheduledFor: dateAt(-(index + 1)) })),
    ...Array.from({ length: 3 }, (_, index) => draft(index + 10, { _id: `historical-draft-${index + 10}`, body: 'Limited time offer with a product discount', scheduledFor: dateAt(-(index + 4)) }))
  ];
  const performances = [
    ...Array.from({ length: 3 }, (_, index) => performance(index + 1, { rate: 0.05 })),
    ...Array.from({ length: 3 }, (_, index) => performance(index + 10, { rate: 0.01 }))
  ];
  const upcoming = Array.from({ length: 4 }, (_, index) => draft(index + 30, { body: 'Limited time offer with a product discount', scheduledFor: dateAt(index + 1) }));
  const result = buildCalendarIntelligence({ drafts: [...historicalDrafts, ...upcoming], performances, now: NOW });
  const insight = result.insights.find((item) => item.type === 'content_mix_opportunity');
  assert.ok(insight);
  assert.equal(insight.classification, 'measured');
  assert.match(insight.evidence.formula, /category median/);
});

test('insight ranking prioritizes urgent campaign risk over lower-impact planning observations', () => {
  const campaign = { _id: 'campaign-1', name: 'Tomorrow Launch', status: 'active', startDate: dateAt(-2), endDate: dateAt(1) };
  const drafts = Array.from({ length: 6 }, (_, index) => draft(index, { scheduledFor: dateAt(1, 10) }));
  const result = buildCalendarIntelligence({ campaigns: [campaign], drafts, now: NOW });
  assert.equal(result.insights[0].type, 'campaign_content_gap');
  assert.equal(result.insights[0].severity, 'warning');
});

test('stale performance is counted but excluded from recommendations', () => {
  const performances = Array.from({ length: 8 }, (_, index) => performance(index + 1, { rate: 0.05, lastObservedAt: dateAt(-45) }));
  const result = buildCalendarIntelligence({ performances, now: NOW });
  assert.equal(result.dataQuality.measuredPosts, 0);
  assert.equal(result.dataQuality.stalePerformanceCount, 8);
  assert.equal(result.insights.some((item) => /advantage|timing/.test(item.type)), false);
});

test('a newly measured post changes the evidence count without fabricated defaults', () => {
  const before = buildCalendarIntelligence({ performances: [], now: NOW });
  const after = buildCalendarIntelligence({ performances: [performance(1, { rate: 0.03 })], now: NOW });
  assert.equal(before.dataQuality.measuredPosts, 0);
  assert.equal(after.dataQuality.measuredPosts, 1);
  assert.equal(after.dataQuality.status, 'building');
});

test('confidence combines sample, consistency, and recency transparently', () => {
  const strong = confidenceFor({ platformSample: 12, segmentSample: 6, consistency: 0.85, freshestAt: dateAt(-1), now: NOW });
  const weak = confidenceFor({ platformSample: 6, segmentSample: 3, consistency: 0.34, freshestAt: dateAt(-25), now: NOW });
  assert.equal(strong.level, 'high');
  assert.ok(strong.score > weak.score);
  assert.equal(weak.level, 'low');
});
