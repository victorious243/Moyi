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
const ProjectSearchProperty = require('../models/ProjectSearchProperty');
const SearchMetric = require('../models/SearchMetric');
const Competitor = require('../models/Competitor');
const CompetitorPage = require('../models/CompetitorPage');
const CompetitorInsight = require('../models/CompetitorInsight');
const WordPressIntegration = require('../models/WordPressIntegration');
const WebflowIntegration = require('../models/WebflowIntegration');
const ShopifyIntegration = require('../models/ShopifyIntegration');
const PublishAction = require('../models/PublishAction');
const WebhookDelivery = require('../models/WebhookDelivery');
const ConversionGoal = require('../models/ConversionGoal');
const TrackingEvent = require('../models/TrackingEvent');
const Campaign = require('../models/Campaign');
const SocialDraft = require('../models/SocialDraft');
const AnalyticsSnapshot = require('../models/AnalyticsSnapshot');
const AuditLog = require('../models/AuditLog');
const { deleteContentImagesForProject } = require('./contentImageService');

function redactIntegration(integration) {
  if (!integration) return integration;
  const copy = integration.toObject ? integration.toObject() : { ...integration };
  ['accessToken', 'apiToken', 'appPassword', 'accessTokenEncrypted', 'apiTokenEncrypted', 'appPasswordEncrypted'].forEach((key) => {
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
    ProjectSearchProperty,
    SearchMetric,
    Competitor,
    CompetitorPage,
    CompetitorInsight,
    WordPressIntegration,
    WebflowIntegration,
    ShopifyIntegration,
    PublishAction,
    WebhookDelivery,
    ConversionGoal,
    TrackingEvent,
    Campaign,
    SocialDraft,
    AnalyticsSnapshot,
    AuditLog,
    deleteContentImagesForProject,
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
      searchProperties,
      searchMetrics,
      competitors,
      competitorPages,
      competitorInsights,
      wordpressIntegrations,
      webflowIntegrations,
      shopifyIntegrations,
      publishActions,
      webhookDeliveries,
      conversionGoals,
      trackingEvents,
      campaigns,
      socialDrafts,
      analyticsSnapshots,
      projectMemberships,
      auditLogs
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
      models.ProjectSearchProperty.find({ projectId: { $in: projectIds } }).lean(),
      models.SearchMetric.find({ projectId: { $in: projectIds } }).lean(),
      models.Competitor.find({ projectId: { $in: projectIds } }).lean(),
      models.CompetitorPage.find({ projectId: { $in: projectIds } }).lean(),
      models.CompetitorInsight.find({ projectId: { $in: projectIds } }).lean(),
      models.WordPressIntegration.find({ projectId: { $in: projectIds } }),
      models.WebflowIntegration.find({ projectId: { $in: projectIds } }),
      models.ShopifyIntegration.find({ projectId: { $in: projectIds } }),
      models.PublishAction.find({ projectId: { $in: projectIds } }).lean(),
      models.WebhookDelivery.find({ projectId: { $in: projectIds } }).lean(),
      models.ConversionGoal.find({ projectId: { $in: projectIds } }).lean(),
      models.TrackingEvent.find({ projectId: { $in: projectIds } }).limit(5000).lean(),
      models.Campaign.find({ projectId: { $in: projectIds } }).lean(),
      models.SocialDraft.find({ projectId: { $in: projectIds } }).lean(),
      models.AnalyticsSnapshot.find({ project: { $in: projectIds } }).lean(),
      models.ProjectMember.find({ $or: [{ userId }, { projectId: { $in: projectIds } }] }).lean(),
      models.AuditLog.find({ actorUserId: userId }).sort({ createdAt: -1 }).limit(500).lean()
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
      webhookDeliveries,
      conversionGoals,
      trackingEvents,
      campaigns,
      socialDrafts,
      analyticsSnapshots,
      projectMemberships,
      auditLogs
    };
  }

  async function deleteProjectOwnedData({ projectId }) {
    await models.deleteContentImagesForProject(projectId);
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
      models.WebhookDelivery.deleteMany({ projectId }),
      models.ConversionGoal.deleteMany({ projectId }),
      models.TrackingEvent.deleteMany({ projectId }),
      models.Campaign.deleteMany({ projectId }),
      models.SocialDraft.deleteMany({ projectId }),
      models.AnalyticsSnapshot.deleteMany({ project: projectId }),
      models.ProjectMember.deleteMany({ projectId })
    ]);
  }

  async function deleteAccountData(userId) {
    const projects = await models.Project.find({ owner: userId }).select('_id').lean();
    await Promise.all(projects.map((project) => deleteProjectOwnedData({ projectId: project._id })));
    await models.ProjectMember.deleteMany({ userId });
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
