const express = require('express');
const { requireAuth } = require('../middleware/auth');
const {
  ensureAiOperationAllowed,
  ensureAiReportAllowed,
  ensureContentDraftAllowed,
  ensureFeature,
  ensureProjectLimit,
  ensureScanAllowed,
  recordAiOperation,
  recordAiOperationFailure,
  upgradeRedirect
} = require('../services/usageService');
const { createCampaignContentPlan } = require('../services/socialDraftService');
const { pipelineAssetOptions } = require('../services/contentDraftService');
const {
  bootstrapDiscoveryProject,
  createSearchConsoleOpportunityDraft,
  generateMeasurementReport,
  generateStrategyPlan,
  startProjectScan,
  syncSearchConsoleWindow
} = require('../services/projectWorkflowService');
const {
  findJobForProject,
  findLatestJob,
  findLatestJobs,
  queueMeasurementReport,
  queueContentPipeline,
  queueSearchConsoleSync,
  queueStrategyPlan,
  queueCompetitorScan,
  queueCompetitorReport
} = require('../services/projectTaskService');
const { buildAttributionReadiness } = require('../services/measurementService');
const { buildProjectsContext } = require('./projects/context');
const {
  registerProjectCollectionRoutes,
  registerProjectDetailRoutes
} = require('./projects/overviewRoutes');
const { registerDiscoveryRoutes } = require('./projects/discoveryRoutes');
const { registerPrioritizationRoutes } = require('./projects/prioritizationRoutes');
const { registerExecutionRoutes } = require('./projects/executionRoutes');
const { registerMeasurementRoutes } = require('./projects/measurementRoutes');
const { registerIntegrationRoutes } = require('./projects/integrationRoutes');
const { registerOperationalRoutes } = require('./projects/operationalRoutes');

const router = express.Router();
const context = buildProjectsContext();
const sharedServices = {
  buildAttributionReadiness,
  bootstrapDiscoveryProject,
  createCampaignContentPlan,
  createSearchConsoleOpportunityDraft,
  ensureAiOperationAllowed,
  ensureAiReportAllowed,
  ensureContentDraftAllowed,
  ensureFeature,
  ensureProjectLimit,
  ensureScanAllowed,
  findJobForProject,
  findLatestJob,
  findLatestJobs,
  generateMeasurementReport,
  generateStrategyPlan,
  pipelineAssetOptions,
  queueMeasurementReport,
  queueContentPipeline,
  queueSearchConsoleSync,
  queueStrategyPlan,
  queueCompetitorScan,
  queueCompetitorReport,
  recordAiOperation,
  recordAiOperationFailure,
  startProjectScan,
  syncSearchConsoleWindow,
  upgradeRedirect
};

router.use(requireAuth);

registerProjectCollectionRoutes(router, context, sharedServices);
registerDiscoveryRoutes(router, context, sharedServices);
registerPrioritizationRoutes(router, context, sharedServices);
registerExecutionRoutes(router, context, sharedServices);
registerMeasurementRoutes(router, context, sharedServices);
registerIntegrationRoutes(router, context, sharedServices);
registerOperationalRoutes(router, context, sharedServices);
registerProjectDetailRoutes(router, context, sharedServices);

module.exports = router;
