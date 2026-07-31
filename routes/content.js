const express = require('express');
const asyncHandler = require('express-async-handler');
const { body, param } = require('express-validator');
const multer = require('multer');
const ContentDraft = require('../models/ContentDraft');
const ContentImage = require('../models/ContentImage');
const SocialDraft = require('../models/SocialDraft');
const Project = require('../models/Project');
const PublishAction = require('../models/PublishAction');
const Recommendation = require('../models/Recommendation');
const WordPressIntegration = require('../models/WordPressIntegration');
const WebflowIntegration = require('../models/WebflowIntegration');
const ShopifyIntegration = require('../models/ShopifyIntegration');
const AppError = require('../utils/appError');
const handleValidation = require('../utils/validate');
const { requireAuth } = require('../middleware/auth');
const { createWordPressDraftPost } = require('../services/wordpressService');
const { createWebflowDraftItem } = require('../services/webflowService');
const { createShopifyDraftArticle } = require('../services/shopifyService');
const { sendContentApprovedWebhook } = require('../services/webhookService');
const { createSocialDraftsFromContent } = require('../services/socialDraftService');
const {
  generateContentImage,
  rejectContentImage,
  restoreContentImage,
  saveUploadedImage,
  selectContentImage
} = require('../services/contentImageService');
const { openDownloadStream } = require('../services/contentImageStorageService');
const { hasProjectLogo, projectLogoReference } = require('../services/projectLogoService');
const { renderContentBody } = require('../services/contentPreviewService');
const { recordAuditEvent } = require('../services/auditLogService');
const { canManageProjectRole, isUnsafeMethod, projectAccessRole } = require('../services/projectAccessService');
const {
  ensureAiOperationAllowed,
  ensureImageGenerationAllowed,
  ensureFeature,
  incrementUsage,
  recordAiOperation,
  recordAiOperationFailure
} = require('../services/usageService');

const router = express.Router();
const imageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 1 }
});

function contentUrl(draftId, workspace, params = {}) {
  const query = new URLSearchParams({ workspace, ...params });
  return `/content/${draftId}?${query.toString()}`;
}

function uploadSingleImage(req, res, next) {
  imageUpload.single('image')(req, res, (error) => {
    if (!error) return next();
    const message = error.code === 'LIMIT_FILE_SIZE'
      ? 'Image uploads must be 10 MB or smaller.'
      : 'The image upload could not be processed.';
    return res.redirect(contentUrl(req.params.id, 'visual', { imageError: message }));
  });
}

function guidanceRequestsLogo(value) {
  return /\b(logo|brand mark|brandmark|logomark|wordmark|brand identity)\b/i.test(String(value || ''));
}

router.use(requireAuth);

function draftStatusLabel(status) {
  if (status === 'awaiting_review' || status === 'draft') return 'awaiting review';
  if (status === 'needs_revision') return 'needs revision';
  return String(status || '').replace(/_/g, ' ');
}

async function loadDraft(req, res, next) {
  try {
    const draft = await ContentDraft.findById(req.params.id);
    if (!draft) return next(new AppError('Content draft not found.', 404));

    const project = await Project.findById(draft.projectId);
    if (!project) return next(new AppError('Content draft not found.', 404));
    const role = await projectAccessRole({ project, userId: req.user._id });
    if (!role) return next(new AppError('Content draft not found.', 404));
    if (isUnsafeMethod(req.method) && !canManageProjectRole(role)) {
      return next(new AppError('You do not have permission to change this content draft.', 403));
    }

    const recommendation = await Recommendation.findById(draft.recommendationId);
    req.draft = draft;
    req.project = project;
    req.recommendation = recommendation;
    res.locals.draft = draft;
    res.locals.project = project;
    res.locals.recommendation = recommendation;
    res.locals.draftStatusLabel = draftStatusLabel(draft.status);
    next();
  } catch (error) {
    next(error);
  }
}

