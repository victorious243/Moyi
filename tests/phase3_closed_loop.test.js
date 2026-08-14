const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

const ApiCredential = require('../models/ApiCredential');
const EngagementSnapshot = require('../models/EngagementSnapshot');
const GrowthSignal = require('../models/GrowthSignal');
const Organization = require('../models/Organization');
const OrganizationMember = require('../models/OrganizationMember');
const PublishJob = require('../models/PublishJob');
const SocialAccount = require('../models/SocialAccount');
const SocialOAuthSession = require('../models/SocialOAuthSession');
const {
  credentialHash,
  parseApiKey
} = require('../services/apiCredentialService');
const {
  engagementSummary,
  nextMetricsSyncAt,
  normalizeMetrics,
  safeMetricText,
  safeProviderData
} = require('../services/engagementMetricsService');
const {
  classifyPublishError,
  platformPolicy,
  retryDecision
} = require('../services/publishReliabilityService');
const {
  buildGrowthBrainUpgradeFromSignals,
  buildRecommendationInputsFromSignals,
  classifyContentType,
  normalizeAnalyticsDays,
  postPerformanceRow,
  socialPerformanceApiPayload,
  summarizeCampaigns,
  summarizeContentTypes,
  summarizePlatforms
} = require('../services/socialAnalyticsService');
const {
  AGENCY_ROLE_CAPABILITIES,
  canManageOrganizationRole,
  canPublishOrganizationRole,
  summarizeAgencyClientReports,
  summarizeAgencyUsagePool
} = require('../services/organizationService');
const { getProviderMetrics } = require('../services/socialProviderService');

const PLATFORMS = ['bluesky', 'x', 'linkedin', 'facebook', 'instagram', 'threads', 'tiktok', 'youtube'];

function sandboxCredentials(platform, metrics = {}) {
  return {
    id: new mongoose.Types.ObjectId().toString(),
    projectId: new mongoose.Types.ObjectId().toString(),
    userId: new mongoose.Types.ObjectId().toString(),
    platform,
    accountName: `Moyi ${platform}`,
    externalAccountId: `${platform}-account`,
    accessToken: platform === 'bluesky' ? '' : `sandbox_${platform}`,
    refreshToken: '',
    expiresAt: null,
    scopes: [],
    metadata: { sandbox: true, sandboxMetrics: metrics },
    status: 'connected'
  };
}

test('all eight native providers expose normalized sandbox engagement metrics', async () => {
  for (const platform of PLATFORMS) {
    const result = await getProviderMetrics(platform, sandboxCredentials(platform, {
      views: 120,
      likes: 12,
      comments: 3,
      shares: 2
    }), {
      platformPostId: `${platform}-post`,
      platformUrl: `https://example.com/${platform}-post`,
      providerState: {},
      publishedAt: new Date()
    });

    assert.equal(result.metrics.views, 120, `${platform} should return views`);
    assert.equal(result.metrics.likes, 12, `${platform} should return likes`);
    assert.ok(result.availableFields.includes('comments'));
    assert.ok(result.unavailableFields.includes('impressions'));
  }
});

test('metric normalization preserves unavailable fields and calculates interactions', () => {
  const metrics = normalizeMetrics({ impressions: '1000', likes: 20, comments: 5, shares: 3, clicks: null, invalid: 99 });
  assert.deepEqual(metrics, { impressions: 1000, likes: 20, comments: 5, shares: 3 });
  assert.deepEqual(engagementSummary(metrics), { engagementTotal: 28, engagementRate: 0.028 });
  assert.deepEqual(engagementSummary({ impressions: 1000 }), { engagementTotal: null, engagementRate: null });
});

