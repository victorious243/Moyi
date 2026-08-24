const { body } = require('express-validator');
const User = require('../../models/User');
const Project = require('../../models/Project');
const ProjectMember = require('../../models/ProjectMember');
const Scan = require('../../models/Scan');
const Page = require('../../models/Page');
const SeoIssue = require('../../models/SeoIssue');
const Report = require('../../models/Report');
const CmoReport = require('../../models/CmoReport');
const ProjectJob = require('../../models/ProjectJob');
const Recommendation = require('../../models/Recommendation');
const ContentDraft = require('../../models/ContentDraft');
const ContentImage = require('../../models/ContentImage');
const MediaAsset = require('../../models/MediaAsset');
const ProjectSearchProperty = require('../../models/ProjectSearchProperty');
const SearchMetric = require('../../models/SearchMetric');
const Competitor = require('../../models/Competitor');
const CompetitorPage = require('../../models/CompetitorPage');
const CompetitorInsight = require('../../models/CompetitorInsight');
const WordPressIntegration = require('../../models/WordPressIntegration');
const WebflowIntegration = require('../../models/WebflowIntegration');
const ShopifyIntegration = require('../../models/ShopifyIntegration');
const PublishAction = require('../../models/PublishAction');
const PublishBatch = require('../../models/PublishBatch');
const PublishJob = require('../../models/PublishJob');
const PublishJobEvent = require('../../models/PublishJobEvent');
const EngagementSnapshot = require('../../models/EngagementSnapshot');
const GrowthSignal = require('../../models/GrowthSignal');
const SocialPostPerformance = require('../../models/SocialPostPerformance');
const ApiCredential = require('../../models/ApiCredential');
const WebhookDelivery = require('../../models/WebhookDelivery');
const ConversionGoal = require('../../models/ConversionGoal');
const TrackingEvent = require('../../models/TrackingEvent');
const Campaign = require('../../models/Campaign');
const SocialDraft = require('../../models/SocialDraft');
const SocialAccount = require('../../models/SocialAccount');
const SocialOAuthSession = require('../../models/SocialOAuthSession');
const AnalyticsSnapshot = require('../../models/AnalyticsSnapshot');
const GrowthAlert = require('../../models/GrowthAlert');
const MarketingGoal = require('../../models/MarketingGoal');
const NotificationDelivery = require('../../models/NotificationDelivery');
const NotificationEndpoint = require('../../models/NotificationEndpoint');
const NotificationRoute = require('../../models/NotificationRoute');
const PaidAdAccount = require('../../models/PaidAdAccount');
const PaidAdEntity = require('../../models/PaidAdEntity');
const PaidMetricSnapshot = require('../../models/PaidMetricSnapshot');
const PaidAttribution = require('../../models/PaidAttribution');
const PaidBudgetRecommendation = require('../../models/PaidBudgetRecommendation');
const Experiment = require('../../models/Experiment');
const ExperimentObservation = require('../../models/ExperimentObservation');
const ExperimentLearning = require('../../models/ExperimentLearning');
const StrategicMetricSnapshot = require('../../models/StrategicMetricSnapshot');
const StrategicForecast = require('../../models/StrategicForecast');
const StrategicOpportunity = require('../../models/StrategicOpportunity');
const StrategicDecision = require('../../models/StrategicDecision');
const CompetitorSnapshot = require('../../models/CompetitorSnapshot');
const StrategicReview = require('../../models/StrategicReview');
const AppError = require('../../utils/appError');
const handleValidation = require('../../utils/validate');
const { normalizeUrl } = require('../../utils/url');
const { normalizeShopDomain } = require('../../services/shopifyService');
const { summarizeIssues } = require('../../services/auditService');
const { recordAuditEvent } = require('../../services/auditLogService');
const { deleteContentImagesForProject } = require('../../services/contentImageService');
const { deleteMediaAssetsForProject } = require('../../services/mediaAssetCleanupService');
const {
  hasProjectLogo,
  openDownloadStream: openProjectLogoStream,
  removeProjectLogo,
  saveProjectLogo
} = require('../../services/projectLogoService');
const { retryFailedJob } = require('../../services/projectTaskService');
const { canChangeProjectRole, canManageProjectRole, canPublishProjectRole, isUnsafeMethod, projectAccessRole } = require('../../services/projectAccessService');

