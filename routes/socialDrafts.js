const express = require('express');
const asyncHandler = require('express-async-handler');
const crypto = require('crypto');
const fs = require('fs');
const { body, param, query } = require('express-validator');
const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc');
const timezone = require('dayjs/plugin/timezone');
const multer = require('multer');
const env = require('../config/env');
const Project = require('../models/Project');
const SocialDraft = require('../models/SocialDraft');
const ContentImage = require('../models/ContentImage');
const MediaAsset = require('../models/MediaAsset');
const PublishJob = require('../models/PublishJob');
const SocialAccount = require('../models/SocialAccount');
const AppError = require('../utils/appError');
const handleValidation = require('../utils/validate');
const { requireAuth } = require('../middleware/auth');
const {
  rejectContentImage,
  restoreContentImage,
  saveUploadedImage,
  selectContentImage
} = require('../services/contentImageService');
const { openDownloadStream: openContentImageDownloadStream } = require('../services/contentImageStorageService');
const { deleteMediaFile, openMediaDownloadStream } = require('../services/mediaStorageService');
const { cancelMediaProcessing, enqueueMediaProcessing, reenqueueMediaProcessing } = require('../queues/mediaQueue');
const {
  canChangeProjectRole,
  canPublishProjectRole,
  projectAccessRole,
  publishableProjectIds
} = require('../services/projectAccessService');
const { queueContentImageGeneration } = require('../services/projectTaskService');
const { ensureImageGenerationAllowed } = require('../services/usageService');
const { getTikTokCreatorInfo } = require('../services/socialProviderService');
const { ensureFreshSocialAccountCredentials } = require('../services/socialTokenRefreshService');
const { socialAccountAccessFilter } = require('../services/socialAccountService');
const { assertStandardXPost } = require('../services/xTextService');

const router = express.Router();
dayjs.extend(utc);
dayjs.extend(timezone);
const imageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 1 }
});
const mediaUpload = multer({
  storage: multer.diskStorage({
    destination(req, file, callback) {
      fs.promises.mkdir(env.mediaUploadTempPath, { recursive: true, mode: 0o700 })
        .then(() => callback(null, env.mediaUploadTempPath))
        .catch(callback);
    },
    filename(req, file, callback) {
      callback(null, `upload-${crypto.randomUUID()}`);
    }
  }),
  limits: { fileSize: env.mediaMaxUploadBytes, files: 1 },
  fileFilter(req, file, callback) {
    const allowed = new Set(['image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/quicktime', 'video/webm']);
    if (allowed.has(file.mimetype)) return callback(null, true);
    const error = new Error('Upload a JPEG, PNG, WebP, MP4, MOV, or WebM file.');
    error.code = 'unsupported_media_type';
    return callback(error);
  }
});

function calendarUrl(projectId, draftId, params = {}) {
  const query = new URLSearchParams(params);
  return `/projects/${projectId}/calendar${query.toString() ? `?${query.toString()}` : ''}#post-${draftId}`;
}

function uploadSingleImage(req, res, next) {
  imageUpload.single('image')(req, res, (error) => {
    if (!error) return next();
    const message = error.code === 'LIMIT_FILE_SIZE'
      ? 'Image uploads must be 10 MB or smaller.'
      : 'The image upload could not be processed.';
    return res.redirect(calendarUrl(req.project._id, req.socialDraft._id, { error: message }));
  });
}

function uploadSingleMedia(req, res, next) {
  mediaUpload.single('media')(req, res, (error) => {
    if (!error) return next();
    const message = error.code === 'LIMIT_FILE_SIZE'
      ? `Media uploads must be ${Math.round(env.mediaMaxUploadBytes / 1024 / 1024)} MB or smaller.`
      : error.message || 'The media upload could not be received.';
    return res.redirect(calendarUrl(req.project._id, req.socialDraft._id, { error: message }));
  });
}

router.use(requireAuth);

async function loadSocialDraft(req, res, next) {
  try {
    const socialDraft = await SocialDraft.findById(req.params.id);
    if (!socialDraft) return next(new AppError('Social draft not found.', 404));

    const project = await Project.findById(socialDraft.projectId);
    if (!project) return next(new AppError('Social draft not found.', 404));
    const role = await projectAccessRole({ project, userId: req.user._id });
    if (!role) return next(new AppError('Social draft not found.', 404));

    req.socialDraft = socialDraft;
    req.project = project;
    req.projectAccessRole = role;
    next();
  } catch (error) {
    next(error);
  }
}

