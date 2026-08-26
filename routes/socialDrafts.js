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
const Campaign = require('../models/Campaign');
const SocialDraft = require('../models/SocialDraft');
const ContentImage = require('../models/ContentImage');
const MediaAsset = require('../models/MediaAsset');
const PublishJob = require('../models/PublishJob');
const PublishJobEvent = require('../models/PublishJobEvent');
const SocialAccount = require('../models/SocialAccount');
const SocialDraftComment = require('../models/SocialDraftComment');
const SocialDraftActivity = require('../models/SocialDraftActivity');
const ProjectMember = require('../models/ProjectMember');
const OrganizationMember = require('../models/OrganizationMember');
const User = require('../models/User');
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
  canEditDraftRole,
  canChangeProjectRole,
  canPublishProjectRole,
  canReviewDraftRole,
  projectAccessRole,
  publishableProjectIds
} = require('../services/projectAccessService');
const {
  addDraftComment,
  applyReviewTransition,
  legacyReviewStatus,
  recordDraftActivity,
  reviewLabel
} = require('../services/calendarCollaborationService');
const { queueContentImageGeneration } = require('../services/projectTaskService');
const { ensureImageGenerationAllowed } = require('../services/usageService');
const { getTikTokCreatorInfo } = require('../services/socialProviderService');
const { ensureFreshSocialAccountCredentials } = require('../services/socialTokenRefreshService');
const { NATIVE_SOCIAL_PLATFORMS, socialAccountAccessFilter } = require('../services/socialAccountService');
const { assertStandardXPost } = require('../services/xTextService');
const { buildPublishReadiness } = require('../services/socialPublisherService');
const {
  ACTIVE_JOB_STATUSES,
  calendarPresentation,
  latestJobsByDraft,
  validateCalendarReschedule
} = require('../services/contentCalendarService');

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

function wantsCalendarJson(req) {
  return req.method !== 'GET'
    && (req.xhr || (typeof req.accepts === 'function' && req.accepts(['json', 'html']) === 'json'));
}

