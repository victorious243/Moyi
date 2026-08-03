const asyncHandler = require('express-async-handler');
const { body, param } = require('express-validator');

function registerExecutionRoutes(router, context, services = {}) {
  const {
    createCampaignContentPlan,
    ensureAiOperationAllowed,
    findJobForProject,
    recordAiOperation,
    recordAiOperationFailure
  } = services;
  router.get('/:id/content', [param('id').isMongoId(), context.handleValidation], context.loadProject, asyncHandler(async (req, res) => {
    const [drafts, socialDrafts, campaigns, job] = await Promise.all([
      context.ContentDraft.find({ projectId: req.project._id }).sort({ updatedAt: -1 }),
      context.SocialDraft.find({ projectId: req.project._id }).sort({ scheduledFor: -1 }).limit(12).populate('campaignId'),
      context.Campaign.find({ projectId: req.project._id }).sort({ updatedAt: -1 }).limit(8),
      req.query.job && findJobForProject
        ? findJobForProject({ jobId: req.query.job, projectId: req.project._id, userId: req.user._id })
        : null
    ]);
    const recommendationId = String(req.query.recommendation || '');
    const pipelineDrafts = recommendationId
      ? drafts.filter((draft) => String(draft.recommendationId) === recommendationId)
      : [];
    res.render('projects/content', {
      title: `${req.project.name} content`,
      drafts,
      socialDrafts,
      campaigns,
      job,
      pipelineDrafts,
      successMessage: req.query.success || '',
      errorMessage: req.query.error || '',
      today: new Date().toISOString().slice(0, 10)
    });
  }));

  router.post('/:id/content-plan', [
    param('id').isMongoId(),
    body('cadence').isIn(['single', 'weekly', 'monthly']).withMessage('Choose a valid plan length.'),
    body('name').trim().notEmpty().withMessage('Campaign name is required.').isLength({ max: 160 }),
    body('goal').trim().notEmpty().withMessage('Describe what this campaign should achieve.').isLength({ max: 500 }),
    body('channel').isIn(['linkedin', 'facebook', 'x', 'instagram', 'email', 'multi']).withMessage('Choose a valid channel.'),
    body('startDate').isISO8601().withMessage('Choose a valid start date.'),
    context.handleValidation
  ], context.loadProject, asyncHandler(async (req, res) => {
    await ensureAiOperationAllowed(req.user);
    const cadenceDays = { single: 0, weekly: 6, monthly: 29 };
    const startDate = new Date(`${req.body.startDate}T09:00:00`);
    const endDate = new Date(startDate);
    endDate.setDate(endDate.getDate() + cadenceDays[req.body.cadence]);

    const campaign = await context.Campaign.create({
      projectId: req.project._id,
      name: req.body.name,
      goal: req.body.goal,
      channel: req.body.channel,
      cadence: req.body.cadence,
      startDate,
      endDate,
      status: 'planned'
    });

    try {
      const drafts = await createCampaignContentPlan({
        project: req.project,
        campaign,
        cadence: req.body.cadence
      });
      await recordAiOperation(req.user._id, 1);
      return res.redirect(`/projects/${req.project._id}/calendar?success=${encodeURIComponent(`${drafts.length} campaign drafts created and scheduled.`)}`);
    } catch (error) {
      await context.Campaign.deleteOne({ _id: campaign._id, projectId: req.project._id });
      await recordAiOperationFailure(req.user._id).catch(() => null);
      return res.redirect(`/projects/${req.project._id}/content?error=${encodeURIComponent(error.message)}`);
    }
  }));

  router.get('/:id/calendar', [param('id').isMongoId(), context.handleValidation], context.loadProject, asyncHandler(async (req, res) => {
    const imageJobQuery = req.query.imageJob && /^[a-f\d]{24}$/i.test(String(req.query.imageJob))
      ? {
          _id: req.query.imageJob,
          projectId: req.project._id,
          userId: req.user._id,
          type: 'content_image_generation',
          status: { $in: ['queued', 'running'] }
        }
      : null;
    const [campaigns, socialDrafts, imageJob] = await Promise.all([
      context.Campaign.find({ projectId: req.project._id }).sort({ startDate: 1 }),
      context.SocialDraft.find({ projectId: req.project._id }).sort({ scheduledFor: 1 }).populate('campaignId'),
      imageJobQuery ? context.ProjectJob.findOne(imageJobQuery) : null
    ]);
    const socialDraftIds = socialDrafts.map((draft) => draft._id);
    const socialImages = socialDraftIds.length
      ? await context.ContentImage.find({
        projectId: req.project._id,
        draftId: { $in: socialDraftIds }
      }).sort({ status: 1, createdAt: -1 })
      : [];
    const socialDraftImagesByDraftId = socialImages.reduce((grouped, image) => {
      const key = String(image.draftId);
      if (!grouped[key]) grouped[key] = [];
      grouped[key].push(image);
      return grouped;
    }, {});

    res.render('projects/calendar', {
      title: `${req.project.name} calendar`,
      campaigns,
      socialDrafts,
      socialDraftImagesByDraftId,
      successMessage: req.query.success || '',
      errorMessage: req.query.error || '',
      imageJob
    });
  }));

  router.get('/:id/campaigns', [param('id').isMongoId(), context.handleValidation], context.loadProject, asyncHandler(async (req, res) => {
    const [campaigns, socialDrafts] = await Promise.all([
      context.Campaign.find({ projectId: req.project._id }).sort({ createdAt: -1 }),
      context.SocialDraft.find({ projectId: req.project._id }).sort({ scheduledFor: 1 })
    ]);

    res.render('projects/campaigns', {
      title: `${req.project.name} campaigns`,
      campaigns,
      socialDrafts,
      successMessage: req.query.success || ''
    });
  }));

  router.post('/:id/campaigns', [param('id').isMongoId(), ...context.campaignValidation], context.loadProject, asyncHandler(async (req, res) => {
    const startDate = new Date(req.body.startDate);
    const endDate = new Date(req.body.endDate);
    if (endDate < startDate) {
      endDate.setTime(startDate.getTime());
    }

    await context.Campaign.create({
      projectId: req.project._id,
      name: req.body.name,
      goal: req.body.goal || '',
      channel: req.body.channel,
      startDate,
      endDate,
      status: req.body.status || 'planned',
      dailySpendLimit: Number(req.body.dailySpendLimit || 0),
      monthlySpendLimit: Number(req.body.monthlySpendLimit || 0)
    });

    res.redirect(`/projects/${req.project._id}/campaigns?success=${encodeURIComponent('Campaign created.')}`);
  }));
}

module.exports = {
  registerExecutionRoutes
};
