const EngagementSnapshot = require('../models/EngagementSnapshot');
const GrowthSignal = require('../models/GrowthSignal');
const PublishJob = require('../models/PublishJob');
const SocialAccount = require('../models/SocialAccount');
const { METRIC_FIELDS } = require('../models/EngagementSnapshot');
const { getProviderMetrics } = require('./socialProviderService');
const { ensureFreshSocialAccountCredentials } = require('./socialTokenRefreshService');
const { classifyPublishError, recordPublishJobEvent } = require('./publishReliabilityService');
const { markSocialAccountReconnectRequired } = require('./socialAccountService');

const METRICS_LEASE_MS = 5 * 60 * 1000;
const MAX_METRICS_AGE_MS = 90 * 24 * 60 * 60 * 1000;

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
  const interactionValues = ['likes', 'comments', 'shares', 'quotes', 'saves', 'clicks']
    .map((field) => numeric(metrics[field]))
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

function nextMetricsSyncAt(job, capturedAt = new Date()) {
  const ageMs = Math.max(0, capturedAt.getTime() - new Date(job.publishedAt || capturedAt).getTime());
  let delayMs;
  if (ageMs < 30 * 60 * 1000) delayMs = 2 * 60 * 1000;
  else if (ageMs < 6 * 60 * 60 * 1000) delayMs = 5 * 60 * 1000;
  else if (ageMs < 48 * 60 * 60 * 1000) delayMs = 30 * 60 * 1000;
  else if (ageMs < 14 * 24 * 60 * 60 * 1000) delayMs = 24 * 60 * 60 * 1000;
  else if (ageMs < MAX_METRICS_AGE_MS) delayMs = 7 * 24 * 60 * 60 * 1000;
  else return null;
  return new Date(capturedAt.getTime() + delayMs);
}

function growthScore(metrics = {}, engagementRate = null) {
  const reach = Number(metrics.impressions ?? metrics.reach ?? metrics.views ?? metrics.videoViews ?? 0);
  const engagement = ['likes', 'comments', 'shares', 'quotes', 'saves', 'clicks']
    .reduce((total, field) => total + Number(metrics[field] || 0), 0);
  const ratePoints = Number.isFinite(engagementRate) ? Math.min(45, engagementRate * 500) : 0;
  return Math.round(Math.min(100, Math.log10(reach + 1) * 10 + Math.log10(engagement + 1) * 15 + ratePoints));
}

async function updateGrowthSignal({ job, snapshot }) {
  const metrics = normalizeMetrics(snapshot.metrics || {});
  const named = Object.entries(metrics).filter(([, value]) => value !== null && value !== undefined);
  const summary = named.length
    ? `${job.platform} post: ${named.slice(0, 5).map(([key, value]) => `${Number(value).toLocaleString()} ${key}`).join(', ')}.`
    : `${job.platform} returned no supported engagement counters.`;
  return GrowthSignal.findOneAndUpdate(
    { publishJobId: job._id },
    {
      $set: {
        projectId: job.destinationProjectId || job.projectId,
        sourceProjectId: job.projectId,
        publishJobId: job._id,
        draftId: job.draftId,
        platform: job.platform,
        signalType: 'social_post_performance',
        score: growthScore(metrics, snapshot.engagementRate),
        summary,
        evidence: {
          metrics,
          availableFields: snapshot.availableFields,
          engagementRate: snapshot.engagementRate,
          capturedAt: snapshot.capturedAt,
          platformPostId: job.platformPostId
        },
        observedAt: snapshot.capturedAt
      }
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
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
    { new: true, select: '+metricsSyncLockedUntil' }
  );
}

async function collectMetricsForJob(jobId) {
  const job = await claimMetricsJob(jobId);
  if (!job) return { success: true, skipped: true };
  try {
    const account = await SocialAccount.findOne({ _id: job.accountId, projectId: job.destinationProjectId || job.projectId });
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
    const snapshot = await EngagementSnapshot.create({
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
      ...summary,
      providerData: safeProviderData(result.providerData || {}),
      capturedAt
    });
    const nextSync = nextMetricsSyncAt(job, capturedAt);
    await Promise.all([
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
      updateGrowthSignal({ job, snapshot }),
      recordPublishJobEvent(job, 'metrics_collected', { metadata: { availableFields, capturedAt } })
    ]);
    return { success: true, jobId: String(job._id), snapshotId: String(snapshot._id), metrics, nextMetricsSyncAt: nextSync };
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
    const accountUpdate = {
      metricsStatus: unsupported ? 'unsupported' : 'error',
      metricsStatusMessage: safeMessage.slice(0, 500)
    };
    await Promise.all([
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
    return { success: false, jobId: String(job._id), error: safeMessage, reconnectRequired: classification.reconnectRequired };
  }
}

async function collectDueMetrics({ limit = 100 } = {}) {
  const retentionCutoff = new Date(Date.now() - MAX_METRICS_AGE_MS);
  const expired = await PublishJob.updateMany(
    {
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
  updateGrowthSignal
};
