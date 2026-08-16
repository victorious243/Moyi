const asyncHandler = require('express-async-handler');
const { body, param } = require('express-validator');
const { crawlCompetitor } = require('../../services/competitorCrawlerService');
const {
  discoverCompetitorsForProject
} = require('../../services/competitorDiscoveryService');
const { generateCompetitorInsights } = require('../../services/competitorInsightService');
const { auditTelemetry } = require('../../services/telemetryAuditor');
const { generateScanPdfReport } = require('../../services/scanPdfReportService');

function registerDiscoveryRoutes(router, context, services = {}) {
  const {
    bootstrapDiscoveryProject,
    ensureFeature,
    ensureProjectLimit,
    ensureScanAllowed,
    startProjectScan,
    upgradeRedirect
  } = services;

  router.post('/scan', [
    body('name').optional({ checkFalsy: true }).trim().isLength({ max: 160 }).withMessage('Project name is too long.'),
    body('targetCountry').optional({ checkFalsy: true }).trim().isLength({ max: 80 }).withMessage('Target country is too long.'),
    body('targetCity').optional({ checkFalsy: true }).trim().isLength({ max: 100 }).withMessage('Target city is too long.'),
    body('businessModel')
      .optional({ checkFalsy: true })
      .isIn(['saas', 'ecommerce', 'marketplace', 'agency', 'professional_services', 'local_service', 'retail', 'media', 'nonprofit', 'other'])
      .withMessage('Choose a valid business model.'),
    body('websiteUrl')
      .trim()
      .notEmpty()
      .withMessage('Website URL is required.')
      .custom((value) => {
        try {
          context.normalizeUrl(value);
          return true;
        } catch (error) {
          throw new Error('Website URL must be valid.');
        }
      }),
    context.handleValidation
  ], asyncHandler(async (req, res) => {
    try {
      await ensureProjectLimit(req.user);
    } catch (error) {
      return res.redirect(`/projects?limitMessage=${encodeURIComponent(error.message)}`);
    }

    const { project } = await bootstrapDiscoveryProject({
      userId: req.user._id,
      name: req.body.name || '',
      websiteUrl: req.body.websiteUrl,
      targetCountry: req.body.targetCountry || '',
      targetCity: req.body.targetCity || '',
      businessModel: req.body.businessModel || ''
    });

    res.redirect(`/projects/${project._id}/calibration`);
  }));

  router.get('/:id/calibration', [param('id').isMongoId(), context.handleValidation], context.loadProject, (req, res) => {
    res.render('projects/calibration', {
      title: `${req.project.name} calibration`,
      project: req.project,
      competitorLabel: context.competitorLabel
    });
  });

  router.post('/:id/approve', [
    param('id').isMongoId(),
    body('toneAdjectivesJson').optional({ checkFalsy: true }).isLength({ max: 2000 }).withMessage('Tone adjectives are too long.'),
    body('valuePropsJson').optional({ checkFalsy: true }).isLength({ max: 6000 }).withMessage('Value props are too long.'),
    body('targetPersonasJson').optional({ checkFalsy: true }).isLength({ max: 12000 }).withMessage('Personas are too long.'),
    body('competitorsJson').optional({ checkFalsy: true }).isLength({ max: 12000 }).withMessage('Competitors are too long.'),
    context.handleValidation
  ], context.loadProject, asyncHandler(async (req, res) => {
    const brandProfile = req.project.brand_profile || {};
    brandProfile.toneAdjectives = context.parseJsonField(req.body.toneAdjectivesJson, brandProfile.toneAdjectives || []);
    brandProfile.valueProps = context.parseJsonField(req.body.valuePropsJson, brandProfile.valueProps || []);
    brandProfile.targetPersonas = context.parseJsonField(req.body.targetPersonasJson, brandProfile.targetPersonas || []);
    brandProfile.personas = (brandProfile.targetPersonas || []).map(context.personaSummary).filter(Boolean);

    req.project.brand_profile = brandProfile;
    req.project.brandTone = brandProfile.toneAdjectives.join(', ');
    req.project.mainOffer = brandProfile.valueProps[0] || req.project.mainOffer;
    req.project.targetAudience = brandProfile.personas.join(', ');
    req.project.competitors = context.parseJsonField(req.body.competitorsJson, req.project.competitors || []);
    req.project.status = 'approved';
    const telemetry = await auditTelemetry(req.project);
    req.project.telemetryHealthScore = telemetry.score;
    req.project.telemetryAudit = telemetry;
    await req.project.save();

    res.redirect(`/projects/${req.project._id}?approved=1`);
  }));

  router.post('/:id/scans', [param('id').isMongoId(), context.handleValidation], context.loadProject, asyncHandler(async (req, res) => {
    try {
      await ensureScanAllowed(req.user);
    } catch (error) {
      return res.redirect(upgradeRedirect(req.project._id, error.message));
    }

    const scan = await startProjectScan({ projectId: req.project._id, userId: req.user._id });
    res.redirect(`/projects/${req.project._id}/scans/${scan._id}`);
  }));

  router.post(
    '/:id/scans/:scanId/cancel',
    [param('id').isMongoId(), param('scanId').isMongoId(), context.handleValidation],
    context.loadProject,
    context.loadScan,
    asyncHandler(async (req, res) => {
      if (req.scan.status === 'pending' || req.scan.status === 'running') {
        req.scan.status = 'cancelled';
        req.scan.completedAt = new Date();
        req.scan.currentStep = 'Stopped by user';
        req.scan.currentUrl = '';
        req.scan.errorMessage = '';
        await req.scan.save();
      }

      res.redirect(`/projects/${req.project._id}/scans/${req.scan._id}?stopped=1`);
    })
  );

  router.get('/:id/competitors', [param('id').isMongoId(), context.handleValidation], context.loadProject, asyncHandler(async (req, res) => {
    let upgradeMessage = '';
    try {
      ensureFeature(req.user, 'competitors', 'Competitor tracking is available on Pro and Agency plans.', 'pro');
    } catch (error) {
      upgradeMessage = error.message;
    }

    const competitors = await context.Competitor.find({ projectId: req.project._id, userId: req.user._id }).sort({ createdAt: -1 });
    const pages = await context.CompetitorPage.find({ projectId: req.project._id });
    const latestInsights = await context.CompetitorInsight.find({ projectId: req.project._id }).sort({ createdAt: -1 }).limit(6);

    res.render('projects/competitors/index', {
      title: `${req.project.name} competitors`,
      competitors,
      pages,
      latestInsights,
      discovery: req.project.competitorDiscovery || {},
      errorMessage: req.query.error || upgradeMessage,
      successMessage: req.query.success || ''
    });
  }));

  router.post('/:id/competitors', [param('id').isMongoId(), ...context.competitorValidation], context.loadProject, asyncHandler(async (req, res) => {
    try {
      ensureFeature(req.user, 'competitors', 'Competitor tracking is available on Pro and Agency plans.', 'pro');
    } catch (error) {
      return res.redirect(upgradeRedirect(req.project._id, error.message));
    }

    try {
      await context.Competitor.create({
        projectId: req.project._id,
        userId: req.user._id,
        name: req.body.name,
        websiteUrl: context.normalizeUrl(req.body.websiteUrl),
        notes: req.body.notes || '',
        classification: req.body.classification || 'direct',
        businessModel: req.body.businessModel || 'other',
        locationRelevance: req.body.locationRelevance || 'unknown',
        classificationReason: 'Manually classified by the workspace user.'
      });

      res.redirect(`/projects/${req.project._id}/competitors?success=${encodeURIComponent('Competitor added.')}`);
    } catch (error) {
      const message = error.code === 11000 ? 'That competitor website is already added to this project.' : error.message;
      res.redirect(`/projects/${req.project._id}/competitors?error=${encodeURIComponent(message)}`);
    }
  }));

  router.post(
    '/:id/competitors/:competitorId/scan',
    [param('id').isMongoId(), param('competitorId').isMongoId(), context.handleValidation],
    context.loadProject,
    context.loadCompetitor,
    asyncHandler(async (req, res) => {
      try {
        ensureFeature(req.user, 'competitors', 'Competitor tracking is available on Pro and Agency plans.', 'pro');
      } catch (error) {
        return res.redirect(upgradeRedirect(req.project._id, error.message));
      }

      const result = await crawlCompetitor({ projectId: req.project._id, competitor: req.competitor });
      const message = result.skippedByRobots
        ? 'Competitor homepage is disallowed by robots.txt, so it was not scanned.'
        : `${result.pages.length} competitor pages scanned.`;

      res.redirect(`/projects/${req.project._id}/competitors/${req.competitor._id}?success=${encodeURIComponent(message)}`);
    })
  );

  router.post(
    '/:id/competitors/:competitorId/delete',
    [param('id').isMongoId(), param('competitorId').isMongoId(), context.handleValidation],
    context.loadProject,
    context.loadCompetitor,
    asyncHandler(async (req, res) => {
      await context.Competitor.findByIdAndDelete(req.competitor._id);
      await context.CompetitorPage.deleteMany({ competitorId: req.competitor._id });
      await context.CompetitorInsight.deleteMany({ competitorId: req.competitor._id });
      res.redirect(`/projects/${req.project._id}/competitors?success=${encodeURIComponent('Competitor removed.')}`);
    })
  );

  router.post('/:id/competitors/report', [param('id').isMongoId(), context.handleValidation], context.loadProject, asyncHandler(async (req, res) => {
    try {
      ensureFeature(req.user, 'competitors', 'Competitor tracking is available on Pro and Agency plans.', 'pro');
    } catch (error) {
      return res.redirect(upgradeRedirect(req.project._id, error.message));
    }

    const projectPages = await context.Page.find({ projectId: req.project._id }).sort({ lastCrawledAt: -1 }).limit(80);
    await discoverCompetitorsForProject({
      project: req.project,
      userId: req.user._id,
      projectPages,
      force: true
    });

    const competitors = await context.Competitor.find({
      projectId: req.project._id,
      userId: req.user._id
    }).sort({ createdAt: -1 });

    if (!competitors.length) {
      const diagnostics = req.project.competitorDiscovery || {};
      const message = diagnostics.status === 'search_unavailable'
        ? 'Competitor search did not return public results. Check outbound network access and try again; you can add a known competitor while search is unavailable.'
        : `Moyi evaluated ${diagnostics.candidatesEvaluated || 0} public websites but could not verify a direct competitor with enough evidence. Add one known competitor or improve the project offer and industry details, then try again.`;
      return res.redirect(`/projects/${req.project._id}/competitors?error=${encodeURIComponent(message)}`);
    }

    for (const competitor of competitors) {
      await crawlCompetitor({ projectId: req.project._id, competitor });
    }

    const persistedPages = await context.CompetitorPage.find({ projectId: req.project._id });
    const readablePages = persistedPages.filter((page) => page.statusCode >= 200 && page.statusCode < 400 && (page.title || page.wordCount));
    const crawledPageCount = readablePages.length;
    const unavailableCompetitors = competitors.filter((competitor) => !readablePages.some((page) => page.competitorId.toString() === competitor._id.toString())).length;
    const insights = await generateCompetitorInsights({ projectId: req.project._id, userId: req.user._id });
    const message = insights.length
      ? `${insights.length} competitor opportunities generated from ${crawledPageCount} verified public pages across ${competitors.length} competitors.`
      : `No defensible opportunity was found. ${unavailableCompetitors} of ${competitors.length} competitor sites could not be read; review their crawl status and try again.`;
    res.redirect(`/projects/${req.project._id}/competitors/insights?success=${encodeURIComponent(message)}`);
  }));

  router.get('/:id/competitors/insights', [param('id').isMongoId(), context.handleValidation], context.loadProject, asyncHandler(async (req, res) => {
    const [competitors, insights, competitorPages] = await Promise.all([
      context.Competitor.find({ projectId: req.project._id, userId: req.user._id }).sort({ createdAt: -1 }),
      context.CompetitorInsight.find({ projectId: req.project._id }).sort({ priority: 1, createdAt: -1 }),
      context.CompetitorPage.find({ projectId: req.project._id })
    ]);

    res.render('projects/competitors/insights', {
      title: `${req.project.name} competitor opportunities`,
      competitors,
      insights,
      competitorPages,
      discovery: req.project.competitorDiscovery || {},
      errorMessage: req.query.error || '',
      successMessage: req.query.success || ''
    });
  }));

  router.get(
    '/:id/competitors/:competitorId',
    [param('id').isMongoId(), param('competitorId').isMongoId(), context.handleValidation],
    context.loadProject,
    context.loadCompetitor,
    asyncHandler(async (req, res) => {
      const pages = await context.CompetitorPage.find({ projectId: req.project._id, competitorId: req.competitor._id }).sort({ lastCrawledAt: -1 });
      const insights = await context.CompetitorInsight.find({ projectId: req.project._id, competitorId: req.competitor._id }).sort({ priority: 1, createdAt: -1 });

      res.render('projects/competitors/show', {
        title: `${req.competitor.name} competitor`,
        pages,
        insights,
        successMessage: req.query.success || ''
      });
    })
  );

  router.get('/:id/scans', [param('id').isMongoId(), context.handleValidation], context.loadProject, asyncHandler(async (req, res) => {
    const scans = await context.Scan.find({ projectId: req.project._id }).sort({ createdAt: -1 });
    res.render('projects/scans/index', { title: `${req.project.name} scans`, scans });
  }));

  router.get(
    '/:id/scans/:scanId/live',
    [param('id').isMongoId(), param('scanId').isMongoId(), context.handleValidation],
    context.loadProject,
    context.loadScan,
    asyncHandler(async (req, res) => {
      const viewData = await context.loadScanViewData({
        project: req.project,
        scan: req.scan,
        userId: req.user._id
      });

      res.json(context.scanJson(req.scan, viewData));
    })
  );

  router.get(
    '/:id/scans/:scanId/pdf',
    [param('id').isMongoId(), param('scanId').isMongoId(), context.handleValidation],
    context.loadProject,
    context.loadScan,
    asyncHandler(async (req, res) => {
      const viewData = await context.loadScanViewData({
        project: req.project,
        scan: req.scan,
        userId: req.user._id
      });
      const { buffer, filename } = generateScanPdfReport({
        project: req.project,
        scan: req.scan,
        ...viewData
      });

      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.setHeader('Content-Length', buffer.length);
      res.send(buffer);
    })
  );

  router.get(
    '/:id/scans/:scanId',
    [param('id').isMongoId(), param('scanId').isMongoId(), context.handleValidation],
    context.loadProject,
    context.loadScan,
    asyncHandler(async (req, res) => {
      const viewData = await context.loadScanViewData({
        project: req.project,
        scan: req.scan,
        userId: req.user._id
      });

      res.render('projects/scans/show', {
        title: `${req.project.name} scan`,
        stopped: req.query.stopped === '1',
        ...viewData
      });
    })
  );

  router.get('/:id/pages', [param('id').isMongoId(), context.handleValidation], context.loadProject, asyncHandler(async (req, res) => {
    const latestScan = await context.Scan.findOne({ projectId: req.project._id }).sort({ createdAt: -1 });
    const query = latestScan ? { projectId: req.project._id, scanId: latestScan._id } : { projectId: req.project._id };
    const pages = await context.Page.find(query).sort({ url: 1 });

    res.render('projects/pages', {
      title: `${req.project.name} pages`,
      latestScan,
      pages
    });
  }));
}

module.exports = {
  registerDiscoveryRoutes
};