test('metric cadence slows with post age and stops after ninety days', () => {
  const now = new Date('2026-08-13T12:00:00.000Z');
  assert.equal(
    nextMetricsSyncAt({ publishedAt: new Date('2026-08-13T10:00:00.000Z') }, now).toISOString(),
    '2026-08-13T12:30:00.000Z'
  );
  assert.equal(
    nextMetricsSyncAt({ publishedAt: new Date('2026-08-12T12:00:00.000Z') }, now).toISOString(),
    '2026-08-13T15:00:00.000Z'
  );
  assert.equal(
    nextMetricsSyncAt({ publishedAt: new Date('2026-08-03T12:00:00.000Z') }, now).toISOString(),
    '2026-08-14T12:00:00.000Z'
  );
  assert.equal(nextMetricsSyncAt({ publishedAt: new Date('2026-04-01T12:00:00.000Z') }, now), null);
});

test('provider-aware retry policy separates transient, authentication, and permanent failures', () => {
  const transient = Object.assign(new Error('service unavailable'), { statusCode: 503, retryable: true });
  const auth = Object.assign(new Error('OAuth token expired'), { statusCode: 401, code: 'invalid_token' });
  const permanent = Object.assign(new Error('media is invalid'), { statusCode: 422, code: 'media_too_large' });
  const billing = Object.assign(new Error('X request failed: API credits are depleted.'), { statusCode: 429, code: 'x_api_credits_depleted' });
  assert.equal(classifyPublishError(transient).retryable, true);
  assert.deepEqual(classifyPublishError(auth), {
    failureKind: 'authentication', reconnectRequired: true, retryable: false
  });
  assert.equal(classifyPublishError(permanent).failureKind, 'permanent');
  assert.deepEqual(classifyPublishError(billing), {
    failureKind: 'billing', reconnectRequired: false, retryable: false
  });

  const decision = retryDecision({ job: { platform: 'tiktok', attempts: 1, maxAttempts: 5 }, error: transient });
  assert.equal(decision.shouldRetry, true);
  assert.equal(decision.maxAttempts, platformPolicy('tiktok').maxAttempts);
  assert.ok(decision.nextRetryAt > new Date());
  assert.equal(retryDecision({ job: { platform: 'x', attempts: 4, maxAttempts: 4 }, error: transient }).deadLetter, true);
  const unknownOutcome = retryDecision({
    job: { platform: 'x', attempts: 1, maxAttempts: 4, providerDispatchStartedAt: new Date() },
    error: transient,
    protectUnknownOutcome: true
  });
  assert.equal(unknownOutcome.outcomeUnknown, true);
  assert.equal(unknownOutcome.shouldRetry, false);
  assert.equal(unknownOutcome.failureKind, 'unknown');
});

test('metric errors and provider metadata redact credentials before storage', () => {
  const text = safeMetricText('Failed for Bearer secret-token and access_token=plain-secret');
  const details = safeProviderData({
    accessToken: 'plain-secret',
    response: { authorization: 'Bearer secret-token', source: 'provider' }
  });
  assert.doesNotMatch(text, /secret-token|plain-secret/);
  assert.doesNotMatch(JSON.stringify(details), /secret-token|plain-secret/);
  assert.match(JSON.stringify(details), /credential redacted/);
});

