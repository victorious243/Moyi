const EngagementSnapshot = require('../models/EngagementSnapshot');
const GrowthSignal = require('../models/GrowthSignal');
const PublishJob = require('../models/PublishJob');
const SocialAccount = require('../models/SocialAccount');
const { METRIC_FIELDS } = require('../models/EngagementSnapshot');
const { getProviderMetrics } = require('./socialProviderService');
const { ensureFreshSocialAccountCredentials } = require('./socialTokenRefreshService');
const { classifyPublishError, recordPublishJobEvent } = require('./publishReliabilityService');
const { markSocialAccountReconnectRequired } = require('./socialAccountService');
const MetricObservation = require('../models/MetricObservation');
const ProviderSyncRun = require('../models/ProviderSyncRun');
const { createHash, randomUUID } = require('crypto');
const { freshnessFor } = require('./analytics/metricStatus');
const { rebuildCanonicalPostPerformance } = require('./socialPostPerformanceService');

const METRICS_LEASE_MS = 5 * 60 * 1000;
const MAX_METRICS_AGE_MS = 90 * 24 * 60 * 60 * 1000;

const METRIC_FAMILIES = Object.freeze({
  impressions: 'exposure',
  views: 'exposure',
  reach: 'unique_reach',
  likes: 'engagement',
  reactions: 'engagement',
  comments: 'engagement',
  shares: 'engagement',
  reposts: 'engagement',
  quotes: 'engagement',
  saves: 'engagement',
  clicks: 'traffic',
  linkClicks: 'traffic',
  profileClicks: 'traffic',
  videoViews: 'video_consumption',
  watchTimeMs: 'video_consumption'
});

