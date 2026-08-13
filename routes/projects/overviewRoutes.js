const asyncHandler = require('express-async-handler');
const { param } = require('express-validator');
const crypto = require('crypto');
const multer = require('multer');
const { buildWorkspaceSummary } = require('../../services/projectWorkspaceService');
const { auditTelemetry } = require('../../services/telemetryAuditor');
const { findAccessibleProjects } = require('../../services/projectAccessService');

const logoUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024, files: 1 }
});

function projectLogoErrorRedirect(req, res, fallback = '/projects/new') {
  const message = 'Project logos must be transparent PNG files no larger than 2 MB.';
  if (req.params && req.params.id) {
    return res.redirect(`/projects/${req.params.id}/edit?logoError=${encodeURIComponent(message)}`);
  }
  return res.redirect(`${fallback}?logoError=${encodeURIComponent(message)}`);
}

function uploadSingleLogo(req, res, next) {
  logoUpload.single('brandLogo')(req, res, (error) => {
    if (!error) return next();
    return projectLogoErrorRedirect(req, res);
  });
}

function registerProjectCollectionRoutes(router, context, services = {}) {
  const { ensureProjectLimit } = services;

  router.get('/', asyncHandler(async (req, res) => {
    const projects = await findAccessibleProjects(req.user._id, { sort: { updatedAt: -1 } });
    res.render('projects/index', { title: 'Projects', projects, limitMessage: req.query.limitMessage || '' });
  }));

  router.get('/new', (req, res) => {
    res.render('projects/new', {
      title: 'New project',
      project: null,
      logoError: req.query.logoError || ''
    });
  });

  router.post('/', uploadSingleLogo, context.projectValidation, asyncHandler(async (req, res) => {
    try {
      await ensureProjectLimit(req.user);
    } catch (error) {
      return res.redirect(`/projects?limitMessage=${encodeURIComponent(error.message)}`);
    }

    if (!req.file) {
      return res.redirect(`/projects/new?logoError=${encodeURIComponent('Upload a transparent PNG logo before creating this project.')}`);
    }

    const project = await context.Project.create({
      owner: req.user._id,
      ...context.projectPayload(req)
    });
    if (req.file) {
      try {
        await context.saveProjectLogo({ project, file: req.file });
      } catch (error) {
        await context.Project.deleteOne({ _id: project._id, owner: req.user._id });
        return res.redirect(`/projects/new?logoError=${encodeURIComponent(error.message)}`);
      }
    }
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

  router.post(
    '/:id/jobs/:jobId/retry',
    [param('id').isMongoId(), param('jobId').isMongoId(), context.handleValidation],
    context.loadProject,
    asyncHandler(async (req, res) => {
      const job = await context.retryFailedJob({
        jobId: req.params.jobId,
        projectId: req.project._id,
        userId: req.user._id
      });
      await context.recordAuditEvent({
        user: req.user,
        projectId: req.project._id,
        eventType: 'project_job_retried',
        metadata: { previousJobId: req.params.jobId, newJobId: job._id, type: job.type },
        req
      });
      res.redirect(`/projects/${req.project._id}?message=${encodeURIComponent('Background job retry queued.')}`);
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
    if (!res.locals.canManageProject) return res.redirect(`/projects/${req.project._id}`);
    if (!req.project.webhookSigningSecret) {
      req.project.webhookSigningSecret = crypto.randomBytes(32).toString('hex');
      await req.project.save();
    }
    res.render('projects/edit', {
      title: `Edit ${req.project.name}`,
      logoError: req.query.logoError || '',
      logoSuccess: req.query.logoSuccess || ''
    });
  }));

  router.get(
    '/:id/logo',
    [param('id').isMongoId(), context.handleValidation],
    context.loadProject,
    asyncHandler(async (req, res, next) => {
      if (!context.hasProjectLogo(req.project)) return next(new context.AppError('Project logo not found.', 404));
      res.set('Content-Type', 'image/png');
      res.set('Content-Length', String(req.project.brandLogo.byteLength || 0));
      res.set('Cache-Control', 'private, max-age=3600');
      const stream = context.openProjectLogoStream(req.project.brandLogo.storageKey);
      stream.on('error', next);
      stream.pipe(res);
    })
  );

  router.get('/:id/team', [param('id').isMongoId(), context.handleValidation], context.loadProject, asyncHandler(async (req, res) => {
    const members = await context.ProjectMember.find({ projectId: req.project._id })
      .sort({ createdAt: -1 })
      .populate('userId', 'name email')
      .populate('invitedBy', 'name email');

    res.render('projects/team', {
      title: `${req.project.name} team`,
      members,
      teamError: req.query.error || '',
      teamMessage: req.query.message || ''
    });
  }));

  router.post('/:id/team', [param('id').isMongoId(), ...context.projectMemberValidation], context.loadProject, asyncHandler(async (req, res) => {
    const targetUser = await context.User.findOne({ email: req.body.email });
    if (!targetUser) {
      return res.redirect(`/projects/${req.project._id}/team?error=${encodeURIComponent('That user does not have a Moyi account yet.')}`);
    }

    if (String(targetUser._id) === String(req.project.owner)) {
      return res.redirect(`/projects/${req.project._id}/team?error=${encodeURIComponent('The project owner already has full access.')}`);
    }

    const membership = await context.ProjectMember.findOneAndUpdate(
      { projectId: req.project._id, userId: targetUser._id },
      {
        projectId: req.project._id,
        userId: targetUser._id,
        role: req.body.role,
        invitedBy: req.user._id,
        joinedAt: new Date()
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    await context.recordAuditEvent({
      user: req.user,
      projectId: req.project._id,
      eventType: 'project_member_upserted',
      metadata: { memberUserId: targetUser._id, memberEmail: targetUser.email, role: membership.role },
      req
    });
    res.redirect(`/projects/${req.project._id}/team?message=${encodeURIComponent('Team access updated.')}`);
  }));

  router.post('/:id/team/:memberId/remove', [param('id').isMongoId(), param('memberId').isMongoId(), context.handleValidation], context.loadProject, asyncHandler(async (req, res) => {
    const membership = await context.ProjectMember.findOneAndDelete({
      _id: req.params.memberId,
      projectId: req.project._id
    }).populate('userId', 'email');

    if (membership) {
      await context.recordAuditEvent({
        user: req.user,
        projectId: req.project._id,
        eventType: 'project_member_removed',
        metadata: {
          memberUserId: membership.userId && membership.userId._id,
          memberEmail: membership.userId && membership.userId.email,
          role: membership.role
        },
        req
      });
    }

    res.redirect(`/projects/${req.project._id}/team?message=${encodeURIComponent('Team access removed.')}`);
  }));

  router.post('/:id', [param('id').isMongoId(), context.handleValidation], context.loadProject, uploadSingleLogo, context.projectValidation, asyncHandler(async (req, res) => {
    Object.assign(req.project, context.projectPayload(req));
    await req.project.save();
    if (req.file) {
      try {
        await context.saveProjectLogo({ project: req.project, file: req.file });
      } catch (error) {
        return res.redirect(`/projects/${req.project._id}/edit?logoError=${encodeURIComponent(error.message)}`);
      }
    }
    res.redirect(`/projects/${req.project._id}`);
  }));

  router.post(
    '/:id/logo/remove',
    [param('id').isMongoId(), context.handleValidation],
    context.loadProject,
    asyncHandler(async (req, res) => {
      await context.removeProjectLogo(req.project);
      res.redirect(`/projects/${req.project._id}/edit?logoSuccess=${encodeURIComponent('Brand logo removed.')}`);
    })
  );

  router.post('/:id/delete', [param('id').isMongoId(), context.handleValidation], context.loadProject, asyncHandler(async (req, res) => {
    if (String(req.project.owner) !== String(req.user._id)) {
      throw new context.AppError('Only the project owner can permanently delete this workspace.', 403);
    }
    await context.recordAuditEvent({
      user: req.user,
      projectId: req.project._id,
      eventType: 'project_deleted',
      severity: 'critical',
      metadata: { projectName: req.project.name, websiteUrl: req.project.websiteUrl },
      req
    });
    await context.deleteProjectOwnedData({ project: req.project, userId: req.user._id });
    res.redirect('/projects');
  }));
}

module.exports = {
  registerProjectCollectionRoutes,
  registerProjectDetailRoutes
};