function requireDraftManager(req, res, next) {
  if (!canChangeProjectRole(req.projectAccessRole)) {
    return next(new AppError('You do not have permission to edit or approve this social draft.', 403));
  }
  return next();
}

function requireDraftPublisher(req, res, next) {
  if (!canPublishProjectRole(req.projectAccessRole)) {
    return next(new AppError('You do not have permission to publish this social draft.', 403));
  }
  return next();
}

function requireApprovedOrManager(req, res, next) {
  if (req.socialDraft.status === 'approved') return next();
  return requireDraftManager(req, res, next);
}

function requireDraftNotPublishing(req, res, next) {
  if (['queued', 'preparing_media', 'publishing', 'provider_processing'].includes(req.socialDraft.publishStatus)) {
    return next(new AppError('Wait for the active publishing jobs to finish before changing this draft.', 409));
  }
  return next();
}

router.get(
  '/:id/images/:imageId/file',
  [param('id').isMongoId(), param('imageId').isMongoId(), handleValidation],
  loadSocialDraft,
  asyncHandler(async (req, res, next) => {
    const image = await ContentImage.findOne({
      _id: req.params.imageId,
      draftId: req.socialDraft._id,
      projectId: req.project._id
    });
    if (!image) return next(new AppError('Social post image not found.', 404));

    res.set('Content-Type', image.mimeType);
    res.set('Content-Length', String(image.byteLength));
    res.set('Cache-Control', 'private, max-age=3600');
    if (req.query.download === '1') {
      res.attachment(image.filename);
    }

    const stream = openContentImageDownloadStream(image.storageKey);
    stream.on('error', next);
    stream.pipe(res);
  })
);

router.get(
  '/:id/media/:assetId/file',
  [param('id').isMongoId(), param('assetId').isMongoId(), handleValidation],
  loadSocialDraft,
  asyncHandler(async (req, res, next) => {
    const asset = await MediaAsset.findOne({
      _id: req.params.assetId,
      draftId: req.socialDraft._id,
      projectId: req.project._id,
      status: 'ready'
    });
    if (!asset) return next(new AppError('Processed media file not found.', 404));
    const variantKey = String(req.query.variant || 'original');
    const media = variantKey === 'original'
      ? { storageKey: asset.storageKey, mimeType: asset.mimeType, size: asset.size }
      : asset.variants && asset.variants[variantKey];
    if (!media || !String(media.storageKey || '').startsWith('social-media/')) {
      return next(new AppError('Processed media variant not found.', 404));
    }
    const totalSize = Number(media.size || 0);
    const rangeMatch = String(req.headers.range || '').match(/^bytes=(\d+)-(\d*)$/);
    let start;
    let end;
    if (rangeMatch && totalSize > 0) {
      start = Number(rangeMatch[1]);
      end = rangeMatch[2] ? Number(rangeMatch[2]) : totalSize - 1;
      if (start >= totalSize || end < start || end >= totalSize) {
        res.set('Content-Range', `bytes */${totalSize}`);
        return res.status(416).end();
      }
      res.status(206);
      res.set('Content-Range', `bytes ${start}-${end}/${totalSize}`);
      res.set('Content-Length', String(end - start + 1));
    } else if (totalSize > 0) {
      res.set('Content-Length', String(totalSize));
    }
    res.set('Content-Type', media.mimeType || 'application/octet-stream');
    res.set('Accept-Ranges', 'bytes');
    res.set('Cache-Control', 'private, max-age=3600');
    if (req.query.download === '1') res.attachment(asset.filename || `media-${asset._id}`);
    const stream = await openMediaDownloadStream(media.storageKey, {
      ...(Number.isInteger(start) ? { start, end, range: `bytes=${start}-${end}` } : {})
    });
    stream.on('error', next);
    stream.pipe(res);
  })
);

router.get(
  '/:id/media-status',
  [param('id').isMongoId(), handleValidation],
  loadSocialDraft,
  asyncHandler(async (req, res) => {
    const assets = await MediaAsset.find({
      draftId: req.socialDraft._id,
      projectId: req.project._id
    }).select('kind status processingError updatedAt');
    res.json({
      assets: assets.map((asset) => ({
        id: String(asset._id),
        kind: asset.kind,
        status: asset.status,
        error: asset.status === 'failed' ? asset.processingError : '',
        updatedAt: asset.updatedAt
      }))
    });
  })
);

