const express = require('express');
const asyncHandler = require('express-async-handler');
const { body, param } = require('express-validator');
const Project = require('../models/Project');
const Scan = require('../models/Scan');
const Page = require('../models/Page');
const SeoIssue = require('../models/SeoIssue');
const Report = require('../models/Report');
const CmoReport = require('../models/CmoReport');
const Recommendation = require('../models/Recommendation');
const ContentDraft = require('../models/ContentDraft');
const ProjectSearchProperty = require('../models/ProjectSearchProperty');
const SearchMetric = require('../models/SearchMetric');
const Competitor = require('../models/Competitor');
const CompetitorPage = require('../models/CompetitorPage');
const CompetitorInsight = require('../models/CompetitorInsight');
const WordPressIntegration = require('../models/WordPressIntegration');
const WebflowIntegration = require('../models/WebflowIntegration');
const ShopifyIntegration = require('../models/ShopifyIntegration');
const PublishAction = require('../models/PublishAction');
const ConversionGoal = require('../models/ConversionGoal');
const TrackingEvent = require('../models/TrackingEvent');
const Campaign = require('../models/Campaign');
const SocialDraft = require('../models/SocialDraft');
const AnalyticsSnapshot = require('../models/AnalyticsSnapshot');
const AppError = require('../utils/appError');
const handleValidation = require('../utils/validate');
const { requireAuth } = require('../middleware/auth');
const { normalizeUrl } = require('../utils/url');
const { enqueueScan } = require('../queues/scanQueue');
const { generateAiCmoPlan } = require('../services/aiReportService');
const { generateCmoReport } = require('../services/cmoReportService');
const { generateDraftsForRecommendation } = require('../services/contentDraftService');
const { crawlCompetitor } = require('../services/competitorCrawlerService');
const {
  competitorSummary,
  discoverCompetitorsForProject,
  persistDiscoveredCompetitors
} = require('../services/competitorDiscoveryService');
const { generateCompetitorInsights } = require('../services/competitorInsightService');
const { summarizeIssues } = require('../services/auditService');
const {
  fetchWordPressPages,
  testWordPressConnection,
  upsertWordPressIntegration
} = require('../services/wordpressService');
const {
  testWebflowConnection,
  upsertWebflowIntegration
} = require('../services/webflowService');
const {
  normalizeShopDomain,
  testShopifyConnection,
  upsertShopifyIntegration
} = require('../services/shopifyService');
const {
  ensureAiReportAllowed,
  ensureContentDraftAllowed,
  ensureFeature,
  ensureProjectLimit,
  ensureScanAllowed,
  incrementUsage,
  upgradeRedirect
} = require('../services/usageService');
const { buildAnalyticsDashboard } = require('../services/trackingService');
const { scanProjectForDiscovery } = require('../services/discoveryService');
const { auditTelemetry } = require('../services/telemetryAuditor');
const { buildAttributionDashboard } = require('../services/attributionService');
const {
  buildPerformanceDashboard,
  calculateGscOpportunities,
  getIntegration,
  listSearchConsoleSites,
  syncSearchConsoleProject
} = require('../services/searchConsoleService');

const router = express.Router();

router.use(requireAuth);

const projectValidation = [
  body('name').trim().notEmpty().withMessage('Project name is required.'),
  body('websiteUrl')
    .trim()
    .notEmpty()
    .withMessage('Website URL is required.')
    .custom((value) => {
      try {
        normalizeUrl(value);
        return true;
      } catch (error) {
        throw new Error('Website URL must be valid.');
      }
    }),
  body('industry').optional({ checkFalsy: true }).trim().isLength({ max: 120 }).withMessage('Industry is too long.'),
  body('targetAudience').optional({ checkFalsy: true }).trim().isLength({ max: 240 }).withMessage('Target audience is too long.'),
  body('targetCountry').optional({ checkFalsy: true }).trim().isLength({ max: 80 }).withMessage('Target country is too long.'),
  body('mainGoal').optional({ checkFalsy: true }).trim().isLength({ max: 500 }).withMessage('Main goal is too long.'),
  body('mainOffer').optional({ checkFalsy: true }).trim().isLength({ max: 240 }).withMessage('Main offer is too long.'),
  body('brandTone').optional({ checkFalsy: true }).trim().isLength({ max: 160 }).withMessage('Brand tone is too long.'),
  body('webhookUrl')
    .optional({ checkFalsy: true })
    .trim()
    .isLength({ max: 500 })
    .withMessage('Webhook URL is too long.')
    .isURL({ require_protocol: true, protocols: ['http', 'https'] })
    .withMessage('Webhook URL must be a full URL, including https://.'),
  handleValidation
];

const competitorValidation = [
  body('name').trim().notEmpty().withMessage('Competitor name is required.').isLength({ max: 120 }).withMessage('Competitor name is too long.'),
  body('websiteUrl')
    .trim()
    .notEmpty()
    .withMessage('Competitor website URL is required.')
    .custom((value) => {
      try {
        normalizeUrl(value);
        return true;
      } catch (error) {
        throw new Error('Competitor website URL must be valid.');
      }
    }),
  body('notes').optional({ checkFalsy: true }).trim().isLength({ max: 500 }).withMessage('Notes are too long.'),
  handleValidation
];

const wordpressValidation = [
  body('siteUrl')
    .trim()
    .notEmpty()
    .withMessage('WordPress site URL is required.')
    .custom((value) => {
      try {
        normalizeUrl(value);
        return true;
      } catch (error) {
        throw new Error('WordPress site URL must be valid.');
      }
    }),
  body('username').trim().notEmpty().withMessage('WordPress username is required.').isLength({ max: 120 }).withMessage('WordPress username is too long.'),
  body('appPassword').trim().notEmpty().withMessage('Application password is required.').isLength({ max: 240 }).withMessage('Application password is too long.'),
  handleValidation
];

const webflowValidation = [
  body('siteId').optional({ checkFalsy: true }).trim().isLength({ max: 120 }).withMessage('Webflow site ID is too long.'),
  body('collectionId').trim().notEmpty().withMessage('Webflow collection ID is required.').isLength({ max: 160 }).withMessage('Webflow collection ID is too long.'),
  body('apiToken').trim().notEmpty().withMessage('Webflow API token is required.').isLength({ max: 500 }).withMessage('Webflow API token is too long.'),
  body('titleField').optional({ checkFalsy: true }).trim().isLength({ max: 80 }).withMessage('Title field is too long.'),
  body('slugField').optional({ checkFalsy: true }).trim().isLength({ max: 80 }).withMessage('Slug field is too long.'),
  body('bodyField').optional({ checkFalsy: true }).trim().isLength({ max: 80 }).withMessage('Body field is too long.'),
  handleValidation
];

const shopifyValidation = [
  body('shopDomain')
    .trim()
    .notEmpty()
    .withMessage('Shopify shop domain is required.')
    .custom((value) => {
      try {
        normalizeShopDomain(value);
        return true;
      } catch (error) {
        throw new Error(error.message);
      }
    }),
  body('blogId').trim().notEmpty().withMessage('Shopify blog ID is required.').isLength({ max: 120 }).withMessage('Shopify blog ID is too long.'),
  body('accessToken').trim().notEmpty().withMessage('Shopify access token is required.').isLength({ max: 500 }).withMessage('Shopify access token is too long.'),
  body('apiVersion').optional({ checkFalsy: true }).trim().matches(/^\d{4}-\d{2}$/).withMessage('API version must look like 2025-01.'),
  handleValidation
];

const conversionGoalValidation = [
  body('name').trim().notEmpty().withMessage('Goal name is required.').isLength({ max: 120 }).withMessage('Goal name is too long.'),
  body('eventName').trim().notEmpty().withMessage('Event name is required.').isLength({ max: 120 }).withMessage('Event name is too long.'),
  body('urlPattern').optional({ checkFalsy: true }).trim().isLength({ max: 300 }).withMessage('URL pattern is too long.'),
  handleValidation
];

