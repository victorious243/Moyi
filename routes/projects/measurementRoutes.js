const asyncHandler = require('express-async-handler');
const { param } = require('express-validator');
const crypto = require('crypto');
const { buildAnalyticsDashboard } = require('../../services/trackingService');
const { auditTelemetry } = require('../../services/telemetryAuditor');
const { buildAttributionDashboard } = require('../../services/attributionService');
const {
  buildSocialPerformanceDashboard,
  destinationProjectFilter,
  normalizeAnalyticsDays,
  socialPerformanceApiPayload
} = require('../../services/socialAnalyticsService');
const { collectMetricsForJob } = require('../../services/engagementMetricsService');
const {
  buildPerformanceDashboard,
  calculateGscOpportunities,
  getIntegration,
  listSearchConsoleSites
} = require('../../services/searchConsoleService');

function registerMeasurementRoutes(router, context, services = {}) {
  const {
    buildAttributionReadiness,
    createSearchConsoleOpportunityDraft,
    ensureContentDraftAllowed,
    ensureFeature,
    findJobForProject,
    findLatestJob,
    findLatestJobs,
    queueMeasurementReport,
    queueSearchConsoleSync,
    upgradeRedirect
  } = services;

  router.get('/:id/social-performance', [param('id').isMongoId(), context.handleValidation], context.loadProject, asyncHandler(async (req, res) => {
    const days = normalizeAnalyticsDays(req.query.days);
    const dashboard = await buildSocialPerformanceDashboard({ projectId: req.project._id, days });
    res.render('projects/social-performance', {
      title: `${req.project.name} social performance`,
      dashboard,
      successMessage: req.query.success || '',
      errorMessage: req.query.error || ''
    });
  }));

  router.get('/:id/social-performance/data', [param('id').isMongoId(), context.handleValidation], context.loadProject, asyncHandler(async (req, res) => {
    const days = normalizeAnalyticsDays(req.query.days);
    const dashboard = await buildSocialPerformanceDashboard({ projectId: req.project._id, days });
    res.json(socialPerformanceApiPayload(dashboard));
  }));

  router.post('/:id/social-performance/jobs/:jobId/metrics', [
    param('id').isMongoId(),
    param('jobId').isMongoId(),
    context.handleValidation
  ], context.loadProject, asyncHandler(async (req, res) => {
    const days = normalizeAnalyticsDays(req.body.days || req.query.days);
    const redirectBase = `/projects/${req.project._id}/social-performance?days=${days}`;
    const job = await context.PublishJob.findOne({
      _id: req.params.jobId,
      ...destinationProjectFilter(req.project._id),
      status: 'published'
    }).select('_id').lean();

    if (!job) {
      return res.redirect(`${redirectBase}&error=${encodeURIComponent('Metrics can only be refreshed for a published post in this project.')}`);
    }

    const result = await collectMetricsForJob(job._id);
    if (!result.success) {
      return res.redirect(`${redirectBase}&error=${encodeURIComponent(result.error || 'Metrics refresh failed.')}`);
    }

    res.redirect(`${redirectBase}&success=${encodeURIComponent(result.skipped ? 'Metrics refresh is already running for this post.' : 'Metrics refreshed for this post.')}`);
  }));

  router.get('/:id/search-console/connect', [param('id').isMongoId(), context.handleValidation], context.loadProject, asyncHandler(async (req, res) => {
    const [integration, connectedProperty] = await Promise.all([
      getIntegration(req.user._id),
      context.ProjectSearchProperty.findOne({ projectId: req.project._id, userId: req.user._id })
    ]);

    let properties = [];
    let errorMessage = req.query.error || '';

    if (integration) {
      try {
        properties = await listSearchConsoleSites(req.user._id);
      } catch (error) {
        errorMessage = error.message;
      }
    }

    res.render('projects/search-console/connect', {
      title: `${req.project.name} Search Console`,
      integration,
      connectedProperty,
      properties,
      errorMessage,
      successMessage: req.query.connected ? 'Search Console property connected.' : ''
    });
  }));

  router.post('/:id/search-console/property', [param('id').isMongoId(), context.handleValidation], context.loadProject, asyncHandler(async (req, res) => {
    try {
      ensureFeature(req.user, 'searchConsole', 'Search Console sync is available on Pro and Agency plans.', 'pro');
    } catch (error) {
      return res.redirect(upgradeRedirect(req.project._id, error.message));
    }

    const { siteUrl, permissionLevel } = context.parsePropertySelection(req.body.property);

    if (!siteUrl) {
      return res.redirect(`/projects/${req.project._id}/search-console/connect?error=${encodeURIComponent('Select a Search Console property.')}`);
    }

    const integration = await getIntegration(req.user._id);
    if (!integration) {
      return res.redirect(`/projects/${req.project._id}/search-console/connect?error=${encodeURIComponent('Connect Google Search Console first.')}`);
    }

    let properties = [];
    try {
      properties = await listSearchConsoleSites(req.user._id);
    } catch (error) {
      return res.redirect(`/projects/${req.project._id}/search-console/connect?error=${encodeURIComponent(error.message)}`);
    }

    const verifiedProperty = properties.find((property) => property.siteUrl === siteUrl);
    if (!verifiedProperty) {
      return res.redirect(`/projects/${req.project._id}/search-console/connect?error=${encodeURIComponent('That property was not found in your verified Search Console sites.')}`);
    }

    await context.ProjectSearchProperty.findOneAndUpdate(
      { projectId: req.project._id, userId: req.user._id },
      {
        projectId: req.project._id,
        userId: req.user._id,
        siteUrl,
        permissionLevel: verifiedProperty.permissionLevel || permissionLevel,
        connectedAt: new Date()
      },
      { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true }
    );

    res.redirect(`/projects/${req.project._id}/search-console/performance?connected=1`);
  }));

  router.post('/:id/search-console/sync', [param('id').isMongoId(), context.handleValidation], context.loadProject, asyncHandler(async (req, res) => {
    try {
      ensureFeature(req.user, 'searchConsole', 'Search Console sync is available on Pro and Agency plans.', 'pro');
    } catch (error) {
      return res.redirect(`/projects/${req.project._id}/search-console/performance?error=${encodeURIComponent(error.message)}`);
    }

    const days = context.normalizeDays(req.body.days);

    try {
      const job = await queueSearchConsoleSync({
        projectId: req.project._id,
        userId: req.user._id,
        days
      });

      if (job.status === 'completed') {
        return res.redirect(`/projects/${req.project._id}/search-console/performance?days=${days}&synced=${job.result.rowsSynced || 0}`);
      }

      res.redirect(`/projects/${req.project._id}/search-console/performance?days=${days}&syncJob=${job._id}&queued=1`);
    } catch (error) {
      res.redirect(`/projects/${req.project._id}/search-console/performance?days=${days}&error=${encodeURIComponent(error.message)}`);
    }
  }));

  router.get('/:id/search-console/performance', [param('id').isMongoId(), context.handleValidation], context.loadProject, asyncHandler(async (req, res) => {
    const days = context.normalizeDays(req.query.days);
    const [integration, connectedProperty] = await Promise.all([
      getIntegration(req.user._id),
      context.ProjectSearchProperty.findOne({ projectId: req.project._id, userId: req.user._id })
    ]);
    const syncJob = req.query.syncJob
      ? await findJobForProject({ jobId: req.query.syncJob, projectId: req.project._id, userId: req.user._id })
      : await findLatestJob({ projectId: req.project._id, userId: req.user._id, type: 'search_console_sync' });
    const [dashboard, opportunities] = connectedProperty
      ? await Promise.all([
        buildPerformanceDashboard({ projectId: req.project._id, userId: req.user._id, days }),
        calculateGscOpportunities(req.project._id)
      ])
      : [null, null];

    res.render('projects/search-console/performance', {
      title: `${req.project.name} Search Performance`,
      days,
      integration,
      connectedProperty,
      dashboard,
      opportunities,
      errorMessage: req.query.error || '',
      successMessage: req.query.synced ? `${req.query.synced} Search Console rows synced.` : (req.query.connected ? 'Search Console property connected.' : ''),
      syncJob,
      queuedMessage: syncJob && (syncJob.status === 'queued' || syncJob.status === 'running')
        ? 'Search Console sync was queued and is running in the background.'
        : ''
    });
  }));

  router.post('/:id/search-console/opportunities/draft', [param('id').isMongoId(), ...context.gscOpportunityDraftValidation], context.loadProject, asyncHandler(async (req, res, next) => {
    try {
      await ensureContentDraftAllowed(req.user);
    } catch (error) {
      return res.redirect(upgradeRedirect(req.project._id, error.message));
    }

    try {
      const result = await createSearchConsoleOpportunityDraft({
        project: req.project,
        userId: req.user._id,
        opportunityType: req.body.opportunityType,
        query: req.body.query.trim(),
        pageUrl: req.body.page
      });
      return res.redirect(result.firstDraft ? `/content/${result.firstDraft._id}` : `/projects/${req.project._id}/content`);
    } catch (error) {
      if (error.statusCode === 422) {
        return res.redirect(`/projects/${req.project._id}/search-console/performance?error=${encodeURIComponent(error.message)}`);
      }
      return next(error);
    }
  }));

  router.get('/:id/tracking/setup', [param('id').isMongoId(), context.handleValidation], context.loadProject, asyncHandler(async (req, res) => {
    if (!req.project.publicProjectKey) {
      req.project.publicProjectKey = crypto.randomBytes(18).toString('hex');
      await req.project.save();
    }

    const scriptUrl = `${req.protocol}://${req.get('host')}/tracker.js`;
    const snippet = `<script src="${scriptUrl}" data-project="${req.project.publicProjectKey}" async></script>`;
    const goals = await context.ConversionGoal.find({ projectId: req.project._id }).sort({ createdAt: -1 });

    res.render('projects/tracking/setup', {
      title: `${req.project.name} tracking setup`,
      snippet,
      goals,
      successMessage: req.query.success || ''
    });
  }));

  router.get('/:id/analytics', [param('id').isMongoId(), context.handleValidation], context.loadProject, asyncHandler(async (req, res) => {
    const days = [7, 30, 90].includes(Number(req.query.days)) ? Number(req.query.days) : 30;
    const dashboard = await buildAnalyticsDashboard(req.project._id, days);

    res.render('projects/tracking/analytics', {
      title: `${req.project.name} analytics`,
      dashboard
    });
  }));

  router.post('/:id/telemetry/audit', [param('id').isMongoId(), context.handleValidation], context.loadProject, asyncHandler(async (req, res) => {
    const telemetry = await auditTelemetry(req.project);
    req.project.telemetryHealthScore = telemetry.score;
    req.project.telemetryAudit = telemetry;
    await req.project.save();
    res.redirect(`/projects/${req.project._id}?telemetry=${telemetry.score}`);
  }));

  router.get('/:id/attribution', [param('id').isMongoId(), context.handleValidation], context.loadProject, asyncHandler(async (req, res) => {
    const [dashboard, readiness] = await Promise.all([
      buildAttributionDashboard(req.project._id, []),
      buildAttributionReadiness(req.project._id)
    ]);

    res.render('projects/attribution_dashboard', {
      title: `${req.project.name} attribution`,
      dashboard,
      readiness
    });
  }));

  router.post('/:id/conversion-goals', [param('id').isMongoId(), ...context.conversionGoalValidation], context.loadProject, asyncHandler(async (req, res) => {
    await context.ConversionGoal.create({
      projectId: req.project._id,
      name: req.body.name,
      eventName: req.body.eventName,
      urlPattern: req.body.urlPattern || ''
    });

    res.redirect(`/projects/${req.project._id}/tracking/setup?success=${encodeURIComponent('Conversion goal added.')}`);
  }));

  router.post('/:id/reports/weekly', [param('id').isMongoId(), context.handleValidation], context.loadProject, asyncHandler(async (req, res) => {
    try {
      ensureFeature(req.user, 'reports', 'Weekly and monthly reports are available on Starter, Pro, and Agency plans.', 'starter');
    } catch (error) {
      return res.redirect(upgradeRedirect(req.project._id, error.message));
    }

    const job = await queueMeasurementReport({ projectId: req.project._id, userId: req.user._id, type: 'weekly' });
    if (job.status === 'completed' && job.result && job.result.resourceId) {
      return res.redirect(`/projects/${req.project._id}/reports/${job.result.resourceId}`);
    }
    res.redirect(`/projects/${req.project._id}/reports?job=${job._id}&queued=1`);
  }));

  router.post('/:id/reports/monthly', [param('id').isMongoId(), context.handleValidation], context.loadProject, asyncHandler(async (req, res) => {
    try {
      ensureFeature(req.user, 'reports', 'Weekly and monthly reports are available on Starter, Pro, and Agency plans.', 'starter');
    } catch (error) {
      return res.redirect(upgradeRedirect(req.project._id, error.message));
    }

    const job = await queueMeasurementReport({ projectId: req.project._id, userId: req.user._id, type: 'monthly' });
    if (job.status === 'completed' && job.result && job.result.resourceId) {
      return res.redirect(`/projects/${req.project._id}/reports/${job.result.resourceId}`);
    }
    res.redirect(`/projects/${req.project._id}/reports?job=${job._id}&queued=1`);
  }));

  router.get('/:id/reports', [param('id').isMongoId(), context.handleValidation], context.loadProject, asyncHandler(async (req, res) => {
    const requestedJob = req.query.job
      ? await findJobForProject({ jobId: req.query.job, projectId: req.project._id, userId: req.user._id })
      : null;
    const [reports, reportJobs] = await Promise.all([
      context.CmoReport.find({ projectId: req.project._id, userId: req.user._id }).sort({ createdAt: -1 }),
      requestedJob
        ? Promise.resolve({
          measurement_report: requestedJob
        })
        : findLatestJobs({
          projectId: req.project._id,
          userId: req.user._id,
          types: ['measurement_report']
        })
    ]);
    res.render('projects/reports/index', {
      title: `${req.project.name} reports`,
      reports,
      reportJob: reportJobs.measurement_report || null,
      queuedMessage: reportJobs.measurement_report && ['queued', 'running'].includes(reportJobs.measurement_report.status)
        ? 'Report generation was queued and is running in the background.'
        : ''
    });
  }));

  router.get(
    '/:id/reports/:reportId',
    [param('id').isMongoId(), param('reportId').isMongoId(), context.handleValidation],
    context.loadProject,
    asyncHandler(async (req, res, next) => {
      const report = await context.CmoReport.findOne({
        _id: req.params.reportId,
        projectId: req.project._id,
        userId: req.user._id
      });

      if (!report) return next(new context.AppError('Report not found.', 404));

      res.render('projects/reports/show', {
        title: `${req.project.name} ${report.type} report`,
        report
      });
    })
  );
}

module.exports = {
  registerMeasurementRoutes
};