router.post(
  '/:id/media/upload',
  [param('id').isMongoId(), handleValidation],
  loadSocialDraft,
  requireDraftManager,
  requireDraftNotPublishing,
  uploadSingleMedia,
  asyncHandler(async (req, res) => {
    if (!req.file) {
      return res.redirect(calendarUrl(req.project._id, req.socialDraft._id, { error: 'Choose an image or video to upload.' }));
    }
    let asset;
    try {
      asset = await MediaAsset.create({
        projectId: req.project._id,
        userId: req.user._id,
        draftId: req.socialDraft._id,
        originalUrl: '',
        storageProvider: env.mediaStorageProvider,
        storageKey: '',
        temporaryPath: req.file.path,
        filename: String(req.file.originalname || 'media').slice(0, 240),
        kind: req.file.mimetype.startsWith('video/') ? 'video' : 'image',
        mimeType: req.file.mimetype,
        size: req.file.size,
        altText: String(req.body.altText || '').trim().slice(0, 500),
        status: 'queued',
        variants: {}
      });
      await enqueueMediaProcessing(asset._id);
      res.redirect(calendarUrl(req.project._id, req.socialDraft._id, {
        success: 'Media uploaded. Moyi is preparing platform-ready versions in the background.'
      }));
    } catch (error) {
      if (asset) await MediaAsset.deleteOne({ _id: asset._id }).catch(() => null);
      await fs.promises.unlink(req.file.path).catch(() => null);
      res.redirect(calendarUrl(req.project._id, req.socialDraft._id, { error: error.message }));
    }
  })
);

router.post(
  '/:id/media/:assetId/update',
  [
    param('id').isMongoId(),
    param('assetId').isMongoId(),
    body('altText').optional({ checkFalsy: true }).trim().isLength({ max: 500 }).withMessage('Alt text is too long.'),
    handleValidation
  ],
  loadSocialDraft,
  requireDraftManager,
  requireDraftNotPublishing,
  asyncHandler(async (req, res, next) => {
    const asset = await MediaAsset.findOneAndUpdate(
      { _id: req.params.assetId, draftId: req.socialDraft._id, projectId: req.project._id },
      { $set: { altText: req.body.altText || '' } },
      { new: true }
    );
    if (!asset) return next(new AppError('Media file not found.', 404));
    res.redirect(calendarUrl(req.project._id, req.socialDraft._id, { success: 'Media details saved.' }));
  })
);

router.post(
  '/:id/media/:assetId/retry',
  [param('id').isMongoId(), param('assetId').isMongoId(), handleValidation],
  loadSocialDraft,
  requireDraftManager,
  requireDraftNotPublishing,
  asyncHandler(async (req, res, next) => {
    const asset = await MediaAsset.findOneAndUpdate(
      { _id: req.params.assetId, draftId: req.socialDraft._id, projectId: req.project._id, status: 'failed' },
      { $set: { status: 'queued', processingError: '' } },
      { new: true }
    );
    if (!asset) return next(new AppError('Only failed media can be processed again.', 422));
    await reenqueueMediaProcessing(asset._id);
    res.redirect(calendarUrl(req.project._id, req.socialDraft._id, { success: 'Media processing queued again.' }));
  })
);

router.post(
  '/:id/media/:assetId/delete',
  [param('id').isMongoId(), param('assetId').isMongoId(), handleValidation],
  loadSocialDraft,
  requireDraftManager,
  requireDraftNotPublishing,
  asyncHandler(async (req, res, next) => {
    const asset = await MediaAsset.findOne({
      _id: req.params.assetId,
      draftId: req.socialDraft._id,
      projectId: req.project._id
    }).select('+temporaryPath');
    if (!asset) return next(new AppError('Media file not found.', 404));
    const isUsed = await PublishJob.exists({
      mediaIds: asset._id,
      status: { $in: ['queued', 'preparing_media', 'publishing', 'provider_processing'] }
    });
    if (isUsed) return next(new AppError('This media is attached to an active publishing job.', 409));
    if (asset.status === 'processing') return next(new AppError('Wait for media processing to finish before removing this file.', 409));
    if (asset.status === 'queued' && !(await cancelMediaProcessing(asset._id))) {
      return next(new AppError('Media processing has already started. Wait for it to finish before removing this file.', 409));
    }
    const keys = [asset.storageKey, ...Object.values(asset.variants || {}).map((variant) => variant && variant.storageKey)]
      .filter((key) => String(key || '').startsWith('social-media/'));
    await Promise.all(keys.map((key) => deleteMediaFile(key).catch(() => null)));
    if (asset.temporaryPath) await fs.promises.unlink(asset.temporaryPath).catch(() => null);
    await MediaAsset.deleteOne({ _id: asset._id });
    res.redirect(calendarUrl(req.project._id, req.socialDraft._id, { success: 'Media removed.' }));
  })
);