const campaignValidation = [
  body('name').trim().notEmpty().withMessage('Campaign name is required.').isLength({ max: 160 }).withMessage('Campaign name is too long.'),
  body('goal').optional({ checkFalsy: true }).trim().isLength({ max: 500 }).withMessage('Campaign goal is too long.'),
  body('channel').isIn(['linkedin', 'facebook', 'x', 'instagram', 'email', 'multi']).withMessage('Campaign channel is invalid.'),
  body('startDate').isISO8601().withMessage('Start date is required.'),
  body('endDate').isISO8601().withMessage('End date is required.'),
  body('status').optional({ checkFalsy: true }).isIn(['planned', 'active', 'completed', 'paused']).withMessage('Campaign status is invalid.'),
  body('dailySpendLimit').optional({ checkFalsy: true }).isFloat({ min: 0, max: 10000 }).withMessage('Daily spend limit is invalid.'),
  body('monthlySpendLimit').optional({ checkFalsy: true }).isFloat({ min: 0, max: 250000 }).withMessage('Monthly spend limit is invalid.'),
  handleValidation
];

const gscOpportunityDraftValidation = [
  body('opportunityType').isIn(['boost_ctr', 'push_to_page_one']).withMessage('Opportunity type is invalid.'),
  body('query').trim().notEmpty().isLength({ max: 240 }).withMessage('Query is required.'),
  body('page')
    .trim()
    .notEmpty()
    .withMessage('Target page is required.')
    .custom((value) => {
      try {
        normalizeUrl(value);
        return true;
      } catch (error) {
        throw new Error('Target page must be valid.');
      }
    }),
  handleValidation
];

function parseCompetitors(value) {
  return String(value || '')
    .split('\n')
    .map((competitor) => competitor.trim())
    .filter(Boolean);
}

function competitorLabel(competitor) {
  if (typeof competitor === 'string') return competitor;
  return competitor.name || competitor.websiteUrl || '';
}

function projectPayload(req) {
  return {
    owner: req.user._id,
    name: req.body.name,
    websiteUrl: normalizeUrl(req.body.websiteUrl),
    industry: req.body.industry || '',
    targetAudience: req.body.targetAudience || '',
    targetCountry: req.body.targetCountry || '',
    mainGoal: req.body.mainGoal || '',
    mainOffer: req.body.mainOffer || '',
    brandTone: req.body.brandTone || '',
    competitors: parseCompetitors(req.body.competitors),
    webhookUrl: req.body.webhookUrl || ''
  };
}

function loadProject(req, res, next) {
  Project.findOne({ _id: req.params.id, owner: req.user._id })
    .then((project) => {
      if (!project) return next(new AppError('Project not found.', 404));

      req.project = project;
      res.locals.project = project;
      next();
    })
    .catch(next);
}

function loadScan(req, res, next) {
  Scan.findOne({ _id: req.params.scanId, projectId: req.project._id })
    .then((scan) => {
      if (!scan) return next(new AppError('Scan not found.', 404));

      req.scan = scan;
      res.locals.scan = scan;
      next();
    })
    .catch(next);
}

function loadCompetitor(req, res, next) {
  Competitor.findOne({
    _id: req.params.competitorId,
    projectId: req.project._id,
    userId: req.user._id
  })
    .then((competitor) => {
      if (!competitor) return next(new AppError('Competitor not found.', 404));

      req.competitor = competitor;
      res.locals.competitor = competitor;
      next();
    })
    .catch(next);
}

function normalizeDays(value) {
  const days = Number(value || 28);
  return [7, 28, 90].includes(days) ? days : 28;
}

function parsePropertySelection(value) {
  const [siteUrl, permissionLevel = ''] = String(value || '').split('||');
  return { siteUrl, permissionLevel };
}

function parseJsonField(value, fallback) {
  if (!value) return fallback;
  try {
    return JSON.parse(String(value));
  } catch (error) {
    return fallback;
  }
}

function personaSummary(persona) {
  return [persona.name, persona.role].filter(Boolean).join(' - ');
}

const LOW_STAKES_RECOMMENDATION_ACTIONS = new Set(['fix_metadata', 'content', 'internal_linking', 'schema']);

function stalePendingRecommendation(recommendation) {
  const lastTouched = recommendation.updatedAt || recommendation.createdAt;
  return recommendation.status === 'pending' && lastTouched && Date.now() - lastTouched.getTime() > 48 * 60 * 60 * 1000;
}

async function autoResolveRecommendationQueue(project, recommendations) {
  const stale = recommendations.filter(stalePendingRecommendation);
  if (!stale.length) return recommendations;

  const telemetry = await auditTelemetry(project);
  if (telemetry.score < 85 || project.status !== 'approved') return recommendations;

  await Promise.all(stale.map((recommendation) => {
    recommendation.status = LOW_STAKES_RECOMMENDATION_ACTIONS.has(recommendation.actionType) ? 'accepted' : 'rejected';
    recommendation.reason = `${recommendation.reason || ''}\n\nAuto-resolved after 48 hours with telemetry health ${telemetry.score}%.`.trim();
    return recommendation.save();
  }));

  return recommendations;
}

async function loadScanViewData({ project, scan, userId }) {
  const [pages, issues, competitors, competitorInsights] = await Promise.all([
    Page.find({ scanId: scan._id }).sort({ statusCode: -1, url: 1 }),
    SeoIssue.find({ scan: scan._id }).sort({ createdAt: -1, severity: 1 }).limit(12),
    Competitor.find({ projectId: project._id, userId }).sort({ createdAt: -1 }).limit(3),
    CompetitorInsight.find({ projectId: project._id }).sort({ priority: 1, createdAt: -1 }).limit(4)
  ]);
  const failedPages = pages.filter((page) => page.statusCode === 0 || page.statusCode >= 400);
  const issueSummary = summarizeIssues(issues, pages);

  return {
    competitors,
    competitorInsights,
    failedPages,
    issueSummary,
    issues,
    pages
  };
}

function scanJson(scan, viewData) {
  return {
    scan: {
      id: scan._id,
      status: scan.status,
      pagesScanned: scan.pagesScanned,
      pagesFound: scan.pagesFound,
      errorMessage: scan.errorMessage,
      currentStep: scan.currentStep || '',
      currentUrl: scan.currentUrl || '',
      startedAt: scan.startedAt,
      completedAt: scan.completedAt
    },
    issueSummary: viewData.issueSummary,
    failedPagesCount: viewData.failedPages.length,
    issues: viewData.issues.map((issue) => ({
      severity: issue.severity,
      title: issue.title,
      url: issue.url,
      recommendation: issue.recommendation
    })),
    pages: viewData.pages.map((page) => ({
      statusCode: page.statusCode,
      url: page.url,
      title: page.title,
      metaDescription: page.metaDescription,
      h1: page.h1 || [],
      wordCount: page.wordCount,
      imagesMissingAlt: page.imagesMissingAlt
    })),
    competitors: viewData.competitors.map((competitor) => ({
      id: competitor._id,
      name: competitor.name,
      websiteUrl: competitor.websiteUrl
    })),
    competitorInsights: viewData.competitorInsights.map((insight) => ({
      category: insight.category,
      title: insight.title,
      insight: insight.insight,
      opportunity: insight.opportunity,
      priority: insight.priority
    }))
  };
}

