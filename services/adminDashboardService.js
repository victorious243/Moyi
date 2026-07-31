const User = require('../models/User');
const Project = require('../models/Project');
const Usage = require('../models/Usage');
const ProjectJob = require('../models/ProjectJob');
const PublishAction = require('../models/PublishAction');
const WebhookDelivery = require('../models/WebhookDelivery');
const AuditLog = require('../models/AuditLog');
const AppLog = require('../models/AppLog');
const { readinessPayload } = require('./runtimeHealthService');
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
    health
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
    readinessPayload()
  ]);

  const usageTotals = usageRows.reduce((totals, row) => {
    totals.scansUsed += Number(row.scansUsed || 0);
    totals.aiReportsUsed += Number(row.aiReportsUsed || 0);
    totals.contentDraftsUsed += Number(row.contentDraftsUsed || 0);
    totals.searchConsoleSyncsUsed += Number(row.searchConsoleSyncsUsed || 0);
    totals.aiOperationsUsed += Number(row.aiOperationsUsed || 0);
    totals.aiOperationFailures += Number(row.aiOperationFailures || 0);
    return totals;
  }, {
    scansUsed: 0,
    aiReportsUsed: 0,
    contentDraftsUsed: 0,
    searchConsoleSyncsUsed: 0,
    aiOperationsUsed: 0,
    aiOperationFailures: 0
  });

  return {
    activeUsers,
    failedJobs,
    failedPublishActions,
    failedWebhookDeliveries,
    health,
    periodEnd,
    periodStart,
    projectCount,
    recentAuditLogs,
    recentAppLogs,
    runningJobs,
    usageRows,
    usageTotals,
    userCount
  };
}

module.exports = {
  buildAdminDashboard
};