router.post(
  '/:id/images/upload',
  [param('id').isMongoId(), handleValidation],
  loadSocialDraft,
  requireDraftManager,
  uploadSingleImage,
  asyncHandler(async (req, res) => {
    try {
      await saveUploadedImage({
        project: req.project,
        draft: req.socialDraft,
        userId: req.user._id,
        file: req.file,
        altText: req.body.altText || '',
        caption: req.body.caption || ''
      });
      res.redirect(calendarUrl(req.project._id, req.socialDraft._id, { success: 'Image uploaded for this post.' }));
    } catch (error) {
      res.redirect(calendarUrl(req.project._id, req.socialDraft._id, { error: error.message }));
    }
  })
);

router.post(
  '/:id/images/generate',
  [
    param('id').isMongoId(),
    body('guidance').optional({ checkFalsy: true }).trim().isLength({ max: 1500 }).withMessage('Image guidance is too long.'),
    body('referenceImageId').optional({ checkFalsy: true }).isMongoId().withMessage('Reference image is invalid.'),
    handleValidation
  ],
  loadSocialDraft,
  requireDraftManager,
  asyncHandler(async (req, res) => {
    try {
      await ensureImageGenerationAllowed(req.user);
      const referenceImage = req.body.referenceImageId
        ? await ContentImage.findOne({
          _id: req.body.referenceImageId,
          draftId: req.socialDraft._id,
          projectId: req.project._id,
          status: { $ne: 'rejected' }
        })
        : null;
      if (req.body.referenceImageId && !referenceImage) {
        throw new AppError('Reference image not found for this post.', 404);
      }
      const redirectPath = calendarUrl(req.project._id, req.socialDraft._id, {
        success: 'Image generation started. Moyi will refresh this post when the poster is ready.'
      });
      const job = await queueContentImageGeneration({
        projectId: req.project._id,
        userId: req.user._id,
        draftId: req.socialDraft._id,
        draftModel: 'SocialDraft',
        guidance: req.body.guidance || '',
        referenceImageId: referenceImage ? referenceImage._id : '',
        visualFormat: req.body.visualFormat || '',
        aestheticTheme: req.body.aestheticTheme || '',
        redirectPath
      });
      res.redirect(calendarUrl(req.project._id, req.socialDraft._id, {
        success: 'Image generation started. Moyi will refresh this post when the poster is ready.',
        imageJob: job._id
      }));
    } catch (error) {
      res.redirect(calendarUrl(req.project._id, req.socialDraft._id, { error: error.message }));
    }
  })
);

router.post(
  '/:id/images/:imageId/update',
  [
    param('id').isMongoId(),
    param('imageId').isMongoId(),
    body('altText').optional({ checkFalsy: true }).trim().isLength({ max: 240 }).withMessage('Alt text is too long.'),
    body('caption').optional({ checkFalsy: true }).trim().isLength({ max: 500 }).withMessage('Caption is too long.'),
    handleValidation
  ],
  loadSocialDraft,
  requireDraftManager,
  asyncHandler(async (req, res, next) => {
    const image = await ContentImage.findOne({
      _id: req.params.imageId,
      draftId: req.socialDraft._id,
      projectId: req.project._id
    });
    if (!image) return next(new AppError('Social post image not found.', 404));
    image.altText = req.body.altText || '';
    image.caption = req.body.caption || '';
    await image.save();
    res.redirect(calendarUrl(req.project._id, req.socialDraft._id, { success: 'Image details saved.' }));
  })
);

router.post(
  '/:id/images/:imageId/select',
  [param('id').isMongoId(), param('imageId').isMongoId(), handleValidation],
  loadSocialDraft,
  requireDraftManager,
  asyncHandler(async (req, res, next) => {
    const image = await ContentImage.findOne({
      _id: req.params.imageId,
      draftId: req.socialDraft._id,
      projectId: req.project._id,
      status: { $ne: 'rejected' }
    });
    if (!image) return next(new AppError('Social post image not found.', 404));
    await selectContentImage({ draft: req.socialDraft, image });
    res.redirect(calendarUrl(req.project._id, req.socialDraft._id, { success: 'Image selected for this post.' }));
  })
);

