const express = require('express');
const { requireAuth } = require('../middleware/auth');
const {
  ensureAiReportAllowed,
  ensureContentDraftAllowed,
  ensureFeature,
  ensureProjectLimit,
  ensureScanAllowed,
  upgradeRedirect
} = require('../services/usageService');
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
  queueSearchConsoleSync,
  queueStrategyPlan
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

const router = express.Router();
const context = buildProjectsContext();
const sharedServices = {
  buildAttributionReadiness,
  bootstrapDiscoveryProject,
  createSearchConsoleOpportunityDraft,
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
  queueSearchConsoleSync,
  queueStrategyPlan,
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
registerProjectDetailRoutes(router, context, sharedServices);

module.exports = router;
