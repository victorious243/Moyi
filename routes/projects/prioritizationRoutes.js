const asyncHandler = require('express-async-handler');
const { param } = require('express-validator');

function registerPrioritizationRoutes(router, context, services = {}) {
  const {
    ensureAiReportAllowed,
    findJobForProject,
    findLatestJob,
    pipelineAssetOptions,
    queueStrategyPlan,
    upgradeRedirect
  } = services;

  router.post('/:id/ai-report', [param('id').isMongoId(), context.handleValidation], context.loadProject, asyncHandler(async (req, res) => {
    let plan;
    try {
      plan = await ensureAiReportAllowed(req.user);
    } catch (error) {
      return res.redirect(upgradeRedirect(req.project._id, error.message));
    }

    try {
      const job = await queueStrategyPlan({
        projectId: req.project._id,
        userId: req.user._id,
        recommendationLimit: plan.key === 'free' ? 3 : Infinity
      });

      if (job.status === 'completed' && job.result && job.result.resourcePath) {
        return res.redirect(job.result.resourcePath);
      }

      res.redirect(`/projects/${req.project._id}/ai-report/latest?job=${job._id}&queued=1`);
    } catch (error) {
      if (error.statusCode === 422) {
        return res.redirect(`/projects/${req.project._id}?aiError=${encodeURIComponent(error.message)}`);
      }

      res.redirect(`/projects/${req.project._id}/ai-report/latest?aiError=${encodeURIComponent(error.message)}`);
    }
  }));

  router.get('/:id/ai-report/latest', [param('id').isMongoId(), context.handleValidation], context.loadProject, asyncHandler(async (req, res) => {
    const activeJob = req.query.job
      ? await findJobForProject({ jobId: req.query.job, projectId: req.project._id, userId: req.user._id })
      : await findLatestJob({ projectId: req.project._id, userId: req.user._id, type: 'ai_report' });
    const report = await context.Report.findOne({ projectId: req.project._id }).sort({ createdAt: -1 });
    const recommendations = report
      ? await context.Recommendation.find({ projectId: req.project._id, auditId: report.auditId }).sort({ priority: 1, createdAt: -1 })
      : [];

    res.render('projects/ai-report', {
      title: `${req.project.name} AI CMO Plan`,
      report,
      recommendations,
      aiError: req.query.aiError || '',
      job: activeJob,
      queuedMessage: activeJob && (activeJob.status === 'queued' || activeJob.status === 'running')
        ? 'AI CMO plan generation is running in the background.'
        : ''
    });
  }));

  router.get('/:id/recommendations', [param('id').isMongoId(), context.handleValidation], context.loadProject, asyncHandler(async (req, res) => {
    const allowedViews = new Set(['active', 'rejected', 'done', 'all']);
    const currentView = allowedViews.has(req.query.view) ? req.query.view : 'active';
    const allRecommendations = await context.Recommendation.find({ projectId: req.project._id })
      .sort({ createdAt: -1, priority: -1 })
      .populate('auditId', 'completedAt createdAt pagesScanned');
    const recommendations = allRecommendations.filter((recommendation) => {
      if (currentView === 'all') return true;
      if (currentView === 'rejected') return recommendation.status === 'rejected';
      if (currentView === 'done') return recommendation.status === 'done';
      return !['rejected', 'done'].includes(recommendation.status);
    });
    const recommendationCounts = allRecommendations.reduce((counts, recommendation) => {
      counts.all += 1;
      if (recommendation.status === 'rejected') counts.rejected += 1;
      else if (recommendation.status === 'done') counts.done += 1;
      else counts.active += 1;
      return counts;
    }, { active: 0, rejected: 0, done: 0, all: 0 });

    res.render('projects/recommendations', {
      title: `${req.project.name} recommendations`,
      currentView,
      recommendationCounts,
      successMessage: req.query.success || '',
      recommendations: recommendations.map((recommendation) => ({
        ...recommendation.toObject(),
        assetOptions: pipelineAssetOptions(recommendation)
      }))
    });
  }));
}

module.exports = {
  registerPrioritizationRoutes
};