test('analytics rolls up only available exposure and interaction counters', () => {
  const campaignId = new mongoose.Types.ObjectId();
  const posts = [
    postPerformanceRow({
      _id: new mongoose.Types.ObjectId(),
      projectId: new mongoose.Types.ObjectId(),
      destinationProjectId: null,
      platform: 'linkedin',
      accountId: { accountName: 'Moyi LinkedIn' },
      draftId: { title: 'Observed post', campaignId: { _id: campaignId, name: 'Launch Campaign', goal: 'Pipeline', channel: 'linkedin' } },
      mediaIds: [{ mimeType: 'image/png' }],
      metricsStatus: 'active',
      metricsAvailableFields: ['impressions', 'likes', 'comments'],
      metricsLatest: { impressions: 1000, likes: 40, comments: 10 }
    }),
    postPerformanceRow({
      _id: new mongoose.Types.ObjectId(),
      projectId: new mongoose.Types.ObjectId(),
      destinationProjectId: null,
      platform: 'youtube',
      accountId: { accountName: 'Moyi YouTube' },
      draftId: { title: 'Video' },
      mediaIds: [{ mimeType: 'video/mp4' }],
      metricsStatus: 'active',
      metricsAvailableFields: ['views', 'likes'],
      metricsLatest: { views: 500, likes: 25 }
    })
  ];
  const platforms = summarizePlatforms(posts);
  assert.equal(platforms.find((row) => row.platform === 'linkedin').exposure, 1000);
  assert.equal(platforms.find((row) => row.platform === 'linkedin').engagementRate, 0.05);
  assert.equal(platforms.find((row) => row.platform === 'youtube').exposure, 500);
  const campaigns = summarizeCampaigns(posts);
  assert.equal(campaigns[0].campaignName, 'Launch Campaign');
  assert.equal(campaigns[0].campaignGoal, 'Pipeline');
  const contentTypes = summarizeContentTypes(posts);
  assert.equal(contentTypes.find((row) => row.contentType === 'image').exposure, 1000);
  assert.equal(contentTypes.find((row) => row.contentType === 'video').engagements, 25);
  assert.equal(classifyContentType({ mediaIds: [{ mimeType: 'image/jpeg' }, { mimeType: 'image/png' }] }), 'carousel');
  assert.equal(normalizeAnalyticsDays(14), 30);
  const unavailable = postPerformanceRow({
    _id: new mongoose.Types.ObjectId(),
    projectId: new mongoose.Types.ObjectId(),
    platform: 'x',
    metricsAvailableFields: [],
    metricsLatest: { impressions: null, likes: null }
  });
  assert.equal(unavailable.exposureField, '');
  assert.equal(unavailable.exposure, null);
  assert.equal(unavailable.engagements, null);
  assert.deepEqual(unavailable.metrics, {});
  const unavailablePlatform = summarizePlatforms([unavailable])[0];
  assert.equal(unavailablePlatform.exposure, null);
  assert.equal(unavailablePlatform.engagements, null);
  assert.equal(unavailablePlatform.clicks, null);
});

