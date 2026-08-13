const express = require('express');
const asyncHandler = require('express-async-handler');
const mongoose = require('mongoose');
const Project = require('../models/Project');
const PublishBatch = require('../models/PublishBatch');
const PublishJob = require('../models/PublishJob');
const SocialAccount = require('../models/SocialAccount');
const SocialDraft = require('../models/SocialDraft');
const createRateLimit = require('../middleware/rateLimit');
const { requireApiCredential, requireApiScope } = require('../services/apiCredentialService');
const { createAndQueuePublishBatch } = require('../services/contentDistributionEngineService');
const {
  canPublishProjectRole,
  projectAccessRole,
  publishableProjectIds
} = require('../services/projectAccessService');
const {
  buildSocialPerformanceDashboard,
  normalizeAnalyticsDays,
  socialPerformanceApiPayload
} = require('../services/socialAnalyticsService');
const AppError = require('../utils/appError');

const router = express.Router();
const apiIpRateLimit = createRateLimit({
  windowMs: 60 * 1000,
  max: 180,
  keyPrefix: 'rate-limit:public-api-ip',
  message: 'Too many API requests from this address.'
});
const apiCredentialRateLimit = createRateLimit({
  windowMs: 60 * 1000,
  max: 600,
  keyPrefix: 'rate-limit:public-api-key',
  keyGenerator: (req) => req.apiCredential && req.apiCredential.id,
  message: 'This API key exceeded its request limit.'
});

router.use(apiIpRateLimit);
router.use(requireApiCredential);
router.use(apiCredentialRateLimit);

function objectId(value, label) {
  if (!mongoose.Types.ObjectId.isValid(String(value || ''))) {
    throw new AppError(`${label} is invalid.`, 422);
  }
  return String(value);
}

function credentialAllowsProject(credential, projectId) {
  return credential.projectIds.includes(String(projectId));
}

async function authorizedProject(req, projectId, { publish = false } = {}) {
  const id = objectId(projectId, 'Project ID');
  if (!credentialAllowsProject(req.apiCredential, id)) {
    throw new AppError('This API key is not authorized for that project.', 403);
  }
  const project = await Project.findById(id);
  if (!project) throw new AppError('Project not found.', 404);
  const role = await projectAccessRole({ project, userId: req.apiCredential.userId });
  if (!role || publish && !canPublishProjectRole(role)) {
    throw new AppError(publish ? 'This API key user cannot publish in that project.' : 'Project not found.', publish ? 403 : 404);
  }
  return project;
}

function accountPayload(account) {
  return {
    id: String(account._id),
    projectId: String(account.projectId),
    platform: account.platform,
    accountName: account.accountName,
    externalAccountId: account.externalAccountId || '',
    status: account.status,
    statusMessage: account.statusMessage || '',
    metricsStatus: account.metricsStatus || 'pending',
    lastMetricsSyncAt: account.lastMetricsSyncAt || null
  };
}

function publishJobPayload(job, credential = null) {
  const canSeeSource = !credential || credentialAllowsProject(credential, job.projectId);
  return {
    id: String(job._id),
    batchId: String(job.batchId),
    sourceProjectId: canSeeSource ? String(job.projectId) : null,
    destinationProjectId: String(job.destinationProjectId || job.projectId),
    draftId: canSeeSource ? String(job.draftId) : null,
    accountId: String(job.accountId),
    platform: job.platform,
    status: job.status,
    attempts: job.attempts,
    maxAttempts: job.maxAttempts,
    nextRetryAt: job.nextRetryAt || null,
    failureKind: job.failureKind || '',
    reconnectRequired: Boolean(job.reconnectRequired),
    error: job.errorMessage || '',
    platformPostId: job.platformPostId || '',
    platformUrl: job.platformUrl || '',
    scheduledAt: job.scheduledAt,
    publishedAt: job.publishedAt || null,
    metricsStatus: job.metricsStatus || 'pending',
    metrics: job.metricsLatest || {},
    metricsCapturedAt: job.metricsCapturedAt || null
  };
}

function normalizeArray(value) {
  return [...new Set((Array.isArray(value) ? value : value ? [value] : []).map(String).filter(Boolean))];
}