async function deleteProjectOwnedData({ project, userId }) {
  await Promise.all([
    Page.deleteMany({ projectId: project._id }),
    Scan.deleteMany({ projectId: project._id }),
    SeoIssue.deleteMany({ project: project._id }),
    Report.deleteMany({ projectId: project._id }),
    CmoReport.deleteMany({ projectId: project._id }),
    Recommendation.deleteMany({ projectId: project._id }),
    ContentDraft.deleteMany({ projectId: project._id }),
    ProjectSearchProperty.deleteMany({ projectId: project._id }),
    SearchMetric.deleteMany({ projectId: project._id }),
    Competitor.deleteMany({ projectId: project._id }),
    CompetitorPage.deleteMany({ projectId: project._id }),
    CompetitorInsight.deleteMany({ projectId: project._id }),
    WordPressIntegration.deleteMany({ projectId: project._id }),
    WebflowIntegration.deleteMany({ projectId: project._id }),
    ShopifyIntegration.deleteMany({ projectId: project._id }),
    PublishAction.deleteMany({ projectId: project._id }),
    ConversionGoal.deleteMany({ projectId: project._id }),
    TrackingEvent.deleteMany({ projectId: project._id }),
    Campaign.deleteMany({ projectId: project._id }),
    SocialDraft.deleteMany({ projectId: project._id }),
    AnalyticsSnapshot.deleteMany({ project: project._id })
  ]);

  await Project.deleteOne({ _id: project._id, owner: userId });
}

router.get('/', asyncHandler(async (req, res) => {
  const projects = await Project.find({ owner: req.user._id }).sort({ updatedAt: -1 });
  res.render('projects/index', { title: 'Projects', projects, limitMessage: req.query.limitMessage || '' });
}));

router.get('/new', (req, res) => {
  res.render('projects/new', { title: 'New project', project: null });
});

router.post('/', projectValidation, asyncHandler(async (req, res) => {
  try {
    await ensureProjectLimit(req.user);
  } catch (error) {
    return res.redirect(`/projects?limitMessage=${encodeURIComponent(error.message)}`);
  }

  const project = await Project.create(projectPayload(req));
  res.redirect(`/projects/${project._id}`);
}));

router.post('/scan', [
  body('name').optional({ checkFalsy: true }).trim().isLength({ max: 160 }).withMessage('Project name is too long.'),
  body('websiteUrl')
    .trim()
    .notEmpty()
    .withMessage('Website URL is required.')
    .custom((value) => {
      try {
        normalizeUrl(value);
        return true;
      } catch (error) {
        throw new Error('Website URL must be valid.');
      }
    }),
  handleValidation
], asyncHandler(async (req, res) => {
  try {
    await ensureProjectLimit(req.user);
  } catch (error) {
    return res.redirect(`/projects?limitMessage=${encodeURIComponent(error.message)}`);
  }

  const websiteUrl = normalizeUrl(req.body.websiteUrl);
  const discovery = await scanProjectForDiscovery(websiteUrl);
  const brand = discovery.brandProfile || {};
  const approvedAudience = (brand.targetPersonas || []).map(personaSummary).filter(Boolean);
  const project = await Project.create({
    owner: req.user._id,
    name: req.body.name || brand.brandName || new URL(websiteUrl).hostname,
    websiteUrl,
    industry: '',
    targetAudience: approvedAudience.join(', ') || (brand.personas || []).join(', '),
    mainGoal: 'Convert discovered demand into qualified pipeline.',
    mainOffer: (brand.valueProps || [])[0] || '',
    brandTone: (brand.toneAdjectives || []).join(', '),
    status: 'draft',
    brand_profile: {
      ...brand,
      diagnostics: discovery.diagnostics
    },
    competitors: discovery.competitors.map(competitorSummary)
  });
  await persistDiscoveredCompetitors({
    project,
    userId: req.user._id,
    competitors: discovery.competitors
  });

  res.redirect(`/projects/${project._id}/calibration`);
}));

router.get('/:id/calibration', [param('id').isMongoId(), handleValidation], loadProject, (req, res) => {
  res.render('projects/calibration', {
    title: `${req.project.name} calibration`,
    project: req.project,
    competitorLabel
  });
});

router.post('/:id/approve', [
  param('id').isMongoId(),
  body('toneAdjectivesJson').optional({ checkFalsy: true }).isLength({ max: 2000 }).withMessage('Tone adjectives are too long.'),
  body('valuePropsJson').optional({ checkFalsy: true }).isLength({ max: 6000 }).withMessage('Value props are too long.'),
  body('targetPersonasJson').optional({ checkFalsy: true }).isLength({ max: 12000 }).withMessage('Personas are too long.'),
  body('competitorsJson').optional({ checkFalsy: true }).isLength({ max: 12000 }).withMessage('Competitors are too long.'),
  handleValidation
], loadProject, asyncHandler(async (req, res) => {
  const brandProfile = req.project.brand_profile || {};
  brandProfile.toneAdjectives = parseJsonField(req.body.toneAdjectivesJson, brandProfile.toneAdjectives || []);
  brandProfile.valueProps = parseJsonField(req.body.valuePropsJson, brandProfile.valueProps || []);
  brandProfile.targetPersonas = parseJsonField(req.body.targetPersonasJson, brandProfile.targetPersonas || []);
  brandProfile.personas = (brandProfile.targetPersonas || []).map(personaSummary).filter(Boolean);

  req.project.brand_profile = brandProfile;
  req.project.brandTone = brandProfile.toneAdjectives.join(', ');
  req.project.mainOffer = brandProfile.valueProps[0] || req.project.mainOffer;
  req.project.targetAudience = brandProfile.personas.join(', ');
  req.project.competitors = parseJsonField(req.body.competitorsJson, req.project.competitors || []);
  req.project.status = 'approved';
  const telemetry = await auditTelemetry(req.project);
  req.project.telemetryHealthScore = telemetry.score;
  req.project.telemetryAudit = telemetry;
  await req.project.save();

  res.redirect(`/projects/${req.project._id}?approved=1`);
}));

router.post('/:id/scans', [param('id').isMongoId(), handleValidation], loadProject, asyncHandler(async (req, res) => {
  try {
    await ensureScanAllowed(req.user);
  } catch (error) {
    return res.redirect(upgradeRedirect(req.project._id, error.message));
  }

  const scan = await Scan.create({ projectId: req.project._id, status: 'pending' });
  await incrementUsage(req.user._id, 'scansUsed', 1);
  await enqueueScan(scan._id);
  res.redirect(`/projects/${req.project._id}/scans/${scan._id}`);
}));

router.post('/:id/ai-report', [param('id').isMongoId(), handleValidation], loadProject, asyncHandler(async (req, res) => {
  let plan;
  try {
    plan = await ensureAiReportAllowed(req.user);
  } catch (error) {
    return res.redirect(upgradeRedirect(req.project._id, error.message));
  }

  const scan = await Scan.findOne({ projectId: req.project._id, status: 'completed' }).sort({ completedAt: -1, createdAt: -1 });
  if (!scan) {
    return res.redirect(`/projects/${req.project._id}?aiError=${encodeURIComponent('Run a completed website scan before generating an AI CMO plan.')}`);
  }

  const [pages, issues] = await Promise.all([
    Page.find({ projectId: req.project._id, scanId: scan._id }).sort({ url: 1 }),
    SeoIssue.find({ project: req.project._id, scan: scan._id }).sort({ severity: 1, createdAt: -1 })
  ]);

  try {
    const result = await generateAiCmoPlan({
      project: req.project,
      scan,
      pages,
      issues
    });

    const report = await Report.findOneAndUpdate(
      { projectId: req.project._id, auditId: scan._id },
      {
        ...result.report,
        projectId: req.project._id,
        auditId: scan._id,
        status: 'ready',
        sourceIssueIds: issues.map((issue) => issue._id),
        sourcePageUrls: pages.map((page) => page.url),
        model: result.model,
        errorMessage: ''
      },
      { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true }
    );

    const recommendations = result.recommendations.slice(0, plan.key === 'free' ? 3 : result.recommendations.length);
    await Recommendation.deleteMany({ projectId: req.project._id, auditId: scan._id });
    if (recommendations.length) {
      await Recommendation.insertMany(recommendations.map((recommendation) => ({
        ...recommendation,
        projectId: req.project._id,
        auditId: scan._id
      })));
    }

    await incrementUsage(req.user._id, 'aiReportsUsed', 1);
    res.redirect(`/projects/${req.project._id}/ai-report/latest?report=${report._id}`);
  } catch (error) {
    await Report.findOneAndUpdate(
      { projectId: req.project._id, auditId: scan._id },
      {
        projectId: req.project._id,
        auditId: scan._id,
        status: 'failed',
        errorMessage: error.message,
        model: error.code === 'missing_api_key' ? 'not-configured' : ''
      },
      { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true }
    );

    res.redirect(`/projects/${req.project._id}/ai-report/latest?aiError=${encodeURIComponent(error.message)}`);
  }
}));