router.use((req, res, next) => {
  if (!wantsCalendarJson(req)) return next();
  const redirect = res.redirect.bind(res);
  res.redirect = function calendarJsonRedirect(statusOrPath, maybePath) {
    const redirectPath = typeof statusOrPath === 'number' ? maybePath : statusOrPath;
    if (!redirectPath) return redirect(statusOrPath, maybePath);
    const parsed = new URL(String(redirectPath), 'http://moyi.local');
    const error = parsed.searchParams.get('error') || '';
    const success = parsed.searchParams.get('success') || '';
    const hashMatch = parsed.hash.match(/^#post-([a-f\d]{24})$/i);
    return res.status(error ? 422 : 200).json({
      ok: !error,
      message: error || success || 'Calendar updated.',
      redirect: `${parsed.pathname}${parsed.search}${parsed.hash}`,
      draftId: hashMatch ? hashMatch[1] : String(req.socialDraft?._id || '')
    });
  };
  return next();
});

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

router.get(
  '/:id/calendar-detail',
  [param('id').isMongoId(), handleValidation],
  loadSocialDraft,
  asyncHandler(async (req, res) => {
    const canPublish = canPublishProjectRole(req.projectAccessRole);
    const canManage = canChangeProjectRole(req.projectAccessRole);
    const destinationProjectIds = canPublish
      ? await publishableProjectIds(req.user._id, { sourceProject: req.project })
      : [req.project._id];
    const [socialAccounts, destinationProjects, socialImages, mediaAssets, allJobs, campaign, comments, activities, directMembers, organizationMembers, owner] = await Promise.all([
      SocialAccount.find({
        projectId: { $in: destinationProjectIds },
        ...socialAccountAccessFilter(req.user._id)
      }).select('-accessToken -refreshToken -webhookSecret').sort({ platform: 1, updatedAt: -1 }),
      Project.find({ _id: { $in: destinationProjectIds } }).select('name').lean(),
      ContentImage.find({ projectId: req.project._id, draftId: req.socialDraft._id }).sort({ status: 1, createdAt: -1 }),
      MediaAsset.find({ projectId: req.project._id, draftId: req.socialDraft._id }).sort({ createdAt: 1 }),
      PublishJob.find({ projectId: req.project._id, draftId: req.socialDraft._id }).sort({ createdAt: -1 }).limit(40),
      Campaign.findOne({ _id: req.socialDraft.campaignId, projectId: req.project._id }).select('name goal channel').lean(),
      SocialDraftComment.find({ draftId: req.socialDraft._id, projectId: req.project._id }).sort({ createdAt: 1 }).limit(200).populate('authorUserId', 'name email').lean(),
      SocialDraftActivity.find({ draftId: req.socialDraft._id, projectId: req.project._id }).sort({ createdAt: -1 }).limit(200).populate('actorUserId', 'name email').lean(),
      ProjectMember.find({ projectId: req.project._id }).select('userId role').populate('userId', 'name email').lean(),
      req.project.organizationId
        ? OrganizationMember.find({ organizationId: req.project.organizationId }).select('userId role').populate('userId', 'name email').lean()
        : [],
      User.findById(req.project.owner).select('name email').lean()
    ]);
    const publishAccounts = socialAccounts.filter((account) => NATIVE_SOCIAL_PLATFORMS.includes(account.platform) && account.status === 'connected');
    const latestJobs = latestJobsByDraft(allJobs)[String(req.socialDraft._id)] || [];
    const publishReadiness = buildPublishReadiness({
      socialDrafts: [req.socialDraft],
      connectedAccounts: socialAccounts,
      imagesByDraftId: { [String(req.socialDraft._id)]: socialImages },
      mediaAssetsByDraftId: { [String(req.socialDraft._id)]: mediaAssets },
      jobsByDraftId: { [String(req.socialDraft._id)]: latestJobs },
      projectId: req.project._id
    });
    const draftReadiness = publishReadiness.posts[0] || { ready: false, blockers: [] };
    const calendarStatus = calendarPresentation(req.socialDraft, { jobs: latestJobs, readiness: draftReadiness });
    const jobIds = allJobs.map((job) => job._id);
    const jobEvents = jobIds.length
      ? await PublishJobEvent.find({ publishJobId: { $in: jobIds }, projectId: req.project._id }).sort({ createdAt: -1 }).limit(200)
      : [];
    const eventsByJobId = jobEvents.reduce((grouped, event) => {
      const key = String(event.publishJobId);
      if (!grouped[key]) grouped[key] = [];
      grouped[key].push(event);
      return grouped;
    }, {});
    const collaborators = [...new Map([
      ...(owner ? [{ userId: owner, role: 'owner' }] : []),
      ...directMembers,
      ...organizationMembers
    ].filter((member) => member.userId).map((member) => [String(member.userId._id), {
      id: member.userId._id,
      name: member.userId.name || member.userId.email,
      email: member.userId.email,
      role: member.role
    }])).values()];

    res.render('projects/partials/calendar-drawer', {
      project: req.project,
      draft: req.socialDraft,
      campaign,
      socialAccounts,
      publishAccounts,
      accountProjectNames: Object.fromEntries(destinationProjects.map((item) => [String(item._id), item.name])),
      socialImages,
      mediaAssets,
      publishJobs: allJobs,
      eventsByJobId,
      publishReadiness: draftReadiness,
      calendarStatus,
      canManageProject: canManage,
      canEditDraft: canEditDraftRole(req.projectAccessRole),
      canReviewDraft: canReviewDraftRole(req.projectAccessRole),
      canPublishProject: canPublish,
      reviewStatus: legacyReviewStatus(req.socialDraft),
      reviewStatusLabel: reviewLabel(legacyReviewStatus(req.socialDraft)),
      comments,
      activities,
      collaborators,
      clientReviewMode: !canEditDraftRole(req.projectAccessRole) && !canPublish
    });
  })
);

function requireDraftManager(req, res, next) {
  if (!canChangeProjectRole(req.projectAccessRole)) {
    return next(new AppError('You do not have permission to edit or approve this social draft.', 403));
  }
  return next();
}

function requireDraftEditor(req, res, next) {
  if (!canEditDraftRole(req.projectAccessRole)) {
    return next(new AppError('You do not have permission to edit this social draft.', 403));
  }
  return next();
}

function requireDraftReviewer(req, res, next) {
  if (!canReviewDraftRole(req.projectAccessRole)) {
    return next(new AppError('You do not have permission to approve this social draft.', 403));
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
  return requireDraftReviewer(req, res, next);
}

function requireDraftNotPublishing(req, res, next) {
  if (['queued', 'preparing_media', 'publishing', 'provider_processing', 'retry_wait'].includes(req.socialDraft.publishStatus)) {
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
      await recordDraftActivity({
        draft: req.socialDraft,
        user: req.user,
        eventType: 'media_uploaded',
        summary: 'Uploaded media for this post.',
        metadata: { mediaId: asset._id },
        req
      });
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
      { returnDocument: 'after' }
    );
    if (!asset) return next(new AppError('Media file not found.', 404));
    await recordDraftActivity({ draft: req.socialDraft, user: req.user, eventType: 'media_updated', summary: 'Updated media accessibility details.', metadata: { mediaId: asset._id }, req });
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
      { returnDocument: 'after' }
    );
    if (!asset) return next(new AppError('Only failed media can be processed again.', 422));
    await reenqueueMediaProcessing(asset._id);
    await recordDraftActivity({ draft: req.socialDraft, user: req.user, eventType: 'media_processing_retried', summary: 'Retried media processing.', metadata: { mediaId: asset._id }, req });
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
    await recordDraftActivity({ draft: req.socialDraft, user: req.user, eventType: 'media_removed', summary: 'Removed media from this post.', metadata: { mediaId: asset._id }, req });
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
      await recordDraftActivity({ draft: req.socialDraft, user: req.user, eventType: 'image_uploaded', summary: 'Uploaded an image for this post.', req });
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
        success: 'Image generation started. Moyi will refresh this post when the visual is ready.'
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
      await recordDraftActivity({ draft: req.socialDraft, user: req.user, eventType: 'image_generation_started', summary: 'Started image generation for this post.', req });
      res.redirect(calendarUrl(req.project._id, req.socialDraft._id, {
        success: 'Image generation started. Moyi will refresh this post when the visual is ready.',
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
    await recordDraftActivity({ draft: req.socialDraft, user: req.user, eventType: 'image_updated', summary: 'Updated image accessibility details.', metadata: { imageId: image._id }, req });
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
    await recordDraftActivity({ draft: req.socialDraft, user: req.user, eventType: 'image_selected', summary: 'Selected a new image for this post.', metadata: { imageId: image._id }, req });
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
    await recordDraftActivity({ draft: req.socialDraft, user: req.user, eventType: 'image_rejected', summary: 'Rejected an image option.', metadata: { imageId: image._id }, req });
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
    await recordDraftActivity({ draft: req.socialDraft, user: req.user, eventType: 'image_restored', summary: 'Restored an image option.', metadata: { imageId: image._id }, req });
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

function groupByDraftId(items = []) {
  return items.reduce((grouped, item) => {
    const key = String(item.draftId || '');
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(item);
    return grouped;
  }, {});
}

async function publishingReadinessForDrafts({ project, userId, drafts, allowedDestinationProjectIds }) {
  const draftIds = drafts.map((draft) => draft._id);
  const [accounts, images, mediaAssets, jobs] = await Promise.all([
    SocialAccount.find({
      projectId: { $in: allowedDestinationProjectIds },
      ...socialAccountAccessFilter(userId)
    }).select('-accessToken -refreshToken -webhookSecret'),
    ContentImage.find({ projectId: project._id, draftId: { $in: draftIds }, status: 'selected' }),
    MediaAsset.find({ projectId: project._id, draftId: { $in: draftIds } }),
    PublishJob.find({ projectId: project._id, draftId: { $in: draftIds } }).sort({ createdAt: -1 })
  ]);
  return buildPublishReadiness({
    socialDrafts: drafts,
    connectedAccounts: accounts,
    imagesByDraftId: groupByDraftId(images),
    mediaAssetsByDraftId: groupByDraftId(mediaAssets),
    jobsByDraftId: latestJobsByDraft(jobs),
    projectId: project._id
  });
}

function selectedDraftIds(req) {
  return [...new Set((Array.isArray(req.body.draftIds) ? req.body.draftIds : [req.body.draftIds])
    .filter(Boolean)
    .map(String))];
}

function bulkMessage(action, results) {
  const labels = {
    approve: 'approved',
    schedule: 'scheduled',
    move_campaign: 'moved',
    publish: 'queued',
    retry: 'queued for retry',
    delete: 'deleted'
  };
  return `${results.filter((item) => item.ok).length} ${labels[action] || 'updated'}, ${results.filter((item) => !item.ok).length} could not be updated.`;
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

  const drafts = await SocialDraft.find({ projectId: project._id, publishStatus: { $ne: 'published' } });

  if (!drafts.length) {
    return res.redirect(`/projects/${project._id}/calendar?success=${encodeURIComponent('No pending social drafts to publish.')}`);
  }

  const allowedDestinationProjectIds = await publishableProjectIds(req.user._id, { sourceProject: project });
  const readiness = await publishingReadinessForDrafts({ project, userId: req.user._id, drafts, allowedDestinationProjectIds });
  const readyIds = readiness.posts.filter((item) => item.ready).map((item) => item.draftId);
  if (!readyIds.length) {
    return res.redirect(`/projects/${project._id}/calendar?error=${encodeURIComponent(`${readiness.attentionCount} post${readiness.attentionCount === 1 ? '' : 's'} require attention and ${readiness.inFlightCount} are already processing. Review blockers before publishing.`)}`);
  }

  const scheduledAt = new Date();
  let results;
  try {
    results = await createAndQueuePublishBatch({
      projectId: project._id,
      userId: req.user._id,
      draftIds: readyIds,
      project,
      allowedDestinationProjectIds,
      scheduledAt
    });
  } catch (error) {
    return res.redirect(projectCalendarUrl(project._id, publishFailureParams(error)));
  }
  if (!results.total) {
    return res.redirect(`/projects/${project._id}/calendar?error=${encodeURIComponent(noCompatibleAccountsMessage(results))}`);
  }

  const msg = `${queueSuccessMessage(results, scheduledAt)} ${readiness.attentionCount} blocked and ${readiness.inFlightCount} already processing.`;

  res.redirect(`/projects/${project._id}/calendar?success=${encodeURIComponent(msg)}`);
}));

router.post('/:id/comments', [
  param('id').isMongoId(),
  body('body').trim().notEmpty().isLength({ max: 2000 }).withMessage('Comment must be 2,000 characters or fewer.'),
  handleValidation
], loadSocialDraft, asyncHandler(async (req, res) => {
  await addDraftComment({ draft: req.socialDraft, user: req.user, body: req.body.body, req });
  res.redirect(calendarUrl(req.project._id, req.socialDraft._id, { success: 'Comment added.' }));
}));

router.post('/:id/review/:action', [
  param('id').isMongoId(),
  param('action').isIn(['submit', 'resubmit', 'approve', 'request_changes']).withMessage('Choose a valid review action.'),
  body('comment').optional({ checkFalsy: true }).trim().isLength({ max: 2000 }).withMessage('Review feedback must be 2,000 characters or fewer.'),
  handleValidation
], loadSocialDraft, requireDraftNotPublishing, asyncHandler(async (req, res, next) => {
  const action = req.params.action;
  if (['approve', 'request_changes'].includes(action) && !canReviewDraftRole(req.projectAccessRole)) {
    return next(new AppError('You do not have permission to review this social draft.', 403));
  }
  if (['submit', 'resubmit'].includes(action) && !canEditDraftRole(req.projectAccessRole)) {
    return next(new AppError('You do not have permission to submit this social draft.', 403));
  }
  if (action === 'request_changes' && !String(req.body.comment || '').trim()) {
    return next(new AppError('Explain what needs to change before returning this draft.', 422));
  }
  const transition = applyReviewTransition(req.socialDraft, { action, actorUserId: req.user._id });
  await req.socialDraft.save();
  if (req.body.comment) {
    await addDraftComment({
      draft: req.socialDraft,
      user: req.user,
      body: req.body.comment,
      kind: action === 'request_changes' ? 'change_request' : (action === 'approve' ? 'approval_note' : 'comment'),
      req
    });
  }
  await recordDraftActivity({
    draft: req.socialDraft,
    user: req.user,
    eventType: `review_${action}`,
    summary: `${reviewLabel(transition.previous)} moved to ${reviewLabel(transition.current)}.`,
    metadata: { from: transition.previous, to: transition.current },
    req
  });
  res.redirect(calendarUrl(req.project._id, req.socialDraft._id, { success: `${reviewLabel(transition.current)}.` }));
}));

router.post('/:id/assign', [
  param('id').isMongoId(),
  body('assignedTo').optional({ checkFalsy: true }).isMongoId().withMessage('Choose a valid teammate.'),
  handleValidation
], loadSocialDraft, requireDraftManager, requireDraftNotPublishing, asyncHandler(async (req, res, next) => {
  const targetId = req.body.assignedTo || null;
  if (targetId) {
    const [direct, organization] = await Promise.all([
      ProjectMember.exists({ projectId: req.project._id, userId: targetId }),
      req.project.organizationId ? OrganizationMember.exists({ organizationId: req.project.organizationId, userId: targetId }) : null
    ]);
    if (!direct && !organization && String(req.project.owner) !== String(targetId)) {
      return next(new AppError('Assignee must have access to this workspace.', 422));
    }
  }
  const previous = req.socialDraft.assignedTo;
  req.socialDraft.assignedTo = targetId;
  await req.socialDraft.save();
  await recordDraftActivity({
    draft: req.socialDraft,
    user: req.user,
    eventType: 'assignment_changed',
    summary: targetId ? 'Assigned the post to a teammate.' : 'Cleared the post assignment.',
    metadata: { from: previous || '', assignedTo: targetId || '' },
    req
  });
  res.redirect(calendarUrl(req.project._id, req.socialDraft._id, { success: 'Assignment updated.' }));
}));

router.post('/:id/approve', [param('id').isMongoId(), handleValidation], loadSocialDraft, requireDraftReviewer, asyncHandler(async (req, res) => {
  const transition = applyReviewTransition(req.socialDraft, { action: 'approve', actorUserId: req.user._id });
  await req.socialDraft.save();
  await recordDraftActivity({ draft: req.socialDraft, user: req.user, eventType: 'review_approve', summary: 'Approved the post.', metadata: transition, req });
  res.redirect(calendarUrl(req.project._id, req.socialDraft._id, { success: 'Post approved.' }));
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
  if (req.socialDraft.status !== 'approved') {
    applyReviewTransition(req.socialDraft, { action: 'approve', actorUserId: req.user._id });
  } else {
    req.socialDraft.reviewStatus = scheduledAt.getTime() > Date.now() + 60000 ? 'scheduled' : 'approved';
    req.socialDraft.publishStatus = 'approved';
  }
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
    await recordDraftActivity({
      draft: req.socialDraft,
      user: req.user,
      eventType: scheduledAt.getTime() > Date.now() + 60000 ? 'publish_scheduled' : 'publish_queued',
      summary: scheduledAt.getTime() > Date.now() + 60000 ? 'Scheduled the approved post for publishing.' : 'Queued the approved post for publishing.',
      metadata: { accountId: accountIds.join(','), to: scheduledAt.toISOString() },
      req
    });
    res.redirect(`/projects/${req.project._id}/calendar?success=${encodeURIComponent(queueSuccessMessage(result, scheduledAt))}#post-${req.socialDraft._id}`);
  } catch (error) {
    req.socialDraft.publishStatus = 'failed';
    req.socialDraft.errorMessage = error.message;
    await req.socialDraft.save();
    res.redirect(calendarUrl(req.project._id, req.socialDraft._id, { error: error.message }));
  }
}));

router.post('/batch-publish', [
  body('projectId').isMongoId().withMessage('Project ID is required.'),
  body('draftIds').custom((value) => (Array.isArray(value) ? value : [value]).filter(Boolean).length > 0).withMessage('Select at least one draft to publish.'),
  handleValidation
], asyncHandler(async (req, res) => {
  const project = await Project.findById(req.body.projectId);
  if (!project) throw new AppError('Project not found.', 404);

  const role = await projectAccessRole({ project, userId: req.user._id });
  if (!canPublishProjectRole(role)) {
    throw new AppError('You do not have permission to publish social drafts.', 403);
  }

  const draftIds = selectedDraftIds(req);
  const drafts = await SocialDraft.find({ _id: { $in: draftIds }, projectId: project._id });
  const allowedDestinationProjectIds = await publishableProjectIds(req.user._id, { sourceProject: project });
  const readiness = await publishingReadinessForDrafts({ project, userId: req.user._id, drafts, allowedDestinationProjectIds });
  const readyIds = readiness.posts.filter((item) => item.ready).map((item) => item.draftId);
  if (!readyIds.length) {
    return res.redirect(`/projects/${project._id}/calendar?error=${encodeURIComponent('None of the selected posts are ready. Open Attention view to resolve their blockers.')}`);
  }
  const scheduledAt = new Date();
  let results;
  try {
    results = await createAndQueuePublishBatch({
      projectId: project._id,
      userId: req.user._id,
      draftIds: readyIds,
      project,
      scheduledAt,
      allowedDestinationProjectIds
    });
  } catch (error) {
    return res.redirect(projectCalendarUrl(project._id, publishFailureParams(error)));
  }
  if (!results.total) {
    return res.redirect(`/projects/${project._id}/calendar?error=${encodeURIComponent(noCompatibleAccountsMessage(results))}`);
  }

  const msg = `${queueSuccessMessage(results, scheduledAt)} ${readiness.posts.length - readyIds.length} selected post${readiness.posts.length - readyIds.length === 1 ? '' : 's'} remained blocked.`;
  res.redirect(`/projects/${project._id}/calendar?success=${encodeURIComponent(msg)}`);
}));

router.post('/batch-action', [
  body('projectId').isMongoId().withMessage('Project ID is required.'),
  body('draftIds').custom((value) => (Array.isArray(value) ? value : [value]).filter(Boolean).length > 0).withMessage('Select at least one post.'),
  body('action').isIn(['approve', 'schedule', 'move_campaign', 'publish', 'retry', 'delete']).withMessage('Choose a valid bulk action.'),
  body('scheduledAt').optional({ checkFalsy: true }).isISO8601().withMessage('Choose a valid schedule date.'),
  body('campaignId').optional({ checkFalsy: true }).isMongoId().withMessage('Choose a valid campaign.'),
  handleValidation
], asyncHandler(async (req, res) => {
  const project = await Project.findById(req.body.projectId);
  if (!project) throw new AppError('Project not found.', 404);
  const role = await projectAccessRole({ project, userId: req.user._id });
  const action = req.body.action;
  const mayManage = canChangeProjectRole(role);
  const mayReview = canReviewDraftRole(role);
  const mayPublish = canPublishProjectRole(role);
  if ((action === 'approve' && !mayReview) || (['schedule', 'move_campaign', 'delete'].includes(action) && !mayManage) || (['publish', 'retry'].includes(action) && !mayPublish)) {
    throw new AppError('You do not have permission to perform this bulk action.', 403);
  }

  const ids = selectedDraftIds(req);
  const drafts = await SocialDraft.find({ _id: { $in: ids }, projectId: project._id });
  const draftsById = new Map(drafts.map((draft) => [String(draft._id), draft]));
  const results = ids.map((id) => ({
    id,
    title: draftsById.get(id)?.title || 'Unknown post',
    ok: false,
    message: draftsById.has(id) ? '' : 'Post not found in this project.'
  }));
  const activeJobs = await PublishJob.find({ projectId: project._id, draftId: { $in: drafts.map((draft) => draft._id) }, status: { $in: [...ACTIVE_JOB_STATUSES] } }).select('draftId');
  const activeDraftIds = new Set(activeJobs.map((job) => String(job.draftId)));

  if (action === 'publish') {
    const allowedDestinationProjectIds = await publishableProjectIds(req.user._id, { sourceProject: project });
    const readiness = await publishingReadinessForDrafts({ project, userId: req.user._id, drafts, allowedDestinationProjectIds });
    const byId = new Map(readiness.posts.map((item) => [item.draftId, item]));
    const readyIds = readiness.posts.filter((item) => item.ready).map((item) => item.draftId);
    results.forEach((item) => {
      const state = byId.get(item.id);
      item.message = state ? state.blockerDetails.map((blocker) => blocker.message).join(' ') || 'Ready to publish.' : item.message;
    });
    if (readyIds.length) {
      await createAndQueuePublishBatch({ projectId: project._id, userId: req.user._id, draftIds: readyIds, project, scheduledAt: new Date(), allowedDestinationProjectIds });
      results.forEach((item) => { if (readyIds.includes(item.id)) Object.assign(item, { ok: true, message: 'Publishing queued.' }); });
      for (const draft of drafts.filter((item) => readyIds.includes(String(item._id)))) {
        await recordDraftActivity({ draft, user: req.user, eventType: 'bulk_publish_queued', summary: 'Queued the post using a bulk calendar action.', req });
      }
    }
  } else if (action === 'retry') {
    const latestFailedJobs = await PublishJob.find({ projectId: project._id, draftId: { $in: drafts.map((draft) => draft._id) }, status: { $in: ['failed', 'dead_letter'] } }).sort({ createdAt: -1 });
    const jobByDraft = new Map();
    latestFailedJobs.forEach((job) => { if (!jobByDraft.has(String(job.draftId))) jobByDraft.set(String(job.draftId), job); });
    for (const item of results) {
      const job = jobByDraft.get(item.id);
      if (!job) { item.message = 'No failed publication is available to retry.'; continue; }
      try {
        await retryPublishJob(job._id);
        const draft = draftsById.get(item.id);
        if (draft) await recordDraftActivity({ draft, user: req.user, eventType: 'publish_retried', summary: 'Retried a failed publication.', metadata: { jobId: job._id }, req });
        Object.assign(item, { ok: true, message: 'Retry queued.' });
      } catch (error) { item.message = error.message; }
    }
  } else {
    let campaign = null;
    if (action === 'move_campaign') campaign = await Campaign.findOne({ _id: req.body.campaignId, projectId: project._id });
    for (const item of results) {
      const draft = draftsById.get(item.id);
      if (!draft) continue;
      if (activeDraftIds.has(item.id) || draft.publishStatus === 'published' || draft.status === 'published_manually') {
        item.message = activeDraftIds.has(item.id) ? 'Publishing is already in progress.' : 'Published posts cannot be changed.';
        continue;
      }
      try {
        let transition = null;
        if (action === 'approve') transition = applyReviewTransition(draft, { action: 'approve', actorUserId: req.user._id });
        if (action === 'schedule') {
          const previousSchedule = draft.scheduledFor;
          draft.scheduledFor = validateCalendarReschedule(draft, req.body.scheduledAt);
          if (['approved', 'scheduled'].includes(legacyReviewStatus(draft))) draft.reviewStatus = 'scheduled';
          transition = { from: previousSchedule?.toISOString() || '', to: draft.scheduledFor.toISOString() };
        }
        if (action === 'move_campaign') {
          if (!campaign) throw new AppError('Choose a campaign in this project.', 422);
          draft.campaignId = campaign._id;
        }
        if (action === 'delete') {
          await recordDraftActivity({ draft, user: req.user, eventType: 'bulk_deleted', summary: 'Deleted the post using a bulk calendar action.', req });
          await SocialDraft.deleteOne({ _id: draft._id, projectId: project._id });
        } else {
          await draft.save();
          const summaries = {
            approve: 'Approved the post using a bulk calendar action.',
            schedule: 'Scheduled the post using a bulk calendar action.',
            move_campaign: 'Moved the post to another campaign.'
          };
          await recordDraftActivity({
            draft,
            user: req.user,
            eventType: `bulk_${action}`,
            summary: summaries[action] || 'Updated the post using a bulk calendar action.',
            metadata: action === 'move_campaign' ? { campaignId: campaign._id } : (transition || {}),
            req
          });
        }
        Object.assign(item, { ok: true, message: action === 'delete' ? 'Post deleted.' : 'Post updated.' });
      } catch (error) { item.message = error.message; }
    }
  }

  const message = bulkMessage(action, results);
  if (wantsCalendarJson(req)) return res.status(results.some((item) => item.ok) ? 200 : 422).json({ ok: results.some((item) => item.ok), message, results });
  const failures = results.filter((item) => !item.ok);
  return res.redirect(projectCalendarUrl(project._id, failures.length ? { success: message } : { success: message }));
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
      const retried = await retryPublishJob(job._id);
      if (!retried) throw new AppError('This publish job is no longer eligible for retry.', 409);
    } catch (error) {
      return res.redirect(calendarUrl(req.project._id, req.socialDraft._id, { error: error.message }));
    }
    await recordDraftActivity({ draft: req.socialDraft, user: req.user, eventType: 'publish_retried', summary: 'Retried a failed publication.', metadata: { jobId: job._id }, req });
    res.redirect(calendarUrl(req.project._id, req.socialDraft._id, { success: `Retry queued for ${job.platform}.` }));
  })
);

router.post('/:id/reschedule', [
  param('id').isMongoId(),
  body('scheduledFor').isISO8601().withMessage('Choose a valid schedule date.'),
  handleValidation
], loadSocialDraft, requireDraftEditor, requireDraftNotPublishing, asyncHandler(async (req, res) => {
  const activeJob = await PublishJob.exists({
    projectId: req.project._id,
    draftId: req.socialDraft._id,
    status: { $in: [...ACTIVE_JOB_STATUSES] }
  });
  if (activeJob) {
    return res.status(409).json({ ok: false, message: 'Wait for active publishing jobs to finish before rescheduling this post.' });
  }
  let scheduledFor;
  try {
    scheduledFor = validateCalendarReschedule(req.socialDraft, req.body.scheduledFor);
  } catch (error) {
    return res.status(error.statusCode || 422).json({ ok: false, message: error.message });
  }
  const previousSchedule = req.socialDraft.scheduledFor;
  req.socialDraft.scheduledFor = scheduledFor;
  if (['approved', 'scheduled'].includes(legacyReviewStatus(req.socialDraft))) req.socialDraft.reviewStatus = 'scheduled';
  await req.socialDraft.save();
  await recordDraftActivity({
    draft: req.socialDraft,
    user: req.user,
    eventType: 'schedule_changed',
    summary: 'Changed the scheduled publishing time.',
    metadata: { from: previousSchedule?.toISOString() || '', to: scheduledFor.toISOString() },
    req
  });
  return res.status(200).json({
    ok: true,
    message: `Post moved to ${dayjs(scheduledFor).tz(req.project.timezone || 'UTC').format('ddd, D MMM YYYY [at] HH:mm z')}.`,
    draftId: String(req.socialDraft._id),
    scheduledFor: scheduledFor.toISOString(),
    previousScheduledFor: previousSchedule?.toISOString() || ''
  });
}));

router.post('/:id/update', [
  param('id').isMongoId(),
  body('title').trim().isLength({ max: 180 }).withMessage('Post title is too long.'),
  body('body').trim().notEmpty().withMessage('Post copy is required.').isLength({ max: 4000 }).withMessage('Post copy is too long.'),
  body('channel').isIn(['bluesky', 'linkedin', 'facebook', 'x', 'instagram', 'threads', 'youtube', 'tiktok', 'email', 'webhook']).withMessage('Channel is invalid.'),
  body('scheduledFor').isISO8601().withMessage('Choose a valid schedule date.'),
  body('socialAccountId').optional({ checkFalsy: true }).isMongoId().withMessage('Choose a valid social account.'),
  handleValidation
], loadSocialDraft, requireDraftEditor, requireDraftNotPublishing, asyncHandler(async (req, res) => {
  if (req.body.channel === 'x') {
    try {
      assertStandardXPost(req.body.body);
    } catch (error) {
      req.socialDraft.publishStatus = 'failed';
      req.socialDraft.errorMessage = error.message;
      await req.socialDraft.save();
      return res.redirect(calendarUrl(req.project._id, req.socialDraft._id, { error: error.message }));
    }
  }
  req.socialDraft.title = req.body.title;
  req.socialDraft.body = req.body.body;
  req.socialDraft.channel = req.body.channel;
  req.socialDraft.socialAccountId = req.body.socialAccountId || null;
  req.socialDraft.scheduledFor = new Date(req.body.scheduledFor);
  req.socialDraft.errorMessage = '';
  if (req.socialDraft.publishStatus === 'failed') req.socialDraft.publishStatus = 'approved';
  await req.socialDraft.save();
  await recordDraftActivity({
    draft: req.socialDraft,
    user: req.user,
    eventType: 'content_edited',
    summary: 'Updated the post content or publishing details.',
    metadata: { platform: req.socialDraft.channel, accountId: req.socialDraft.socialAccountId || '' },
    req
  });
  res.redirect(`/projects/${req.project._id}/calendar?success=${encodeURIComponent('Post updated.')}#post-${req.socialDraft._id}`);
}));

router.post('/:id/delete', [param('id').isMongoId(), handleValidation], loadSocialDraft, requireDraftManager, requireDraftNotPublishing, asyncHandler(async (req, res) => {
  await recordDraftActivity({ draft: req.socialDraft, user: req.user, eventType: 'deleted', summary: 'Removed the post from the calendar.', req });
  await SocialDraft.deleteOne({ _id: req.socialDraft._id, projectId: req.project._id });
  res.redirect(`/projects/${req.project._id}/calendar?success=${encodeURIComponent('Post removed from the calendar.')}`);
}));

router.post('/:id/mark-published', [param('id').isMongoId(), handleValidation], loadSocialDraft, requireDraftManager, requireDraftNotPublishing, asyncHandler(async (req, res) => {
  req.socialDraft.status = 'published_manually';
  req.socialDraft.publishStatus = 'published';
  req.socialDraft.publishedAt = new Date();
  await req.socialDraft.save();
  await recordDraftActivity({ draft: req.socialDraft, user: req.user, eventType: 'marked_published', summary: 'Marked the post as published manually.', req });
  res.redirect(`/projects/${req.project._id}/calendar`);
}));

module.exports = router;