function numeric(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function normalizeMetrics(metrics = {}) {
  return METRIC_FIELDS.reduce((normalized, field) => {
    const value = numeric(metrics[field]);
    if (value !== null) normalized[field] = value;
    return normalized;
  }, {});
}

function safeMetricText(value) {
  return String(value || '')
    .replace(/\/social-media\/public\/[^\s?]+\?[^\s]*/gi, '/social-media/public/[signed URL redacted]')
    .replace(/([?&](?:access_token|refresh_token|client_secret|signature)=)[^&#\s]*/gi, '$1[credential redacted]')
    .replace(/Bearer\s+[A-Za-z0-9._~+\/-]+=*/gi, 'Bearer [credential redacted]')
    .replace(/(?:access_token|refresh_token|client_secret|authorization|signature)["'\s:=]+[^\s,"'}&]+/gi, '[credential redacted]')
    .slice(0, 1200);
}

function safeProviderData(value, depth = 0) {
  if (value == null || typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'string') return safeMetricText(value);
  if (depth >= 3) return '[details truncated]';
  if (Array.isArray(value)) return value.slice(0, 20).map((item) => safeProviderData(item, depth + 1));
  if (typeof value !== 'object') return safeMetricText(value);
  return Object.fromEntries(Object.entries(value).slice(0, 30).map(([key, item]) => (
    /(?:token|secret|authorization|signature|credential)/i.test(key)
      ? [key, '[credential redacted]']
      : [key, safeProviderData(item, depth + 1)]
  )));
}

function engagementSummary(metrics = {}) {
  const interactionValues = [
    numeric(metrics.reactions) ?? numeric(metrics.likes),
    numeric(metrics.comments),
    numeric(metrics.reposts) ?? numeric(metrics.shares),
    numeric(metrics.quotes),
    numeric(metrics.saves)
  ]
    .filter((value) => value !== null);
  const interactions = interactionValues.length
    ? interactionValues.reduce((total, value) => total + value, 0)
    : null;
  const denominator = ['impressions', 'reach', 'views', 'videoViews']
    .map((field) => numeric(metrics[field]))
    .find((value) => value !== null) ?? null;
  return {
    engagementTotal: interactions,
    engagementRate: interactions !== null && denominator !== null && denominator > 0
      ? interactions / denominator
      : null
  };
}

function nextMetricsSyncAt(job, capturedAt = new Date(), { currentMetrics = null } = {}) {
  const ageMs = Math.max(0, capturedAt.getTime() - new Date(job.publishedAt || capturedAt).getTime());
  let delayMs;
  if (ageMs < 30 * 60 * 1000) delayMs = 2 * 60 * 1000;
  else if (ageMs < 6 * 60 * 60 * 1000) delayMs = 5 * 60 * 1000;
  else if (ageMs < 48 * 60 * 60 * 1000) delayMs = 30 * 60 * 1000;
  else if (ageMs < 14 * 24 * 60 * 60 * 1000) delayMs = 24 * 60 * 60 * 1000;
  else if (ageMs < MAX_METRICS_AGE_MS) delayMs = 7 * 24 * 60 * 60 * 1000;
  else return null;
  const previousExposure = ['impressions', 'reach', 'views', 'videoViews']
    .map((field) => numeric(job.metricsLatest && job.metricsLatest[field]))
    .find((value) => value !== null) ?? null;
  const currentExposure = ['impressions', 'reach', 'views', 'videoViews']
    .map((field) => numeric(currentMetrics && currentMetrics[field]))
    .find((value) => value !== null) ?? null;
  const previousCapturedAt = job.metricsCapturedAt ? new Date(job.metricsCapturedAt) : null;
  const observationGapMs = previousCapturedAt && !Number.isNaN(previousCapturedAt.getTime())
    ? capturedAt.getTime() - previousCapturedAt.getTime()
    : null;
  const breakoutVelocity = previousExposure !== null && currentExposure !== null
    && observationGapMs > 0 && observationGapMs <= 2 * 60 * 60 * 1000
    && currentExposure - previousExposure >= Math.max(50, previousExposure * 0.25);
  if (breakoutVelocity && ageMs < 48 * 60 * 60 * 1000) delayMs = Math.min(delayMs, 10 * 60 * 1000);
  if (job.publishOptions && job.publishOptions.businessImportance === 'high' && ageMs < 48 * 60 * 60 * 1000) {
    delayMs = Math.min(delayMs, 15 * 60 * 1000);
  }
  return new Date(capturedAt.getTime() + delayMs);
}

function observationKey(job, capturedAt, metrics) {
  const minuteBucket = Math.floor(new Date(capturedAt).getTime() / 60000);
  return createHash('sha256')
    .update(`${job._id}:${minuteBucket}:${JSON.stringify(metrics)}`)
    .digest('hex');
}

async function claimMetricsJob(jobId) {
  const now = new Date();
  return PublishJob.findOneAndUpdate(
    {
      _id: jobId,
      status: 'published',
      platformPostId: { $ne: '' },
      $or: [
        { metricsSyncLockedUntil: null },
        { metricsSyncLockedUntil: { $exists: false } },
        { metricsSyncLockedUntil: { $lte: now } }
      ]
    },
    {
      $set: { metricsSyncLockedUntil: new Date(now.getTime() + METRICS_LEASE_MS) },
      $inc: { metricsAttempts: 1 }
    },
    { returnDocument: 'after', select: '+metricsSyncLockedUntil' }
  );
}

async function collectMetricsForJob(jobId) {
  const job = await claimMetricsJob(jobId);
  if (!job) return { success: true, skipped: true };
  const syncRunId = randomUUID();
  const syncRun = await ProviderSyncRun.create({
    syncRunId,
    projectId: job.destinationProjectId || job.projectId,
    accountId: job.accountId,
    publishJobId: job._id,
    platform: job.platform,
    status: 'running',
    postsRequested: 1,
    windowStart: job.publishedAt || null,
    windowEnd: new Date()
  });
  console.info(JSON.stringify({
    event: 'provider_metrics_sync_started',
    syncRunId,
    projectId: String(job.destinationProjectId || job.projectId),
    publishJobId: String(job._id),
    platform: job.platform
  }));
  try {
    const targetProjectId = job.destinationProjectId || job.projectId;
    const account = await SocialAccount.findOne({
      _id: job.accountId,
      $or: [
        { projectId: targetProjectId },
        { projectId: job.projectId },
        { sharedWithProjectIds: targetProjectId }
      ]
    });
    if (!account || !['connected', 'reconnect_required'].includes(account.status)) {
      const error = new Error('Reconnect the social account before Moyi can refresh engagement metrics.');
      error.code = 'social_account_disconnected';
      error.statusCode = 401;
      throw error;
    }
    const credentials = await ensureFreshSocialAccountCredentials(account);
    const result = await getProviderMetrics(job.platform, credentials, {
      platformPostId: job.platformPostId,
      platformUrl: job.platformUrl,
      providerState: job.providerState || {},
      publishedAt: job.publishedAt
    });
    const metrics = normalizeMetrics(result.metrics || {});
    const availableFields = [...new Set((result.availableFields || Object.keys(metrics)).filter((field) => (
      METRIC_FIELDS.includes(field) && Object.prototype.hasOwnProperty.call(metrics, field)
    )))];
    const proposedCapturedAt = result.capturedAt ? new Date(result.capturedAt) : new Date();
    const capturedAt = Number.isNaN(proposedCapturedAt.getTime()) ? new Date() : proposedCapturedAt;
    const summary = engagementSummary(metrics);
    const freshness = freshnessFor(capturedAt, new Date());
    const metricStates = METRIC_FIELDS.map((field) => {
      const hasValue = Object.prototype.hasOwnProperty.call(metrics, field);
      const unsupported = Array.isArray(result.unavailableFields) && result.unavailableFields.includes(field);
      return {
        metric: field,
        value: hasValue ? metrics[field] : null,
        status: hasValue ? 'verified' : (unsupported ? 'unsupported' : 'pending'),
        source: `${job.platform}_api`,
        providerMetric: field,
        observedAt: capturedAt,
        fetchedAt: new Date(),
        freshness,
        syncRunId
      };
    });
    const snapshotPayload = {
      projectId: job.destinationProjectId || job.projectId,
      sourceProjectId: job.projectId,
      publishJobId: job._id,
      draftId: job.draftId,
      accountId: job.accountId,
      platform: job.platform,
      platformPostId: job.platformPostId,
      metrics,
      availableFields,
      unavailableFields: (result.unavailableFields || []).filter((field) => METRIC_FIELDS.includes(field)),
      metricStates,
      ...summary,
      providerData: safeProviderData(result.providerData || {}),
      capturedAt,
      syncRunId,
      observationKey: observationKey(job, capturedAt, metrics),
      reconciledAt: new Date(),
      isFinal: nextMetricsSyncAt(job, capturedAt, { currentMetrics: metrics }) === null
    };
    const snapshot = await EngagementSnapshot.findOneAndUpdate(
      { projectId: snapshotPayload.projectId, publishJobId: job._id, observationKey: snapshotPayload.observationKey },
      { $setOnInsert: snapshotPayload },
      { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true }
    );
    const nextSync = nextMetricsSyncAt(job, capturedAt, { currentMetrics: metrics });
    const observationWrites = metricStates.map((state) => ({
      updateOne: {
        filter: { projectId: job.destinationProjectId || job.projectId, publishJobId: job._id, metric: state.metric, syncRunId },
        update: {
          $set: {
            accountId: job.accountId,
            normalizedFamily: METRIC_FAMILIES[state.metric],
            value: state.value,
            status: state.status,
            source: state.source,
            providerMetric: state.providerMetric,
            platform: job.platform,
            entityType: 'post',
            entityId: job.platformPostId,
            windowStart: job.publishedAt || null,
            windowEnd: capturedAt,
            observedAt: capturedAt,
            fetchedAt: state.fetchedAt,
            freshness: state.freshness,
            rawValue: state.value
          },
          $setOnInsert: { projectId: job.destinationProjectId || job.projectId, publishJobId: job._id, metric: state.metric, syncRunId }
        },
        upsert: true
      }
    }));
    await Promise.all([
      observationWrites.length ? MetricObservation.bulkWrite(observationWrites, { ordered: false }) : Promise.resolve(),
      ProviderSyncRun.updateOne({ _id: syncRun._id }, {
        $set: {
          status: availableFields.length ? 'success' : 'partial',
          finishedAt: new Date(),
          postsFetched: 1,
          metricsFetched: availableFields.length,
          dataThrough: capturedAt,
          permissionStatus: 'ok',
          tokenStatus: 'valid',
          nextRetryAt: nextSync
        }
      }),
      PublishJob.updateOne({ _id: job._id }, {
        $set: {
          metricsStatus: nextSync ? (availableFields.length ? 'active' : 'limited') : 'complete',
          metricsLatest: metrics,
          metricsAvailableFields: availableFields,
          metricsCapturedAt: capturedAt,
          nextMetricsSyncAt: nextSync,
          metricsSyncLockedUntil: null,
          metricsAttempts: 0,
          metricsErrorCode: '',
          metricsErrorMessage: ''
        }
      }),
      SocialAccount.updateOne({ _id: account._id }, {
        $set: {
          metricsStatus: availableFields.length ? 'active' : 'limited',
          metricsStatusMessage: availableFields.length ? '' : 'The provider did not return metrics available to this app.',
          lastMetricsSyncAt: capturedAt
        }
      }),
      recordPublishJobEvent(job, 'metrics_collected', { metadata: { availableFields, capturedAt } })
    ]);
    await rebuildCanonicalPostPerformance(job._id);
    console.info(JSON.stringify({
      event: 'provider_metrics_sync_completed',
      syncRunId,
      projectId: String(job.destinationProjectId || job.projectId),
      publishJobId: String(job._id),
      platform: job.platform,
      status: availableFields.length ? 'success' : 'partial',
      metricsFetched: availableFields.length,
      capturedAt: capturedAt.toISOString()
    }));
    return { success: true, jobId: String(job._id), snapshotId: String(snapshot._id), syncRunId, metrics, nextMetricsSyncAt: nextSync };
  } catch (error) {
    const classification = classifyPublishError(error);
    const attempts = Number(job.metricsAttempts || 1);
    const retryDelay = classification.failureKind === 'rate_limit'
      ? Math.min(24 * 60 * 60 * 1000, 30 * 60 * 1000 * (2 ** Math.min(attempts - 1, 5)))
      : Math.min(24 * 60 * 60 * 1000, 10 * 60 * 1000 * (2 ** Math.min(attempts - 1, 6)));
    const unsupported = String(error.code || '') === 'metrics_not_supported';
    const postUnavailable = String(error.code || '') === 'post_not_found' || Number(error.statusCode || 0) === 404;
    const terminal = unsupported || classification.reconnectRequired || (
      !classification.retryable && ['permanent', 'permission'].includes(classification.failureKind)
    );
    const safeMessage = safeMetricText(error.message || 'Metrics collection failed.');
    const permissionDenied = classification.failureKind === 'permission';
    const accountUpdate = {
      metricsStatus: unsupported ? 'unsupported' : 'error',
      metricsStatusMessage: safeMessage.slice(0, 500)
    };
    await Promise.all([
      ProviderSyncRun.updateOne({ _id: syncRun._id }, {
        $set: {
          status: 'failed',
          finishedAt: new Date(),
          permissionStatus: permissionDenied ? 'denied' : 'unknown',
          tokenStatus: classification.reconnectRequired ? 'reconnect_required' : 'unknown',
          errorCode: String(error.code || 'metrics_fetch_failed').slice(0, 120),
          errorMessage: safeMessage,
          nextRetryAt: terminal ? null : new Date(Date.now() + retryDelay)
        }
      }),
      PublishJob.updateOne({ _id: job._id }, {
        $set: {
          metricsStatus: unsupported ? 'unsupported' : (
            terminal && !classification.reconnectRequired ? 'complete' : 'error'
          ),
          metricsSyncLockedUntil: null,
          metricsErrorCode: String(error.code || 'metrics_fetch_failed').slice(0, 120),
          metricsErrorMessage: safeMessage,
          nextMetricsSyncAt: terminal ? null : new Date(Date.now() + retryDelay),
          ...(classification.reconnectRequired ? { metricsAttempts: 10 } : {})
        }
      }),
      classification.reconnectRequired
        ? markSocialAccountReconnectRequired(job.accountId, safeMessage, { propagateConnection: job.platform === 'linkedin' })
        : postUnavailable
          ? Promise.resolve()
          : SocialAccount.updateOne({ _id: job.accountId }, { $set: accountUpdate }),
      recordPublishJobEvent(job, classification.reconnectRequired ? 'reconnect_required' : 'metrics_failed', {
        errorCode: error.code || 'metrics_fetch_failed',
        message: safeMessage
      })
    ]);
    console.warn(JSON.stringify({
      event: 'provider_metrics_sync_failed',
      syncRunId,
      projectId: String(job.destinationProjectId || job.projectId),
      publishJobId: String(job._id),
      platform: job.platform,
      errorCode: String(error.code || 'metrics_fetch_failed').slice(0, 120),
      reconnectRequired: Boolean(classification.reconnectRequired),
      retryScheduled: !terminal
    }));
    return { success: false, jobId: String(job._id), syncRunId, error: safeMessage, reconnectRequired: classification.reconnectRequired };
  }
}

async function collectDueMetrics({ limit = 100, projectId = null } = {}) {
  const retentionCutoff = new Date(Date.now() - MAX_METRICS_AGE_MS);
  const projectScope = projectId
    ? { $or: [{ projectId }, { destinationProjectId: projectId }] }
    : {};
  const expired = await PublishJob.updateMany(
    {
      ...projectScope,
      status: 'published',
      metricsStatus: { $nin: ['unsupported', 'complete'] },
      publishedAt: { $lte: retentionCutoff }
    },
    {
      $set: {
        metricsStatus: 'complete',
        nextMetricsSyncAt: null,
        metricsSyncLockedUntil: null,
        metricsErrorCode: '',
        metricsErrorMessage: ''
      }
    }
  );
  const jobs = await PublishJob.find({
    ...projectScope,
    status: 'published',
    platformPostId: { $ne: '' },
    metricsStatus: { $nin: ['unsupported', 'complete'] },
    metricsAttempts: { $lt: 10 },
    $or: [
      { nextMetricsSyncAt: null },
      { nextMetricsSyncAt: { $exists: false } },
      { nextMetricsSyncAt: { $lte: new Date() } }
    ],
    publishedAt: { $gt: retentionCutoff }
  }).sort({ nextMetricsSyncAt: 1, publishedAt: 1 }).limit(limit).select('_id');
  const results = [];
  for (const job of jobs) results.push(await collectMetricsForJob(job._id));
  return {
    checked: jobs.length,
    collected: results.filter((result) => result.success && !result.skipped).length,
    failed: results.filter((result) => !result.success).length,
    completedByAge: Number(expired.modifiedCount || 0)
  };
}

async function latestProjectPerformance(projectId, { limit = 50, platform = '' } = {}) {
  const match = { projectId };
  if (platform) match.platform = platform;
  const signals = await GrowthSignal.find(match)
    .sort({ observedAt: -1, score: -1 })
    .limit(Math.min(200, Math.max(1, limit)))
    .populate('draftId', 'title body channel')
    .lean();
  return signals;
}

module.exports = {
  MAX_METRICS_AGE_MS,
  collectDueMetrics,
  collectMetricsForJob,
  engagementSummary,
  latestProjectPerformance,
  nextMetricsSyncAt,
  normalizeMetrics,
  safeMetricText,
  safeProviderData,
  observationKey
};