test('social performance API includes Growth Brain-ready signals', () => {
  const payload = socialPerformanceApiPayload({
    days: 30,
    since: new Date('2026-08-01T00:00:00.000Z'),
    generatedAt: new Date('2026-08-14T00:00:00.000Z'),
    lastMetricsSyncAt: new Date('2026-08-13T12:00:00.000Z'),
    totals: { posts: 1, measuredPosts: 1, exposure: 1000, engagements: 50 },
    reliability: { deadLetter: 0, reconnectRequired: 0 },
    platformRows: [{ platform: 'linkedin', posts: 1, measuredPosts: 1 }],
    campaignRows: [{ campaignName: 'Launch Campaign', posts: 1, measuredPosts: 1, exposure: 1000 }],
    contentTypeRows: [{ contentType: 'image', posts: 1, measuredPosts: 1, exposure: 1000 }],
    growthBrain: {
      source: 'Moyi Content Distribution Engine engagement snapshots',
      asOf: new Date('2026-08-13T12:00:00.000Z'),
      windowDays: 30,
      sampleSize: 1,
      measurementNote: 'Provider metrics vary.',
      platforms: [{ platform: 'linkedin', samples: 1, averageScore: 64 }],
      growthBrainUpgrade: {
        whatWorked: [{ platform: 'linkedin', pattern: 'proof-led angle', score: 64 }],
        bestPostingTimes: [{ platform: 'linkedin', label: 'Thursday 11:00 UTC', averageScore: 64 }],
        bestPlatforms: [{ platform: 'linkedin', averageScore: 64, samples: 1 }],
        winningHooks: [{ platform: 'linkedin', hook: 'Observed post', score: 64 }],
        winningTopics: [{ topic: 'observed', averageScore: 64 }],
        winningFormats: [{ format: 'image - proof-led angle', averageScore: 64 }],
        lowPerformingWarnings: [],
        improvedDraftSuggestions: [{ platform: 'linkedin', direction: 'Prioritize LinkedIn.', hookTemplate: 'Open with proof.' }]
      },
      recommendationInputs: {
        evidenceQuality: { confidence: 'early', sampleSize: 1, note: 'Use these signals directionally.' },
        bestContentPatterns: [{ platform: 'linkedin', pattern: 'proof-led angle', samples: 1, averageScore: 64 }],
        weakContentPatterns: [],
        suggestedNextActions: [{ priority: 'high', action: 'Create two more proof-led angle posts for linkedin.', rationale: 'Strong signal.' }]
      },
      strongestObservedPosts: [{
        platform: 'linkedin',
        score: 64,
        title: 'Observed post',
        contentExcerpt: 'Short safe excerpt',
        metrics: { impressions: 1000, likes: 50 },
        engagementRate: 0.05
      }]
    },
    recentPosts: [{
      id: 'job-1',
      platform: 'linkedin',
      accountName: 'Moyi LinkedIn',
      publishedAt: new Date('2026-08-13T11:00:00.000Z'),
      platformUrl: 'https://linkedin.com/feed/update/123',
      metricsStatus: 'active',
      metricsCapturedAt: new Date('2026-08-13T12:00:00.000Z'),
      availableFields: ['impressions', 'likes'],
      campaignId: 'campaign-1',
      campaignName: 'Launch Campaign',
      contentType: 'image',
      metrics: { impressions: 1000, likes: 50 },
      engagementRate: 0.05
    }]
  });

  assert.equal(payload.growthBrain.sampleSize, 1);
  assert.equal(payload.growthBrain.platforms[0].platform, 'linkedin');
  assert.equal(payload.growthBrain.recommendationInputs.bestContentPatterns[0].pattern, 'proof-led angle');
  assert.equal(payload.growthBrain.recommendationInputs.suggestedNextActions[0].priority, 'high');
  assert.equal(payload.growthBrain.growthBrainUpgrade.bestPlatforms[0].platform, 'linkedin');
  assert.equal(payload.growthBrain.growthBrainUpgrade.improvedDraftSuggestions[0].platform, 'linkedin');
  assert.equal(payload.growthBrain.strongestObservedPosts[0].contentExcerpt, 'Short safe excerpt');
  assert.equal(payload.campaigns[0].campaignName, 'Launch Campaign');
  assert.equal(payload.contentTypes[0].contentType, 'image');
  assert.equal(payload.posts[0].campaignName, 'Launch Campaign');
  assert.equal(payload.posts[0].contentType, 'image');
  assert.equal(payload.posts[0].metrics.impressions, 1000);
});

test('Growth Brain recommendation inputs separate winning and weak content patterns', () => {
  const projectId = new mongoose.Types.ObjectId();
  const signals = [
    {
      projectId,
      sourceProjectId: projectId,
      platform: 'linkedin',
      score: 82,
      observedAt: new Date('2026-08-14T10:00:00.000Z'),
      draftId: {
        title: 'Growth data from Moyi',
        body: 'Proof and data from a customer result. Visit Moyi to learn more.'
      },
      evidence: {
        metrics: { impressions: 1200, likes: 80, comments: 12 },
        engagementRate: 0.076
      }
    },
    {
      projectId,
      sourceProjectId: projectId,
      platform: 'linkedin',
      score: 74,
      observedAt: new Date('2026-08-13T10:00:00.000Z'),
      draftId: {
        title: 'Another result',
        body: 'A benchmark with growth proof and data for marketing teams.'
      },
      evidence: {
        metrics: { impressions: 900, likes: 44, comments: 8 },
        engagementRate: 0.057
      }
    },
    {
      projectId,
      sourceProjectId: projectId,
      platform: 'x',
      score: 22,
      observedAt: new Date('2026-08-12T10:00:00.000Z'),
      draftId: {
        title: 'General update',
        body: 'We launched a new dashboard for users today.'
      },
      evidence: {
        metrics: { views: 90, likes: 1 },
        engagementRate: 0.011
      }
    }
  ];

  const inputs = buildRecommendationInputsFromSignals(signals, projectId);
  assert.equal(inputs.evidenceQuality.confidence, 'early');
  assert.equal(inputs.bestContentPatterns[0].pattern, 'proof-led angle');
  assert.equal(inputs.bestContentPatterns[0].platform, 'linkedin');
  assert.equal(inputs.weakContentPatterns[0].platform, 'x');
  assert.match(inputs.suggestedNextActions[0].action, /Create two more proof-led angle posts/);
  assert.ok(inputs.suggestedNextActions.some((item) => /Collect at least five measured social posts/.test(item.action)));
});

