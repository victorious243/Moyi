const express = require('express');
const asyncHandler = require('express-async-handler');
const { body, param } = require('express-validator');
const Recommendation = require('../models/Recommendation');
const Project = require('../models/Project');
const ContentDraft = require('../models/ContentDraft');
const AppError = require('../utils/appError');
const handleValidation = require('../utils/validate');
const { requireAuth } = require('../middleware/auth');
const { EXECUTION_ASSET_TYPES, generateDraftsForRecommendation } = require('../services/contentDraftService');
const {
  ensureContentDraftAllowed,
  incrementUsage
} = require('../services/usageService');

const router = express.Router();

router.use(requireAuth);

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

    recommendation.status = req.body.status;
    await recommendation.save();

    res.redirect(`/projects/${project._id}/recommendations`);
  })
);

router.post(
  '/:id/generate-content',
  [
    param('id').isMongoId(),
    body('type').optional({ checkFalsy: true }).isIn(EXECUTION_ASSET_TYPES).withMessage('Content type is invalid.'),
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
        if (recommendation.status === 'accepted') {
          recommendation.status = 'in_progress';
          await recommendation.save();
        }
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
