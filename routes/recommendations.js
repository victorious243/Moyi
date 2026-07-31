const express = require('express');
const asyncHandler = require('express-async-handler');
const { body, param } = require('express-validator');
const Recommendation = require('../models/Recommendation');
const Project = require('../models/Project');
const AppError = require('../utils/appError');
const handleValidation = require('../utils/validate');
const { requireAuth } = require('../middleware/auth');
const {
  EXECUTION_ASSET_TYPES
} = require('../services/contentDraftService');
const { queueContentPipeline } = require('../services/projectTaskService');
const {
  ensureContentDraftAllowed
} = require('../services/usageService');
const { canManageProjectRole, projectAccessRole } = require('../services/projectAccessService');

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

    const project = await Project.findById(recommendation.projectId);
    if (!project) return next(new AppError('Recommendation not found.', 404));
    const role = await projectAccessRole({ project, userId: req.user._id });
    if (!canManageProjectRole(role)) return next(new AppError('You do not have permission to change this recommendation.', 403));

    recommendation.status = req.body.status;
    await recommendation.save();

    const statusMessages = {
      pending: 'Recommendation moved back to the active queue.',
      accepted: 'Recommendation accepted.',
      rejected: 'Recommendation rejected and removed from the active queue.',
      in_progress: 'Recommendation marked as in progress.',
      done: 'Recommendation completed and removed from the active queue.'
    };
    const view = req.body.status === 'rejected'
      ? 'active'
      : (req.body.status === 'done' ? 'active' : '');
    const query = new URLSearchParams({
      success: statusMessages[req.body.status],
      ...(view ? { view } : {})
    });

    res.redirect(`/projects/${project._id}/recommendations?${query.toString()}`);
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

    const project = await Project.findById(recommendation.projectId);
    if (!project) return next(new AppError('Recommendation not found.', 404));
    const role = await projectAccessRole({ project, userId: req.user._id });
    if (!canManageProjectRole(role)) return next(new AppError('You do not have permission to generate content for this recommendation.', 403));

    try {
      await ensureContentDraftAllowed(req.user);
      const job = await queueContentPipeline({
        projectId: project._id,
        userId: req.user._id,
        recommendationId: recommendation._id,
        requestedType: req.body.type || '',
        keyword: req.body.keyword || ''
      });
      res.redirect(`/projects/${project._id}/content?job=${job._id}`);
    } catch (error) {
      if (error.statusCode) return next(new AppError(error.message, error.statusCode));
      return next(error);
    }
  })
);

module.exports = router;