test('Growth Brain upgrade identifies best times, platforms, hooks, topics, formats, and draft improvements', () => {
  const projectId = new mongoose.Types.ObjectId();
  const signals = [
    {
      projectId,
      sourceProjectId: projectId,
      platform: 'linkedin',
      score: 91,
      observedAt: new Date('2026-08-14T12:00:00.000Z'),
      draftId: {
        title: 'Proof: SEO wins from Moyi',
        body: 'Proof from a campaign result: better SEO recommendations helped a startup prioritize demand capture.'
      },
      evidence: {
        publishedAt: '2026-08-14T11:00:00.000Z',
        contentType: 'image',
        metrics: { impressions: 1500, likes: 120, comments: 18 },
        engagementRate: 0.092
      }
    },
    {
      projectId,
      sourceProjectId: projectId,
      platform: 'linkedin',
      score: 84,
      observedAt: new Date('2026-08-07T12:00:00.000Z'),
      draftId: {
        title: 'Data-backed SEO prioritization',
        body: 'Data and benchmark lessons for marketing teams deciding what to fix first.'
      },
      evidence: {
        publishedAt: '2026-08-07T11:00:00.000Z',
        contentType: 'image',
        metrics: { impressions: 1200, likes: 88, comments: 10 },
        engagementRate: 0.081
      }
    },
    {
      projectId,
      sourceProjectId: projectId,
      platform: 'x',
      score: 18,
      observedAt: new Date('2026-08-06T15:00:00.000Z'),
      draftId: {
        title: 'Generic update',
        body: 'We added a dashboard today.'
      },
      evidence: {
        publishedAt: '2026-08-06T15:00:00.000Z',
        contentType: 'text',
        metrics: { views: 70, likes: 1 },
        engagementRate: 0.014
      }
    }
  ];

  const upgrade = buildGrowthBrainUpgradeFromSignals(signals, projectId);
  assert.equal(upgrade.whatWorked[0].platform, 'linkedin');
  assert.equal(upgrade.bestPostingTimes[0].label, 'Friday 11:00 UTC');
  assert.equal(upgrade.bestPlatforms[0].platform, 'linkedin');
  assert.match(upgrade.winningHooks[0].hook, /Proof/);
  assert.equal(upgrade.winningTopics[0].topic, 'proof');
  assert.equal(upgrade.winningFormats[0].format, 'image - proof-led angle');
  assert.equal(upgrade.lowPerformingWarnings[0].platform, 'x');
  assert.match(upgrade.improvedDraftSuggestions[0].direction, /Prioritize linkedin/);
});

