const env = require('../config/env');
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const ContentImage = require('../models/ContentImage');
const MediaAsset = require('../models/MediaAsset');
const PublishAction = require('../models/PublishAction');
const PublishBatch = require('../models/PublishBatch');
const PublishJob = require('../models/PublishJob');
const PublishJobEvent = require('../models/PublishJobEvent');
const SocialAccount = require('../models/SocialAccount');
const SocialDraft = require('../models/SocialDraft');
const {
  NATIVE_SOCIAL_PLATFORMS,
  socialAccountAccessFilter
} = require('./socialAccountService');
const { downloadBuffer: downloadContentImageBuffer } = require('./contentImageStorageService');
const { downloadMediaBuffer, downloadMediaToFile } = require('./mediaStorageService');
const { buildPublicMediaUrl } = require('./mediaPublicUrlService');
const { PLATFORM_MEDIA_LIMITS, selectedVariant, validatePlatformMedia, validatePreparedMedia } = require('./mediaProfileService');
const { buildPostPayload } = require('./socialPublisherService');
const { getProviderPublishStatus, publishWithProvider } = require('./socialProviderService');
const { ensureFreshSocialAccountCredentials } = require('./socialTokenRefreshService');
const { nextMetricsSyncAt } = require('./engagementMetricsService');
const {
  platformPolicy,
  recordPublishJobEvent,
  retryDecision
} = require('./publishReliabilityService');
const { markSocialAccountReconnectRequired } = require('./socialAccountService');
const {
  enqueuePublishJob,
  enqueueProviderStatusCheck,
  ensurePublishJobEnqueued,
  reenqueuePublishJob
} = require('../queues/publishQueue');
const { reenqueueMediaProcessing } = require('../queues/mediaQueue');
const {
  ensureSocialPublishAllowed,
  reserveSocialPublishUsage
} = require('./usageService');
const { assertStandardXPost } = require('./xTextService');

const VARIANT_REQUIRED_PLATFORMS = new Set(['facebook', 'instagram', 'threads', 'tiktok', 'youtube']);
const PUBLISH_QUEUE_SUBMIT_TIMEOUT_MS = 5000;

