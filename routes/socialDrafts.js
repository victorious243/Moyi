const express = require('express');
const asyncHandler = require('express-async-handler');
const { param } = require('express-validator');
const Project = require('../models/Project');
const SocialDraft = require('../models/SocialDraft');
const AppError = require('../utils/appError');
const handleValidation = require('../utils/validate');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

router.use(requireAuth);

async function loadSocialDraft(req, res, next) {
  try {
    const socialDraft = await SocialDraft.findById(req.params.id);
    if (!socialDraft) return next(new AppError('Social draft not found.', 404));

    const project = await Project.findOne({ _id: socialDraft.projectId, owner: req.user._id });
    if (!project) return next(new AppError('Social draft not found.', 404));

    req.socialDraft = socialDraft;
    req.project = project;
    next();
  } catch (error) {
    next(error);
  }
}

router.post('/:id/approve', [param('id').isMongoId(), handleValidation], loadSocialDraft, asyncHandler(async (req, res) => {
  req.socialDraft.status = 'approved';
  await req.socialDraft.save();
  res.redirect(`/projects/${req.project._id}/calendar`);
}));

router.post('/:id/mark-published', [param('id').isMongoId(), handleValidation], loadSocialDraft, asyncHandler(async (req, res) => {
  req.socialDraft.status = 'published_manually';
  await req.socialDraft.save();
  res.redirect(`/projects/${req.project._id}/calendar`);
}));

module.exports = router;
