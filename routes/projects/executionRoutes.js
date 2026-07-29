const asyncHandler = require('express-async-handler');
const { param } = require('express-validator');

function registerExecutionRoutes(router, context) {
  router.get('/:id/content', [param('id').isMongoId(), context.handleValidation], context.loadProject, asyncHandler(async (req, res) => {
    const drafts = await context.ContentDraft.find({ projectId: req.project._id }).sort({ updatedAt: -1 });
    res.render('projects/content', {
      title: `${req.project.name} content`,
      drafts
    });
  }));

  router.get('/:id/calendar', [param('id').isMongoId(), context.handleValidation], context.loadProject, asyncHandler(async (req, res) => {
    const [campaigns, socialDrafts] = await Promise.all([
      context.Campaign.find({ projectId: req.project._id }).sort({ startDate: 1 }),
      context.SocialDraft.find({ projectId: req.project._id }).sort({ scheduledFor: 1 }).populate('campaignId')
    ]);

    res.render('projects/calendar', {
      title: `${req.project.name} calendar`,
      campaigns,
      socialDrafts,
      successMessage: req.query.success || ''
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
