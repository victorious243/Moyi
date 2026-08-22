const User = require('../models/User');
const Project = require('../models/Project');
const ProjectMember = require('../models/ProjectMember');
const Scan = require('../models/Scan');
const Page = require('../models/Page');
const SeoIssue = require('../models/SeoIssue');
const Report = require('../models/Report');
const CmoReport = require('../models/CmoReport');
const ProjectJob = require('../models/ProjectJob');
const Recommendation = require('../models/Recommendation');
const ContentDraft = require('../models/ContentDraft');
const ContentImage = require('../models/ContentImage');
const MediaAsset = require('../models/MediaAsset');
const ProjectSearchProperty = require('../models/ProjectSearchProperty');
const SearchMetric = require('../models/SearchMetric');
const Competitor = require('../models/Competitor');
const CompetitorPage = require('../models/CompetitorPage');
const CompetitorInsight = require('../models/CompetitorInsight');
const WordPressIntegration = require('../models/WordPressIntegration');
const WebflowIntegration = require('../models/WebflowIntegration');
const ShopifyIntegration = require('../models/ShopifyIntegration');
const PublishAction = require('../models/PublishAction');
const PublishBatch = require('../models/PublishBatch');
const PublishJob = require('../models/PublishJob');
const PublishJobEvent = require('../models/PublishJobEvent');
const EngagementSnapshot = require('../models/EngagementSnapshot');
const GrowthSignal = require('../models/GrowthSignal');
const WebhookDelivery = require('../models/WebhookDelivery');
const ConversionGoal = require('../models/ConversionGoal');
const TrackingEvent = require('../models/TrackingEvent');
const Campaign = require('../models/Campaign');
const SocialDraft = require('../models/SocialDraft');
const SocialAccount = require('../models/SocialAccount');
const SocialOAuthSession = require('../models/SocialOAuthSession');
const AnalyticsSnapshot = require('../models/AnalyticsSnapshot');
const AuditLog = require('../models/AuditLog');
const Organization = require('../models/Organization');
const OrganizationMember = require('../models/OrganizationMember');
const ApiCredential = require('../models/ApiCredential');
const GrowthAlert = require('../models/GrowthAlert');
const MarketingGoal = require('../models/MarketingGoal');
const NotificationDelivery = require('../models/NotificationDelivery');
const NotificationEndpoint = require('../models/NotificationEndpoint');
const NotificationRoute = require('../models/NotificationRoute');
const PaidAdAccount = require('../models/PaidAdAccount');
const PaidAdEntity = require('../models/PaidAdEntity');
const PaidMetricSnapshot = require('../models/PaidMetricSnapshot');
const PaidAttribution = require('../models/PaidAttribution');
const PaidBudgetRecommendation = require('../models/PaidBudgetRecommendation');
const Experiment = require('../models/Experiment');
const ExperimentObservation = require('../models/ExperimentObservation');
const ExperimentLearning = require('../models/ExperimentLearning');
const StrategicMetricSnapshot = require('../models/StrategicMetricSnapshot');
const StrategicForecast = require('../models/StrategicForecast');
const StrategicOpportunity = require('../models/StrategicOpportunity');
const StrategicDecision = require('../models/StrategicDecision');
const CompetitorSnapshot = require('../models/CompetitorSnapshot');
const StrategicReview = require('../models/StrategicReview');
const { deleteContentImagesForProject } = require('./contentImageService');
const { deleteMediaAssetsForProject } = require('./mediaAssetCleanupService');

function redactIntegration(integration) {
  if (!integration) return integration;
  const copy = integration.toObject ? integration.toObject() : { ...integration };
  ['accessToken', 'refreshToken', 'webhookSecret', 'encryptedPayload', 'encryptedUrl', 'encryptedSigningSecret', 'apiToken', 'appPassword', 'accessTokenEncrypted', 'apiTokenEncrypted', 'appPasswordEncrypted', 'encryptedAccessToken', 'encryptedRefreshToken'].forEach((key) => {
    if (copy[key]) copy[key] = '[encrypted credential redacted]';
  });
  return copy;
}