router.post(
  '/:id/images/:imageId/reject',
  [param('id').isMongoId(), param('imageId').isMongoId(), handleValidation],
  loadSocialDraft,
  requireDraftManager,
  asyncHandler(async (req, res, next) => {
    const image = await ContentImage.findOne({
      _id: req.params.imageId,
      draftId: req.socialDraft._id,
      projectId: req.project._id
    });
    if (!image) return next(new AppError('Social post image not found.', 404));
    await rejectContentImage({ draft: req.socialDraft, image });
    res.redirect(calendarUrl(req.project._id, req.socialDraft._id, { success: 'Image rejected for this post.' }));
  })
);

router.post(
  '/:id/images/:imageId/restore',
  [param('id').isMongoId(), param('imageId').isMongoId(), handleValidation],
  loadSocialDraft,
  requireDraftManager,
  asyncHandler(async (req, res, next) => {
    const image = await ContentImage.findOne({
      _id: req.params.imageId,
      draftId: req.socialDraft._id,
      projectId: req.project._id,
      status: 'rejected'
    });
    if (!image) return next(new AppError('Rejected social post image not found.', 404));
    await restoreContentImage(image);
    res.redirect(calendarUrl(req.project._id, req.socialDraft._id, { success: 'Image restored for this post.' }));
  })
);

const {
  createAndQueuePublishBatch,
  retryPublishJob
} = require('../services/contentDistributionEngineService');

function selectedAccountIds(req) {
  const value = req.body.accountIds || req.body.socialAccountId || [];
  return [...new Set((Array.isArray(value) ? value : [value]).filter(Boolean).map(String))];
}

function selectedMediaIdsByAccount(req, accountIds) {
  const configuredValue = req.body.mediaAccountConfigured || [];
  const configured = new Set((Array.isArray(configuredValue) ? configuredValue : [configuredValue]).filter(Boolean).map(String));
  return accountIds.reduce((result, accountId) => {
    if (!configured.has(String(accountId))) return result;
    const value = req.body[`media_${accountId}`] || [];
    result[String(accountId)] = [...new Set((Array.isArray(value) ? value : [value]).filter(Boolean).map(String))];
    return result;
  }, {});
}

function requestedPublishOptions(req) {
  return {
    tiktok: {
      privacyLevel: req.body.tiktokPrivacyLevel || undefined,
      allowComment: req.body.tiktokAllowComment === 'on',
      allowDuet: req.body.tiktokAllowDuet === 'on',
      allowStitch: req.body.tiktokAllowStitch === 'on',
      commercialContent: req.body.tiktokCommercialContent === 'on',
      brandedContent: req.body.tiktokBrandedContent === 'on',
      brandOrganicContent: req.body.tiktokBrandOrganicContent === 'on',
      musicUsageConsent: req.body.tiktokMusicUsageConsent === 'on'
    },
    youtube: {
      privacyStatus: req.body.youtubePrivacyStatus || 'private',
      videoType: req.body.youtubeVideoType || 'regular',
      categoryId: '22',
      notifySubscribers: req.body.youtubeNotifySubscribers === 'on'
    }
  };
}

function requestedPublishTime(req) {
  if (req.body.publishMode !== 'schedule') return new Date();
  const timeZone = String(req.body.timeZone || '').trim();
  let scheduledAt = null;
  try {
    scheduledAt = timeZone
      ? dayjs.tz(String(req.body.scheduledAt), timeZone).toDate()
      : new Date(req.body.scheduledAt);
  } catch (error) {
    scheduledAt = null;
  }
  if (!req.body.scheduledAt || !scheduledAt || Number.isNaN(scheduledAt.getTime())) {
    throw new AppError('Choose a valid date and time for the scheduled post.', 422);
  }
  if (scheduledAt.getTime() < Date.now() + 60 * 1000) {
    throw new AppError('Scheduled posts must be at least one minute in the future.', 422);
  }
  return scheduledAt;
}

