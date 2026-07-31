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
  generateContentImage,
  rejectContentImage,
  restoreContentImage,
  saveUploadedImage,
  selectContentImage
} = require('../services/contentImageService');
const { openDownloadStream } = require('../services/contentImageStorageService');
const { hasProjectLogo, projectLogoReference } = require('../services/projectLogoService');
const { canManageProjectRole, projectAccessRole } = require('../services/projectAccessService');
const {
  ensureImageGenerationAllowed,
  incrementUsage,
  recordAiOperation,
  recordAiOperationFailure
} = require('../services/usageService');

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

function guidanceRequestsLogo(value) {
  return /\b(logo|brand mark|brandmark|logomark|wordmark|brand identity)\b/i.test(String(value || ''));
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
      const brandLogoReference = guidanceRequestsLogo(req.body.guidance) && hasProjectLogo(req.project)
        ? await projectLogoReference(req.project)
        : null;

      await generateContentImage({
        project: req.project,
        draft: req.socialDraft,
        userId: req.user._id,
        guidance: req.body.guidance || '',
        referenceImage,
        brandLogoReference
      });
      await incrementUsage(req.user._id, 'imageGenerationsUsed', 1);
      await recordAiOperation(req.user._id, 1);
      res.redirect(calendarUrl(req.project._id, req.socialDraft._id, { success: 'Image candidate generated for this post.' }));
    } catch (error) {
      await recordAiOperationFailure(req.user._id).catch(() => null);
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

router.post('/:id/approve', [param('id').isMongoId(), handleValidation], loadSocialDraft, asyncHandler(async (req, res) => {
  req.socialDraft.status = 'approved';
  await req.socialDraft.save();
  res.redirect(`/projects/${req.project._id}/calendar`);
}));

router.post('/:id/update', [
  param('id').isMongoId(),
  body('title').trim().isLength({ max: 180 }).withMessage('Post title is too long.'),
  body('body').trim().notEmpty().withMessage('Post copy is required.').isLength({ max: 4000 }).withMessage('Post copy is too long.'),
  body('channel').isIn(['linkedin', 'facebook', 'x', 'instagram', 'email']).withMessage('Channel is invalid.'),
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
  await req.socialDraft.save();
  res.redirect(`/projects/${req.project._id}/calendar`);
}));

module.exports = router;
