const express = require('express');
const asyncHandler = require('express-async-handler');
const { body, param } = require('express-validator');
const ContentDraft = require('../models/ContentDraft');
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
  ensureFeature
} = require('../services/usageService');

const router = express.Router();

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

    const project = await Project.findOne({ _id: draft.projectId, owner: req.user._id });
    if (!project) return next(new AppError('Content draft not found.', 404));

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
  const [wordpressIntegration, webflowIntegration, shopifyIntegration, publishActions] = await Promise.all([
    WordPressIntegration.findOne({ projectId: req.project._id, userId: req.user._id }),
    WebflowIntegration.findOne({ projectId: req.project._id, userId: req.user._id }),
    ShopifyIntegration.findOne({ projectId: req.project._id, userId: req.user._id }),
    PublishAction.find({ contentDraftId: req.draft._id, userId: req.user._id }).sort({ createdAt: -1 }).limit(10)
  ]);

  res.render('content/show', {
    title: req.draft.title || 'Content draft',
    wordpressIntegration,
    webflowIntegration,
    shopifyIntegration,
    publishActions,
    publishError: req.query.publishError || '',
    publishSuccess: req.query.publishSuccess || '',
    webhookStatus: req.query.webhook || ''
  });
}));

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
    res.redirect(`/content/${req.draft._id}`);
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
  res.redirect(`/content/${req.draft._id}`);
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

  if (!req.project.webhookUrl) {
    return res.redirect(`/content/${req.draft._id}`);
  }

  try {
    await sendContentApprovedWebhook({ project: req.project, draft: req.draft });
    res.redirect(`/content/${req.draft._id}?webhook=sent`);
  } catch (error) {
    console.warn(`Content approval webhook failed for draft ${req.draft._id}: ${error.message}`);
    res.redirect(`/content/${req.draft._id}?webhook=failed`);
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
  res.redirect(`/content/${req.draft._id}`);
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
  res.redirect(`/content/${req.draft._id}`);
}));

router.post('/:id/mark-published', [param('id').isMongoId(), handleValidation], loadDraft, asyncHandler(async (req, res) => {
  if (req.draft.status !== 'approved') {
    return res.redirect(`/content/${req.draft._id}?publishError=${encodeURIComponent('Only approved assets can be marked as published.')}`);
  }
  req.draft.status = 'published_manually';
  req.draft.publishedAt = new Date();
  await req.draft.save();
  res.redirect(`/content/${req.draft._id}`);
}));

router.post('/:id/publish/wordpress-draft', [param('id').isMongoId(), handleValidation], loadDraft, asyncHandler(async (req, res) => {
  const integration = await WordPressIntegration.findOne({ projectId: req.project._id, userId: req.user._id });
  try {
    ensureFeature(req.user, 'wordpress', 'WordPress drafts are available on Pro and Agency plans.', 'pro');
  } catch (error) {
    return res.redirect(`/content/${req.draft._id}?publishError=${encodeURIComponent(error.message)}`);
  }

  if (!integration) {
    return res.redirect(`/content/${req.draft._id}?publishError=${encodeURIComponent('Connect WordPress for this project first.')}`);
  }

  try {
    const action = await createWordPressDraftPost({
      integration,
      draft: req.draft,
      userId: req.user._id
    });

    const message = action.actionType === 'export_only'
      ? 'This content type is export-only in the WordPress MVP. Use Copy Content or Export.'
      : 'WordPress draft post created.';
    res.redirect(`/content/${req.draft._id}?publishSuccess=${encodeURIComponent(message)}`);
  } catch (error) {
    res.redirect(`/content/${req.draft._id}?publishError=${encodeURIComponent(error.message)}`);
  }
}));

router.post('/:id/publish/webflow-draft', [param('id').isMongoId(), handleValidation], loadDraft, asyncHandler(async (req, res) => {
  const integration = await WebflowIntegration.findOne({ projectId: req.project._id, userId: req.user._id });
  try {
    ensureFeature(req.user, 'webflow', 'Webflow CMS drafts are available on Pro and Agency plans.', 'pro');
  } catch (error) {
    return res.redirect(`/content/${req.draft._id}?publishError=${encodeURIComponent(error.message)}`);
  }

  if (!integration) {
    return res.redirect(`/content/${req.draft._id}?publishError=${encodeURIComponent('Connect Webflow for this project first.')}`);
  }

  try {
    await createWebflowDraftItem({
      integration,
      draft: req.draft,
      userId: req.user._id
    });
    res.redirect(`/content/${req.draft._id}?publishSuccess=${encodeURIComponent('Webflow draft CMS item created.')}`);
  } catch (error) {
    res.redirect(`/content/${req.draft._id}?publishError=${encodeURIComponent(error.message)}`);
  }
}));

router.post('/:id/publish/shopify-draft', [param('id').isMongoId(), handleValidation], loadDraft, asyncHandler(async (req, res) => {
  const integration = await ShopifyIntegration.findOne({ projectId: req.project._id, userId: req.user._id });
  try {
    ensureFeature(req.user, 'shopify', 'Shopify blog drafts are available on Pro and Agency plans.', 'pro');
  } catch (error) {
    return res.redirect(`/content/${req.draft._id}?publishError=${encodeURIComponent(error.message)}`);
  }

  if (!integration) {
    return res.redirect(`/content/${req.draft._id}?publishError=${encodeURIComponent('Connect Shopify for this project first.')}`);
  }

  try {
    await createShopifyDraftArticle({
      integration,
      draft: req.draft,
      userId: req.user._id
    });
    res.redirect(`/content/${req.draft._id}?publishSuccess=${encodeURIComponent('Shopify unpublished blog article created.')}`);
  } catch (error) {
    res.redirect(`/content/${req.draft._id}?publishError=${encodeURIComponent(error.message)}`);
  }
}));

router.post('/:id/create-social-drafts', [param('id').isMongoId(), handleValidation], loadDraft, asyncHandler(async (req, res) => {
  try {
    const drafts = await createSocialDraftsFromContent({
      project: req.project,
      draft: req.draft
    });
    res.redirect(`/projects/${req.project._id}/calendar?success=${encodeURIComponent(`${drafts.length} social drafts created.`)}`);
  } catch (error) {
    res.redirect(`/content/${req.draft._id}?publishError=${encodeURIComponent(error.message)}`);
  }
}));

module.exports = router;