function queueSuccessMessage(result, scheduledAt) {
  if (result.successCount) {
    return `Published ${result.successCount} post${result.successCount === 1 ? '' : 's'} successfully.`;
  }
  const scheduled = scheduledAt.getTime() > Date.now() + 60 * 1000;
  const queued = result.queuedCount || result.total;
  const warning = result.batch && result.batch.errorMessage ? ` ${result.batch.errorMessage}` : '';
  return `${queued} publishing job${queued === 1 ? '' : 's'} ${scheduled ? 'scheduled' : 'queued'}.${warning}`;
}

function noCompatibleAccountsMessage(result) {
  return result.batch && result.batch.errorMessage
    ? result.batch.errorMessage
    : 'Select at least one connected social account.';
}

function projectCalendarUrl(projectId, params = {}) {
  const query = new URLSearchParams(params);
  return `/projects/${projectId}/calendar${query.toString() ? `?${query.toString()}` : ''}`;
}

function publishFailureParams(error) {
  if (error && error.code === 'social_posts_limit_reached') {
    return {
      error: error.message,
      limit: 'social_posts'
    };
  }
  return {
    error: `Publish failed: ${error.message}`
  };
}

router.post('/publish-all-connected', [
  body('projectId').isMongoId().withMessage('Project ID is required.'),
  handleValidation
], asyncHandler(async (req, res) => {
  const project = await Project.findById(req.body.projectId);
  if (!project) throw new AppError('Project not found.', 404);

  const role = await projectAccessRole({ project, userId: req.user._id });
  if (!canPublishProjectRole(role)) {
    throw new AppError('You do not have permission to publish social drafts.', 403);
  }

  const drafts = await SocialDraft.find({
    projectId: project._id,
    status: 'approved',
    publishStatus: 'approved'
  }).select('_id');

  if (!drafts.length) {
    return res.redirect(`/projects/${project._id}/calendar?success=${encodeURIComponent('No pending social drafts to publish.')}`);
  }

  const scheduledAt = new Date();
  let results;
  try {
    results = await createAndQueuePublishBatch({
      projectId: project._id,
      userId: req.user._id,
      draftIds: drafts.map((draft) => draft._id),
      project,
      allowedDestinationProjectIds: await publishableProjectIds(req.user._id, { sourceProject: project }),
      scheduledAt
    });
  } catch (error) {
    return res.redirect(projectCalendarUrl(project._id, publishFailureParams(error)));
  }
  if (!results.total) {
    return res.redirect(`/projects/${project._id}/calendar?error=${encodeURIComponent(noCompatibleAccountsMessage(results))}`);
  }

  const msg = queueSuccessMessage(results, scheduledAt);

  res.redirect(`/projects/${project._id}/calendar?success=${encodeURIComponent(msg)}`);
}));

router.post('/:id/approve', [param('id').isMongoId(), handleValidation], loadSocialDraft, requireDraftManager, asyncHandler(async (req, res) => {
  req.socialDraft.status = 'approved';
  req.socialDraft.publishStatus = 'approved';
  await req.socialDraft.save();
  res.redirect(`/projects/${req.project._id}/calendar`);
}));

