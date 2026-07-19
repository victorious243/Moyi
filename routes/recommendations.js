const express = require('express');
const asyncHandler = require('express-async-handler');
const { body, param } = require('express-validator');
const Recommendation = require('../models/Recommendation');
const Project = require('../models/Project');
const ContentDraft = require('../models/ContentDraft');
const AppError = require('../utils/appError');
const handleValidation = require('../utils/validate');
const { requireAuth } = require('../middleware/auth');
const { generateDraftsForRecommendation } = require('../services/contentDraftService');
const { auditTelemetry } = require('../services/telemetryAuditor');
const {
  ensureContentDraftAllowed,
  incrementUsage
} = require('../services/usageService');

const router = express.Router();

router.use(requireAuth);

// AI-CMO SPEC COMPLIANCE: Subsystem D - timeout-based autonomy with trust gates.
const LOW_STAKES_ACTIONS = new Set(['fix_metadata', 'content', 'internal_linking', 'schema']);

function isStalePending(recommendation) {
  const lastTouched = recommendation.updatedAt || recommendation.createdAt;
  return recommendation.status === 'pending' && lastTouched && Date.now() - lastTouched.getTime() > 48 * 60 * 60 * 1000;
}

async function autoResolveStaleRecommendation(recommendation, project) {
  if (!isStalePending(recommendation)) return recommendation;

  const audit = await auditTelemetry(project);
  if (audit.score < 85 || project.status !== 'approved') return recommendation;

  recommendation.status = LOW_STAKES_ACTIONS.has(recommendation.actionType) ? 'accepted' : 'rejected';
  recommendation.reason = `${recommendation.reason || ''}\n\nAuto-resolved after 48 hours with telemetry health ${audit.score}%.`.trim();
  await recommendation.save();
  return recommendation;
}

router.post(
  '/:id/status',
  [
    param('id').isMongoId(),
    body('status').isIn(['pending', 'accepted', 'rejected', 'in_progress', 'done']).withMessage('Recommendation status is invalid.'),
    handleValidation
  ],
  asyncHandler(async (req, res, next) => {
    const recommendation = await Recommendation.findById(req.params.id);
    if (!recommendation) return next(new AppError('Recommendation not found.', 404));

    const project = await Project.findOne({ _id: recommendation.projectId, owner: req.user._id });
    if (!project) return next(new AppError('Recommendation not found.', 404));

    await autoResolveStaleRecommendation(recommendation, project);
    recommendation.status = req.body.status;
    await recommendation.save();

    res.redirect(`/projects/${project._id}/recommendations`);
  })
);

router.post(
  '/:id/generate-content',
  [
    param('id').isMongoId(),
    body('type').optional({ checkFalsy: true }).isIn([
      'meta_title',
      'meta_description',
      'h1',
      'faq_section',
      'blog_outline',
      'blog_article',
      'vs_comparison_article',
      'alternatives_list',
      'product_led_guide',
      'service_page_section',
      'internal_linking_plan',
      'schema_jsonld'
    ]).withMessage('Content type is invalid.'),
    body('keyword').optional({ checkFalsy: true }).trim().isLength({ max: 120 }).withMessage('Keyword is too long.'),
    handleValidation
  ],
  asyncHandler(async (req, res, next) => {
    const recommendation = await Recommendation.findById(req.params.id);
    if (!recommendation) return next(new AppError('Recommendation not found.', 404));

    const project = await Project.findOne({ _id: recommendation.projectId, owner: req.user._id });
    if (!project) return next(new AppError('Recommendation not found.', 404));

    try {
      await ensureContentDraftAllowed(req.user);
      const drafts = await generateDraftsForRecommendation({
        project,
        recommendation,
        requestedType: req.body.type || '',
        keyword: req.body.keyword || ''
      });

      const created = drafts.length ? await ContentDraft.insertMany(drafts) : [];
      if (created.length) {
        await incrementUsage(req.user._id, 'contentDraftsUsed', created.length);
      }
      const firstDraft = created[0];
      res.redirect(firstDraft ? `/content/${firstDraft._id}` : `/projects/${project._id}/content`);
    } catch (error) {
      if (error.statusCode) return next(new AppError(error.message, error.statusCode));
      return next(error);
    }
  })
);

module.exports = router;