router.get('/:id/ai-report/latest', [param('id').isMongoId(), handleValidation], loadProject, asyncHandler(async (req, res) => {
  const report = await Report.findOne({ projectId: req.project._id }).sort({ createdAt: -1 });
  const recommendations = report
    ? await Recommendation.find({ projectId: req.project._id, auditId: report.auditId }).sort({ priority: 1, createdAt: -1 })
    : [];

  res.render('projects/ai-report', {
    title: `${req.project.name} AI CMO Plan`,
    report,
    recommendations,
    aiError: req.query.aiError || ''
  });
}));

router.get('/:id/recommendations', [param('id').isMongoId(), handleValidation], loadProject, asyncHandler(async (req, res) => {
  const recommendations = await Recommendation.find({ projectId: req.project._id }).sort({ status: 1, priority: 1, createdAt: -1 });
  await autoResolveRecommendationQueue(req.project, recommendations);
  res.render('projects/recommendations', {
    title: `${req.project.name} recommendations`,
    recommendations
  });
}));

router.get('/:id/content', [param('id').isMongoId(), handleValidation], loadProject, asyncHandler(async (req, res) => {
  const drafts = await ContentDraft.find({ projectId: req.project._id }).sort({ updatedAt: -1 });
  res.render('projects/content', {
    title: `${req.project.name} content`,
    drafts
  });
}));

router.get('/:id/calendar', [param('id').isMongoId(), handleValidation], loadProject, asyncHandler(async (req, res) => {
  const [campaigns, socialDrafts] = await Promise.all([
    Campaign.find({ projectId: req.project._id }).sort({ startDate: 1 }),
    SocialDraft.find({ projectId: req.project._id }).sort({ scheduledFor: 1 }).populate('campaignId')
  ]);

  res.render('projects/calendar', {
    title: `${req.project.name} calendar`,
    campaigns,
    socialDrafts,
    successMessage: req.query.success || ''
  });
}));

router.get('/:id/campaigns', [param('id').isMongoId(), handleValidation], loadProject, asyncHandler(async (req, res) => {
  const [campaigns, socialDrafts] = await Promise.all([
    Campaign.find({ projectId: req.project._id }).sort({ createdAt: -1 }),
    SocialDraft.find({ projectId: req.project._id }).sort({ scheduledFor: 1 })
  ]);

  res.render('projects/campaigns', {
    title: `${req.project.name} campaigns`,
    campaigns,
    socialDrafts,
    successMessage: req.query.success || ''
  });
}));