router.post('/:id/approve-and-publish', [
  param('id').isMongoId(),
  body('socialAccountId').optional({ checkFalsy: true }).isMongoId().withMessage('Choose a valid social account.'),
  body('accountIds').optional().custom((value) => {
    const values = Array.isArray(value) ? value : [value];
    return values.every((item) => /^[a-f\d]{24}$/i.test(String(item)));
  }).withMessage('Choose valid social accounts.'),
  body('publishMode').optional().isIn(['now', 'schedule']).withMessage('Choose publish now or schedule.'),
  body('scheduledAt').optional({ checkFalsy: true }).isISO8601().withMessage('Choose a valid schedule date.'),
  body('timeZone').optional({ checkFalsy: true }).trim().isLength({ max: 80 }).withMessage('Browser time zone is invalid.'),
  body('firstComment').optional({ checkFalsy: true }).trim().isLength({ max: 3000 }).withMessage('First comment is too long.'),
  body('tiktokPrivacyLevel').optional({ checkFalsy: true }).isIn(['PUBLIC_TO_EVERYONE', 'MUTUAL_FOLLOW_FRIENDS', 'FOLLOWER_OF_CREATOR', 'SELF_ONLY']).withMessage('Choose a valid TikTok visibility.'),
  body('youtubePrivacyStatus').optional({ checkFalsy: true }).isIn(['public', 'private', 'unlisted']).withMessage('Choose a valid YouTube visibility.'),
  body('youtubeVideoType').optional({ checkFalsy: true }).isIn(['short', 'regular']).withMessage('Choose Shorts or regular video.'),
  handleValidation
], loadSocialDraft, requireDraftPublisher, requireApprovedOrManager, requireDraftNotPublishing, asyncHandler(async (req, res) => {
  const accountIds = selectedAccountIds(req);
  if (!accountIds.length) {
    return res.redirect(calendarUrl(req.project._id, req.socialDraft._id, { error: 'Select at least one connected social account.' }));
  }
  const scheduledAt = requestedPublishTime(req);
  req.socialDraft.status = 'approved';
  req.socialDraft.publishStatus = 'approved';
  req.socialDraft.socialAccountId = accountIds[0] || null;
  await req.socialDraft.save();

  try {
    const result = await createAndQueuePublishBatch({
      projectId: req.project._id,
      userId: req.user._id,
      draftIds: [req.socialDraft._id],
      accountIds,
      mediaIdsByAccount: selectedMediaIdsByAccount(req, accountIds),
      firstComment: req.body.firstComment || '',
      publishOptions: requestedPublishOptions(req),
      project: req.project,
      scheduledAt,
      allowedDestinationProjectIds: await publishableProjectIds(req.user._id, { sourceProject: req.project })
    });
    if (!result.total) {
      return res.redirect(calendarUrl(req.project._id, req.socialDraft._id, { error: noCompatibleAccountsMessage(result) }));
    }
    res.redirect(`/projects/${req.project._id}/calendar?success=${encodeURIComponent(queueSuccessMessage(result, scheduledAt))}#post-${req.socialDraft._id}`);
  } catch (error) {
    res.redirect(`${projectCalendarUrl(req.project._id, publishFailureParams(error))}#post-${req.socialDraft._id}`);
  }
}));

router.post('/batch-publish', [
  body('projectId').isMongoId().withMessage('Project ID is required.'),
  body('draftIds').isArray({ min: 1 }).withMessage('Select at least one draft to publish.'),
  handleValidation
], asyncHandler(async (req, res) => {
  const project = await Project.findById(req.body.projectId);
  if (!project) throw new AppError('Project not found.', 404);

  const role = await projectAccessRole({ project, userId: req.user._id });
  if (!canPublishProjectRole(role)) {
    throw new AppError('You do not have permission to publish social drafts.', 403);
  }

  const selectedDraftIds = Array.isArray(req.body.draftIds) ? req.body.draftIds : [req.body.draftIds];
  const scheduledAt = new Date();
  let results;
  try {
    results = await createAndQueuePublishBatch({
      projectId: project._id,
      userId: req.user._id,
      draftIds: selectedDraftIds,
      project,
      scheduledAt,
      allowedDestinationProjectIds: await publishableProjectIds(req.user._id, { sourceProject: project })
    });
  } catch (error) {
    return res.redirect(projectCalendarUrl(project._id, publishFailureParams(error)));
  }
  if (!results.total) {
    return res.redirect(`/projects/${project._id}/calendar?error=${encodeURIComponent(noCompatibleAccountsMessage(results))}`);
  }

  const msg = queueSuccessMessage(results, scheduledAt);
  res.redirect(`/projects/${project._id}/calendar?success=${encodeURIComponent(msg)}`);
}));

router.get('/:id/publish-status', [param('id').isMongoId(), handleValidation], loadSocialDraft, asyncHandler(async (req, res) => {
  const jobs = await PublishJob.find({
    draftId: req.socialDraft._id,
    projectId: req.project._id
  }).sort({ createdAt: -1 }).limit(20);
  const latestBatchId = jobs[0] ? String(jobs[0].batchId) : '';
  const latestJobs = jobs.filter((job) => String(job.batchId) === latestBatchId);
  res.json({
    draftId: String(req.socialDraft._id),
    publishStatus: req.socialDraft.publishStatus,
    jobs: latestJobs.map((job) => ({
      id: String(job._id),
      platform: job.platform,
      status: job.status,
      attempts: job.attempts,
      maxAttempts: job.maxAttempts,
      nextRetryAt: job.nextRetryAt,
      reconnectRequired: job.reconnectRequired,
      deadLetterReason: job.deadLetterReason,
      error: job.errorMessage,
      errorCode: job.errorCode,
      errorDetails: job.errorDetails || {},
      warning: job.warningMessage,
      platformUrl: job.platformUrl,
      metricsStatus: job.metricsStatus,
      metrics: job.metricsLatest || {},
      metricsCapturedAt: job.metricsCapturedAt,
      scheduledAt: job.scheduledAt,
      publishedAt: job.publishedAt
    }))
  });
}));

