const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

const SocialPostPerformance = require('../models/SocialPostPerformance');
const {
  calculateVelocity,
  captureLifecycleWindows,
  median,
  normalizeMetricFamilies,
  normalizedValue,
  percentileRank,
  recencyWeight
} = require('../services/socialPerformanceMath');
const {
  compareWithBaselines,
  confidenceFor,
  detectAnomalies,
  mostComparableHistory,
  scoreFromComparison
} = require('../services/socialPostPerformanceService');
const {
  buildGrowthBrainUpgradeFromSignals,
  buildRecommendationInputsFromSignals,
  postPerformanceRow,
  socialDataHealth,
  summarizePlatforms
} = require('../services/socialAnalyticsService');

const SOCIAL_COMPONENTS = ['likes', 'reactions', 'comments', 'shares', 'reposts', 'quotes', 'saves', 'linkClicks', 'profileClicks'];
const verifiedStates = (metrics) => [
  ...Object.keys(metrics).map((metric) => ({ metric, value: metrics[metric], status: 'verified', source: 'provider_api', providerMetric: metric })),
  ...SOCIAL_COMPONENTS.filter((metric) => !Object.prototype.hasOwnProperty.call(metrics, metric))
    .map((metric) => ({ metric, value: null, status: 'unsupported', source: 'provider_api', providerMetric: metric }))
];
const normalized = (metrics, platform = 'linkedin') => normalizeMetricFamilies({ metrics, metricStates: verifiedStates(metrics), platform });
const window = (key, metrics, targetAgeMs = 7200000) => ({ key, targetAgeMs, complete: true, normalizedMetrics: normalized(metrics), nativeMetrics: metrics });

test('missing metrics remain unknown while a provider-verified zero remains zero', () => {
  const rows = normalizeMetricFamilies({
    metrics: { impressions: 100, clicks: 0 },
    metricStates: [
      { metric: 'impressions', value: 100, status: 'verified' },
      { metric: 'clicks', value: 0, status: 'verified' },
      { metric: 'likes', value: null, status: 'pending' }
    ],
    platform: 'x'
  });
  assert.equal(normalizedValue(rows, 'trafficIntent'), 0);
  assert.equal(normalizedValue(rows, 'socialInteraction'), null);
  assert.equal(normalizedValue(rows, 'socialEngagement'), null);
});

test('a pending component keeps an aggregate unknown while unsupported components do not', () => {
  const pending = normalizeMetricFamilies({
    metrics: { impressions: 100, likes: 4 },
    metricStates: [
      { metric: 'impressions', value: 100, status: 'verified' },
      { metric: 'likes', value: 4, status: 'verified' },
      { metric: 'comments', value: null, status: 'pending' },
      ...['shares', 'quotes', 'saves'].map((metric) => ({ metric, value: null, status: 'unsupported' }))
    ],
    platform: 'x'
  });
  assert.equal(normalizedValue(pending, 'socialEngagement'), null);

  const resolved = normalized({ impressions: 100, likes: 4 }, 'x');
  assert.equal(normalizedValue(resolved, 'socialEngagement'), 4);
});

test('clicks are traffic intent and are not silently counted as social engagement', () => {
  const rows = normalized({ impressions: 1000, likes: 10, comments: 2, clicks: 40 });
  assert.equal(normalizedValue(rows, 'socialEngagement'), 12);
  assert.equal(normalizedValue(rows, 'trafficIntent'), 40);
  assert.equal(normalizedValue(rows, 'socialEngagementRate'), 0.012);
  assert.equal(normalizedValue(rows, 'ctr'), 0.04);
});

test('native aliases are preserved without double-counting reactions, reposts, or click detail', () => {
  const rows = normalized({
    impressions: 1000,
    likes: 10,
    reactions: 10,
    comments: 2,
    shares: 3,
    reposts: 3,
    clicks: 12,
    linkClicks: 8,
    profileClicks: 4
  }, 'x');
  assert.equal(normalizedValue(rows, 'socialInteraction'), 10);
  assert.equal(normalizedValue(rows, 'meaningfulEngagement'), 5);
  assert.equal(normalizedValue(rows, 'socialEngagement'), 15);
  assert.equal(normalizedValue(rows, 'trafficIntent'), 12);
});

