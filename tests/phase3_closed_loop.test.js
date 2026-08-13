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
  normalizeAnalyticsDays,
  postPerformanceRow,
  summarizePlatforms
} = require('../services/socialAnalyticsService');
const {
  canManageOrganizationRole,
  canPublishOrganizationRole
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
  assert.equal(classifyPublishError(transient).retryable, true);
  assert.deepEqual(classifyPublishError(auth), {
    failureKind: 'authentication', reconnectRequired: true, retryable: false
  });
  assert.equal(classifyPublishError(permanent).failureKind, 'permanent');

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
  const posts = [
    postPerformanceRow({
      _id: new mongoose.Types.ObjectId(),
      projectId: new mongoose.Types.ObjectId(),
      destinationProjectId: null,
      platform: 'linkedin',
      accountId: { accountName: 'Moyi LinkedIn' },
      draftId: { title: 'Observed post' },
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
      metricsStatus: 'active',
      metricsAvailableFields: ['views', 'likes'],
      metricsLatest: { views: 500, likes: 25 }
    })
  ];
  const platforms = summarizePlatforms(posts);
  assert.equal(platforms.find((row) => row.platform === 'linkedin').exposure, 1000);
  assert.equal(platforms.find((row) => row.platform === 'linkedin').engagementRate, 0.05);
  assert.equal(platforms.find((row) => row.platform === 'youtube').exposure, 500);
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

test('public API batch summaries include only jobs visible to the API key', () => {
  const { publishJobPayload, visibleBatchStatus, visibleBatchSummary } = require('../routes/publicApi');
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
  assert.ok(publicRoutes.includes('/accounts'));
  assert.ok(publicRoutes.includes('/publish-jobs'));
  assert.ok(publicRoutes.includes('/publish-jobs/:id'));
  assert.ok(publicRoutes.includes('/projects/:id/social-performance'));
  assert.ok(organizationRoutes.includes('/:id/members'));
  assert.ok(organizationRoutes.includes('/:id/projects'));
});
