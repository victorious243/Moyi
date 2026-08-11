const express = require('express');
const asyncHandler = require('express-async-handler');
const { body, param } = require('express-validator');
const multer = require('multer');
const Project = require('../models/Project');
const SocialDraft = require('../models/SocialDraft');
const ContentImage = require('../models/ContentImage');
const AppError = require('../utils/appError');
const handleValidation = require('../utils/validate');
const { requireAuth } = require('../middleware/auth');
const {
  rejectContentImage,
  restoreContentImage,
  saveUploadedImage,
  selectContentImage
} = require('../services/contentImageService');
const { openDownloadStream } = require('../services/contentImageStorageService');
const { canManageProjectRole, projectAccessRole } = require('../services/projectAccessService');
const { queueContentImageGeneration } = require('../services/projectTaskService');
const { ensureImageGenerationAllowed } = require('../services/usageService');

const router = express.Router();
const imageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 1 }
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

router.use(requireAuth);

async function loadSocialDraft(req, res, next) {
  try {
    const socialDraft = await SocialDraft.findById(req.params.id);
    if (!socialDraft) return next(new AppError('Social draft not found.', 404));

    const project = await Project.findById(socialDraft.projectId);
    if (!project) return next(new AppError('Social draft not found.', 404));
    const role = await projectAccessRole({ project, userId: req.user._id });
    if (!canManageProjectRole(role)) {
      return next(new AppError('You do not have permission to change this social draft.', 403));
    }

    req.socialDraft = socialDraft;
    req.project = project;
    next();
  } catch (error) {
    next(error);
  }
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

    const stream = openDownloadStream(image.storageKey);
    stream.on('error', next);
    stream.pipe(res);
  })
);

router.post(
  '/:id/images/upload',
  [param('id').isMongoId(), handleValidation],
  loadSocialDraft,
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
  batchPublishSocialDrafts,
  publishAllConnectedChannels,
  publishSocialDraft
} = require('../services/socialPublisherService');

router.post('/publish-all-connected', [
  body('projectId').isMongoId().withMessage('Project ID is required.'),
  handleValidation
], asyncHandler(async (req, res) => {
  const project = await Project.findById(req.body.projectId);
  if (!project) throw new AppError('Project not found.', 404);

  const role = await projectAccessRole({ project, userId: req.user._id });
  if (!canManageProjectRole(role)) {
    throw new AppError('You do not have permission to publish social drafts.', 403);
  }

  const results = await publishAllConnectedChannels({
    projectId: project._id,
    userId: req.user._id
  });

  const msg = results.total === 0
    ? 'No pending social drafts to publish.'
    : `All-in-One publish completed: ${results.successCount} succeeded across connected channels.`;

  res.redirect(`/projects/${project._id}/calendar?success=${encodeURIComponent(msg)}`);
}));

router.post('/:id/approve', [param('id').isMongoId(), handleValidation], loadSocialDraft, asyncHandler(async (req, res) => {
  req.socialDraft.status = 'approved';
  req.socialDraft.publishStatus = 'approved';
  await req.socialDraft.save();
  res.redirect(`/projects/${req.project._id}/calendar`);
}));

router.post('/:id/approve-and-publish', [param('id').isMongoId(), handleValidation], loadSocialDraft, asyncHandler(async (req, res) => {
  req.socialDraft.status = 'approved';
  req.socialDraft.publishStatus = 'approved';
  await req.socialDraft.save();

  try {
    await publishSocialDraft({
      socialDraftId: req.socialDraft._id,
      userId: req.user._id,
      project: req.project
    });
    res.redirect(`/projects/${req.project._id}/calendar?success=${encodeURIComponent('Approved & published to connected platforms.')}#post-${req.socialDraft._id}`);
  } catch (error) {
    res.redirect(`/projects/${req.project._id}/calendar?error=${encodeURIComponent(`Publish failed: ${error.message}`)}#post-${req.socialDraft._id}`);
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
  if (!canManageProjectRole(role)) {
    throw new AppError('You do not have permission to publish social drafts.', 403);
  }

  const results = await batchPublishSocialDrafts({
    projectId: project._id,
    userId: req.user._id,
    draftIds: req.body.draftIds
  });

  const msg = `Multi-platform publish completed: ${results.successCount} succeeded, ${results.failedCount} failed.`;
  res.redirect(`/projects/${project._id}/calendar?success=${encodeURIComponent(msg)}`);
}));

router.post('/:id/update', [
  param('id').isMongoId(),
  body('title').trim().isLength({ max: 180 }).withMessage('Post title is too long.'),
  body('body').trim().notEmpty().withMessage('Post copy is required.').isLength({ max: 4000 }).withMessage('Post copy is too long.'),
  body('channel').isIn(['linkedin', 'facebook', 'x', 'instagram', 'youtube', 'tiktok', 'email', 'webhook']).withMessage('Channel is invalid.'),
  body('scheduledFor').isISO8601().withMessage('Choose a valid schedule date.'),
  handleValidation
], loadSocialDraft, asyncHandler(async (req, res) => {
  req.socialDraft.title = req.body.title;
  req.socialDraft.body = req.body.body;
  req.socialDraft.channel = req.body.channel;
  req.socialDraft.scheduledFor = new Date(req.body.scheduledFor);
  await req.socialDraft.save();
  res.redirect(`/projects/${req.project._id}/calendar?success=${encodeURIComponent('Post updated.')}#post-${req.socialDraft._id}`);
}));

router.post('/:id/delete', [param('id').isMongoId(), handleValidation], loadSocialDraft, asyncHandler(async (req, res) => {
  await SocialDraft.deleteOne({ _id: req.socialDraft._id, projectId: req.project._id });
  res.redirect(`/projects/${req.project._id}/calendar?success=${encodeURIComponent('Post removed from the calendar.')}`);
}));

router.post('/:id/mark-published', [param('id').isMongoId(), handleValidation], loadSocialDraft, asyncHandler(async (req, res) => {
  req.socialDraft.status = 'published_manually';
  req.socialDraft.publishStatus = 'published';
  req.socialDraft.publishedAt = new Date();
  await req.socialDraft.save();
  res.redirect(`/projects/${req.project._id}/calendar`);
}));

module.exports = router;