test('provider-native metrics and normalized provenance remain intact', () => {
  const metrics = { reach: 500, likes: 12, saves: 3 };
  const rows = normalized(metrics, 'instagram');
  assert.deepEqual(metrics, { reach: 500, likes: 12, saves: 3 });
  const exposure = rows.find((row) => row.family === 'exposure');
  assert.equal(exposure.sourceMetric, 'reach');
  assert.equal(exposure.provider, 'instagram');
  assert.equal(exposure.comparableAcrossPlatforms, false);
});

test('lifecycle capture uses a bounded nearest observation and never fabricates interpolation', () => {
  const publishedAt = new Date('2026-08-20T10:00:00.000Z');
  const snapshots = [
    { _id: new mongoose.Types.ObjectId(), platform: 'x', capturedAt: new Date('2026-08-20T10:28:00.000Z'), metrics: { impressions: 100 }, metricStates: verifiedStates({ impressions: 100 }) },
    { _id: new mongoose.Types.ObjectId(), platform: 'x', capturedAt: new Date('2026-08-20T12:10:00.000Z'), metrics: { impressions: 420 }, metricStates: verifiedStates({ impressions: 420 }) }
  ];
  const lifecycle = captureLifecycleWindows(snapshots, publishedAt);
  assert.equal(lifecycle.find((item) => item.key === 'first30m').complete, true);
  assert.equal(lifecycle.find((item) => item.key === 'first2h').complete, true);
  assert.equal(lifecycle.find((item) => item.key === 'first6h').complete, false);
});

test('velocity is mathematical and counter regressions are preserved but excluded from positive rates', () => {
  const publishedAt = new Date('2026-08-20T10:00:00.000Z');
  const result = calculateVelocity([
    { capturedAt: new Date('2026-08-20T11:00:00.000Z'), metrics: { impressions: 100, likes: 10 } },
    { capturedAt: new Date('2026-08-20T12:00:00.000Z'), metrics: { impressions: 300, likes: 8 } }
  ], publishedAt);
  assert.equal(result.latest.impressions, 200);
  assert.equal(result.latest.likes, undefined);
  assert.equal(result.counterRegressions[0].metric, 'likes');
});

test('velocity separates social engagement growth from traffic-intent growth', () => {
  const publishedAt = new Date('2026-08-20T10:00:00.000Z');
  const snapshots = [
    {
      platform: 'x',
      capturedAt: new Date('2026-08-20T11:00:00.000Z'),
      metrics: { impressions: 100, likes: 4, comments: 1, clicks: 2 },
      metricStates: verifiedStates({ impressions: 100, likes: 4, comments: 1, clicks: 2 })
    },
    {
      platform: 'x',
      capturedAt: new Date('2026-08-20T12:00:00.000Z'),
      metrics: { impressions: 180, likes: 7, comments: 2, clicks: 8 },
      metricStates: verifiedStates({ impressions: 180, likes: 7, comments: 2, clicks: 8 })
    }
  ];
  const result = calculateVelocity(snapshots, publishedAt);
  assert.equal(result.latest.socialEngagement, 4);
  assert.equal(result.latest.meaningfulEngagement, 1);
  assert.equal(result.latest.trafficIntent, 6);
});

test('posts are compared at equivalent lifecycle windows rather than final totals', () => {
  const current = { lifecycle: [window('first2h', { impressions: 400, likes: 20 })] };
  const comparable = [
    { lifecycle: [window('first2h', { impressions: 300, likes: 15 }), window('first7d', { impressions: 9000, likes: 300 }, 604800000)] },
    { lifecycle: [window('first2h', { impressions: 500, likes: 22 }), window('first7d', { impressions: 12000, likes: 400 }, 604800000)] },
    { lifecycle: [window('first2h', { impressions: 350, likes: 18 }), window('first7d', { impressions: 10000, likes: 350 }, 604800000)] }
  ];
  const comparison = compareWithBaselines(current, comparable);
  assert.equal(comparison.comparisonWindow, 'first2h');
  assert.equal(comparison.metrics.exposure.median, 350);
  assert.notEqual(comparison.metrics.exposure.median, 10000);
});

test('robust median is not dominated by one viral outlier', () => {
  assert.equal(median([1100, 1250, 1300, 35000]), 1275);
  assert.equal(percentileRank([1100, 1250, 1300, 35000], 1300), 63);
});

test('unsupported metrics do not reduce baseline-relative score', () => {
  const comparison = {
    status: 'comparable',
    metrics: {
      exposure: { percentile: 80 },
      meaningfulEngagement: { percentile: 90 }
    }
  };
  const score = scoreFromComparison(comparison, 'engagement');
  assert.ok(score >= 80);
});