function createAccountDataService(deps = {}) {
  const models = {
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
    WebhookDelivery,
    ConversionGoal,
    TrackingEvent,
    Campaign,
    SocialDraft,
    SocialAccount,
    SocialOAuthSession,
    AnalyticsSnapshot,
    AuditLog,
    Organization,
    OrganizationMember,
    ApiCredential,
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
    deleteContentImagesForProject,
    deleteMediaAssetsForProject,
    ...deps
  };

  async function exportAccountData(userId) {
    const user = await models.User.findById(userId).select('-passwordHash -passwordResetTokenHash');
    const projects = await models.Project.find({ owner: userId }).lean();
    const projectIds = projects.map((project) => project._id);

    const [
      scans,
      pages,
      seoIssues,
      reports,
      cmoReports,
      projectJobs,
      recommendations,
      contentDrafts,
      contentImages,
      mediaAssets,
      searchProperties,
      searchMetrics,
      competitors,
      competitorPages,
      competitorInsights,
      wordpressIntegrations,
      webflowIntegrations,
      shopifyIntegrations,
      publishActions,
      publishBatches,
      publishJobs,
      webhookDeliveries,
      conversionGoals,
      trackingEvents,
      campaigns,
      socialDrafts,
      socialAccounts,
      analyticsSnapshots,
      projectMemberships,
      auditLogs,
      publishJobEvents,
      engagementSnapshots,
      growthSignals,
      organizations,
      organizationMemberships,
      apiCredentials,
      growthAlerts,
      marketingGoals,
      notificationDeliveries,
      notificationEndpoints,
      notificationRoutes,
      paidAdAccounts,
      paidAdEntities,
      paidMetricSnapshots,
      paidAttributions,
      paidBudgetRecommendations,
      experiments,
      experimentObservations,
      experimentLearnings,
      strategicMetricSnapshots,
      strategicForecasts,
      strategicOpportunities,
      strategicDecisions,
      competitorSnapshots,
      strategicReviews
    ] = await Promise.all([
      models.Scan.find({ projectId: { $in: projectIds } }).lean(),
      models.Page.find({ projectId: { $in: projectIds } }).lean(),
      models.SeoIssue.find({ project: { $in: projectIds } }).lean(),
      models.Report.find({ projectId: { $in: projectIds } }).lean(),
      models.CmoReport.find({ projectId: { $in: projectIds } }).lean(),
      models.ProjectJob.find({ projectId: { $in: projectIds } }).lean(),
      models.Recommendation.find({ projectId: { $in: projectIds } }).lean(),
      models.ContentDraft.find({ projectId: { $in: projectIds } }).lean(),
      models.ContentImage.find({ projectId: { $in: projectIds } }).select('-storageKey').lean(),
      models.MediaAsset.find({ projectId: { $in: projectIds } }).select('-storageKey').lean(),
      models.ProjectSearchProperty.find({ projectId: { $in: projectIds } }).lean(),
      models.SearchMetric.find({ projectId: { $in: projectIds } }).lean(),
      models.Competitor.find({ projectId: { $in: projectIds } }).lean(),
      models.CompetitorPage.find({ projectId: { $in: projectIds } }).lean(),
      models.CompetitorInsight.find({ projectId: { $in: projectIds } }).lean(),
      models.WordPressIntegration.find({ projectId: { $in: projectIds } }),
      models.WebflowIntegration.find({ projectId: { $in: projectIds } }),
      models.ShopifyIntegration.find({ projectId: { $in: projectIds } }),
      models.PublishAction.find({ projectId: { $in: projectIds } }).lean(),
      models.PublishBatch.find({ projectId: { $in: projectIds } }).lean(),
      models.PublishJob.find({ projectId: { $in: projectIds } }).lean(),
      models.WebhookDelivery.find({ projectId: { $in: projectIds } }).lean(),
      models.ConversionGoal.find({ projectId: { $in: projectIds } }).lean(),
      models.TrackingEvent.find({ projectId: { $in: projectIds } }).limit(5000).lean(),
      models.Campaign.find({ projectId: { $in: projectIds } }).lean(),
      models.SocialDraft.find({ projectId: { $in: projectIds } }).lean(),
      models.SocialAccount.find({ projectId: { $in: projectIds }, userId }),
      models.AnalyticsSnapshot.find({ project: { $in: projectIds } }).lean(),
      models.ProjectMember.find({ $or: [{ userId }, { projectId: { $in: projectIds } }] }).lean(),
      models.AuditLog.find({ actorUserId: userId }).sort({ createdAt: -1 }).limit(500).lean(),
      models.PublishJobEvent.find({
        $or: [{ projectId: { $in: projectIds } }, { destinationProjectId: { $in: projectIds } }]
      }).lean(),
      models.EngagementSnapshot.find({
        $or: [{ projectId: { $in: projectIds } }, { sourceProjectId: { $in: projectIds } }]
      }).lean(),
      models.GrowthSignal.find({
        $or: [{ projectId: { $in: projectIds } }, { sourceProjectId: { $in: projectIds } }]
      }).lean(),
      models.Organization.find({ ownerId: userId }).lean(),
      models.OrganizationMember.find({ userId }).populate('organizationId', 'name slug status').lean(),
      models.ApiCredential.find({ userId }).select('+prefix').populate('projectIds', 'name').lean(),
      models.GrowthAlert.find({ projectId: { $in: projectIds } }).lean(),
      models.MarketingGoal.find({ projectId: { $in: projectIds } }).lean(),
      models.NotificationDelivery.find({ projectId: { $in: projectIds } }).lean(),
      models.NotificationEndpoint.find({ projectId: { $in: projectIds } }).lean(),
      models.NotificationRoute.find({ projectId: { $in: projectIds } }).lean(),
      models.PaidAdAccount.find({ projectId: { $in: projectIds } }).select('+encryptedAccessToken +encryptedRefreshToken'),
      models.PaidAdEntity.find({ projectId: { $in: projectIds } }).lean(),
      models.PaidMetricSnapshot.find({ projectId: { $in: projectIds } }).limit(10000).lean(),
      models.PaidAttribution.find({ projectId: { $in: projectIds } }).limit(10000).lean(),
      models.PaidBudgetRecommendation.find({ projectId: { $in: projectIds } }).lean(),
      models.Experiment.find({ projectId: { $in: projectIds } }).lean(),
      models.ExperimentObservation.find({ projectId: { $in: projectIds } }).limit(10000).lean(),
      models.ExperimentLearning.find({ projectId: { $in: projectIds } }).lean(),
      models.StrategicMetricSnapshot.find({ projectId: { $in: projectIds } }).limit(10000).lean(),
      models.StrategicForecast.find({ projectId: { $in: projectIds } }).lean(),
      models.StrategicOpportunity.find({ projectId: { $in: projectIds } }).lean(),
      models.StrategicDecision.find({ projectId: { $in: projectIds } }).lean(),
      models.CompetitorSnapshot.find({ projectId: { $in: projectIds } }).lean(),
      models.StrategicReview.find({ projectId: { $in: projectIds } }).lean()
    ]);

    return {
      exportedAt: new Date().toISOString(),
      account: user ? user.toObject() : null,
      projects,
      scans,
      pages,
      seoIssues,
      reports,
      cmoReports,
      projectJobs,
      recommendations,
      contentDrafts,
      contentImages,
      mediaAssets,
      searchConsole: {
        properties: searchProperties,
        metrics: searchMetrics
      },
      competitors,
      competitorPages,
      competitorInsights,
      integrations: {
        wordpress: wordpressIntegrations.map(redactIntegration),
        webflow: webflowIntegrations.map(redactIntegration),
        shopify: shopifyIntegrations.map(redactIntegration)
      },
      publishActions,
      publishBatches,
      publishJobs,
      publishJobEvents,
      engagementSnapshots,
      growthSignals,
      webhookDeliveries,
      conversionGoals,
      trackingEvents,
      campaigns,
      socialDrafts,
      socialAccounts: socialAccounts.map(redactIntegration),
      analyticsSnapshots,
      projectMemberships,
      organizations,
      organizationMemberships,
      apiCredentials,
      growthAlerts,
      marketingGoals,
      notificationDeliveries,
      notificationEndpoints: notificationEndpoints.map(redactIntegration),
      notificationRoutes,
      paidAdvertising: {
        accounts: paidAdAccounts.map(redactIntegration),
        entities: paidAdEntities,
        metricSnapshots: paidMetricSnapshots,
        attributions: paidAttributions,
        budgetRecommendations: paidBudgetRecommendations
      },
      experimentation: {
        experiments,
        observations: experimentObservations,
        learnings: experimentLearnings
      },
      strategicIntelligence: {
        metricSnapshots: strategicMetricSnapshots,
        forecasts: strategicForecasts,
        opportunities: strategicOpportunities,
        decisions: strategicDecisions,
        competitorSnapshots,
        monthlyReviews: strategicReviews
      },
      auditLogs
    };
  }

  async function deleteProjectOwnedData({ projectId }) {
    const publishJobIds = await models.PublishJob.find({
      $or: [{ projectId }, { destinationProjectId: projectId }]
    }).distinct('_id');
    const blueskyAccounts = await models.SocialAccount.find({ projectId, platform: 'bluesky' }).select('metadata').lean();
    const sessionKeys = blueskyAccounts
      .map((account) => account.metadata && account.metadata.oauthSessionKey)
      .filter(Boolean)
      .map(String);
    await Promise.all([
      models.deleteContentImagesForProject(projectId),
      models.deleteMediaAssetsForProject(projectId)
    ]);
    await Promise.all([
      models.Page.deleteMany({ projectId }),
      models.Scan.deleteMany({ projectId }),
      models.SeoIssue.deleteMany({ project: projectId }),
      models.Report.deleteMany({ projectId }),
      models.CmoReport.deleteMany({ projectId }),
      models.ProjectJob.deleteMany({ projectId }),
      models.Recommendation.deleteMany({ projectId }),
      models.ContentDraft.deleteMany({ projectId }),
      models.ProjectSearchProperty.deleteMany({ projectId }),
      models.SearchMetric.deleteMany({ projectId }),
      models.Competitor.deleteMany({ projectId }),
      models.CompetitorPage.deleteMany({ projectId }),
      models.CompetitorInsight.deleteMany({ projectId }),
      models.WordPressIntegration.deleteMany({ projectId }),
      models.WebflowIntegration.deleteMany({ projectId }),
      models.ShopifyIntegration.deleteMany({ projectId }),
      models.PublishAction.deleteMany({ projectId }),
      models.PublishBatch.deleteMany({ projectId }),
      models.PublishJob.deleteMany({ _id: { $in: publishJobIds } }),
      models.PublishJobEvent.deleteMany({
        $or: [
          { publishJobId: { $in: publishJobIds } },
          { projectId },
          { destinationProjectId: projectId }
        ]
      }),
      models.EngagementSnapshot.deleteMany({
        $or: [{ publishJobId: { $in: publishJobIds } }, { projectId }, { sourceProjectId: projectId }]
      }),
      models.GrowthSignal.deleteMany({
        $or: [{ publishJobId: { $in: publishJobIds } }, { projectId }, { sourceProjectId: projectId }]
      }),
      models.WebhookDelivery.deleteMany({ projectId }),
      models.ConversionGoal.deleteMany({ projectId }),
      models.TrackingEvent.deleteMany({ projectId }),
      models.Campaign.deleteMany({ projectId }),
      models.SocialDraft.deleteMany({ projectId }),
      models.SocialAccount.deleteMany({ projectId }),
      sessionKeys.length
        ? models.SocialOAuthSession.deleteMany({ platform: 'bluesky', kind: 'session', key: { $in: sessionKeys } })
        : Promise.resolve(),
      models.AnalyticsSnapshot.deleteMany({ project: projectId }),
      models.GrowthAlert.deleteMany({ projectId }),
      models.MarketingGoal.deleteMany({ projectId }),
      models.NotificationDelivery.deleteMany({ projectId }),
      models.NotificationEndpoint.deleteMany({ projectId }),
      models.NotificationRoute.deleteMany({ projectId }),
      models.PaidMetricSnapshot.deleteMany({ projectId }),
      models.PaidAdEntity.deleteMany({ projectId }),
      models.PaidAttribution.deleteMany({ projectId }),
      models.PaidBudgetRecommendation.deleteMany({ projectId }),
      models.PaidAdAccount.deleteMany({ projectId }),
      models.ExperimentObservation.deleteMany({ projectId }),
      models.ExperimentLearning.deleteMany({ projectId }),
      models.Experiment.deleteMany({ projectId }),
      models.StrategicMetricSnapshot.deleteMany({ projectId }),
      models.StrategicForecast.deleteMany({ projectId }),
      models.StrategicOpportunity.deleteMany({ projectId }),
      models.StrategicDecision.deleteMany({ projectId }),
      models.CompetitorSnapshot.deleteMany({ projectId }),
      models.StrategicReview.deleteMany({ projectId }),
      models.ProjectMember.deleteMany({ projectId })
    ]);
    await models.ApiCredential.updateMany({ projectIds: projectId }, { $pull: { projectIds: projectId } });
    await models.ApiCredential.updateMany({ projectIds: { $size: 0 } }, { $set: { status: 'revoked' } });
  }

  async function deleteAccountData(userId) {
    const projects = await models.Project.find({ owner: userId }).select('_id').lean();
    const ownedOrganizations = await models.Organization.find({ ownerId: userId }).select('_id').lean();
    const ownedOrganizationIds = ownedOrganizations.map((organization) => organization._id);
    await Promise.all(projects.map((project) => deleteProjectOwnedData({ projectId: project._id })));
    await Promise.all([
      models.ProjectMember.deleteMany({ userId }),
      models.OrganizationMember.deleteMany({
        $or: [{ userId }, { organizationId: { $in: ownedOrganizationIds } }]
      }),
      models.ApiCredential.deleteMany({ userId }),
      models.Project.updateMany(
        { organizationId: { $in: ownedOrganizationIds }, owner: { $ne: userId } },
        { $set: { organizationId: null } }
      )
    ]);
    await models.Organization.deleteMany({ _id: { $in: ownedOrganizationIds } });
    await models.Project.deleteMany({ owner: userId });
    await models.User.deleteOne({ _id: userId });
    return { deletedProjects: projects.length };
  }

  return {
    deleteAccountData,
    deleteProjectOwnedData,
    exportAccountData
  };
}

module.exports = {
  createAccountDataService,
  deleteAccountData: createAccountDataService().deleteAccountData,
  deleteProjectOwnedData: createAccountDataService().deleteProjectOwnedData,
  exportAccountData: createAccountDataService().exportAccountData,
  redactIntegration
};