router.get('/:id', [param('id').isMongoId(), handleValidation], loadDraft, asyncHandler(async (req, res) => {
  const [wordpressIntegration, webflowIntegration, shopifyIntegration, publishActions, contentImages] = await Promise.all([
    WordPressIntegration.findOne({ projectId: req.project._id, userId: req.user._id }),
    WebflowIntegration.findOne({ projectId: req.project._id, userId: req.user._id }),
    ShopifyIntegration.findOne({ projectId: req.project._id, userId: req.user._id }),
    PublishAction.find({ contentDraftId: req.draft._id, userId: req.user._id }).sort({ createdAt: -1 }).limit(10),
    ContentImage.find({ draftId: req.draft._id }).sort({ status: 1, createdAt: -1 })
  ]);

  res.render('content/show', {
    title: req.draft.title || 'Content draft',
    wordpressIntegration,
    webflowIntegration,
    shopifyIntegration,
    publishActions,
    contentImages,
    postBodyHtml: renderContentBody(req.draft.body),
    workspaceStep: ['write', 'visual', 'review', 'distribute'].includes(req.query.workspace)
      ? req.query.workspace
      : (['approved', 'published_manually'].includes(req.draft.status) ? 'distribute' : 'write'),
    imageError: req.query.imageError || '',
    imageSuccess: req.query.imageSuccess || '',
    publishError: req.query.publishError || '',
    publishSuccess: req.query.publishSuccess || '',
    webhookStatus: req.query.webhook || ''
  });
}));