test('conversion objectives score verified business outcomes ahead of social attention', () => {
  const current = {
    lifecycle: [window('first24h', { impressions: 500, likes: 10 })],
    attribution: { status: 'verified', sessions: 20, leads: 6, conversions: 3, revenue: 300 }
  };
  const comparable = [
    { lifecycle: [window('first24h', { impressions: 2000, likes: 100 })], attribution: { status: 'verified', sessions: 8, leads: 1, conversions: 0, revenue: 0 } },
    { lifecycle: [window('first24h', { impressions: 1800, likes: 80 })], attribution: { status: 'verified', sessions: 10, leads: 2, conversions: 1, revenue: 50 } },
    { lifecycle: [window('first24h', { impressions: 1600, likes: 70 })], attribution: { status: 'verified', sessions: 12, leads: 2, conversions: 1, revenue: 75 } },
    { lifecycle: [window('first24h', { impressions: 1400, likes: 60 })], attribution: { status: 'verified', sessions: 14, leads: 3, conversions: 1, revenue: 100 } },
    { lifecycle: [window('first24h', { impressions: 1200, likes: 50 })], attribution: { status: 'verified', sessions: 15, leads: 3, conversions: 2, revenue: 125 } }
  ];
  const comparison = compareWithBaselines(current, comparable);
  const conversionScore = scoreFromComparison(comparison, 'conversion');
  const awarenessScore = scoreFromComparison(comparison, 'awareness');
  assert.ok(conversionScore > awarenessScore);
  assert.equal(comparison.metrics.revenue.source, 'first_party_attribution');
});

test('one breakout post cannot create a proven pattern or posting-time recommendation', () => {
  const projectId = new mongoose.Types.ObjectId();
  const signal = {
    projectId,
    sourceProjectId: projectId,
    platform: 'linkedin',
    score: 99,
    observedAt: new Date(),
    draftId: { title: 'How to grow', body: 'A strong result with data.' },
    evidence: { confidence: { score: 0.4, label: 'emerging' }, contentType: 'carousel', latestMetrics: { impressions: 50000, likes: 2000 } }
  };
  const recommendations = buildRecommendationInputsFromSignals([signal], projectId);
  const upgrade = buildGrowthBrainUpgradeFromSignals([signal], projectId);
  assert.equal(recommendations.bestContentPatterns.length, 0);
  assert.equal(upgrade.bestPostingTimes.length, 0);
  assert.equal(upgrade.winningFormats.length, 0);
  assert.equal(upgrade.improvedDraftSuggestions.length, 0);
});

test('topic evidence stays platform-specific instead of pooling unrelated channel samples', () => {
  const projectId = new mongoose.Types.ObjectId();
  const signal = (platform, index) => ({
    projectId,
    sourceProjectId: projectId,
    platform,
    score: 75,
    observedAt: new Date(Date.now() - index * 60000),
    draftId: { title: `SEO strategy ${index}`, body: 'Improve organic search and keyword performance.' },
    evidence: { confidence: { score: 0.7, label: 'moderate' }, contentType: 'text', latestMetrics: { impressions: 100 + index, likes: 5 } }
  });
  const upgrade = buildGrowthBrainUpgradeFromSignals([
    signal('linkedin', 1),
    signal('linkedin', 2),
    signal('x', 3)
  ], projectId);
  assert.equal(upgrade.winningTopics.length, 0);
});

test('sample count alone cannot make a low-confidence pattern proven', () => {
  const projectId = new mongoose.Types.ObjectId();
  const signals = Array.from({ length: 12 }, (_, index) => ({
    projectId,
    sourceProjectId: projectId,
    platform: 'linkedin',
    score: 90,
    observedAt: new Date(Date.now() - index * 60000),
    draftId: { title: `How to improve attribution ${index}`, body: 'A structured guide with evidence.' },
    evidence: { confidence: { score: 0.4, label: 'emerging' }, contentType: 'carousel', latestMetrics: { impressions: 500, likes: 20 } }
  }));
  const recommendations = buildRecommendationInputsFromSignals(signals, projectId);
  assert.notEqual(recommendations.bestContentPatterns[0].status, 'proven');
});