function buildProjectsContext(overrides = {}) {
  const deps = {
    User,
    Project,
    ProjectMember,
    Scan,
    Page,
    SeoIssue,
    Report,
    CmoReport,
    ProjectJob,
    Recommendation,
    ContentDraft,
    ContentImage,
    MediaAsset,
    ProjectSearchProperty,
    SearchMetric,
    Competitor,
    CompetitorPage,
    CompetitorInsight,
    WordPressIntegration,
    WebflowIntegration,
    ShopifyIntegration,
    PublishAction,
    PublishBatch,
    PublishJob,
    PublishJobEvent,
    EngagementSnapshot,
    GrowthSignal,
    SocialPostPerformance,
    ApiCredential,
    WebhookDelivery,
    ConversionGoal,
    TrackingEvent,
    Campaign,
    SocialDraft,
    SocialAccount,
    SocialOAuthSession,
    AnalyticsSnapshot,
    GrowthAlert,
    MarketingGoal,
    NotificationDelivery,
    NotificationEndpoint,
    NotificationRoute,
    PaidAdAccount,
    PaidAdEntity,
    PaidMetricSnapshot,
    PaidAttribution,
    PaidBudgetRecommendation,
    Experiment,
    ExperimentObservation,
    ExperimentLearning,
    StrategicMetricSnapshot,
    StrategicForecast,
    StrategicOpportunity,
    StrategicDecision,
    CompetitorSnapshot,
    StrategicReview,
    AppError,
    handleValidation,
    normalizeUrl,
    normalizeShopDomain,
    summarizeIssues,
    recordAuditEvent,
    deleteContentImagesForProject,
    deleteMediaAssetsForProject,
    hasProjectLogo,
    openProjectLogoStream,
    removeProjectLogo,
    saveProjectLogo,
    retryFailedJob,
    canManageProjectRole,
    canChangeProjectRole,
    canPublishProjectRole,
    isUnsafeMethod,
    projectAccessRole,
    ...overrides
  };

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
      name: req.body.name,
      websiteUrl: deps.normalizeUrl(req.body.websiteUrl),
      industry: req.body.industry || '',
      targetAudience: req.body.targetAudience || '',
      targetCountry: req.body.targetCountry || '',
      targetCity: req.body.targetCity || '',
      businessModel: req.body.businessModel || '',
      mainGoal: req.body.mainGoal || '',
      mainOffer: req.body.mainOffer || '',
      brandTone: req.body.brandTone || '',
      competitors: parseCompetitors(req.body.competitors),
      webhookUrl: req.body.webhookUrl || ''
    };
  }

  function loadProject(req, res, next) {
    deps.Project.findById(req.params.id)
      .then(async (project) => {
        if (!project) return next(new deps.AppError('Project not found.', 404));
        const role = await deps.projectAccessRole({ project, userId: req.user._id });
        if (!role) return next(new deps.AppError('Project not found.', 404));
        if (deps.isUnsafeMethod(req.method) && !deps.canChangeProjectRole(role)) {
          return next(new deps.AppError('You do not have permission to change this project.', 403));
        }

        req.project = project;
        req.projectAccessRole = role;
        res.locals.project = project;
        res.locals.projectAccessRole = role;
        res.locals.canManageProject = deps.canChangeProjectRole(role);
        res.locals.canPublishProject = deps.canPublishProjectRole(role);
        next();
      })
      .catch(next);
  }

  function loadScan(req, res, next) {
    deps.Scan.findOne({ _id: req.params.scanId, projectId: req.project._id })
      .then((scan) => {
        if (!scan) return next(new deps.AppError('Scan not found.', 404));

        req.scan = scan;
        res.locals.scan = scan;
        next();
      })
      .catch(next);
  }

  function loadCompetitor(req, res, next) {
    deps.Competitor.findOne({
      _id: req.params.competitorId,
      projectId: req.project._id,
      userId: req.user._id
    })
      .then((competitor) => {
        if (!competitor) return next(new deps.AppError('Competitor not found.', 404));

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

  async function loadScanViewData({ project, scan, userId }) {
    const [pages, issues, recommendations, competitors, competitorInsights] = await Promise.all([
      deps.Page.find({ scanId: scan._id }).sort({ statusCode: -1, url: 1 }),
      deps.SeoIssue.find({ scan: scan._id }).sort({ createdAt: -1, severity: 1 }),
      deps.Recommendation.find({ projectId: project._id, auditId: scan._id }).sort({ priority: -1, createdAt: 1 }),
      deps.Competitor.find({ projectId: project._id, userId }).sort({ createdAt: -1 }).limit(3),
      deps.CompetitorInsight.find({ projectId: project._id }).sort({ priority: 1, createdAt: -1 }).limit(4)
    ]);
    const failedPages = pages.filter((page) => page.statusCode === 0 || page.statusCode >= 400);
    const issueSummary = deps.summarizeIssues(issues, pages);

    return {
      competitors,
      competitorInsights,
      failedPages,
      issueSummary,
      issues,
      pages,
      recommendations
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
    const publishJobIds = await deps.PublishJob.find({
      $or: [{ projectId: project._id }, { destinationProjectId: project._id }]
    }).distinct('_id');
    const blueskyAccounts = await deps.SocialAccount.find({ projectId: project._id, platform: 'bluesky' })
      .select('metadata')
      .lean();
    const sessionKeys = blueskyAccounts
      .map((account) => account.metadata && account.metadata.oauthSessionKey)
      .filter(Boolean)
      .map(String);
    await Promise.all([
      deps.deleteContentImagesForProject(project._id),
      deps.deleteMediaAssetsForProject(project._id)
    ]);
    if (deps.hasProjectLogo(project)) {
      await deps.removeProjectLogo(project);
    }
    await Promise.all([
      deps.Page.deleteMany({ projectId: project._id }),
      deps.Scan.deleteMany({ projectId: project._id }),
      deps.SeoIssue.deleteMany({ project: project._id }),
      deps.Report.deleteMany({ projectId: project._id }),
      deps.CmoReport.deleteMany({ projectId: project._id }),
      deps.ProjectJob.deleteMany({ projectId: project._id }),
      deps.Recommendation.deleteMany({ projectId: project._id }),
      deps.ContentDraft.deleteMany({ projectId: project._id }),
      deps.ProjectSearchProperty.deleteMany({ projectId: project._id }),
      deps.SearchMetric.deleteMany({ projectId: project._id }),
      deps.Competitor.deleteMany({ projectId: project._id }),
      deps.CompetitorPage.deleteMany({ projectId: project._id }),
      deps.CompetitorInsight.deleteMany({ projectId: project._id }),
      deps.WordPressIntegration.deleteMany({ projectId: project._id }),
      deps.WebflowIntegration.deleteMany({ projectId: project._id }),
      deps.ShopifyIntegration.deleteMany({ projectId: project._id }),
      deps.PublishAction.deleteMany({ projectId: project._id }),
      deps.PublishBatch.deleteMany({ projectId: project._id }),
      deps.PublishJob.deleteMany({ _id: { $in: publishJobIds } }),
      deps.PublishJobEvent.deleteMany({
        $or: [
          { publishJobId: { $in: publishJobIds } },
          { projectId: project._id },
          { destinationProjectId: project._id }
        ]
      }),
      deps.EngagementSnapshot.deleteMany({
        $or: [
          { publishJobId: { $in: publishJobIds } },
          { projectId: project._id },
          { sourceProjectId: project._id }
        ]
      }),
      deps.GrowthSignal.deleteMany({
        $or: [
          { publishJobId: { $in: publishJobIds } },
          { projectId: project._id },
          { sourceProjectId: project._id }
        ]
      }),
      deps.SocialPostPerformance.deleteMany({
        $or: [
          { publishJobId: { $in: publishJobIds } },
          { projectId: project._id },
          { sourceProjectId: project._id }
        ]
      }),
      deps.WebhookDelivery.deleteMany({ projectId: project._id }),
      deps.ConversionGoal.deleteMany({ projectId: project._id }),
      deps.TrackingEvent.deleteMany({ projectId: project._id }),
      deps.Campaign.deleteMany({ projectId: project._id }),
      deps.SocialDraft.deleteMany({ projectId: project._id }),
      deps.SocialAccount.deleteMany({ projectId: project._id }),
      sessionKeys.length
        ? deps.SocialOAuthSession.deleteMany({ platform: 'bluesky', kind: 'session', key: { $in: sessionKeys } })
        : Promise.resolve(),
      deps.AnalyticsSnapshot.deleteMany({ project: project._id }),
      deps.GrowthAlert.deleteMany({ projectId: project._id }),
      deps.MarketingGoal.deleteMany({ projectId: project._id }),
      deps.NotificationDelivery.deleteMany({ projectId: project._id }),
      deps.NotificationEndpoint.deleteMany({ projectId: project._id }),
      deps.NotificationRoute.deleteMany({ projectId: project._id }),
      deps.PaidMetricSnapshot.deleteMany({ projectId: project._id }),
      deps.PaidAdEntity.deleteMany({ projectId: project._id }),
      deps.PaidAttribution.deleteMany({ projectId: project._id }),
      deps.PaidBudgetRecommendation.deleteMany({ projectId: project._id }),
      deps.PaidAdAccount.deleteMany({ projectId: project._id }),
      deps.ExperimentObservation.deleteMany({ projectId: project._id }),
      deps.ExperimentLearning.deleteMany({ projectId: project._id }),
      deps.Experiment.deleteMany({ projectId: project._id }),
      deps.StrategicMetricSnapshot.deleteMany({ projectId: project._id }),
      deps.StrategicForecast.deleteMany({ projectId: project._id }),
      deps.StrategicOpportunity.deleteMany({ projectId: project._id }),
      deps.StrategicDecision.deleteMany({ projectId: project._id }),
      deps.CompetitorSnapshot.deleteMany({ projectId: project._id }),
      deps.StrategicReview.deleteMany({ projectId: project._id }),
      deps.ProjectMember.deleteMany({ projectId: project._id })
    ]);
    await deps.ApiCredential.updateMany({ projectIds: project._id }, { $pull: { projectIds: project._id } });
    await deps.ApiCredential.updateMany({ projectIds: { $size: 0 } }, { $set: { status: 'revoked' } });

    await deps.Project.deleteOne({ _id: project._id, owner: userId });
  }

  return {
    ...deps,
    projectValidation: [
      body('name').trim().notEmpty().withMessage('Project name is required.'),
      body('websiteUrl')
        .trim()
        .notEmpty()
        .withMessage('Website URL is required.')
        .custom((value) => {
          try {
            deps.normalizeUrl(value);
            return true;
          } catch (error) {
            throw new Error('Website URL must be valid.');
          }
        }),
      body('industry').optional({ checkFalsy: true }).trim().isLength({ max: 120 }).withMessage('Industry is too long.'),
      body('targetAudience').optional({ checkFalsy: true }).trim().isLength({ max: 240 }).withMessage('Target audience is too long.'),
      body('targetCountry').optional({ checkFalsy: true }).trim().isLength({ max: 80 }).withMessage('Target country is too long.'),
      body('targetCity').optional({ checkFalsy: true }).trim().isLength({ max: 100 }).withMessage('Target city is too long.'),
      body('businessModel')
        .optional({ checkFalsy: true })
        .isIn(['saas', 'ecommerce', 'marketplace', 'agency', 'professional_services', 'local_service', 'retail', 'media', 'nonprofit', 'other'])
        .withMessage('Choose a valid business model.'),
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
      deps.handleValidation
    ],
    competitorValidation: [
      body('name').trim().notEmpty().withMessage('Competitor name is required.').isLength({ max: 120 }).withMessage('Competitor name is too long.'),
      body('websiteUrl')
        .trim()
        .notEmpty()
        .withMessage('Competitor website URL is required.')
        .custom((value) => {
          try {
            deps.normalizeUrl(value);
            return true;
          } catch (error) {
            throw new Error('Competitor website URL must be valid.');
          }
        }),
      body('notes').optional({ checkFalsy: true }).trim().isLength({ max: 500 }).withMessage('Notes are too long.'),
      body('classification')
        .optional({ checkFalsy: true })
        .isIn(['direct', 'indirect', 'aspirational'])
        .withMessage('Choose a valid competitor type.'),
      body('businessModel')
        .optional({ checkFalsy: true })
        .isIn(['saas', 'ecommerce', 'marketplace', 'agency', 'professional_services', 'local_service', 'retail', 'media', 'nonprofit', 'other'])
        .withMessage('Choose a valid competitor business model.'),
      body('locationRelevance')
        .optional({ checkFalsy: true })
        .isIn(['local', 'regional', 'national', 'global', 'unknown'])
        .withMessage('Choose a valid competitor market reach.'),
      deps.handleValidation
    ],
    wordpressValidation: [
      body('siteUrl')
        .trim()
        .notEmpty()
        .withMessage('WordPress site URL is required.')
        .custom((value) => {
          try {
            deps.normalizeUrl(value);
            return true;
          } catch (error) {
            throw new Error('WordPress site URL must be valid.');
          }
        }),
      body('username').trim().notEmpty().withMessage('WordPress username is required.').isLength({ max: 120 }).withMessage('WordPress username is too long.'),
      body('appPassword').trim().notEmpty().withMessage('Application password is required.').isLength({ max: 240 }).withMessage('Application password is too long.'),
      deps.handleValidation
    ],
    webflowValidation: [
      body('siteId').optional({ checkFalsy: true }).trim().isLength({ max: 120 }).withMessage('Webflow site ID is too long.'),
      body('collectionId').trim().notEmpty().withMessage('Webflow collection ID is required.').isLength({ max: 160 }).withMessage('Webflow collection ID is too long.'),
      body('apiToken').trim().notEmpty().withMessage('Webflow API token is required.').isLength({ max: 500 }).withMessage('Webflow API token is too long.'),
      body('titleField').optional({ checkFalsy: true }).trim().isLength({ max: 80 }).withMessage('Title field is too long.'),
      body('slugField').optional({ checkFalsy: true }).trim().isLength({ max: 80 }).withMessage('Slug field is too long.'),
      body('bodyField').optional({ checkFalsy: true }).trim().isLength({ max: 80 }).withMessage('Body field is too long.'),
      deps.handleValidation
    ],
    shopifyValidation: [
      body('shopDomain')
        .trim()
        .notEmpty()
        .withMessage('Shopify shop domain is required.')
        .custom((value) => {
          try {
            deps.normalizeShopDomain(value);
            return true;
          } catch (error) {
            throw new Error(error.message);
          }
        }),
      body('blogId').trim().notEmpty().withMessage('Shopify blog ID is required.').isLength({ max: 120 }).withMessage('Shopify blog ID is too long.'),
      body('accessToken').trim().notEmpty().withMessage('Shopify access token is required.').isLength({ max: 500 }).withMessage('Shopify access token is too long.'),
      body('apiVersion').optional({ checkFalsy: true }).trim().matches(/^\d{4}-\d{2}$/).withMessage('API version must look like 2025-01.'),
      deps.handleValidation
    ],
    conversionGoalValidation: [
      body('name').trim().notEmpty().withMessage('Goal name is required.').isLength({ max: 120 }).withMessage('Goal name is too long.'),
      body('eventName').trim().notEmpty().withMessage('Event name is required.').isLength({ max: 120 }).withMessage('Event name is too long.'),
      body('urlPattern').optional({ checkFalsy: true }).trim().isLength({ max: 300 }).withMessage('URL pattern is too long.'),
      deps.handleValidation
    ],
    campaignValidation: [
      body('name').trim().notEmpty().withMessage('Campaign name is required.').isLength({ max: 160 }).withMessage('Campaign name is too long.'),
      body('goal').optional({ checkFalsy: true }).trim().isLength({ max: 500 }).withMessage('Campaign goal is too long.'),
      body('channel').isIn(['bluesky', 'linkedin', 'facebook', 'x', 'instagram', 'threads', 'tiktok', 'youtube', 'email', 'multi']).withMessage('Campaign channel is invalid.'),
      body('startDate').isISO8601().withMessage('Start date is required.'),
      body('endDate').isISO8601().withMessage('End date is required.'),
      body('status').optional({ checkFalsy: true }).isIn(['planned', 'active', 'completed', 'paused']).withMessage('Campaign status is invalid.'),
      body('dailySpendLimit').optional({ checkFalsy: true }).isFloat({ min: 0, max: 10000 }).withMessage('Daily spend limit is invalid.'),
      body('monthlySpendLimit').optional({ checkFalsy: true }).isFloat({ min: 0, max: 250000 }).withMessage('Monthly spend limit is invalid.'),
      deps.handleValidation
    ],
    projectMemberValidation: [
      body('email').isEmail().withMessage('Valid team member email is required.').normalizeEmail(),
      body('role').isIn(['admin', 'member']).withMessage('Team role is invalid.'),
      deps.handleValidation
    ],
    gscOpportunityDraftValidation: [
      body('opportunityType').isIn(['boost_ctr', 'push_to_page_one']).withMessage('Opportunity type is invalid.'),
      body('query').trim().notEmpty().isLength({ max: 240 }).withMessage('Query is required.'),
      body('page')
        .trim()
        .notEmpty()
        .withMessage('Target page is required.')
        .custom((value) => {
          try {
            deps.normalizeUrl(value);
            return true;
          } catch (error) {
            throw new Error('Target page must be valid.');
          }
        }),
      deps.handleValidation
    ],
    competitorLabel,
    deleteProjectOwnedData,
    loadCompetitor,
    loadProject,
    loadScan,
    loadScanViewData,
    normalizeDays,
    parseCompetitors,
    parseJsonField,
    parsePropertySelection,
    personaSummary,
    projectPayload,
    scanJson
  };
}

module.exports = {
  buildProjectsContext
};