router.get(
  '/:id/tiktok-creator-info',
  [param('id').isMongoId(), query('accountId').isMongoId().withMessage('Choose a valid TikTok account.'), handleValidation],
  loadSocialDraft,
  requireDraftPublisher,
  asyncHandler(async (req, res, next) => {
    const accountId = String(req.query.accountId || '');
    if (!/^[a-f\d]{24}$/i.test(accountId)) return next(new AppError('Choose a valid TikTok account.', 422));
    const destinationProjectIds = await publishableProjectIds(req.user._id, { sourceProject: req.project });
    const account = await SocialAccount.findOne({
      _id: accountId,
      projectId: { $in: destinationProjectIds },
      platform: 'tiktok',
      status: 'connected',
      ...socialAccountAccessFilter(req.user._id)
    });
    if (!account) return next(new AppError('Connected TikTok account not found.', 404));
    const credentials = await ensureFreshSocialAccountCredentials(account);
    const creator = await getTikTokCreatorInfo(credentials);
    res.json(creator);
  })
);

router.post(
  '/:id/publish-jobs/:jobId/retry',
  [param('id').isMongoId(), param('jobId').isMongoId(), handleValidation],
  loadSocialDraft,
  requireDraftPublisher,
  asyncHandler(async (req, res) => {
    const job = await PublishJob.findOne({
      _id: req.params.jobId,
      draftId: req.socialDraft._id,
      projectId: req.project._id
    });
    if (!job) throw new AppError('Publish job not found.', 404);
    try {
      await retryPublishJob(job._id);
    } catch (error) {
      return res.redirect(calendarUrl(req.project._id, req.socialDraft._id, { error: error.message }));
    }
    res.redirect(calendarUrl(req.project._id, req.socialDraft._id, { success: `Retry queued for ${job.platform}.` }));
  })
);

router.post('/:id/update', [
  param('id').isMongoId(),
  body('title').trim().isLength({ max: 180 }).withMessage('Post title is too long.'),
  body('body').trim().notEmpty().withMessage('Post copy is required.').isLength({ max: 4000 }).withMessage('Post copy is too long.'),
  body('channel').isIn(['bluesky', 'linkedin', 'facebook', 'x', 'instagram', 'threads', 'youtube', 'tiktok', 'email', 'webhook']).withMessage('Channel is invalid.'),
  body('scheduledFor').isISO8601().withMessage('Choose a valid schedule date.'),
  body('socialAccountId').optional({ checkFalsy: true }).isMongoId().withMessage('Choose a valid social account.'),
  handleValidation
], loadSocialDraft, requireDraftManager, requireDraftNotPublishing, asyncHandler(async (req, res) => {
  if (req.body.channel === 'x') {
    try {
      assertStandardXPost(req.body.body);
    } catch (error) {
      return res.redirect(calendarUrl(req.project._id, req.socialDraft._id, { error: error.message }));
    }
  }
  req.socialDraft.title = req.body.title;
  req.socialDraft.body = req.body.body;
  req.socialDraft.channel = req.body.channel;
  req.socialDraft.socialAccountId = req.body.socialAccountId || null;
  req.socialDraft.scheduledFor = new Date(req.body.scheduledFor);
  await req.socialDraft.save();
  res.redirect(`/projects/${req.project._id}/calendar?success=${encodeURIComponent('Post updated.')}#post-${req.socialDraft._id}`);
}));

router.post('/:id/delete', [param('id').isMongoId(), handleValidation], loadSocialDraft, requireDraftManager, requireDraftNotPublishing, asyncHandler(async (req, res) => {
  await SocialDraft.deleteOne({ _id: req.socialDraft._id, projectId: req.project._id });
  res.redirect(`/projects/${req.project._id}/calendar?success=${encodeURIComponent('Post removed from the calendar.')}`);
}));

router.post('/:id/mark-published', [param('id').isMongoId(), handleValidation], loadSocialDraft, requireDraftManager, requireDraftNotPublishing, asyncHandler(async (req, res) => {
  req.socialDraft.status = 'published_manually';
  req.socialDraft.publishStatus = 'published';
  req.socialDraft.publishedAt = new Date();
  await req.socialDraft.save();
  res.redirect(`/projects/${req.project._id}/calendar`);
}));

module.exports = router;