test('platform comparison reports total contribution and median per-post efficiency', () => {
  const posts = [
    postPerformanceRow({ _id: new mongoose.Types.ObjectId(), platform: 'linkedin', metricsAvailableFields: ['impressions'], metricsLatest: { impressions: 100, likes: 10, reactions: 10, shares: 2, reposts: 2, quotes: 1 } }),
    postPerformanceRow({ _id: new mongoose.Types.ObjectId(), platform: 'linkedin', metricsAvailableFields: ['impressions'], metricsLatest: { impressions: 1000, likes: 20 } }),
    postPerformanceRow({ _id: new mongoose.Types.ObjectId(), platform: 'x', metricsAvailableFields: ['views'], metricsLatest: { views: 400, likes: 20 } })
  ];
  const platforms = summarizePlatforms(posts);
  const linkedin = platforms.find((row) => row.platform === 'linkedin');
  assert.equal(linkedin.exposure, 1100);
  assert.equal(linkedin.medianExposurePerPost, 550);
  assert.equal(linkedin.likes, 30);
  assert.equal(linkedin.shares, 3);
});

test('confidence reflects sample, coverage, lifecycle completeness, and freshness', () => {
  const performance = {
    latestMetricStates: [{ status: 'verified' }, { status: 'unsupported' }],
    lifecycleCompleteness: 0.5,
    lastObservedAt: new Date()
  };
  const confidence = confidenceFor(performance, { sampleSize: 5 });
  assert.equal(confidence.providerCoverage, 1);
  assert.equal(confidence.lifecycleCompleteness, 0.5);
  assert.ok(confidence.score > 0 && confidence.score < 1);
});

test('baseline selection prefers objective and format matches only when the sample is sufficient', () => {
  const history = [
    ...Array.from({ length: 5 }, () => ({ objective: 'traffic', contentType: 'image' })),
    ...Array.from({ length: 6 }, () => ({ objective: 'awareness', contentType: 'video' }))
  ];
  const selected = mostComparableHistory({ objective: 'traffic', contentType: 'image' }, history);
  assert.equal(selected.length, 5);
  assert.ok(selected.every((post) => post.objective === 'traffic' && post.contentType === 'image'));
});

test('data health remains account-specific when a project connects two accounts on one platform', () => {
  const first = new mongoose.Types.ObjectId();
  const second = new mongoose.Types.ObjectId();
  const health = socialDataHealth([
    { _id: first, platform: 'x', accountName: 'First', status: 'connected', metricsStatus: 'active' },
    { _id: second, platform: 'x', accountName: 'Second', status: 'connected', metricsStatus: 'active' }
  ], [{ accountId: String(first), platform: 'x', availableFields: ['impressions'], metricsCapturedAt: new Date() }]);
  assert.equal(health.providers[0].measuredPosts, 1);
  assert.equal(health.providers[1].measuredPosts, 0);
});

test('anomalies require robust baseline deltas and normal variance remains quiet', () => {
  const abnormal = detectAnomalies({ metrics: { exposure: { delta: 2.1 }, meaningfulEngagement: { delta: -0.4 }, ctr: { delta: -0.5 } } });
  assert.ok(abnormal.some((item) => item.type === 'breakout_exposure'));
  assert.ok(abnormal.some((item) => item.type === 'high_exposure_weak_engagement'));
  assert.deepEqual(detectAnomalies({ metrics: { exposure: { delta: 0.1 }, meaningfulEngagement: { delta: 0.05 } } }), []);
});

test('recency weighting reduces influence without deleting history', () => {
  const now = new Date('2026-08-24T00:00:00.000Z');
  assert.equal(recencyWeight(new Date('2026-08-10T00:00:00.000Z'), now), 1);
  assert.equal(recencyWeight(new Date('2026-04-01T00:00:00.000Z'), now), 0.4);
  assert.equal(recencyWeight(new Date('2025-01-01T00:00:00.000Z'), now), 0.2);
});

test('canonical model enforces one post record per publish job and tenant-scoped identity', async () => {
  const document = new SocialPostPerformance({
    projectId: new mongoose.Types.ObjectId(),
    sourceProjectId: new mongoose.Types.ObjectId(),
    publishJobId: new mongoose.Types.ObjectId(),
    draftId: new mongoose.Types.ObjectId(),
    socialAccountId: new mongoose.Types.ObjectId(),
    platform: 'linkedin',
    remotePostId: 'urn:li:share:1',
    publishedAt: new Date()
  });
  await document.validate();
  const indexes = SocialPostPerformance.schema.indexes();
  assert.ok(indexes.some(([fields, options]) => fields.publishJobId === 1 && options.unique));
  assert.ok(indexes.some(([fields, options]) => fields.projectId === 1 && fields.remotePostId === 1 && options.unique));
});