test('public API batch summaries include only jobs visible to the API key', () => {
  const {
    publishJobPayload,
    publicApiRouteCatalog,
    visibleBatchStatus,
    visibleBatchSummary
  } = require('../routes/publicApi');
  const sourceProjectId = new mongoose.Types.ObjectId();
  const visibleProjectId = new mongoose.Types.ObjectId();
  const hiddenProjectId = new mongoose.Types.ObjectId();
  const credential = { projectIds: [String(sourceProjectId), String(visibleProjectId)] };
  const visibleJob = {
    _id: new mongoose.Types.ObjectId(),
    batchId: new mongoose.Types.ObjectId(),
    projectId: sourceProjectId,
    destinationProjectId: visibleProjectId,
    draftId: new mongoose.Types.ObjectId(),
    accountId: new mongoose.Types.ObjectId(),
    platform: 'linkedin',
    status: 'published',
    attempts: 1,
    maxAttempts: 5
  };
  const destinationOnlyPayload = publishJobPayload(
    { ...visibleJob, projectId: hiddenProjectId },
    { projectIds: [String(visibleProjectId)] }
  );
  assert.equal(destinationOnlyPayload.sourceProjectId, null);
  assert.equal(destinationOnlyPayload.draftId, null);
  assert.deepEqual(visibleBatchSummary([
    visibleJob,
    { ...visibleJob, status: 'dead_letter' },
    { ...visibleJob, status: 'cancelled' }
  ]), { total: 3, successCount: 1, failedCount: 1, cancelledCount: 1 });
  assert.equal(visibleBatchStatus([visibleJob]), 'published');
  assert.equal(visibleBatchStatus([visibleJob, { ...visibleJob, status: 'dead_letter' }]), 'partial');
  assert.equal(visibleBatchStatus([{ ...visibleJob, status: 'retry_wait' }]), 'queued');
  assert.equal(credential.projectIds.includes(String(hiddenProjectId)), false);
  const catalog = publicApiRouteCatalog({
    name: 'Production agent',
    organizationId: null,
    projectIds: credential.projectIds,
    scopes: ['accounts:read', 'publish:write', 'jobs:read', 'analytics:read'],
    lastUsedAt: null
  });
  assert.equal(catalog[0].path, '/api/v1');
  assert.ok(catalog.some((route) => route.path === '/api/v1/publish-jobs'));
});

test('API key parser accepts only the exact Moyi format and hashes secrets deterministically', () => {
  const key = `moyi_live_abcdef123456_${Buffer.alloc(32, 7).toString('base64url')}`;
  assert.deepEqual(parseApiKey(key), {
    prefix: 'abcdef123456',
    secret: Buffer.alloc(32, 7).toString('base64url')
  });
  assert.equal(credentialHash(key), credentialHash(key));
  assert.notEqual(credentialHash(key), credentialHash(`${key}x`));
  assert.equal(parseApiKey('POSTIZ_API_KEY=not-supported'), null);
});

test('agency roles give publishers execution access while analysts stay read only', () => {
  assert.equal(canPublishOrganizationRole('owner'), true);
  assert.equal(canPublishOrganizationRole('admin'), true);
  assert.equal(canPublishOrganizationRole('publisher'), true);
  assert.equal(canPublishOrganizationRole('analyst'), false);
  assert.equal(canManageOrganizationRole('admin'), true);
  assert.equal(canManageOrganizationRole('publisher'), false);
  assert.equal(AGENCY_ROLE_CAPABILITIES.find((role) => role.role === 'analyst').reporting, true);
  assert.equal(AGENCY_ROLE_CAPABILITIES.find((role) => role.role === 'publisher').accounts, false);
});

test('agency dashboard summarizes pooled usage and client reporting health', () => {
  const ownerId = new mongoose.Types.ObjectId();
  const projectId = new mongoose.Types.ObjectId();
  const pool = summarizeAgencyUsagePool({
    owner: { _id: ownerId, name: 'Agency Owner', email: 'owner@example.com', plan: 'agency' },
    usage: {
      socialPostsUsed: 125,
      extraSocialPostCredits: 25,
      scansUsed: 12,
      contentDraftsUsed: 40,
      aiReportsUsed: 8
    }
  });

  assert.equal(pool.planName, 'Agency');
  assert.equal(pool.socialPosts.allowed, 1025);
  assert.equal(pool.socialPosts.remaining, 900);

  const reports = summarizeAgencyClientReports({
    projects: [{ _id: projectId, name: 'Client A', websiteUrl: 'https://client.example', owner: ownerId }],
    accounts: [
      { projectId, platform: 'linkedin', status: 'connected', lastMetricsSyncAt: new Date('2026-08-14T10:00:00.000Z') },
      { projectId, platform: 'x', status: 'reconnect_required' }
    ],
    publishJobs: [
      { projectId, destinationProjectId: projectId, status: 'published', metricsStatus: 'active' },
      { projectId, destinationProjectId: projectId, status: 'dead_letter', metricsStatus: 'error' }
    ],
    approvedDraftCounts: new Map([[String(projectId), 3]])
  });

  assert.equal(reports[0].connectedAccounts, 2);
  assert.equal(reports[0].reconnectRequired, 1);
  assert.deepEqual(reports[0].platforms, ['linkedin', 'x']);
  assert.equal(reports[0].approvedDrafts, 3);
  assert.equal(reports[0].publishedPosts, 1);
  assert.equal(reports[0].measuredPosts, 1);
  assert.equal(reports[0].failedJobs, 1);
});