function visibleBatchSummary(jobs) {
  const statuses = jobs.map((job) => job.status);
  return {
    total: jobs.length,
    successCount: statuses.filter((status) => status === 'published').length,
    failedCount: statuses.filter((status) => ['failed', 'dead_letter', 'expired'].includes(status)).length,
    cancelledCount: statuses.filter((status) => status === 'cancelled').length
  };
}

function visibleBatchStatus(jobs) {
  if (!jobs.length) return 'failed';
  const statuses = jobs.map((job) => job.status);
  if (statuses.some((status) => ['publishing', 'provider_processing', 'preparing_media'].includes(status))) return 'publishing';
  if (statuses.some((status) => ['queued', 'retry_wait'].includes(status))) {
    return statuses.some((status) => ['published', 'failed', 'dead_letter', 'expired'].includes(status)) ? 'publishing' : 'queued';
  }
  const published = statuses.filter((status) => status === 'published').length;
  const failed = statuses.filter((status) => ['failed', 'dead_letter', 'expired'].includes(status)).length;
  if (published === jobs.length) return 'published';
  if (published && failed) return 'partial';
  if (statuses.every((status) => status === 'cancelled')) return 'cancelled';
  return 'failed';
}

function publicPublishOptions(value = {}) {
  const tiktok = value && value.tiktok || {};
  const youtube = value && value.youtube || {};
  return {
    tiktok: {
      privacyLevel: ['PUBLIC_TO_EVERYONE', 'MUTUAL_FOLLOW_FRIENDS', 'FOLLOWER_OF_CREATOR', 'SELF_ONLY'].includes(tiktok.privacyLevel)
        ? tiktok.privacyLevel
        : undefined,
      allowComment: Boolean(tiktok.allowComment),
      allowDuet: Boolean(tiktok.allowDuet),
      allowStitch: Boolean(tiktok.allowStitch),
      commercialContent: Boolean(tiktok.commercialContent),
      brandedContent: Boolean(tiktok.brandedContent),
      brandOrganicContent: Boolean(tiktok.brandOrganicContent),
      musicUsageConsent: Boolean(tiktok.musicUsageConsent)
    },
    youtube: {
      privacyStatus: ['public', 'private', 'unlisted'].includes(youtube.privacyStatus) ? youtube.privacyStatus : 'private',
      videoType: youtube.videoType === 'short' ? 'short' : 'regular',
      categoryId: '22',
      notifySubscribers: Boolean(youtube.notifySubscribers)
    }
  };
}

router.get('/accounts', requireApiScope('accounts:read'), asyncHandler(async (req, res) => {
  const requestedProjectId = req.query.projectId ? objectId(req.query.projectId, 'Project ID') : '';
  const projectIds = requestedProjectId ? [requestedProjectId] : req.apiCredential.projectIds;
  await Promise.all(projectIds.map((projectId) => authorizedProject(req, projectId)));
  const accounts = await SocialAccount.find({ projectId: { $in: projectIds } })
    .select('projectId platform accountName externalAccountId status statusMessage metricsStatus lastMetricsSyncAt')
    .sort({ projectId: 1, platform: 1, accountName: 1 })
    .lean();
  res.json({ data: accounts.map(accountPayload) });
}));

