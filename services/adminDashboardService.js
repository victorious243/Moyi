const User = require('../models/User');
const Project = require('../models/Project');
const Usage = require('../models/Usage');
const ProjectJob = require('../models/ProjectJob');
const PublishAction = require('../models/PublishAction');
const PublishJob = require('../models/PublishJob');
const SocialAccount = require('../models/SocialAccount');
const WebhookDelivery = require('../models/WebhookDelivery');
const AuditLog = require('../models/AuditLog');
const AppLog = require('../models/AppLog');
const ContentDraft = require('../models/ContentDraft');
const SocialDraft = require('../models/SocialDraft');
const IntelloArticle = require('../models/IntelloArticle');
const { readinessPayload } = require('./runtimeHealthService');
const {
  buildEnterpriseHardeningSummary,
  buildIncidentSummary
} = require('./enterpriseHardeningService');
const { currentPeriod } = require('./usageService');

async function buildAdminDashboard() {
  const { periodStart, periodEnd } = currentPeriod();
  const [
    userCount,
    projectCount,
    activeUsers,
    failedJobs,
    runningJobs,
    failedPublishActions,
    failedWebhookDeliveries,
    recentAuditLogs,
    recentAppLogs,
    usageRows,
    health,
    failedPublishJobs,
    reconnectAccounts,
    pendingIntelloDrafts,
    pendingKbArticles
  ] = await Promise.all([
    User.countDocuments(),
    Project.countDocuments(),
    User.find().sort({ updatedAt: -1 }).limit(12).lean(),
    ProjectJob.find({ status: 'failed' }).sort({ updatedAt: -1 }).limit(12).populate('projectId', 'name').populate('userId', 'email name').lean(),
    ProjectJob.find({ status: { $in: ['queued', 'running'] } }).sort({ updatedAt: -1 }).limit(12).populate('projectId', 'name').populate('userId', 'email name').lean(),
    PublishAction.find({ status: 'failed' }).sort({ updatedAt: -1 }).limit(12).populate('projectId', 'name').populate('userId', 'email name').populate('contentDraftId', 'title').lean(),
    WebhookDelivery.find({ status: 'failed' }).sort({ updatedAt: -1 }).limit(12).populate('projectId', 'name').populate('userId', 'email name').populate('contentDraftId', 'title').lean(),
    AuditLog.find().sort({ createdAt: -1 }).limit(20).populate('projectId', 'name').lean(),
    AppLog.find().sort({ createdAt: -1 }).limit(20).populate('userId', 'email name').lean(),
    Usage.find({ periodStart, periodEnd }).sort({ updatedAt: -1 }).populate('userId', 'email name plan').lean(),
    readinessPayload(),
    PublishJob.find({ status: { $in: ['retry_wait', 'dead_letter', 'failed'] } })
      .sort({ deadLetteredAt: -1, nextRetryAt: 1, updatedAt: -1 })
      .limit(25)
      .populate('projectId', 'name')
      .populate('destinationProjectId', 'name')
      .populate('accountId', 'accountName platform status')
      .populate('userId', 'email name')
      .lean(),
    SocialAccount.find({ status: 'reconnect_required' })
      .sort({ reconnectRequiredAt: -1 })
      .limit(25)
      .populate('projectId', 'name')
      .populate('userId', 'email name')
      .select('-accessToken -refreshToken -webhookSecret')
      .lean(),
    ContentDraft.find({
      type: 'daily_content_intelligence',
      status: { $in: ['awaiting_review', 'pending_approval', 'draft'] }
    })
      .sort({ createdAt: -1 })
      .limit(25)
      .populate('projectId', 'name websiteUrl')
      .lean(),
    IntelloArticle.find({
      status: { $in: ['awaiting_review', 'draft'] }
    })
      .sort({ createdAt: -1 })
      .limit(25)
      .populate('sourceProjectId', 'name websiteUrl')
      .lean()
  ]);

  const intelloDailyQueue = await Promise.all(
    pendingIntelloDrafts.map(async (draft) => {
      const socialDrafts = await SocialDraft.find({
        sourceContentDraftId: draft._id
      }).lean();
      return {
        ...draft,
        socialDrafts
      };
    })
  );

  const usageTotals = usageRows.reduce((totals, row) => {
    totals.scansUsed += Number(row.scansUsed || 0);
    totals.aiReportsUsed += Number(row.aiReportsUsed || 0);
    totals.contentDraftsUsed += Number(row.contentDraftsUsed || 0);
    totals.socialPostsUsed += Number(row.socialPostsUsed || 0);
    totals.extraSocialPostCredits += Number(row.extraSocialPostCredits || 0);
    totals.searchConsoleSyncsUsed += Number(row.searchConsoleSyncsUsed || 0);
    totals.aiOperationsUsed += Number(row.aiOperationsUsed || 0);
    totals.aiOperationFailures += Number(row.aiOperationFailures || 0);
    return totals;
  }, {
    scansUsed: 0,
    aiReportsUsed: 0,
    contentDraftsUsed: 0,
    socialPostsUsed: 0,
    extraSocialPostCredits: 0,
    searchConsoleSyncsUsed: 0,
    aiOperationsUsed: 0,
    aiOperationFailures: 0
  });
  const incidentSummary = buildIncidentSummary({
    failedJobs,
    failedPublishJobs,
    failedWebhookDeliveries,
    health,
    recentAppLogs,
    reconnectAccounts
  });
  const enterpriseHardening = buildEnterpriseHardeningSummary({ health });

  return {
    activeUsers,
    enterpriseHardening,
    failedJobs,
    failedPublishActions,
    failedPublishJobs,
    failedWebhookDeliveries,
    health,
    incidentSummary,
    intelloDailyQueue,
    pendingKbArticles,
    periodEnd,
    periodStart,
    projectCount,
    recentAuditLogs,
    recentAppLogs,
    reconnectAccounts,
    runningJobs,
    usageRows,
    usageTotals,
    userCount
  };
}

module.exports = {
  buildAdminDashboard
};