test('Phase 3 models validate secure credentials, snapshots, growth signals, and recovery state', () => {
  const projectId = new mongoose.Types.ObjectId();
  const sourceProjectId = new mongoose.Types.ObjectId();
  const userId = new mongoose.Types.ObjectId();
  const jobId = new mongoose.Types.ObjectId();
  const draftId = new mongoose.Types.ObjectId();
  const accountId = new mongoose.Types.ObjectId();
  const organization = new Organization({ name: 'Moyi Agency', slug: 'moyi-agency', ownerId: userId });
  const member = new OrganizationMember({ organizationId: organization._id, userId, role: 'publisher' });
  const credential = new ApiCredential({
    userId,
    name: 'Production agent',
    prefix: 'abcdef123456',
    secretHash: 'a'.repeat(64),
    scopes: ['publish:write', 'jobs:read'],
    projectIds: [projectId]
  });
  const snapshot = new EngagementSnapshot({
    projectId,
    sourceProjectId,
    publishJobId: jobId,
    draftId,
    accountId,
    platform: 'linkedin',
    platformPostId: 'urn:li:share:123',
    metrics: { impressions: 100, likes: 5 },
    availableFields: ['impressions', 'likes'],
    engagementTotal: 5,
    engagementRate: 0.05
  });
  const signal = new GrowthSignal({
    projectId,
    sourceProjectId,
    publishJobId: jobId,
    draftId,
    platform: 'linkedin',
    score: 42,
    summary: 'Observed performance.'
  });
  const socialAccount = new SocialAccount({
    projectId,
    userId,
    platform: 'x',
    accountName: '@moyi',
    status: 'reconnect_required',
    metricsStatus: 'error'
  });
  const publishJob = new PublishJob({
    batchId: new mongoose.Types.ObjectId(),
    projectId: sourceProjectId,
    destinationProjectId: projectId,
    userId,
    draftId,
    accountId,
    platform: 'x',
    status: 'dead_letter',
    failureKind: 'unknown',
    reconnectRequired: false,
    providerDispatchStartedAt: new Date(),
    deadLetteredAt: new Date()
  });

  for (const model of [organization, member, credential, snapshot, signal, socialAccount, publishJob]) {
    assert.equal(model.validateSync(), undefined);
  }
  assert.equal(SocialAccount.schema.path('accessToken').options.select, false);
  assert.equal(SocialAccount.schema.path('refreshToken').options.select, false);
  assert.equal(SocialAccount.schema.path('webhookSecret').options.select, false);
  assert.equal(SocialOAuthSession.schema.path('encryptedPayload').options.select, false);
  assert.deepEqual(normalizeMetrics(snapshot.metrics), { impressions: 100, likes: 5 });
});

test('public API and agency management expose the expected route contracts', () => {
  const publicApi = require('../routes/publicApi');
  const organizations = require('../routes/organizations');
  const publicRoutes = publicApi.stack.filter((layer) => layer.route).map((layer) => layer.route.path);
  const organizationRoutes = organizations.stack.filter((layer) => layer.route).map((layer) => layer.route.path);
  assert.ok(publicRoutes.includes('/'));
  assert.ok(publicRoutes.includes('/accounts'));
  assert.ok(publicRoutes.includes('/publish-jobs'));
  assert.ok(publicRoutes.includes('/publish-jobs/:id'));
  assert.ok(publicRoutes.includes('/projects/:id/social-performance'));
  assert.ok(organizationRoutes.includes('/:id/members'));
  assert.ok(organizationRoutes.includes('/:id/projects'));
});