router.get(
  '/:id/images/:imageId/file',
  [param('id').isMongoId(), param('imageId').isMongoId(), handleValidation],
  loadDraft,
  asyncHandler(async (req, res, next) => {
    const image = await ContentImage.findOne({
      _id: req.params.imageId,
      draftId: req.draft._id,
      projectId: req.project._id
    });
    if (!image) return next(new AppError('Content image not found.', 404));

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
  loadDraft,
  uploadSingleImage,
  asyncHandler(async (req, res) => {
    try {
      await saveUploadedImage({
        project: req.project,
        draft: req.draft,
        userId: req.user._id,
        file: req.file,
        altText: req.body.altText || '',
        caption: req.body.caption || ''
      });
      res.redirect(contentUrl(req.draft._id, 'visual', { imageSuccess: 'Image uploaded as a review candidate.' }));
    } catch (error) {
      res.redirect(contentUrl(req.draft._id, 'visual', { imageError: error.message }));
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
  loadDraft,
  asyncHandler(async (req, res) => {
    try {
      await ensureImageGenerationAllowed(req.user);
      const referenceImage = req.body.referenceImageId
        ? await ContentImage.findOne({
          _id: req.body.referenceImageId,
          draftId: req.draft._id,
          status: { $ne: 'rejected' }
        })
        : null;
      if (req.body.referenceImageId && !referenceImage) {
        throw new AppError('Reference image not found for this draft.', 404);
      }
      const brandLogoReference = guidanceRequestsLogo(req.body.guidance) && hasProjectLogo(req.project)
        ? await projectLogoReference(req.project)
        : null;

      await generateContentImage({
        project: req.project,
        draft: req.draft,
        userId: req.user._id,
        guidance: req.body.guidance || '',
        referenceImage,
        brandLogoReference
      });
      await incrementUsage(req.user._id, 'imageGenerationsUsed', 1);
      await recordAiOperation(req.user._id, 1);
      res.redirect(contentUrl(req.draft._id, 'visual', { imageSuccess: 'New image candidate generated. Review and select it before using this asset.' }));
    } catch (error) {
      await recordAiOperationFailure(req.user._id).catch(() => null);
      res.redirect(contentUrl(req.draft._id, 'visual', { imageError: error.message }));
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
  loadDraft,
  asyncHandler(async (req, res, next) => {
    const image = await ContentImage.findOne({ _id: req.params.imageId, draftId: req.draft._id });
    if (!image) return next(new AppError('Content image not found.', 404));
    image.altText = req.body.altText || '';
    image.caption = req.body.caption || '';
    await image.save();
    res.redirect(contentUrl(req.draft._id, 'visual', { imageSuccess: 'Image details saved.' }));
  })
);

router.post(
  '/:id/images/:imageId/select',
  [param('id').isMongoId(), param('imageId').isMongoId(), handleValidation],
  loadDraft,
  asyncHandler(async (req, res, next) => {
    const image = await ContentImage.findOne({
      _id: req.params.imageId,
      draftId: req.draft._id,
      status: { $ne: 'rejected' }
    });
    if (!image) return next(new AppError('Content image not found.', 404));
    await selectContentImage({ draft: req.draft, image });
    await SocialDraft.updateMany(
      { sourceContentDraftId: req.draft._id },
      { $set: { contentImageId: image._id } }
    );
    res.redirect(contentUrl(req.draft._id, 'visual', { imageSuccess: 'Image selected for this post.' }));
  })
);

router.post(
  '/:id/images/:imageId/reject',
  [param('id').isMongoId(), param('imageId').isMongoId(), handleValidation],
  loadDraft,
  asyncHandler(async (req, res, next) => {
    const image = await ContentImage.findOne({ _id: req.params.imageId, draftId: req.draft._id });
    if (!image) return next(new AppError('Content image not found.', 404));
    const wasSelected = image.status === 'selected';
    await rejectContentImage({ draft: req.draft, image });
    if (wasSelected) {
      await SocialDraft.updateMany(
        { sourceContentDraftId: req.draft._id },
        { $set: { contentImageId: null } }
      );
    }
    res.redirect(contentUrl(req.draft._id, 'visual', { imageSuccess: 'Image rejected and removed from the candidate set.' }));
  })
);

router.post(
  '/:id/images/:imageId/restore',
  [param('id').isMongoId(), param('imageId').isMongoId(), handleValidation],
  loadDraft,
  asyncHandler(async (req, res, next) => {
    const image = await ContentImage.findOne({
      _id: req.params.imageId,
      draftId: req.draft._id,
      status: 'rejected'
    });
    if (!image) return next(new AppError('Rejected content image not found.', 404));
    await restoreContentImage(image);
    res.redirect(contentUrl(req.draft._id, 'visual', { imageSuccess: 'Image restored to the candidate set.' }));
  })
);

router.post(
  '/:id/update',
  [
    param('id').isMongoId(),
    body('keyword').optional({ checkFalsy: true }).trim().isLength({ max: 120 }).withMessage('Keyword is too long.'),
    body('title').optional({ checkFalsy: true }).trim().isLength({ max: 240 }).withMessage('Title is too long.'),
    body('businessGoal').optional({ checkFalsy: true }).trim().isLength({ max: 300 }).withMessage('Business goal is too long.'),
    body('targetPersona').optional({ checkFalsy: true }).trim().isLength({ max: 240 }).withMessage('Target persona is too long.'),
    body('searchIntent').optional({ checkFalsy: true }).trim().isLength({ max: 240 }).withMessage('Search intent is too long.'),
    body('primaryCta').optional({ checkFalsy: true }).trim().isLength({ max: 180 }).withMessage('CTA is too long.'),
    body('proofPoints').optional().isString(),
    body('body').optional().isString(),
    body('jsonBody').optional({ checkFalsy: true }).isString(),
    handleValidation
  ],
  loadDraft,
  asyncHandler(async (req, res, next) => {
    req.draft.keyword = req.body.keyword || '';
    req.draft.title = req.body.title || '';
    req.draft.body = req.body.body || '';
    req.draft.executionContext = {
      ...(req.draft.executionContext || {}),
      businessGoal: req.body.businessGoal || '',
      targetPersona: req.body.targetPersona || '',
      searchIntent: req.body.searchIntent || '',
      primaryCta: req.body.primaryCta || '',
      proofPoints: String(req.body.proofPoints || '')
        .split('\n')
        .map((item) => item.trim())
        .filter(Boolean)
        .slice(0, 8)
    };

    if (req.body.jsonBody) {
      try {
        req.draft.jsonBody = JSON.parse(req.body.jsonBody);
      } catch (error) {
        return next(new AppError('JSON body must be valid JSON.', 422));
      }
    } else {
      req.draft.jsonBody = null;
    }

    await req.draft.save();
    res.redirect(contentUrl(req.draft._id, 'write', { saved: '1' }));
  })
);

router.post('/:id/submit-for-review', [
  param('id').isMongoId(),
  body('reviewNotes').optional().isString(),
  handleValidation
], loadDraft, asyncHandler(async (req, res) => {
  req.draft.status = 'awaiting_review';
  req.draft.approvedAt = undefined;
  req.draft.reviewNotes = req.body.reviewNotes || req.draft.reviewNotes || '';
  await req.draft.save();
  await recordAuditEvent({
    user: req.user,
    projectId: req.project._id,
    eventType: 'content_submitted_for_review',
    metadata: { contentDraftId: req.draft._id, title: req.draft.title },
    req
  });
  res.redirect(contentUrl(req.draft._id, 'review'));
}));

router.post('/:id/approve', [
  param('id').isMongoId(),
  body('reviewNotes').optional().isString(),
  handleValidation
], loadDraft, asyncHandler(async (req, res) => {
  req.draft.status = 'approved';
  req.draft.approvedAt = new Date();
  req.draft.lastReviewedAt = new Date();
  req.draft.reviewNotes = req.body.reviewNotes || '';
  await req.draft.save();
  await recordAuditEvent({
    user: req.user,
    projectId: req.project._id,
    eventType: 'content_approved',
    metadata: { contentDraftId: req.draft._id, title: req.draft.title },
    req
  });

  if (!req.project.webhookUrl) {
    return res.redirect(contentUrl(req.draft._id, 'distribute'));
  }

  try {
    await sendContentApprovedWebhook({ project: req.project, draft: req.draft, userId: req.user._id });
    await recordAuditEvent({
      user: req.user,
      projectId: req.project._id,
      eventType: 'content_approval_webhook_sent',
      metadata: { contentDraftId: req.draft._id },
      req
    });
    res.redirect(contentUrl(req.draft._id, 'distribute', { webhook: 'sent' }));
  } catch (error) {
    console.warn(`Content approval webhook failed for draft ${req.draft._id}: ${error.message}`);
    await recordAuditEvent({
      user: req.user,
      projectId: req.project._id,
      eventType: 'content_approval_webhook_failed',
      status: 'failed',
      severity: 'warning',
      metadata: { contentDraftId: req.draft._id, errorMessage: error.message },
      req
    });
    res.redirect(contentUrl(req.draft._id, 'distribute', { webhook: 'failed' }));
  }
}));

router.post('/:id/request-revision', [
  param('id').isMongoId(),
  body('reviewNotes').optional().isString(),
  handleValidation
], loadDraft, asyncHandler(async (req, res) => {
  req.draft.status = 'needs_revision';
  req.draft.approvedAt = undefined;
  req.draft.lastReviewedAt = new Date();
  req.draft.reviewNotes = req.body.reviewNotes || '';
  await req.draft.save();
  await recordAuditEvent({
    user: req.user,
    projectId: req.project._id,
    eventType: 'content_revision_requested',
    metadata: { contentDraftId: req.draft._id, title: req.draft.title },
    req
  });
  res.redirect(contentUrl(req.draft._id, 'review'));
}));

router.post('/:id/reject', [
  param('id').isMongoId(),
  body('reviewNotes').optional().isString(),
  handleValidation
], loadDraft, asyncHandler(async (req, res) => {
  req.draft.status = 'rejected';
  req.draft.approvedAt = undefined;
  req.draft.lastReviewedAt = new Date();
  req.draft.reviewNotes = req.body.reviewNotes || '';
  await req.draft.save();
  await recordAuditEvent({
    user: req.user,
    projectId: req.project._id,
    eventType: 'content_rejected',
    metadata: { contentDraftId: req.draft._id, title: req.draft.title },
    req
  });
  res.redirect(contentUrl(req.draft._id, 'review'));
}));

router.post('/:id/mark-published', [param('id').isMongoId(), handleValidation], loadDraft, asyncHandler(async (req, res) => {
  if (req.draft.status !== 'approved') {
    return res.redirect(contentUrl(req.draft._id, 'distribute', { publishError: 'Only approved assets can be marked as published.' }));
  }
  req.draft.status = 'published_manually';
  req.draft.publishedAt = new Date();
  await req.draft.save();
  await PublishAction.create({
    projectId: req.project._id,
    userId: req.user._id,
    contentDraftId: req.draft._id,
    integrationType: 'manual',
    actionType: 'manual_record',
    status: 'success'
  });
  await recordAuditEvent({
    user: req.user,
    projectId: req.project._id,
    eventType: 'content_marked_published',
    metadata: { contentDraftId: req.draft._id, title: req.draft.title },
    req
  });
  res.redirect(`/projects/${req.project._id}/content?success=${encodeURIComponent('Manual publication recorded. The asset is now in Content History.')}`);
}));

router.post('/:id/publish/wordpress-draft', [param('id').isMongoId(), handleValidation], loadDraft, asyncHandler(async (req, res) => {
  const integration = await WordPressIntegration.findOne({ projectId: req.project._id, userId: req.user._id });
  try {
    ensureFeature(req.user, 'wordpress', 'WordPress drafts are available on Pro and Agency plans.', 'pro');
  } catch (error) {
    return res.redirect(contentUrl(req.draft._id, 'distribute', { publishError: error.message }));
  }

  if (!integration) {
    return res.redirect(contentUrl(req.draft._id, 'distribute', { publishError: 'Connect WordPress for this project first.' }));
  }

  try {
    const action = await createWordPressDraftPost({
      integration,
      draft: req.draft,
      userId: req.user._id
    });

    const message = action.actionType === 'export_only'
      ? 'This content type is available as a reviewed export asset. Use Copy Content or Export.'
      : 'WordPress draft post created.';
    await recordAuditEvent({
      user: req.user,
      projectId: req.project._id,
      eventType: 'publish_wordpress_draft',
      metadata: { contentDraftId: req.draft._id, actionId: action._id, actionType: action.actionType },
      req
    });
    res.redirect(contentUrl(req.draft._id, 'distribute', { publishSuccess: message }));
  } catch (error) {
    await recordAuditEvent({
      user: req.user,
      projectId: req.project._id,
      eventType: 'publish_wordpress_draft_failed',
      status: 'failed',
      severity: 'warning',
      metadata: { contentDraftId: req.draft._id, errorMessage: error.message },
      req
    });
    res.redirect(contentUrl(req.draft._id, 'distribute', { publishError: error.message }));
  }
}));

router.post('/:id/publish/webflow-draft', [param('id').isMongoId(), handleValidation], loadDraft, asyncHandler(async (req, res) => {
  const integration = await WebflowIntegration.findOne({ projectId: req.project._id, userId: req.user._id });
  try {
    ensureFeature(req.user, 'webflow', 'Webflow CMS drafts are available on Pro and Agency plans.', 'pro');
  } catch (error) {
    return res.redirect(contentUrl(req.draft._id, 'distribute', { publishError: error.message }));
  }

  if (!integration) {
    return res.redirect(contentUrl(req.draft._id, 'distribute', { publishError: 'Connect Webflow for this project first.' }));
  }

  try {
    await createWebflowDraftItem({
      integration,
      draft: req.draft,
      userId: req.user._id
    });
    await recordAuditEvent({
      user: req.user,
      projectId: req.project._id,
      eventType: 'publish_webflow_draft',
      metadata: { contentDraftId: req.draft._id },
      req
    });
    res.redirect(contentUrl(req.draft._id, 'distribute', { publishSuccess: 'Webflow draft CMS item created.' }));
  } catch (error) {
    await recordAuditEvent({
      user: req.user,
      projectId: req.project._id,
      eventType: 'publish_webflow_draft_failed',
      status: 'failed',
      severity: 'warning',
      metadata: { contentDraftId: req.draft._id, errorMessage: error.message },
      req
    });
    res.redirect(contentUrl(req.draft._id, 'distribute', { publishError: error.message }));
  }
}));

router.post('/:id/publish/shopify-draft', [param('id').isMongoId(), handleValidation], loadDraft, asyncHandler(async (req, res) => {
  const integration = await ShopifyIntegration.findOne({ projectId: req.project._id, userId: req.user._id });
  try {
    ensureFeature(req.user, 'shopify', 'Shopify blog drafts are available on Pro and Agency plans.', 'pro');
  } catch (error) {
    return res.redirect(contentUrl(req.draft._id, 'distribute', { publishError: error.message }));
  }

  if (!integration) {
    return res.redirect(contentUrl(req.draft._id, 'distribute', { publishError: 'Connect Shopify for this project first.' }));
  }

  try {
    await createShopifyDraftArticle({
      integration,
      draft: req.draft,
      userId: req.user._id
    });
    await recordAuditEvent({
      user: req.user,
      projectId: req.project._id,
      eventType: 'publish_shopify_draft',
      metadata: { contentDraftId: req.draft._id },
      req
    });
    res.redirect(contentUrl(req.draft._id, 'distribute', { publishSuccess: 'Shopify unpublished blog article created.' }));
  } catch (error) {
    await recordAuditEvent({
      user: req.user,
      projectId: req.project._id,
      eventType: 'publish_shopify_draft_failed',
      status: 'failed',
      severity: 'warning',
      metadata: { contentDraftId: req.draft._id, errorMessage: error.message },
      req
    });
    res.redirect(contentUrl(req.draft._id, 'distribute', { publishError: error.message }));
  }
}));

router.post('/:id/create-social-drafts', [param('id').isMongoId(), handleValidation], loadDraft, asyncHandler(async (req, res) => {
  try {
    await ensureAiOperationAllowed(req.user);
    const drafts = await createSocialDraftsFromContent({
      project: req.project,
      draft: req.draft
    });
    await recordAiOperation(req.user._id, 1);
    res.redirect(`/projects/${req.project._id}/calendar?success=${encodeURIComponent(`${drafts.length} social drafts created.`)}`);
  } catch (error) {
    await recordAiOperationFailure(req.user._id).catch(() => null);
    res.redirect(contentUrl(req.draft._id, 'distribute', { publishError: error.message }));
  }
}));

module.exports = router;