router.post('/:id/campaigns', [param('id').isMongoId(), ...campaignValidation], loadProject, asyncHandler(async (req, res) => {
  const startDate = new Date(req.body.startDate);
  const endDate = new Date(req.body.endDate);
  if (endDate < startDate) {
    endDate.setTime(startDate.getTime());
  }

  await Campaign.create({
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

router.get('/:id/search-console/connect', [param('id').isMongoId(), handleValidation], loadProject, asyncHandler(async (req, res) => {
  const [integration, connectedProperty] = await Promise.all([
    getIntegration(req.user._id),
    ProjectSearchProperty.findOne({ projectId: req.project._id, userId: req.user._id })
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

router.post('/:id/search-console/property', [param('id').isMongoId(), handleValidation], loadProject, asyncHandler(async (req, res) => {
  try {
    ensureFeature(req.user, 'searchConsole', 'Search Console sync is available on Pro and Agency plans.', 'pro');
  } catch (error) {
    return res.redirect(upgradeRedirect(req.project._id, error.message));
  }

  const { siteUrl, permissionLevel } = parsePropertySelection(req.body.property);

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

  await ProjectSearchProperty.findOneAndUpdate(
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

router.post('/:id/search-console/sync', [param('id').isMongoId(), handleValidation], loadProject, asyncHandler(async (req, res) => {
  try {
    ensureFeature(req.user, 'searchConsole', 'Search Console sync is available on Pro and Agency plans.', 'pro');
  } catch (error) {
    return res.redirect(`/projects/${req.project._id}/search-console/performance?error=${encodeURIComponent(error.message)}`);
  }

  const days = normalizeDays(req.body.days);

  try {
    const result = await syncSearchConsoleProject({ project: req.project, userId: req.user._id, days });
    await incrementUsage(req.user._id, 'searchConsoleSyncsUsed', 1);
    res.redirect(`/projects/${req.project._id}/search-console/performance?days=${days}&synced=${result.rowsSynced}`);
  } catch (error) {
    res.redirect(`/projects/${req.project._id}/search-console/performance?days=${days}&error=${encodeURIComponent(error.message)}`);
  }
}));

router.get('/:id/search-console/performance', [param('id').isMongoId(), handleValidation], loadProject, asyncHandler(async (req, res) => {
  const days = normalizeDays(req.query.days);
  const connectedProperty = await ProjectSearchProperty.findOne({ projectId: req.project._id, userId: req.user._id });
  const [dashboard, opportunities] = connectedProperty
    ? await Promise.all([
      buildPerformanceDashboard({ projectId: req.project._id, userId: req.user._id, days }),
      calculateGscOpportunities(req.project._id)
    ])
    : [null, null];

  res.render('projects/search-console/performance', {
    title: `${req.project.name} Search Performance`,
    days,
    connectedProperty,
    dashboard,
    opportunities,
    errorMessage: req.query.error || '',
    successMessage: req.query.synced ? `${req.query.synced} Search Console rows synced.` : (req.query.connected ? 'Search Console property connected.' : '')
  });
}));

router.post('/:id/search-console/opportunities/draft', [param('id').isMongoId(), ...gscOpportunityDraftValidation], loadProject, asyncHandler(async (req, res, next) => {
  try {
    await ensureContentDraftAllowed(req.user);
  } catch (error) {
    return res.redirect(upgradeRedirect(req.project._id, error.message));
  }

  const latestScan = await Scan.findOne({ projectId: req.project._id, status: 'completed' }).sort({ completedAt: -1, createdAt: -1 });
  if (!latestScan) {
    return res.redirect(`/projects/${req.project._id}/search-console/performance?error=${encodeURIComponent('Run a website scan before creating optimization drafts from Search Console opportunities.')}`);
  }

  const isCtrOpportunity = req.body.opportunityType === 'boost_ctr';
  const query = req.body.query.trim();
  const page = normalizeUrl(req.body.page);
  const recommendation = await Recommendation.create({
    projectId: req.project._id,
    auditId: latestScan._id,
    title: isCtrOpportunity ? `Boost CTR for "${query}"` : `Push "${query}" toward page 1`,
    category: 'Search Console opportunity',
    priority: isCtrOpportunity ? 2 : 3,
    reason: isCtrOpportunity
      ? `Search Console shows "${query}" ranking on page 1 for ${page}, but CTR is below the project average.`
      : `Search Console shows "${query}" ranking on page 2 with meaningful impressions for ${page}.`,
    expectedImpact: isCtrOpportunity
      ? 'Better search result copy can capture more qualified clicks from existing rankings.'
      : 'More complete page content can improve relevance and help the query move toward page 1.',
    effort: isCtrOpportunity ? 'low' : 'medium',
    actionType: isCtrOpportunity ? 'fix_metadata' : 'content',
    targetUrls: [page],
    status: 'accepted'
  });

  try {
    const drafts = await generateDraftsForRecommendation({
      project: req.project,
      recommendation,
      requestedType: isCtrOpportunity ? 'meta_title' : 'service_page_section',
      keyword: query
    });
    const created = drafts.length ? await ContentDraft.insertMany(drafts) : [];
    if (created.length) {
      await incrementUsage(req.user._id, 'contentDraftsUsed', created.length);
    }

    const firstDraft = created[0];
    return res.redirect(firstDraft ? `/content/${firstDraft._id}` : `/projects/${req.project._id}/content`);
  } catch (error) {
    return next(error);
  }
}));

router.get('/:id/tracking/setup', [param('id').isMongoId(), handleValidation], loadProject, asyncHandler(async (req, res) => {
  if (!req.project.publicProjectKey) {
    req.project.publicProjectKey = require('crypto').randomBytes(18).toString('hex');
    await req.project.save();
  }

  const scriptUrl = `${req.protocol}://${req.get('host')}/tracker.js`;
  const snippet = `<script src="${scriptUrl}" data-project="${req.project.publicProjectKey}" async></script>`;
  const goals = await ConversionGoal.find({ projectId: req.project._id }).sort({ createdAt: -1 });

  res.render('projects/tracking/setup', {
    title: `${req.project.name} tracking setup`,
    snippet,
    goals,
    successMessage: req.query.success || ''
  });
}));

router.get('/:id/analytics', [param('id').isMongoId(), handleValidation], loadProject, asyncHandler(async (req, res) => {
  const days = [7, 30, 90].includes(Number(req.query.days)) ? Number(req.query.days) : 30;
  const dashboard = await buildAnalyticsDashboard(req.project._id, days);

  res.render('projects/tracking/analytics', {
    title: `${req.project.name} analytics`,
    dashboard
  });
}));

router.post('/:id/telemetry/audit', [param('id').isMongoId(), handleValidation], loadProject, asyncHandler(async (req, res) => {
  const telemetry = await auditTelemetry(req.project);
  req.project.telemetryHealthScore = telemetry.score;
  req.project.telemetryAudit = telemetry;
  await req.project.save();
  res.redirect(`/projects/${req.project._id}?telemetry=${telemetry.score}`);
}));

async function seedDemoTrackingEvents(project) {
  const count = await TrackingEvent.countDocuments({ projectId: project._id });
  if (count > 0) return;

  const now = Date.now();
  const demoEvents = [
    // Alex - Organic search then checkout
    {
      projectId: project._id,
      publicProjectKey: project.publicProjectKey || 'demo-key',
      eventType: 'page_view',
      sessionId: 'sess_alex_1',
      url: project.websiteUrl + '/',
      utmSource: 'google',
      utmMedium: 'organic',
      utmCampaign: '',
      resolvedEmail: 'alex@example.com',
      stripeCustomerId: 'cus_demo_1',
      createdAt: new Date(now - 3 * 24 * 3600 * 1000)
    },
    {
      projectId: project._id,
      publicProjectKey: project.publicProjectKey || 'demo-key',
      eventType: 'conversion',
      eventName: 'checkout_pro',
      sessionId: 'sess_alex_1',
      url: project.websiteUrl + '/checkout/success',
      utmSource: 'google',
      utmMedium: 'organic',
      utmCampaign: '',
      resolvedEmail: 'alex@example.com',
      stripeCustomerId: 'cus_demo_1',
      createdAt: new Date(now - 2 * 24 * 3600 * 1000)
    },
    // Jordan - Multi-touch (ad click then direct)
    {
      projectId: project._id,
      publicProjectKey: project.publicProjectKey || 'demo-key',
      eventType: 'page_view',
      sessionId: 'sess_jordan_1',
      url: project.websiteUrl + '/',
      utmSource: 'linkedin',
      utmMedium: 'cpc',
      utmCampaign: 'launch_promo',
      resolvedEmail: 'jordan@example.com',
      stripeCustomerId: 'cus_demo_2',
      createdAt: new Date(now - 6 * 24 * 3600 * 1000)
    },
    {
      projectId: project._id,
      publicProjectKey: project.publicProjectKey || 'demo-key',
      eventType: 'page_view',
      sessionId: 'sess_jordan_2',
      url: project.websiteUrl + '/pricing',
      utmSource: 'direct',
      utmMedium: '',
      utmCampaign: '',
      resolvedEmail: 'jordan@example.com',
      stripeCustomerId: 'cus_demo_2',
      createdAt: new Date(now - 5 * 24 * 3600 * 1000)
    },
    {
      projectId: project._id,
      publicProjectKey: project.publicProjectKey || 'demo-key',
      eventType: 'conversion',
      eventName: 'checkout_pro',
      sessionId: 'sess_jordan_2',
      url: project.websiteUrl + '/checkout/success',
      utmSource: 'direct',
      utmMedium: '',
      utmCampaign: '',
      resolvedEmail: 'jordan@example.com',
      stripeCustomerId: 'cus_demo_2',
      createdAt: new Date(now - 5 * 24 * 3600 * 1000)
    },
    // Taylor - Referral partner
    {
      projectId: project._id,
      publicProjectKey: project.publicProjectKey || 'demo-key',
      eventType: 'page_view',
      sessionId: 'sess_taylor_1',
      url: project.websiteUrl + '/',
      utmSource: 'partner_blog',
      utmMedium: 'referral',
      utmCampaign: 'guest_post',
      resolvedEmail: 'taylor@example.com',
      stripeCustomerId: 'cus_demo_3',
      createdAt: new Date(now - 11 * 24 * 3600 * 1000)
    },
    {
      projectId: project._id,
      publicProjectKey: project.publicProjectKey || 'demo-key',
      eventType: 'conversion',
      eventName: 'checkout_starter',
      sessionId: 'sess_taylor_1',
      url: project.websiteUrl + '/checkout/success',
      utmSource: 'partner_blog',
      utmMedium: 'referral',
      utmCampaign: 'guest_post',
      resolvedEmail: 'taylor@example.com',
      stripeCustomerId: 'cus_demo_3',
      createdAt: new Date(now - 10 * 24 * 3600 * 1000)
    }
  ];

  await TrackingEvent.insertMany(demoEvents);
}

async function getAttributionPayments(project) {
  // 1. Check if there are conversion events in TrackingEvent
  const events = await TrackingEvent.find({
    projectId: project._id,
    eventType: { $in: ['conversion', 'custom'] }
  }).sort({ createdAt: -1 }).limit(100);

  if (events.length > 0) {
    return events.map((event) => {
      let amount = 99;
      if (event.eventName.toLowerCase().includes('pro') || event.eventName.toLowerCase().includes('enterprise')) {
        amount = 299;
      } else if (event.eventName.toLowerCase().includes('starter')) {
        amount = 49;
      }
      return {
        id: 'pay_' + event._id.toString().slice(-8),
        amount,
        createdAt: event.createdAt,
        customerId: event.resolvedCustomerId || '',
        stripeCustomerId: event.stripeCustomerId || '',
        email: event.resolvedEmail || ''
      };
    });
  }

  // 2. If no events exist, let's see if there are any tracking events at all.
  const hasEvents = await TrackingEvent.exists({ projectId: project._id });
  if (hasEvents) {
    const sessions = await TrackingEvent.find({ projectId: project._id }).distinct('sessionId');
    const payments = [];
    for (let i = 0; i < Math.min(sessions.length, 5); i++) {
      const sess = sessions[i];
      const touch = await TrackingEvent.findOne({ projectId: project._id, sessionId: sess }).sort({ createdAt: 1 });
      payments.push({
        id: 'pay_demo_' + i,
        amount: [49, 99, 199, 299][i % 4],
        createdAt: new Date(),
        customerId: touch.resolvedCustomerId || 'cust_demo_' + i,
        stripeCustomerId: touch.stripeCustomerId || 'cus_demo_' + i,
        email: touch.resolvedEmail || `buyer${i}@example.com`
      });
    }
    return payments;
  }

  // 3. Fallback to static realistic demo data for first user experience
  return [
    {
      id: 'pay_demo_1',
      amount: 149.00,
      createdAt: new Date(Date.now() - 2 * 24 * 3600 * 1000),
      customerId: 'cus_demo_1',
      stripeCustomerId: 'cus_demo_1',
      email: 'alex@example.com'
    },
    {
      id: 'pay_demo_2',
      amount: 299.00,
      createdAt: new Date(Date.now() - 5 * 24 * 3600 * 1000),
      customerId: 'cus_demo_2',
      stripeCustomerId: 'cus_demo_2',
      email: 'jordan@example.com'
    },
    {
      id: 'pay_demo_3',
      amount: 49.00,
      createdAt: new Date(Date.now() - 10 * 24 * 3600 * 1000),
      customerId: 'cus_demo_3',
      stripeCustomerId: 'cus_demo_3',
      email: 'taylor@example.com'
    }
  ];
}

router.get('/:id/attribution', [param('id').isMongoId(), handleValidation], loadProject, asyncHandler(async (req, res) => {
  await seedDemoTrackingEvents(req.project);
  const payments = await getAttributionPayments(req.project);
  const dashboard = await buildAttributionDashboard(req.project._id, payments);

  res.render('projects/attribution_dashboard', {
    title: `${req.project.name} attribution`,
    dashboard
  });
}));

router.post('/:id/conversion-goals', [param('id').isMongoId(), ...conversionGoalValidation], loadProject, asyncHandler(async (req, res) => {
  await ConversionGoal.create({
    projectId: req.project._id,
    name: req.body.name,
    eventName: req.body.eventName,
    urlPattern: req.body.urlPattern || ''
  });

  res.redirect(`/projects/${req.project._id}/tracking/setup?success=${encodeURIComponent('Conversion goal added.')}`);
}));

router.get('/:id/integrations/wordpress', [param('id').isMongoId(), handleValidation], loadProject, asyncHandler(async (req, res) => {
  let upgradeMessage = '';
  try {
    ensureFeature(req.user, 'wordpress', 'WordPress drafts are available on Pro and Agency plans.', 'pro');
  } catch (error) {
    upgradeMessage = error.message;
  }

  const integration = await WordPressIntegration.findOne({ projectId: req.project._id, userId: req.user._id });
  const recentActions = await PublishAction.find({ projectId: req.project._id, userId: req.user._id, integrationType: 'wordpress' }).sort({ createdAt: -1 }).limit(10);

  res.render('projects/integrations/wordpress', {
    title: `${req.project.name} WordPress`,
    integration,
    recentActions,
    errorMessage: req.query.error || upgradeMessage,
    successMessage: req.query.success || ''
  });
}));

router.post('/:id/integrations/wordpress/connect', [param('id').isMongoId(), ...wordpressValidation], loadProject, asyncHandler(async (req, res) => {
  try {
    ensureFeature(req.user, 'wordpress', 'WordPress drafts are available on Pro and Agency plans.', 'pro');
  } catch (error) {
    return res.redirect(upgradeRedirect(req.project._id, error.message));
  }

  await upsertWordPressIntegration({
    projectId: req.project._id,
    userId: req.user._id,
    siteUrl: req.body.siteUrl,
    username: req.body.username,
    appPassword: req.body.appPassword
  });

  res.redirect(`/projects/${req.project._id}/integrations/wordpress?success=${encodeURIComponent('WordPress credentials saved. Test the connection before publishing drafts.')}`);
}));

router.post('/:id/integrations/wordpress/test', [param('id').isMongoId(), handleValidation], loadProject, asyncHandler(async (req, res) => {
  try {
    ensureFeature(req.user, 'wordpress', 'WordPress drafts are available on Pro and Agency plans.', 'pro');
  } catch (error) {
    return res.redirect(`/projects/${req.project._id}/integrations/wordpress?error=${encodeURIComponent(error.message)}`);
  }

  const integration = await WordPressIntegration.findOne({ projectId: req.project._id, userId: req.user._id });
  if (!integration) {
    return res.redirect(`/projects/${req.project._id}/integrations/wordpress?error=${encodeURIComponent('Connect WordPress first.')}`);
  }

  try {
    await testWordPressConnection(integration);
    res.redirect(`/projects/${req.project._id}/integrations/wordpress?success=${encodeURIComponent('WordPress connection test passed.')}`);
  } catch (error) {
    res.redirect(`/projects/${req.project._id}/integrations/wordpress?error=${encodeURIComponent(error.message)}`);
  }
}));

router.get('/:id/integrations/wordpress/pages', [param('id').isMongoId(), handleValidation], loadProject, asyncHandler(async (req, res) => {
  try {
    ensureFeature(req.user, 'wordpress', 'WordPress drafts are available on Pro and Agency plans.', 'pro');
  } catch (error) {
    return res.redirect(`/projects/${req.project._id}/integrations/wordpress?error=${encodeURIComponent(error.message)}`);
  }

  const integration = await WordPressIntegration.findOne({ projectId: req.project._id, userId: req.user._id });
  if (!integration) {
    return res.redirect(`/projects/${req.project._id}/integrations/wordpress?error=${encodeURIComponent('Connect WordPress first.')}`);
  }

  try {
    const wordpressContent = await fetchWordPressPages(integration);
    res.render('projects/integrations/wordpress-pages', {
      title: `${req.project.name} WordPress content`,
      integration,
      wordpressContent,
      errorMessage: ''
    });
  } catch (error) {
    res.render('projects/integrations/wordpress-pages', {
      title: `${req.project.name} WordPress content`,
      integration,
      wordpressContent: { pages: [], posts: [] },
      errorMessage: error.message
    });
  }
}));

router.get('/:id/integrations/webflow', [param('id').isMongoId(), handleValidation], loadProject, asyncHandler(async (req, res) => {
  let upgradeMessage = '';
  try {
    ensureFeature(req.user, 'webflow', 'Webflow CMS drafts are available on Pro and Agency plans.', 'pro');
  } catch (error) {
    upgradeMessage = error.message;
  }

  const integration = await WebflowIntegration.findOne({ projectId: req.project._id, userId: req.user._id });
  const recentActions = await PublishAction.find({ projectId: req.project._id, userId: req.user._id, integrationType: 'webflow' }).sort({ createdAt: -1 }).limit(10);

  res.render('projects/integrations/webflow', {
    title: `${req.project.name} Webflow`,
    integration,
    recentActions,
    errorMessage: req.query.error || upgradeMessage,
    successMessage: req.query.success || ''
  });
}));

router.post('/:id/integrations/webflow/connect', [param('id').isMongoId(), ...webflowValidation], loadProject, asyncHandler(async (req, res) => {
  try {
    ensureFeature(req.user, 'webflow', 'Webflow CMS drafts are available on Pro and Agency plans.', 'pro');
  } catch (error) {
    return res.redirect(upgradeRedirect(req.project._id, error.message));
  }

  await upsertWebflowIntegration({
    projectId: req.project._id,
    userId: req.user._id,
    siteId: req.body.siteId || '',
    collectionId: req.body.collectionId,
    apiToken: req.body.apiToken,
    titleField: req.body.titleField || 'name',
    slugField: req.body.slugField || 'slug',
    bodyField: req.body.bodyField || 'post-body'
  });

  res.redirect(`/projects/${req.project._id}/integrations/webflow?success=${encodeURIComponent('Webflow credentials saved. Test the connection before publishing drafts.')}`);
}));

router.post('/:id/integrations/webflow/test', [param('id').isMongoId(), handleValidation], loadProject, asyncHandler(async (req, res) => {
  try {
    ensureFeature(req.user, 'webflow', 'Webflow CMS drafts are available on Pro and Agency plans.', 'pro');
  } catch (error) {
    return res.redirect(`/projects/${req.project._id}/integrations/webflow?error=${encodeURIComponent(error.message)}`);
  }

  const integration = await WebflowIntegration.findOne({ projectId: req.project._id, userId: req.user._id });
  if (!integration) {
    return res.redirect(`/projects/${req.project._id}/integrations/webflow?error=${encodeURIComponent('Connect Webflow first.')}`);
  }

  try {
    await testWebflowConnection(integration);
    res.redirect(`/projects/${req.project._id}/integrations/webflow?success=${encodeURIComponent('Webflow connection test passed.')}`);
  } catch (error) {
    res.redirect(`/projects/${req.project._id}/integrations/webflow?error=${encodeURIComponent(error.message)}`);
  }
}));

router.get('/:id/integrations/shopify', [param('id').isMongoId(), handleValidation], loadProject, asyncHandler(async (req, res) => {
  let upgradeMessage = '';
  try {
    ensureFeature(req.user, 'shopify', 'Shopify blog drafts are available on Pro and Agency plans.', 'pro');
  } catch (error) {
    upgradeMessage = error.message;
  }

  const integration = await ShopifyIntegration.findOne({ projectId: req.project._id, userId: req.user._id });
  const recentActions = await PublishAction.find({ projectId: req.project._id, userId: req.user._id, integrationType: 'shopify' }).sort({ createdAt: -1 }).limit(10);

  res.render('projects/integrations/shopify', {
    title: `${req.project.name} Shopify`,
    integration,
    recentActions,
    errorMessage: req.query.error || upgradeMessage,
    successMessage: req.query.success || ''
  });
}));

router.post('/:id/integrations/shopify/connect', [param('id').isMongoId(), ...shopifyValidation], loadProject, asyncHandler(async (req, res) => {
  try {
    ensureFeature(req.user, 'shopify', 'Shopify blog drafts are available on Pro and Agency plans.', 'pro');
  } catch (error) {
    return res.redirect(upgradeRedirect(req.project._id, error.message));
  }

  await upsertShopifyIntegration({
    projectId: req.project._id,
    userId: req.user._id,
    shopDomain: req.body.shopDomain,
    blogId: req.body.blogId,
    accessToken: req.body.accessToken,
    apiVersion: req.body.apiVersion || '2025-01'
  });

  res.redirect(`/projects/${req.project._id}/integrations/shopify?success=${encodeURIComponent('Shopify credentials saved. Test the connection before publishing drafts.')}`);
}));

router.post('/:id/integrations/shopify/test', [param('id').isMongoId(), handleValidation], loadProject, asyncHandler(async (req, res) => {
  try {
    ensureFeature(req.user, 'shopify', 'Shopify blog drafts are available on Pro and Agency plans.', 'pro');
  } catch (error) {
    return res.redirect(`/projects/${req.project._id}/integrations/shopify?error=${encodeURIComponent(error.message)}`);
  }

  const integration = await ShopifyIntegration.findOne({ projectId: req.project._id, userId: req.user._id });
  if (!integration) {
    return res.redirect(`/projects/${req.project._id}/integrations/shopify?error=${encodeURIComponent('Connect Shopify first.')}`);
  }

  try {
    await testShopifyConnection(integration);
    res.redirect(`/projects/${req.project._id}/integrations/shopify?success=${encodeURIComponent('Shopify connection test passed.')}`);
  } catch (error) {
    res.redirect(`/projects/${req.project._id}/integrations/shopify?error=${encodeURIComponent(error.message)}`);
  }
}));

router.get('/:id/integrations/webhook', [param('id').isMongoId(), handleValidation], loadProject, asyncHandler(async (req, res) => {
  if (!req.project.webhookSigningSecret) {
    req.project.webhookSigningSecret = require('crypto').randomBytes(32).toString('hex');
    await req.project.save();
  }

  res.render('projects/integrations/webhook', {
    title: `${req.project.name} webhook`,
    errorMessage: req.query.error || '',
    successMessage: req.query.success || ''
  });
}));

router.post(
  '/:id/integrations/webhook',
  [
    param('id').isMongoId(),
    body('webhookUrl')
      .optional({ checkFalsy: true })
      .trim()
      .isLength({ max: 500 })
      .withMessage('Webhook URL is too long.')
      .isURL({ require_protocol: true, protocols: ['http', 'https'] })
      .withMessage('Webhook URL must be a full URL, including https://.'),
    handleValidation
  ],
  loadProject,
  asyncHandler(async (req, res) => {
    req.project.webhookUrl = req.body.webhookUrl || '';
    if (!req.project.webhookSigningSecret) {
      req.project.webhookSigningSecret = require('crypto').randomBytes(32).toString('hex');
    }
    await req.project.save();
    res.redirect(`/projects/${req.project._id}/integrations/webhook?success=${encodeURIComponent('Outgoing webhook settings saved.')}`);
  })
);

router.get('/:id/competitors', [param('id').isMongoId(), handleValidation], loadProject, asyncHandler(async (req, res) => {
  let upgradeMessage = '';
  try {
    ensureFeature(req.user, 'competitors', 'Competitor tracking is available on Pro and Agency plans.', 'pro');
  } catch (error) {
    upgradeMessage = error.message;
  }

  const competitors = await Competitor.find({ projectId: req.project._id, userId: req.user._id }).sort({ createdAt: -1 });
  const pages = await CompetitorPage.find({ projectId: req.project._id });
  const latestInsights = await CompetitorInsight.find({ projectId: req.project._id }).sort({ createdAt: -1 }).limit(6);

  res.render('projects/competitors/index', {
    title: `${req.project.name} competitors`,
    competitors,
    pages,
    latestInsights,
    errorMessage: req.query.error || upgradeMessage,
    successMessage: req.query.success || ''
  });
}));

router.post('/:id/competitors', [param('id').isMongoId(), ...competitorValidation], loadProject, asyncHandler(async (req, res) => {
  try {
    ensureFeature(req.user, 'competitors', 'Competitor tracking is available on Pro and Agency plans.', 'pro');
  } catch (error) {
    return res.redirect(upgradeRedirect(req.project._id, error.message));
  }

  try {
    await Competitor.create({
      projectId: req.project._id,
      userId: req.user._id,
      name: req.body.name,
      websiteUrl: normalizeUrl(req.body.websiteUrl),
      notes: req.body.notes || ''
    });

    res.redirect(`/projects/${req.project._id}/competitors?success=${encodeURIComponent('Competitor added.')}`);
  } catch (error) {
    const message = error.code === 11000 ? 'That competitor website is already added to this project.' : error.message;
    res.redirect(`/projects/${req.project._id}/competitors?error=${encodeURIComponent(message)}`);
  }
}));

router.post(
  '/:id/competitors/:competitorId/scan',
  [param('id').isMongoId(), param('competitorId').isMongoId(), handleValidation],
  loadProject,
  loadCompetitor,
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

router.post('/:id/competitors/report', [param('id').isMongoId(), handleValidation], loadProject, asyncHandler(async (req, res) => {
  try {
    ensureFeature(req.user, 'competitors', 'Competitor tracking is available on Pro and Agency plans.', 'pro');
  } catch (error) {
    return res.redirect(upgradeRedirect(req.project._id, error.message));
  }

  const projectPages = await Page.find({ projectId: req.project._id }).sort({ lastCrawledAt: -1 }).limit(80);
  await discoverCompetitorsForProject({
    project: req.project,
    userId: req.user._id,
    projectPages
  });

  const insights = await generateCompetitorInsights({ projectId: req.project._id, userId: req.user._id });
  res.redirect(`/projects/${req.project._id}/competitors/insights?success=${encodeURIComponent(`${insights.length} competitor opportunities generated.`)}`);
}));

router.get('/:id/competitors/insights', [param('id').isMongoId(), handleValidation], loadProject, asyncHandler(async (req, res) => {
  const [competitors, insights] = await Promise.all([
    Competitor.find({ projectId: req.project._id, userId: req.user._id }).sort({ createdAt: -1 }),
    CompetitorInsight.find({ projectId: req.project._id }).sort({ priority: 1, createdAt: -1 })
  ]);

  res.render('projects/competitors/insights', {
    title: `${req.project.name} competitor opportunities`,
    competitors,
    insights,
    successMessage: req.query.success || ''
  });
}));

router.get(
  '/:id/competitors/:competitorId',
  [param('id').isMongoId(), param('competitorId').isMongoId(), handleValidation],
  loadProject,
  loadCompetitor,
  asyncHandler(async (req, res) => {
    const pages = await CompetitorPage.find({ projectId: req.project._id, competitorId: req.competitor._id }).sort({ lastCrawledAt: -1 });
    const insights = await CompetitorInsight.find({ projectId: req.project._id, competitorId: req.competitor._id }).sort({ priority: 1, createdAt: -1 });

    res.render('projects/competitors/show', {
      title: `${req.competitor.name} competitor`,
      pages,
      insights,
      successMessage: req.query.success || ''
    });
  })
);

router.post('/:id/reports/weekly', [param('id').isMongoId(), handleValidation], loadProject, asyncHandler(async (req, res) => {
  try {
    ensureFeature(req.user, 'reports', 'Weekly and monthly reports are available on Starter, Pro, and Agency plans.', 'starter');
  } catch (error) {
    return res.redirect(upgradeRedirect(req.project._id, error.message));
  }

  const report = await generateCmoReport({ project: req.project, userId: req.user._id, type: 'weekly' });
  res.redirect(`/projects/${req.project._id}/reports/${report._id}`);
}));

router.post('/:id/reports/monthly', [param('id').isMongoId(), handleValidation], loadProject, asyncHandler(async (req, res) => {
  try {
    ensureFeature(req.user, 'reports', 'Weekly and monthly reports are available on Starter, Pro, and Agency plans.', 'starter');
  } catch (error) {
    return res.redirect(upgradeRedirect(req.project._id, error.message));
  }

  const report = await generateCmoReport({ project: req.project, userId: req.user._id, type: 'monthly' });
  res.redirect(`/projects/${req.project._id}/reports/${report._id}`);
}));

router.get('/:id/reports', [param('id').isMongoId(), handleValidation], loadProject, asyncHandler(async (req, res) => {
  const reports = await CmoReport.find({ projectId: req.project._id, userId: req.user._id }).sort({ createdAt: -1 });
  res.render('projects/reports/index', {
    title: `${req.project.name} reports`,
    reports
  });
}));

router.get(
  '/:id/reports/:reportId',
  [param('id').isMongoId(), param('reportId').isMongoId(), handleValidation],
  loadProject,
  asyncHandler(async (req, res, next) => {
    const report = await CmoReport.findOne({
      _id: req.params.reportId,
      projectId: req.project._id,
      userId: req.user._id
    });

    if (!report) return next(new AppError('Report not found.', 404));

    res.render('projects/reports/show', {
      title: `${req.project.name} ${report.type} report`,
      report
    });
  })
);

router.get('/:id/scans', [param('id').isMongoId(), handleValidation], loadProject, asyncHandler(async (req, res) => {
  const scans = await Scan.find({ projectId: req.project._id }).sort({ createdAt: -1 });
  res.render('projects/scans/index', { title: `${req.project.name} scans`, scans });
}));

router.get(
  '/:id/scans/:scanId/live',
  [param('id').isMongoId(), param('scanId').isMongoId(), handleValidation],
  loadProject,
  loadScan,
  asyncHandler(async (req, res) => {
    const viewData = await loadScanViewData({
      project: req.project,
      scan: req.scan,
      userId: req.user._id
    });

    res.json(scanJson(req.scan, viewData));
  })
);

router.get(
  '/:id/scans/:scanId',
  [param('id').isMongoId(), param('scanId').isMongoId(), handleValidation],
  loadProject,
  loadScan,
  asyncHandler(async (req, res) => {
    const viewData = await loadScanViewData({
      project: req.project,
      scan: req.scan,
      userId: req.user._id
    });

    res.render('projects/scans/show', {
      title: `${req.project.name} scan`,
      ...viewData
    });
  })
);

router.get('/:id/pages', [param('id').isMongoId(), handleValidation], loadProject, asyncHandler(async (req, res) => {
  const latestScan = await Scan.findOne({ projectId: req.project._id }).sort({ createdAt: -1 });
  const query = latestScan ? { projectId: req.project._id, scanId: latestScan._id } : { projectId: req.project._id };
  const pages = await Page.find(query).sort({ url: 1 });

  res.render('projects/pages', {
    title: `${req.project.name} pages`,
    latestScan,
    pages
  });
}));

router.get('/:id', [param('id').isMongoId(), handleValidation], loadProject, asyncHandler(async (req, res) => {
  const [
    latestScan,
    recentScans,
    latestReport,
    connectedProperty,
    recentCmoReports,
    competitorCount,
    wordpressIntegration,
    latestCompetitorInsights
  ] = await Promise.all([
    Scan.findOne({ projectId: req.project._id }).sort({ createdAt: -1 }),
    Scan.find({ projectId: req.project._id }).sort({ createdAt: -1 }).limit(5),
    Report.findOne({ projectId: req.project._id }).sort({ createdAt: -1 }),
    ProjectSearchProperty.findOne({ projectId: req.project._id, userId: req.user._id }),
    CmoReport.find({ projectId: req.project._id, userId: req.user._id }).sort({ createdAt: -1 }).limit(3),
    Competitor.countDocuments({ projectId: req.project._id, userId: req.user._id }),
    WordPressIntegration.findOne({ projectId: req.project._id, userId: req.user._id }),
    CompetitorInsight.find({ projectId: req.project._id }).sort({ priority: 1, createdAt: -1 }).limit(4)
  ]);
  const telemetry = await auditTelemetry(req.project);

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
    aiError: req.query.aiError || '',
    limitMessage: req.query.limitMessage || ''
  });
}));

router.get('/:id/edit', [param('id').isMongoId(), handleValidation], loadProject, asyncHandler(async (req, res) => {
  if (!req.project.webhookSigningSecret) {
    req.project.webhookSigningSecret = require('crypto').randomBytes(32).toString('hex');
    await req.project.save();
  }
  res.render('projects/edit', { title: `Edit ${req.project.name}` });
}));

router.post('/:id', [param('id').isMongoId(), ...projectValidation], loadProject, asyncHandler(async (req, res) => {
  Object.assign(req.project, projectPayload(req));
  req.project.owner = req.user._id;
  await req.project.save();
  res.redirect(`/projects/${req.project._id}`);
}));

router.post('/:id/delete', [param('id').isMongoId(), handleValidation], loadProject, asyncHandler(async (req, res) => {
  await deleteProjectOwnedData({ project: req.project, userId: req.user._id });
  res.redirect('/projects');
}));

module.exports = router;
