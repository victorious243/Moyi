const asyncHandler = require('express-async-handler');
const { param } = require('express-validator');
const crypto = require('crypto');
const { buildWorkspaceSummary } = require('../../services/projectWorkspaceService');
const { auditTelemetry } = require('../../services/telemetryAuditor');

function registerProjectCollectionRoutes(router, context, services = {}) {
  const { ensureProjectLimit } = services;

  router.get('/', asyncHandler(async (req, res) => {
    const projects = await context.Project.find({ owner: req.user._id }).sort({ updatedAt: -1 });
    res.render('projects/index', { title: 'Projects', projects, limitMessage: req.query.limitMessage || '' });
  }));

  router.get('/new', (req, res) => {
    res.render('projects/new', { title: 'New project', project: null });
  });

  router.post('/', context.projectValidation, asyncHandler(async (req, res) => {
    try {
      await ensureProjectLimit(req.user);
    } catch (error) {
      return res.redirect(`/projects?limitMessage=${encodeURIComponent(error.message)}`);
    }

    const project = await context.Project.create(context.projectPayload(req));
    res.redirect(`/projects/${project._id}`);
  }));
}

function registerProjectDetailRoutes(router, context) {
  router.get(
    '/:id/jobs/:jobId',
    [param('id').isMongoId(), param('jobId').isMongoId(), context.handleValidation],
    context.loadProject,
    asyncHandler(async (req, res, next) => {
      const job = await context.ProjectJob.findOne({
        _id: req.params.jobId,
        projectId: req.project._id,
        userId: req.user._id
      }).lean();

      if (!job) return next(new context.AppError('Job not found.', 404));

      res.json({
        job: {
          ...job,
          redirectTo: job.status === 'completed' && job.result && job.result.resourcePath
            ? job.result.resourcePath
            : '',
          result: job.result || {}
        }
      });
    })
  );

  router.get('/:id', [param('id').isMongoId(), context.handleValidation], context.loadProject, asyncHandler(async (req, res) => {
    const [
      latestScan,
      recentScans,
      latestReport,
      connectedProperty,
      recentCmoReports,
      competitorCount,
      wordpressIntegration,
      latestCompetitorInsights,
      recommendations,
      drafts,
      conversionGoalCount
    ] = await Promise.all([
      context.Scan.findOne({ projectId: req.project._id }).sort({ createdAt: -1 }),
      context.Scan.find({ projectId: req.project._id }).sort({ createdAt: -1 }).limit(5),
      context.Report.findOne({ projectId: req.project._id }).sort({ createdAt: -1 }),
      context.ProjectSearchProperty.findOne({ projectId: req.project._id, userId: req.user._id }),
      context.CmoReport.find({ projectId: req.project._id, userId: req.user._id }).sort({ createdAt: -1 }).limit(3),
      context.Competitor.countDocuments({ projectId: req.project._id, userId: req.user._id }),
      context.WordPressIntegration.findOne({ projectId: req.project._id, userId: req.user._id }),
      context.CompetitorInsight.find({ projectId: req.project._id }).sort({ priority: 1, createdAt: -1 }).limit(4),
      context.Recommendation.find({ projectId: req.project._id }).sort({ status: 1, priority: 1, createdAt: -1 }).limit(12),
      context.ContentDraft.find({ projectId: req.project._id }).sort({ updatedAt: -1 }).limit(12),
      context.ConversionGoal.countDocuments({ projectId: req.project._id })
    ]);
    const telemetry = await auditTelemetry(req.project);
    const latestCompletedScan = recentScans.find((scan) => scan.status === 'completed') || (latestScan && latestScan.status === 'completed' ? latestScan : null);
    const issues = latestCompletedScan
      ? await context.SeoIssue.find({ project: req.project._id, scan: latestCompletedScan._id }).sort({ createdAt: -1 }).limit(12)
      : [];
    const workspace = buildWorkspaceSummary({
      project: req.project,
      latestScan: latestCompletedScan || latestScan,
      latestReport,
      recommendations,
      drafts,
      issues,
      connectedProperty,
      telemetry,
      competitorCount,
      conversionGoalCount,
      recentCmoReports
    });

    res.render('projects/show', {
      title: req.project.name,
      latestScan,
      recentScans,
      latestReport,
      connectedProperty,
      recentCmoReports,
      competitorCount,
      latestCompetitorInsights,
      wordpressIntegration,
      telemetry,
      workspace,
      recommendations,
      drafts,
      conversionGoalCount,
      aiError: req.query.aiError || '',
      limitMessage: req.query.limitMessage || ''
    });
  }));

  router.get('/:id/edit', [param('id').isMongoId(), context.handleValidation], context.loadProject, asyncHandler(async (req, res) => {
    if (!req.project.webhookSigningSecret) {
      req.project.webhookSigningSecret = crypto.randomBytes(32).toString('hex');
      await req.project.save();
    }
    res.render('projects/edit', { title: `Edit ${req.project.name}` });
  }));

  router.post('/:id', [param('id').isMongoId(), ...context.projectValidation], context.loadProject, asyncHandler(async (req, res) => {
    Object.assign(req.project, context.projectPayload(req));
    req.project.owner = req.user._id;
    await req.project.save();
    res.redirect(`/projects/${req.project._id}`);
  }));

  router.post('/:id/delete', [param('id').isMongoId(), context.handleValidation], context.loadProject, asyncHandler(async (req, res) => {
    await context.deleteProjectOwnedData({ project: req.project, userId: req.user._id });
    res.redirect('/projects');
  }));
}

module.exports = {
  registerProjectCollectionRoutes,
  registerProjectDetailRoutes
};