function waitForPublishQueue(promise, timeoutMs = PUBLISH_QUEUE_SUBMIT_TIMEOUT_MS) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const error = new Error('The publishing queue did not respond in time.');
      error.code = 'publish_queue_timeout';
      error.statusCode = 503;
      error.retryable = true;
      reject(error);
    }, timeoutMs);
  });

  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function redactSensitiveText(value) {
  return String(value)
    .replace(/https?:\/\/[^\s"'<>]*\/social-media\/public\/[^\s"'<>]+/gi, '[signed media URL redacted]')
    .replace(/([?&](?:signature|sig|access_token|refresh_token|client_secret|x-amz-signature|x-amz-credential|x-amz-security-token)=)[^&#\s]*/gi, '$1[credential redacted]')
    .replace(/(?:access_token|refresh_token|client_secret|authorization|x-amz-signature|x-amz-credential|x-amz-security-token)["'\s:=]+[^\s,"'}&]+/gi, '[credential redacted]')
    .replace(/Bearer\s+[A-Za-z0-9._~+\/-]+=*/gi, 'Bearer [credential redacted]')
    .slice(0, 1200);
}

function safeErrorMessage(error) {
  return redactSensitiveText(error && error.message ? error.message : 'Publishing failed.');
}

function safeErrorDetails(value, depth = 0) {
  if (value == null || typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'string') return redactSensitiveText(value);
  if (depth >= 4) return '[details truncated]';
  if (Array.isArray(value)) return value.slice(0, 20).map((item) => safeErrorDetails(item, depth + 1));
  if (typeof value !== 'object') return redactSensitiveText(value);

  return Object.fromEntries(Object.entries(value).slice(0, 30).map(([key, item]) => {
    if (/(?:token|secret|authorization|signature|credential)/i.test(key)) {
      return [key, '[credential redacted]'];
    }
    return [key, safeErrorDetails(item, depth + 1)];
  }));
}

function normalizedSchedule(value) {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) {
    const error = new Error('Choose a valid publishing date and time.');
    error.statusCode = 422;
    throw error;
  }
  return date;
}

async function accountsForDraft({ draft, userId, accountIds = [], allowedProjectIds = [] }) {
  const requestedIds = [...new Set((accountIds.length
    ? accountIds
    : draft.socialAccountId
      ? [draft.socialAccountId]
      : []).map(String))];

  if (requestedIds.length) {
    const accounts = await SocialAccount.find({
      _id: { $in: requestedIds },
      projectId: { $in: allowedProjectIds.length ? allowedProjectIds : [draft.projectId] },
      status: 'connected',
      platform: { $in: NATIVE_SOCIAL_PLATFORMS },
      ...socialAccountAccessFilter(userId)
    });
    const byId = new Map(accounts.map((account) => [String(account._id), account]));
    return requestedIds.map((id) => byId.get(id)).filter(Boolean);
  }

  if (!NATIVE_SOCIAL_PLATFORMS.includes(draft.channel)) return [];
  const account = await SocialAccount.findOne({
    projectId: { $in: allowedProjectIds.length ? allowedProjectIds : [draft.projectId] },
    platform: draft.channel,
    status: 'connected',
    ...socialAccountAccessFilter(userId)
  }).sort({ updatedAt: -1 });
  return account ? [account] : [];
}

async function ensureMediaAsset({ draft, userId }) {
  if (!draft.contentImageId) return null;
  const image = await ContentImage.findOne({
    _id: draft.contentImageId,
    projectId: draft.projectId,
    status: { $ne: 'rejected' }
  });
  if (!image) {
    const error = new Error('The selected post image is no longer available. Choose another image before publishing.');
    error.statusCode = 422;
    throw error;
  }

  const baseUrl = String(env.appUrl || 'http://localhost:3000').replace(/\/$/, '');
  const originalUrl = `${baseUrl}/social-drafts/${draft._id}/images/${image._id}/file`;
  const existing = await MediaAsset.findOne({ projectId: draft.projectId, sourceContentImageId: image._id });
  if (existing) {
    existing.userId = image.userId || userId;
    existing.draftId = draft._id;
    existing.altText = image.altText || image.caption || draft.title || '';
    existing.kind = 'image';
    if (!String(existing.storageKey || '').startsWith('social-media/')) {
      existing.originalUrl = originalUrl;
      existing.storageProvider = image.storageProvider;
      existing.storageKey = image.storageKey;
      existing.mimeType = image.mimeType;
      existing.size = image.byteLength;
    }
    return existing.save();
  }
  try {
    return await MediaAsset.create({
      projectId: draft.projectId,
      userId: image.userId || userId,
      draftId: draft._id,
      sourceContentImageId: image._id,
      originalUrl,
      storageProvider: image.storageProvider,
      storageKey: image.storageKey,
      mimeType: image.mimeType,
      kind: 'image',
      size: image.byteLength,
      altText: image.altText || image.caption || draft.title || '',
      variants: {},
      status: 'ready'
    });
  } catch (error) {
    if (error && error.code === 11000) {
      return MediaAsset.findOne({ projectId: draft.projectId, sourceContentImageId: image._id });
    }
    throw error;
  }
}

function defaultMediaAssetsForPlatform(platform, assets) {
  const available = (assets || []).filter((asset) => asset.status !== 'failed');
  const images = available.filter((asset) => asset.kind === 'image');
  const videos = available.filter((asset) => asset.kind === 'video');
  if (platform === 'youtube') return [videos[0], images[0]].filter(Boolean);
  if (platform === 'tiktok') return videos.length ? [videos[0]] : images.slice(0, 35);
  if (['facebook', 'linkedin'].includes(platform) && videos.length) return [videos[0]];
  if (platform === 'facebook') return images.slice(0, 10);
  if (platform === 'linkedin') return images.slice(0, 20);
  if (['bluesky', 'x'].includes(platform)) return images.slice(0, 4);
  if (platform === 'instagram') return available.slice(0, 10);
  if (platform === 'threads') return available.slice(0, 20);
  return available;
}

async function createPublishBatch({
  projectId,
  userId,
  draftIds,
  accountIds = [],
  mediaIds = [],
  mediaIdsByAccount = {},
  firstComment = '',
  publishOptions = {},
  scheduledAt = null,
  project = null,
  allowedDestinationProjectIds = []
}) {
  const uniqueDraftIds = [...new Set((draftIds || []).map(String))];
  const drafts = await SocialDraft.find({
    _id: { $in: uniqueDraftIds },
    projectId,
    status: 'approved',
    publishStatus: { $in: ['approved', 'failed'] }
  }).sort({ scheduledFor: 1 });

  if (!drafts.length) {
    const error = new Error('No approved, unpublished social drafts were selected.');
    error.statusCode = 422;
    throw error;
  }

  const accountSelections = new Map();
  let requestedJobCount = 0;
  for (const draft of drafts) {
    const accounts = await accountsForDraft({
      draft,
      userId,
      accountIds,
      allowedProjectIds: allowedDestinationProjectIds
    });
    if (accounts.some((account) => account.platform === 'x')) {
      assertStandardXPost(draft.body);
    }
    accountSelections.set(String(draft._id), accounts);
    requestedJobCount += accounts.length;
  }
  if (requestedJobCount > 0) {
    await ensureSocialPublishAllowed(userId, requestedJobCount);
  }

  const publishAt = normalizedSchedule(scheduledAt);
  const batch = await PublishBatch.create({
    projectId,
    userId,
    draftIds: drafts.map((draft) => draft._id),
    scheduledAt: publishAt,
    status: 'queued',
    destinationProjectIds: [],
    summary: { total: 0, successCount: 0, failedCount: 0, cancelledCount: 0 }
  });

  const jobs = [];
  const platforms = new Set();
  const draftsWithoutAccounts = [];
  const originalDraftState = new Map(drafts.map((draft) => [String(draft._id), {
    publishStatus: draft.publishStatus,
    errorMessage: draft.errorMessage,
    socialAccountId: draft.socialAccountId || null
  }]));

  try {
    for (const draft of drafts) {
      const accounts = accountSelections.get(String(draft._id)) || [];
      if (!accounts.length) {
        draftsWithoutAccounts.push(draft);
        draft.publishStatus = 'failed';
        draft.errorMessage = 'Select at least one connected social account.';
        await draft.save();
        continue;
      }

      const payload = await buildPostPayload({ draft, project });
      const fallbackMediaAsset = await ensureMediaAsset({ draft, userId });
      const draftMediaAssets = await MediaAsset.find({
        projectId,
        draftId: draft._id,
        status: { $ne: 'failed' }
      }).sort({ createdAt: 1 });
      if (fallbackMediaAsset && !draftMediaAssets.some((asset) => String(asset._id) === String(fallbackMediaAsset._id))) {
        draftMediaAssets.unshift(fallbackMediaAsset);
      }
      for (const account of accounts) {
        const accountKey = String(account._id);
        const hasAccountOverride = Object.prototype.hasOwnProperty.call(mediaIdsByAccount || {}, accountKey);
        const rawMediaIds = hasAccountOverride ? mediaIdsByAccount[accountKey] : mediaIds;
        const requestedMediaIds = [...new Set((Array.isArray(rawMediaIds) ? rawMediaIds : [rawMediaIds]).filter(Boolean).map(String))];
        let selectedAssets = [];
        if (requestedMediaIds.length) {
          const assets = await MediaAsset.find({
            _id: { $in: requestedMediaIds },
            projectId,
            draftId: draft._id,
            status: { $ne: 'failed' }
          });
          const byId = new Map(assets.map((asset) => [String(asset._id), asset]));
          selectedAssets = requestedMediaIds.map((id) => byId.get(id)).filter(Boolean);
          if (selectedAssets.length !== requestedMediaIds.length) {
            const error = new Error('One or more selected media files are unavailable for this draft.');
            error.code = 'invalid_media_selection';
            error.statusCode = 422;
            throw error;
          }
        } else if (!hasAccountOverride) {
          selectedAssets = defaultMediaAssetsForPlatform(account.platform, draftMediaAssets);
        }

        if (
          VARIANT_REQUIRED_PLATFORMS.has(account.platform) &&
          selectedAssets.some((asset) => asset.sourceContentImageId && !Object.keys(asset.variants || {}).length)
        ) {
          for (const asset of selectedAssets) {
            if (!asset.sourceContentImageId || Object.keys(asset.variants || {}).length) continue;
            asset.status = 'queued';
            asset.processingError = '';
            await asset.save();
          }
        }
        validatePlatformMedia(account.platform, selectedAssets, publishOptions, { allowProcessing: true });
        const mediaReady = selectedAssets.every((asset) => asset.status === 'ready');
        if (!mediaReady && !env.queueEnabled) {
          const error = new Error('Media variants require the Redis worker. Set DISABLE_QUEUE=false and run the worker before publishing this post.');
          error.code = 'media_queue_disabled';
          error.statusCode = 503;
          throw error;
        }
        platforms.add(account.platform);
        jobs.push(await PublishJob.create({
          batchId: batch._id,
          projectId,
          destinationProjectId: account.projectId,
          userId,
          draftId: draft._id,
          accountId: account._id,
          platform: account.platform,
          content: {
            title: payload.title,
            body: payload.body,
            firstComment: String(firstComment || '').trim().slice(0, 3000),
            imageUrl: payload.imageUrl,
            imageAlt: payload.imageAlt
          },
          mediaIds: selectedAssets.map((asset) => asset._id),
          publishOptions,
          scheduledAt: publishAt,
          status: mediaReady ? 'queued' : 'preparing_media',
          maxAttempts: platformPolicy(account.platform).maxAttempts,
          metricsStatus: 'pending'
        }));
        await recordPublishJobEvent(jobs[jobs.length - 1], 'created');
      }

      draft.publishStatus = 'queued';
      draft.errorMessage = '';
      if (accounts.length === 1) draft.socialAccountId = accounts[0]._id;
      await draft.save();
    }

    batch.platforms = [...platforms];
    batch.destinationProjectIds = [...new Set(jobs.map((job) => String(job.destinationProjectId || projectId)))];
    batch.summary.total = jobs.length;
    if (!jobs.length) {
      batch.status = 'failed';
      batch.errorMessage = 'No compatible connected accounts were selected.';
    } else if (draftsWithoutAccounts.length) {
      batch.errorMessage = `${draftsWithoutAccounts.length} draft${draftsWithoutAccounts.length === 1 ? '' : 's'} had no compatible account.`;
    }
    await batch.save();
    if (jobs.length) {
      await reserveSocialPublishUsage(userId, jobs.length);
    }
    return { batch, jobs };
  } catch (error) {
    await Promise.all([
      PublishJob.deleteMany({ batchId: batch._id }),
      PublishJobEvent.deleteMany({ publishJobId: { $in: jobs.map((job) => job._id) } }),
      PublishBatch.deleteOne({ _id: batch._id }),
      ...drafts.map((draft) => {
        const original = originalDraftState.get(String(draft._id));
        return SocialDraft.updateOne(
          { _id: draft._id },
          { $set: original }
        );
      })
    ]).catch(() => null);
    throw error;
  }
}

function batchStatus(jobs) {
  if (!jobs.length) return 'failed';
  const hasPublishing = jobs.some((job) => ['preparing_media', 'publishing', 'provider_processing'].includes(job.status));
  const hasQueued = jobs.some((job) => ['queued', 'retry_wait'].includes(job.status));
  if (hasPublishing) return 'publishing';
  if (hasQueued) return jobs.some((job) => ['published', 'failed', 'dead_letter', 'expired'].includes(job.status)) ? 'publishing' : 'queued';
  const published = jobs.filter((job) => job.status === 'published').length;
  const failed = jobs.filter((job) => ['failed', 'dead_letter', 'expired'].includes(job.status)).length;
  if (published === jobs.length) return 'published';
  if (published && failed) return 'partial';
  if (jobs.every((job) => job.status === 'cancelled')) return 'cancelled';
  return 'failed';
}

async function deadLetterProviderProcessingJob(job, error, { reconnectRequired = false } = {}) {
  const message = safeErrorMessage(error);
  job.status = 'dead_letter';
  job.errorCode = String(error.code || 'provider_processing_failed').slice(0, 120);
  job.errorMessage = message;
  job.errorDetails = safeErrorDetails(error.details || {});
  job.failureKind = reconnectRequired ? 'authentication' : 'permanent';
  job.reconnectRequired = reconnectRequired;
  job.deadLetteredAt = new Date();
  job.deadLetterReason = message;
  await job.save();
  if (reconnectRequired) {
    await markSocialAccountReconnectRequired(job.accountId, message, { propagateConnection: job.platform === 'linkedin' });
  }
  await Promise.all([
    recordPublishAction(job, 'failed', {}, message),
    recordPublishJobEvent(job, reconnectRequired ? 'reconnect_required' : 'dead_lettered', {
      fromStatus: 'provider_processing',
      toStatus: 'dead_letter',
      errorCode: job.errorCode,
      message
    }),
    refreshBatchSummary(job.batchId)
  ]);
  return { success: false, deadLettered: true, job, error: message };
}

async function refreshDraftPublishStatus(batchId, draftId, jobs = null) {
  const draftJobs = jobs || await PublishJob.find({ batchId, draftId }).sort({ createdAt: 1 });
  if (!draftJobs.length) return null;
  const publishedJobs = draftJobs.filter((job) => job.status === 'published');
  const failedJobs = draftJobs.filter((job) => ['failed', 'dead_letter', 'expired'].includes(job.status));
  let publishStatus = 'failed';
  if (draftJobs.some((job) => ['preparing_media', 'publishing', 'provider_processing'].includes(job.status))) publishStatus = 'publishing';
  else if (draftJobs.some((job) => ['queued', 'retry_wait'].includes(job.status))) publishStatus = 'queued';
  else if (publishedJobs.length === draftJobs.length) publishStatus = 'published';

  const update = {
    publishStatus,
    errorMessage: failedJobs.map((job) => `${job.platform}: ${job.errorMessage}`).filter(Boolean).join(' | ').slice(0, 1200)
  };
  if (publishedJobs.length) {
    update.publishedAt = publishedJobs[0].publishedAt || new Date();
    update.platformPostId = publishedJobs[0].platformPostId || '';
  }
  return SocialDraft.findByIdAndUpdate(draftId, { $set: update }, { returnDocument: 'after' });
}

async function refreshBatchSummary(batchId) {
  const jobs = await PublishJob.find({ batchId }).sort({ createdAt: 1 });
  const summary = {
    total: jobs.length,
    successCount: jobs.filter((job) => job.status === 'published').length,
    failedCount: jobs.filter((job) => ['failed', 'dead_letter', 'expired'].includes(job.status)).length,
    cancelledCount: jobs.filter((job) => job.status === 'cancelled').length
  };
  const batch = await PublishBatch.findByIdAndUpdate(
    batchId,
    { $set: { summary, status: batchStatus(jobs) } },
    { returnDocument: 'after' }
  );
  const jobsByDraft = new Map();
  jobs.forEach((job) => {
    const key = String(job.draftId);
    if (!jobsByDraft.has(key)) jobsByDraft.set(key, []);
    jobsByDraft.get(key).push(job);
  });
  await Promise.all([...jobsByDraft.entries()].map(([draftId, draftJobs]) => (
    refreshDraftPublishStatus(batchId, draftId, draftJobs)
  )));
  return { batch, summary };
}

async function optimizeImageForPlatform(buffer, platform) {
  const maxBytes = PLATFORM_MEDIA_LIMITS[platform]?.imageBytes || 10 * 1024 * 1024;
  if (buffer.byteLength <= maxBytes) return { buffer, mimeType: null, optimized: false };

  const presets = [
    { width: 2400, quality: 82 },
    { width: 1920, quality: 74 },
    { width: 1600, quality: 66 },
    { width: 1200, quality: 58 }
  ];
  for (const preset of presets) {
    const optimized = await sharp(buffer)
      .rotate()
      .resize({ width: preset.width, height: preset.width, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: preset.quality, mozjpeg: true })
      .toBuffer();
    if (optimized.byteLength <= maxBytes) {
      return { buffer: optimized, mimeType: 'image/jpeg', optimized: true };
    }
  }
  throw new Error(`The image could not be reduced to ${Math.round(maxBytes / 1024 / 1024)} MB for ${platform}.`);
}

async function loadPublishMedia(job) {
  if (!job.mediaIds || !job.mediaIds.length) return { mediaItems: [], cleanup: async () => {} };
  const assets = await MediaAsset.find({
    _id: { $in: job.mediaIds },
    projectId: job.projectId,
    userId: { $ne: null }
  });
  const byId = new Map(assets.map((asset) => [String(asset._id), asset]));
  const orderedAssets = job.mediaIds.map((id) => byId.get(String(id))).filter(Boolean);
  if (orderedAssets.length !== job.mediaIds.length) throw new Error('One or more selected media files could not be loaded.');
  validatePlatformMedia(job.platform, orderedAssets, job.publishOptions || {});

  let workingDirectory = '';
  const cleanup = async () => {
    if (workingDirectory) await fs.promises.rm(workingDirectory, { recursive: true, force: true }).catch(() => null);
  };
  try {
    const mediaItems = [];
    for (const asset of orderedAssets) {
      const variant = selectedVariant(asset, job.platform, job.publishOptions || {});
      if (!variant || !variant.storageKey) {
        const error = new Error(`No ready ${job.platform} media variant is available for ${asset.filename || 'the selected upload'}.`);
        error.code = 'media_variant_missing';
        throw error;
      }
      const isManagedMedia = String(variant.storageKey).startsWith('social-media/');
      let buffer;
      let localPath;
      let mimeType = variant.mimeType || asset.mimeType;
      let size = Number(variant.size || asset.size);
      if (asset.kind === 'image') {
        const original = isManagedMedia
          ? await downloadMediaBuffer(variant.storageKey)
          : await downloadContentImageBuffer(variant.storageKey);
        const prepared = await optimizeImageForPlatform(original, job.platform);
        buffer = prepared.buffer;
        mimeType = prepared.mimeType || mimeType;
        size = buffer.byteLength;
      } else {
        if (!isManagedMedia) throw new Error('The selected video has not completed media processing.');
        if (!workingDirectory) {
          await fs.promises.mkdir(env.mediaUploadTempPath, { recursive: true, mode: 0o700 });
          workingDirectory = await fs.promises.mkdtemp(path.join(env.mediaUploadTempPath, 'publish-'));
        }
        localPath = path.join(workingDirectory, `${asset._id}-${variant.key}.mp4`);
        await downloadMediaToFile(variant.storageKey, localPath);
      }
      mediaItems.push(validatePreparedMedia(job.platform, {
        id: String(asset._id),
        kind: asset.kind,
        ...(buffer ? { buffer } : {}),
        ...(localPath ? { localPath } : {}),
        ...(isManagedMedia ? { url: buildPublicMediaUrl(asset._id, variant.key) } : {}),
        storageKey: variant.storageKey,
        mimeType,
        size,
        width: variant.width || asset.width || null,
        height: variant.height || asset.height || null,
        durationMs: variant.durationMs || asset.durationMs || null,
        altText: asset.altText || job.content.imageAlt || ''
      }));
    }
    return { mediaItems, cleanup };
  } catch (error) {
    await cleanup();
    throw error;
  }
}

async function recordPublishAction(job, status, result = {}, errorMessage = '') {
  return PublishAction.create({
    projectId: job.destinationProjectId || job.projectId,
    userId: job.userId,
    socialDraftId: job.draftId,
    socialAccountId: job.accountId,
    integrationType: job.platform,
    actionType: 'publish_social_post',
    externalId: result.platformPostId || '',
    status,
    errorMessage
  }).catch(() => null);
}

async function executePublishJob({ jobId }) {
  const existing = await PublishJob.findById(jobId);
  if (!existing) {
    const error = new Error('Publish job not found.');
    error.statusCode = 404;
    throw error;
  }
  if (existing.status === 'published') return { success: true, job: existing, alreadyPublished: true };
  if (existing.status === 'cancelled') return { success: false, job: existing, error: 'Publish job was cancelled.' };
  if (existing.scheduledAt && existing.scheduledAt.getTime() > Date.now() + 1000) {
    const error = new Error('Publish job is not due yet.');
    error.code = 'publish_job_not_due';
    throw error;
  }

  const job = await PublishJob.findOneAndUpdate(
    { _id: jobId, status: { $in: ['queued', 'retry_wait'] } },
    {
      $set: {
        status: 'publishing',
        errorCode: '',
        errorMessage: '',
        errorDetails: {},
        warningMessage: '',
        nextRetryAt: null,
        lastAttemptAt: new Date(),
        providerDispatchStartedAt: null,
        failureKind: '',
        reconnectRequired: false
      },
      $inc: { attempts: 1 }
    },
    { returnDocument: 'after' }
  );
  if (!job) {
    const current = await PublishJob.findById(jobId);
    if (current && current.status === 'published') return { success: true, job: current, alreadyPublished: true };
    const error = new Error('Publish job is already being processed.');
    error.code = 'publish_job_in_progress';
    throw error;
  }

  let cleanupMedia = async () => {};
  try {
    await recordPublishJobEvent(job, 'attempt_started', { fromStatus: existing.status, toStatus: 'publishing' });
    const [draft, account] = await Promise.all([
      SocialDraft.findOne({ _id: job.draftId, projectId: job.projectId }),
      SocialAccount.findOne({
        _id: job.accountId,
        projectId: job.destinationProjectId || job.projectId,
        ...socialAccountAccessFilter(job.userId)
      })
    ]);
    if (!draft || draft.status !== 'approved') {
      const error = new Error('Human approval gate: this draft must remain approved before publishing.');
      error.statusCode = 422;
      throw error;
    }
    if (!account || account.platform !== job.platform || account.status !== 'connected') {
      const error = new Error('The selected social account must be reconnected before publishing.');
      error.code = 'social_account_disconnected';
      error.statusCode = 401;
      throw error;
    }
    if (!NATIVE_SOCIAL_PLATFORMS.includes(job.platform)) {
      throw new Error(`Native ${job.platform} publishing is not available in this release.`);
    }

    const credentials = await ensureFreshSocialAccountCredentials(account);
    if (!credentials || credentials.status !== 'connected') {
      throw new Error('The selected social account is no longer connected.');
    }
    const loadedMedia = await loadPublishMedia(job);
    cleanupMedia = loadedMedia.cleanup;
    const mediaItems = loadedMedia.mediaItems;
    const text = String(job.content.body || job.content.title || '').trim();
    if (!text) throw new Error('The approved post has no text to publish.');
    job.providerDispatchStartedAt = new Date();
    await job.save();
    const result = await publishWithProvider(job.platform, credentials, {
      text,
      title: job.content.title || '',
      body: job.content.body || '',
      firstComment: job.content.firstComment || '',
      media: mediaItems[0] || null,
      mediaItems,
      options: job.publishOptions || {}
    });

    job.status = result.status === 'processing' ? 'provider_processing' : 'published';
    job.platformPostId = result.platformPostId || '';
    job.platformUrl = result.platformUrl || '';
    job.providerState = result.providerState || {};
    job.firstCommentId = result.firstCommentId || '';
    job.warningMessage = result.warning || '';
    job.publishedAt = result.status === 'processing' ? null : new Date();
    job.metricsStatus = 'pending';
    job.nextMetricsSyncAt = result.status === 'processing' ? null : nextMetricsSyncAt(job, new Date());
    job.errorCode = '';
    job.errorMessage = '';
    job.errorDetails = {};
    await job.save();
    if (result.status === 'processing') {
      await recordPublishAction(job, 'pending', result);
      await enqueueProviderStatusCheck(job._id, { delayMs: 30000, checkNumber: 0 });
      return { success: true, processing: true, job, ...result };
    }
    await recordPublishAction(job, 'success', result);
    await recordPublishJobEvent(job, 'published', { fromStatus: 'publishing', toStatus: 'published' });
    return { success: true, job, ...result };
  } catch (error) {
    const decision = retryDecision({ job, error, protectUnknownOutcome: true });
    const providerMessage = safeErrorMessage(error);
    const message = decision.outcomeUnknown
      ? `The provider response was interrupted after dispatch. Check the live account before retrying to avoid a duplicate. Provider detail: ${providerMessage}`
      : providerMessage;
    job.status = decision.shouldRetry ? 'retry_wait' : 'dead_letter';
    job.errorCode = String(decision.outcomeUnknown ? 'provider_outcome_unknown' : (error.code || error.name || 'publish_failed')).slice(0, 120);
    job.errorMessage = message;
    job.errorDetails = safeErrorDetails(error.details || {
      ...(error.providerCode ? { providerCode: String(error.providerCode) } : {}),
      ...(error.providerSubcode ? { providerSubcode: String(error.providerSubcode) } : {}),
      retryable: Boolean(error.retryable)
    });
    job.maxAttempts = decision.maxAttempts;
    job.nextRetryAt = decision.nextRetryAt;
    job.failureKind = decision.failureKind;
    job.reconnectRequired = decision.reconnectRequired;
    job.deadLetteredAt = decision.deadLetter ? new Date() : null;
    job.deadLetterReason = decision.deadLetter ? message : '';
    await job.save();
    if (decision.reconnectRequired) {
      await markSocialAccountReconnectRequired(job.accountId, message, { propagateConnection: job.platform === 'linkedin' });
    }
    await recordPublishJobEvent(job, decision.shouldRetry ? 'retry_scheduled' : 'dead_lettered', {
      fromStatus: 'publishing',
      toStatus: job.status,
      errorCode: job.errorCode,
      message,
      metadata: { nextRetryAt: decision.nextRetryAt, failureKind: decision.failureKind }
    });
    await recordPublishAction(job, 'failed', {}, message);
    return { success: false, retryScheduled: decision.shouldRetry, deadLettered: decision.deadLetter, job, error: message };
  } finally {
    await cleanupMedia();
    await refreshBatchSummary(job.batchId).catch(() => null);
  }
}

async function executeProviderStatusCheck({ jobId }) {
  const job = await PublishJob.findOne({ _id: jobId, status: 'provider_processing' });
  if (!job) return { success: true, skipped: true };
  const submittedAt = new Date(job.providerState && job.providerState.submittedAt || job.updatedAt).getTime();
  if (Number.isFinite(submittedAt) && submittedAt < Date.now() - 24 * 60 * 60 * 1000) {
    const error = new Error(`${job.platform} did not finish processing the post within 24 hours.`);
    error.code = 'provider_processing_timeout';
    return deadLetterProviderProcessingJob(job, error);
  }
  const account = await SocialAccount.findOne({
    _id: job.accountId,
    projectId: job.destinationProjectId || job.projectId,
    ...socialAccountAccessFilter(job.userId)
  });
  if (!account || account.status !== 'connected') {
    const error = new Error('Reconnect the social account so Moyi can finish checking the submitted post.');
    error.code = 'social_account_disconnected';
    error.statusCode = 401;
    return deadLetterProviderProcessingJob(job, error, { reconnectRequired: true });
  }

  try {
    const credentials = await ensureFreshSocialAccountCredentials(account);
    const result = await getProviderPublishStatus(job.platform, credentials, job.providerState || {});
    if (result.status === 'processing') {
      job.providerState = result.providerState || job.providerState || {};
      await job.save();
      const checks = Number(job.providerState.checks || 0);
      const delayMs = checks < 10 ? 30000 : checks < 30 ? 2 * 60 * 1000 : 10 * 60 * 1000;
      await enqueueProviderStatusCheck(job._id, { delayMs, checkNumber: checks });
      return { success: true, processing: true, job };
    }
    if (result.status === 'failed') {
      const error = new Error(result.errorMessage || `${job.platform} rejected the post during processing.`);
      error.code = result.errorCode || 'provider_processing_failed';
      return deadLetterProviderProcessingJob(job, error);
    }
    job.status = 'published';
    job.platformPostId = result.platformPostId || job.platformPostId || '';
    job.platformUrl = result.platformUrl || job.platformUrl || '';
    job.providerState = result.providerState || job.providerState || {};
    job.publishedAt = new Date();
    job.metricsStatus = 'pending';
    job.nextMetricsSyncAt = nextMetricsSyncAt(job, new Date());
    job.errorCode = '';
    job.errorMessage = '';
    await job.save();
    await recordPublishAction(job, 'success', result);
    await recordPublishJobEvent(job, 'published', { fromStatus: 'provider_processing', toStatus: 'published' });
    await refreshBatchSummary(job.batchId);
    return { success: true, job, ...result };
  } catch (error) {
    const decision = retryDecision({ job, error });
    if (decision.retryable) {
      const checks = Number(job.providerState && job.providerState.checks || 0) + 1;
      job.providerState = {
        ...(job.providerState || {}),
        checks,
        lastStatusError: safeErrorMessage(error),
        lastStatusErrorAt: new Date().toISOString()
      };
      await job.save();
      const delayMs = Math.min(30 * 60 * 1000, 30 * 1000 * (2 ** Math.min(checks, 6)));
      await enqueueProviderStatusCheck(job._id, { delayMs, checkNumber: `error-${checks}-${Date.now()}` });
      return { success: true, processing: true, statusCheckDelayed: true, job };
    }
    return deadLetterProviderProcessingJob(job, error, { reconnectRequired: decision.reconnectRequired });
  }
}

async function executePublishBatch({ batchId }) {
  const batch = await PublishBatch.findById(batchId);
  if (!batch) {
    const error = new Error('Publish batch not found.');
    error.statusCode = 404;
    throw error;
  }
  batch.status = 'publishing';
  await batch.save();
  const jobs = await PublishJob.find({
    batchId,
    status: 'queued',
    scheduledAt: { $lte: new Date() }
  }).sort({ scheduledAt: 1, createdAt: 1 });
  const results = [];
  for (const job of jobs) results.push(await executePublishJob({ jobId: job._id }));
  const refreshed = await refreshBatchSummary(batchId);
  return {
    batch: refreshed.batch,
    jobs,
    total: refreshed.summary.total,
    successCount: refreshed.summary.successCount,
    failedCount: refreshed.summary.failedCount,
    errors: results.filter((result) => !result.success).map((result) => ({
      jobId: result.job._id,
      draftId: result.job.draftId,
      platform: result.job.platform,
      error: result.error
    }))
  };
}

async function createAndQueuePublishBatch(options) {
  const created = await createPublishBatch(options);
  if (!created.jobs.length) {
    return { ...created, total: 0, queuedCount: 0, successCount: 0, failedCount: 0 };
  }

  if (env.queueEnabled) {
    const readyJobs = created.jobs.filter((job) => job.status === 'queued');
    const mediaAssetIds = [...new Set(created.jobs
      .filter((job) => job.status === 'preparing_media')
      .flatMap((job) => job.mediaIds.map(String)))];
    let queueDelayed = false;
    try {
      await waitForPublishQueue(Promise.all([
        ...readyJobs.map((job) => enqueuePublishJob(job._id, job.scheduledAt)),
        ...mediaAssetIds.map((assetId) => reenqueueMediaProcessing(assetId))
      ]));
    } catch (error) {
      queueDelayed = true;
      created.batch.errorMessage = [
        created.batch.errorMessage,
        'Publishing is saved and will start automatically when the background queue reconnects.'
      ].filter(Boolean).join(' ');
      await created.batch.save();
      console.warn(`Social publishing queue delayed (${String(error.code || 'queue_unavailable')}).`);
    }
    return {
      ...created,
      total: created.jobs.length,
      queuedCount: created.jobs.length,
      successCount: 0,
      failedCount: 0,
      queueDelayed
    };
  }

  const dueNow = created.jobs.some((job) => !job.scheduledAt || job.scheduledAt.getTime() <= Date.now() + 1000);
  if (dueNow) return executePublishBatch({ batchId: created.batch._id });
  return {
    ...created,
    total: created.jobs.length,
    queuedCount: created.jobs.length,
    successCount: 0,
    failedCount: 0,
    queueDisabled: true
  };
}

async function createAndExecutePublishBatch(options) {
  const { batch } = await createPublishBatch({ ...options, scheduledAt: options.scheduledAt || new Date() });
  return executePublishBatch({ batchId: batch._id });
}

function assertPublishJobRetrySafe(existing) {
  if (!existing || !['failed', 'dead_letter'].includes(existing.status)) {
    const error = new Error('Only failed publish jobs can be retried.');
    error.statusCode = 422;
    throw error;
  }
  if (existing.platformPostId || existing.publishedAt) {
    const error = new Error('This publication already has a provider success record and cannot be retried.');
    error.statusCode = 409;
    throw error;
  }
  if (existing.providerDispatchStartedAt && existing.failureKind === 'unknown') {
    const error = new Error('Moyi cannot safely retry because the provider outcome is unknown. Check the live account first, then mark the post published or contact support.');
    error.statusCode = 409;
    throw error;
  }
}

async function retryPublishJob(jobId) {
  const existing = await PublishJob.findOne({
    _id: jobId,
    status: { $in: ['failed', 'dead_letter'] }
  });
  if (!existing) return null;
  assertPublishJobRetrySafe(existing);

  const draft = await SocialDraft.findOne({ _id: existing.draftId, projectId: existing.projectId });
  const contentUpdates = {};
  if (draft) {
    if (existing.platform === 'x') assertStandardXPost(draft.body);
    contentUpdates['content.title'] = draft.title || '';
    contentUpdates['content.body'] = draft.body || '';
  }

  const job = await PublishJob.findOneAndUpdate(
    { _id: jobId, status: { $in: ['failed', 'dead_letter'] } },
    {
      $set: {
        ...contentUpdates,
        status: 'queued',
        errorCode: '',
        errorMessage: '',
        errorDetails: {},
        providerState: {},
        firstCommentId: '',
        warningMessage: '',
        platformPostId: '',
        platformUrl: '',
        publishedAt: null,
        scheduledAt: new Date(),
        attempts: 0,
        providerDispatchStartedAt: null,
        nextRetryAt: null,
        failureKind: '',
        reconnectRequired: false,
        deadLetteredAt: null,
        deadLetterReason: ''
      },
      $inc: { manualRetryCount: 1 }
    },
    { returnDocument: 'after' }
  );
  if (!job) {
    const error = new Error('Only failed publish jobs can be retried.');
    error.statusCode = 422;
    throw error;
  }
  await refreshBatchSummary(job.batchId);
  await recordPublishJobEvent(job, 'manual_retry', { fromStatus: existing.status, toStatus: 'queued' });
  if (env.queueEnabled) await reenqueuePublishJob(job._id, job.scheduledAt);
  else await executePublishJob({ jobId: job._id });
  return job;
}

async function recoverDuePublishJobs({ limit = 250 } = {}) {
  if (!env.queueEnabled) return { recovered: 0 };
  await PublishJob.updateMany(
    {
      status: 'retry_wait',
      nextRetryAt: { $lte: new Date() }
    },
    {
      $set: { status: 'queued', scheduledAt: new Date() }
    }
  );
  const staleJobs = await PublishJob.find({
    status: 'publishing',
    updatedAt: { $lte: new Date(Date.now() - 30 * 60 * 1000) }
  }).limit(limit);
  for (const staleJob of staleJobs) {
    if (staleJob.providerDispatchStartedAt) {
      staleJob.status = 'dead_letter';
      staleJob.failureKind = 'unknown';
      staleJob.errorCode = 'provider_outcome_unknown';
      staleJob.errorMessage = 'The worker stopped after sending this post. Check the social account before retrying to avoid a duplicate.';
      staleJob.deadLetterReason = staleJob.errorMessage;
      staleJob.deadLetteredAt = new Date();
      await staleJob.save();
      await recordPublishJobEvent(staleJob, 'dead_lettered', {
        fromStatus: 'publishing',
        toStatus: 'dead_letter',
        errorCode: staleJob.errorCode,
        message: staleJob.errorMessage
      });
    } else {
      staleJob.status = 'queued';
      staleJob.errorCode = 'stale_publish_recovered';
      staleJob.errorMessage = 'Publishing stopped before provider dispatch and has been queued again.';
      await staleJob.save();
      await recordPublishJobEvent(staleJob, 'retry_scheduled', {
        fromStatus: 'publishing',
        toStatus: 'queued',
        errorCode: staleJob.errorCode,
        message: staleJob.errorMessage
      });
    }
    await refreshBatchSummary(staleJob.batchId).catch(() => null);
  }
  const jobs = await PublishJob.find({
    status: 'queued',
    scheduledAt: { $lte: new Date() }
  }).sort({ scheduledAt: 1 }).limit(limit);
  for (const job of jobs) await ensurePublishJobEnqueued(job._id, job.scheduledAt);
  const processingJobs = await PublishJob.find({ status: 'provider_processing' }).sort({ updatedAt: 1 }).limit(limit);
  for (const job of processingJobs) {
    const checks = Number(job.providerState && job.providerState.checks || 0);
    await enqueueProviderStatusCheck(job._id, { delayMs: 5000, checkNumber: `recovery-${checks}-${Date.now()}` });
  }
  return { recovered: jobs.length, staleChecked: staleJobs.length, providerChecks: processingJobs.length };
}

async function recoverStalledPublishJob(jobId) {
  const job = await PublishJob.findOne({ _id: jobId, status: 'publishing' });
  if (!job) return null;
  if (job.providerDispatchStartedAt) {
    job.status = 'dead_letter';
    job.failureKind = 'unknown';
    job.errorCode = 'provider_outcome_unknown';
    job.errorMessage = 'The worker stalled after provider dispatch. Check the live social account before manually retrying.';
    job.deadLetterReason = job.errorMessage;
    job.deadLetteredAt = new Date();
    await job.save();
    await recordPublishJobEvent(job, 'dead_lettered', {
      fromStatus: 'publishing',
      toStatus: 'dead_letter',
      errorCode: job.errorCode,
      message: job.errorMessage
    });
  } else {
    job.status = 'queued';
    job.errorCode = 'worker_stalled';
    job.errorMessage = 'The worker stalled before provider dispatch and this post will retry.';
    await job.save();
    await recordPublishJobEvent(job, 'retry_scheduled', {
      fromStatus: 'publishing',
      toStatus: 'queued',
      errorCode: job.errorCode,
      message: job.errorMessage
    });
    if (env.queueEnabled) await reenqueuePublishJob(job._id, new Date()).catch(() => null);
  }
  await refreshBatchSummary(job.batchId).catch(() => null);
  return job;
}

module.exports = {
  assertPublishJobRetrySafe,
  createAndExecutePublishBatch,
  createAndQueuePublishBatch,
  createPublishBatch,
  defaultMediaAssetsForPlatform,
  executePublishBatch,
  executePublishJob,
  executeProviderStatusCheck,
  recoverDuePublishJobs,
  recoverStalledPublishJob,
  refreshBatchSummary,
  retryPublishJob,
  safeErrorDetails,
  safeErrorMessage,
  waitForPublishQueue
};