router.post('/publish-jobs', requireApiScope('publish:write'), asyncHandler(async (req, res) => {
  const project = await authorizedProject(req, req.body.projectId, { publish: true });
  const draftId = objectId(req.body.draftId, 'Draft ID');
  const accountIds = normalizeArray(req.body.accountIds);
  if (!accountIds.length || accountIds.some((id) => !mongoose.Types.ObjectId.isValid(id))) {
    throw new AppError('Choose at least one valid connected account.', 422);
  }
  const draft = await SocialDraft.findOne({ _id: draftId, projectId: project._id, status: 'approved' });
  if (!draft) throw new AppError('Only an approved draft can be published.', 422);

  const contextualDestinations = await publishableProjectIds(req.apiCredential.userId, { sourceProject: project });
  const allowedDestinationProjectIds = contextualDestinations.filter((id) => credentialAllowsProject(req.apiCredential, id));
  const selectedAccounts = await SocialAccount.find({
    _id: { $in: accountIds },
    projectId: { $in: allowedDestinationProjectIds },
    status: 'connected'
  }).select('_id projectId');
  if (selectedAccounts.length !== accountIds.length) {
    throw new AppError('One or more accounts are disconnected or outside this API key scope.', 422);
  }
  await Promise.all(selectedAccounts.map((account) => authorizedProject(req, account.projectId, { publish: true })));

  const scheduledAt = req.body.scheduledAt ? new Date(req.body.scheduledAt) : new Date();
  if (Number.isNaN(scheduledAt.getTime())) throw new AppError('scheduledAt must be a valid ISO date.', 422);
  const result = await createAndQueuePublishBatch({
    projectId: project._id,
    userId: req.apiCredential.userId,
    draftIds: [draft._id],
    accountIds,
    firstComment: String(req.body.firstComment || '').trim().slice(0, 3000),
    publishOptions: publicPublishOptions(req.body.publishOptions),
    project,
    scheduledAt,
    allowedDestinationProjectIds
  });
  res.status(202).json({
    data: {
      batchId: String(result.batch._id),
      status: result.batch.status,
      scheduledAt: result.batch.scheduledAt,
      jobs: result.jobs.map((job) => publishJobPayload(job, req.apiCredential))
    }
  });
}));

router.get('/publish-jobs/:id', requireApiScope('jobs:read'), asyncHandler(async (req, res) => {
  const id = objectId(req.params.id, 'Publish job ID');
  const job = await PublishJob.findById(id);
  if (!job) throw new AppError('Publish job not found.', 404);
  const visibleProjectId = job.destinationProjectId || job.projectId;
  await authorizedProject(req, visibleProjectId);
  res.json({ data: publishJobPayload(job, req.apiCredential) });
}));

router.get('/publish-batches/:id', requireApiScope('jobs:read'), asyncHandler(async (req, res) => {
  const id = objectId(req.params.id, 'Publish batch ID');
  const batch = await PublishBatch.findById(id);
  if (!batch) throw new AppError('Publish batch not found.', 404);
  await authorizedProject(req, batch.projectId);
  const jobs = await PublishJob.find({
    batchId: batch._id,
    $or: [
      { destinationProjectId: { $in: req.apiCredential.projectIds } },
      { projectId: { $in: req.apiCredential.projectIds }, destinationProjectId: null },
      { projectId: { $in: req.apiCredential.projectIds }, destinationProjectId: { $exists: false } }
    ]
  }).sort({ createdAt: 1 });
  const destinationProjectIds = [...new Set(jobs.map((job) => String(job.destinationProjectId || job.projectId)))];
  res.json({
    data: {
      id: String(batch._id),
      sourceProjectId: String(batch.projectId),
      destinationProjectIds,
      status: visibleBatchStatus(jobs),
      scheduledAt: batch.scheduledAt,
      summary: visibleBatchSummary(jobs),
      jobs: jobs.map((job) => publishJobPayload(job, req.apiCredential))
    }
  });
}));

router.get('/projects/:id/social-performance', requireApiScope('analytics:read'), asyncHandler(async (req, res) => {
  const project = await authorizedProject(req, req.params.id);
  const dashboard = await buildSocialPerformanceDashboard({
    projectId: project._id,
    days: normalizeAnalyticsDays(req.query.days)
  });
  res.json({ data: socialPerformanceApiPayload(dashboard) });
}));

router.use((error, req, res, next) => {
  if (res.headersSent) return next(error);
  const status = Number(error.statusCode || error.status || 500);
  return res.status(status).json({
    error: {
      code: String(error.code || (status >= 500 ? 'internal_error' : 'request_failed')),
      message: status >= 500 ? 'The API request could not be completed.' : error.message
    }
  });
});

module.exports = router;
module.exports.publishJobPayload = publishJobPayload;
module.exports.visibleBatchSummary = visibleBatchSummary;
module.exports.visibleBatchStatus = visibleBatchStatus;
