const Project = require('../models/Project');
const ProjectJob = require('../models/ProjectJob');
const Recommendation = require('../models/Recommendation');
const ContentDraft = require('../models/ContentDraft');
const ContentImage = require('../models/ContentImage');
const SocialDraft = require('../models/SocialDraft');
const Competitor = require('../models/Competitor');
const CompetitorPage = require('../models/CompetitorPage');
const CompetitorInsight = require('../models/CompetitorInsight');
const Page = require('../models/Page');
const MarketingGoal = require('../models/MarketingGoal');
const { evaluateGoal } = require('./goalIntelligenceService');
const { enqueueProjectTask } = require('../queues/projectTaskQueue');
const {
  generateDraftsForRecommendation,
  selectDraftTypes
} = require('./contentDraftService');
const {
  generateMeasurementReport,
  generateStrategyPlan,
  syncSearchConsoleWindow
} = require('./projectWorkflowService');
const { syncSearchConsoleProject } = require('./searchConsoleService');
const { generateContentImage } = require('./contentImageService');
const { crawlCompetitor } = require('./competitorCrawlerService');
const { discoverCompetitorsForProject } = require('./competitorDiscoveryService');
const { generateCompetitorInsights } = require('./competitorInsightService');
const { hasProjectLogo, projectLogoReference } = require('./projectLogoService');
const { buildPerformanceMarketingDashboard, syncPaidAdsProject } = require('./paidAds/performanceService');
const { captureCompetitorSnapshot } = require('./strategy/competitorMonitoringService');
const { generateMonthlyStrategyReview, refreshStrategicIntelligence } = require('./strategy/strategicIntelligenceService');
const {
  incrementUsage,
  recordAiOperation,
  recordAiOperationFailure
} = require('./usageService');

function stableStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }

  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
  }

  return JSON.stringify(value);
}

function buildFingerprint({ projectId, type, payload }) {
  return `${projectId}:${type}:${stableStringify(payload || {})}`;
}

function typeLabel(type) {
  return {
    ai_report: 'AI report',
    measurement_report: 'measurement report',
    search_console_sync: 'Search Console sync',
    content_pipeline: 'content pipeline',
    content_image_generation: 'image generation',
    competitor_scan: 'competitor scan',
    competitor_discovery_report: 'competitor report',
    paid_ads_sync: 'paid advertising sync',
    strategic_intelligence_refresh: 'strategic intelligence refresh',
    monthly_strategy_review: 'monthly strategy review',
    marketing_goal_evaluation: 'goal evaluation and forecasting'
  }[type] || 'job';
}

function guidanceRequestsLogo(value) {
  return /\b(logo|brand mark|brandmark|logomark|wordmark|brand identity)\b/i.test(String(value || ''));
}

function parseRecommendationLimit(value) {
  if (value === null || value === undefined || value === '') return Infinity;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : Infinity;
}

async function saveJobProgress(job, update = {}) {
  if (update.currentStep !== undefined) {
    job.currentStep = String(update.currentStep || '');
  }
  if (update.progressPercent !== undefined) {
    const value = Number(update.progressPercent);
    job.progressPercent = Number.isFinite(value) ? Math.max(0, Math.min(100, Math.round(value))) : (job.progressPercent || 0);
  }
  await job.save();
}

function createProjectTaskService(deps = {}) {
  const services = {
    Project,
    ProjectJob,
    Recommendation,
    ContentDraft,
    ContentImage,
    SocialDraft,
    Competitor,
    CompetitorPage,
    CompetitorInsight,
    Page,
    crawlCompetitor,
    discoverCompetitorsForProject,
    generateCompetitorInsights,
    enqueueProjectTask,
    generateDraftsForRecommendation,
    generateContentImage,
    generateMeasurementReport,
    generateStrategyPlan,
    hasProjectLogo,
    projectLogoReference,
    syncSearchConsoleProject,
    syncSearchConsoleWindow,
    recordAiOperationFailure,
    incrementUsage,
    recordAiOperation,
    selectDraftTypes,
    buildPerformanceMarketingDashboard,
    syncPaidAdsProject,
    MarketingGoal,
    evaluateGoal,
    captureCompetitorSnapshot,
    generateMonthlyStrategyReview,
    refreshStrategicIntelligence,
    ...deps
  };

  async function findJobForProject({ jobId, projectId, userId }) {
    if (!jobId) return null;
    return services.ProjectJob.findOne({ _id: jobId, projectId, userId });
  }

  async function findLatestJob({ projectId, userId, type }) {
    return services.ProjectJob.findOne({ projectId, userId, type }).sort({ createdAt: -1 });
  }

  async function findLatestJobs({ projectId, userId, types }) {
    const jobs = await services.ProjectJob.find({
      projectId,
      userId,
      type: { $in: types }
    }).sort({ createdAt: -1 });

    return types.reduce((acc, type) => {
      acc[type] = jobs.find((job) => job.type === type) || null;
      return acc;
    }, {});
  }

  async function enqueueWorkflow({ projectId, userId, type, payload }) {
    const fingerprint = buildFingerprint({ projectId, type, payload });
    const activeJob = await services.ProjectJob.findOne({
      projectId,
      userId,
      fingerprint,
      status: { $in: ['queued', 'running'] }
    }).sort({ createdAt: -1 });

    if (activeJob) {
      return activeJob;
    }

    const job = await services.ProjectJob.create({
      projectId,
      userId,
      type,
      status: 'queued',
      fingerprint,
      payload
    });

    try {
      const queueJob = await services.enqueueProjectTask(job._id);
      if (queueJob) {
        job.queueJobId = String(queueJob.id);
        await job.save();
      } else {
        setImmediate(() => {
          processProjectTask(job._id).catch((error) => {
            console.error(`Inline ${typeLabel(type)} job failed:`, error);
          });
        });
      }
    } catch (error) {
      job.status = 'failed';
      job.errorMessage = error.message;
      job.completedAt = new Date();
      await job.save();
      throw error;
    }

    return job;
  }

  async function queueStrategyPlan({ projectId, userId, recommendationLimit = Infinity }) {
    return enqueueWorkflow({
      projectId,
      userId,
      type: 'ai_report',
      payload: { recommendationLimit: Number.isFinite(recommendationLimit) ? recommendationLimit : null }
    });
  }

  async function queueMeasurementReport({ projectId, userId, type }) {
    return enqueueWorkflow({
      projectId,
      userId,
      type: 'measurement_report',
      payload: { type }
    });
  }

  async function queueSearchConsoleSync({ projectId, userId, days }) {
    return enqueueWorkflow({
      projectId,
      userId,
      type: 'search_console_sync',
      payload: { days }
    });
  }

  async function queueContentPipeline({ projectId, userId, recommendationId, requestedType = '', keyword = '' }) {
    return enqueueWorkflow({
      projectId,
      userId,
      type: 'content_pipeline',
      payload: { recommendationId, requestedType, keyword }
    });
  }

  async function queueContentImageGeneration({
    projectId,
    userId,
    draftId,
    draftModel = 'ContentDraft',
    guidance = '',
    referenceImageId = '',
    visualFormat = '',
    aestheticTheme = '',
    redirectPath = ''
  }) {
    return enqueueWorkflow({
      projectId,
      userId,
      type: 'content_image_generation',
      payload: {
        draftId,
        draftModel,
        guidance,
        referenceImageId: referenceImageId || '',
        visualFormat: visualFormat || '',
        aestheticTheme: aestheticTheme || '',
        redirectPath
      }
    });
  }

  async function queueCompetitorScan({ projectId, userId, competitorId }) {
    return enqueueWorkflow({
      projectId,
      userId,
      type: 'competitor_scan',
      payload: { competitorId }
    });
  }

  async function queueCompetitorReport({ projectId, userId }) {
    return enqueueWorkflow({
      projectId,
      userId,
      type: 'competitor_discovery_report',
      payload: {}
    });
  }

  async function queuePaidAdsSync({ projectId, userId, days = 30 }) {
    return enqueueWorkflow({
      projectId,
      userId,
      type: 'paid_ads_sync',
      payload: { days: Math.min(90, Math.max(1, Number(days || 30))) }
    });
  }

  async function queueStrategicIntelligenceRefresh({ projectId, userId }) {
    return enqueueWorkflow({ projectId, userId, type: 'strategic_intelligence_refresh', payload: {} });
  }

  async function queueMonthlyStrategyReview({ projectId, userId }) {
    return enqueueWorkflow({ projectId, userId, type: 'monthly_strategy_review', payload: {} });
  }

  async function queueMarketingGoalEvaluation({ projectId, userId, goalId, notify = false }) {
    return enqueueWorkflow({
      projectId,
      userId,
      type: 'marketing_goal_evaluation',
      payload: { goalId: String(goalId), notify: Boolean(notify) }
    });
  }

  async function retryFailedJob({ jobId, projectId, userId }) {
    const failedJob = await services.ProjectJob.findOne({
      _id: jobId,
      projectId,
      userId,
      status: 'failed'
    });

    if (!failedJob) {
      const error = new Error('Failed job not found.');
      error.statusCode = 404;
      throw error;
    }

    return enqueueWorkflow({
      projectId,
      userId,
      type: failedJob.type,
      payload: failedJob.payload || {}
    });
  }

  async function processProjectTask(jobId, meta = {}) {
    const job = await services.ProjectJob.findById(jobId);
    if (!job) return null;

    if (job.status === 'completed') {
      return job;
    }

    const project = await services.Project.findById(job.projectId);
    if (!project) {
      job.status = 'failed';
      job.errorMessage = 'Project not found.';
      job.completedAt = new Date();
      await job.save();
      return job;
    }

    job.status = 'running';
    job.startedAt = new Date();
    job.completedAt = undefined;
    job.errorMessage = '';
    job.currentStep = 'Preparing background work';
    job.progressPercent = 5;
    job.attemptsMade = Math.max(job.attemptsMade || 0, Number(meta.attemptsMade || 0) + 1);
    await job.save();

    try {
      let result = {};
      const onProgress = async (update) => saveJobProgress(job, update);

      if (job.type === 'ai_report') {
        const output = await services.generateStrategyPlan({
          project,
          userId: job.userId,
          recommendationLimit: parseRecommendationLimit(job.payload.recommendationLimit),
          onProgress
        });
        result = {
          recommendationCount: output.recommendations.length,
          reportId: output.report._id,
          resourceId: output.report._id,
          resourcePath: `/projects/${project._id}/ai-report/latest?report=${output.report._id}`,
          resourceType: 'report',
          scanId: output.scan._id
        };
      } else if (job.type === 'measurement_report') {
        const output = await services.generateMeasurementReport({
          project,
          userId: job.userId,
          type: job.payload.type,
          onProgress
        });
        result = {
          reportId: output._id,
          resourceId: output._id,
          resourcePath: `/projects/${project._id}/reports/${output._id}`,
          resourceType: 'cmo_report',
          type: job.payload.type
        };
      } else if (job.type === 'search_console_sync') {
        const output = await services.syncSearchConsoleWindow({
          project,
          userId: job.userId,
          days: job.payload.days,
          syncSearchConsoleProject: services.syncSearchConsoleProject,
          onProgress
        });
        result = {
          days: job.payload.days,
          resourcePath: `/projects/${project._id}/search-console/performance?days=${job.payload.days}&synced=${output.rowsSynced}`,
          resourceType: 'search_console_sync',
          rowsSynced: output.rowsSynced,
          startDate: output.startDate,
          endDate: output.endDate
        };
      } else if (job.type === 'paid_ads_sync') {
        await onProgress({ currentStep: 'Refreshing advertising account tokens', progressPercent: 12 });
        const days = Math.min(90, Math.max(1, Number(job.payload.days || 30)));
        const endDate = new Date();
        const startDate = new Date();
        startDate.setUTCDate(startDate.getUTCDate() - (days - 1));
        await onProgress({ currentStep: 'Importing paid campaign performance', progressPercent: 30 });
        const syncResults = await services.syncPaidAdsProject(project._id, { startDate, endDate });
        await onProgress({ currentStep: 'Evaluating campaign health and budget opportunities', progressPercent: 82 });
        const dashboard = await services.buildPerformanceMarketingDashboard(project._id, days, { persist: true });
        result = {
          accountCount: syncResults.length,
          failedAccountCount: syncResults.filter((item) => item.error).length,
          rowsSynced: syncResults.reduce((sum, item) => sum + Number(item.rowsSynced || 0), 0),
          alertCount: dashboard.alerts.length,
          recommendationCount: dashboard.recommendations.length,
          resourcePath: `/projects/${project._id}/performance-marketing?days=${days}`,
          resourceType: 'paid_performance',
          syncResults
        };
      } else if (job.type === 'strategic_intelligence_refresh') {
        await onProgress({ currentStep: 'Normalizing KPI history and calculating transparent forecasts', progressPercent: 25 });
        const output = await services.refreshStrategicIntelligence(project, { persist: true });
        await onProgress({ currentStep: 'Detecting strategic risks, shifts, and opportunities', progressPercent: 88 });
        result = {
          forecastCount: output.forecasts.length,
          opportunityCount: output.opportunities.length,
          searchSignalCount: output.searchDemand.length,
          audienceSignalCount: output.audience.signals.length,
          resourcePath: `/projects/${project._id}/strategy-intelligence`,
          resourceType: 'strategic_intelligence'
        };
      } else if (job.type === 'monthly_strategy_review') {
        await onProgress({ currentStep: 'Assembling the monthly executive evidence pack', progressPercent: 30 });
        await services.refreshStrategicIntelligence(project, { persist: true });
        const review = await services.generateMonthlyStrategyReview(project, job.userId);
        result = {
          reviewId: review._id,
          resourceId: review._id,
          resourcePath: `/projects/${project._id}/strategy-intelligence?review=${review._id}`,
          resourceType: 'strategic_review'
        };
      } else if (job.type === 'marketing_goal_evaluation') {
        await onProgress({ currentStep: 'Loading marketing goal and historical telemetry', progressPercent: 20 });
        const goal = await services.MarketingGoal.findOne({
          _id: job.payload.goalId,
          projectId: project._id
        });
        if (!goal) {
          const error = new Error('Marketing goal not found.');
          error.statusCode = 404;
          throw error;
        }
        await onProgress({ currentStep: 'Calculating AI forecasting trajectories and pacing baselines', progressPercent: 60 });
        const evaluation = await services.evaluateGoal(goal, { notify: Boolean(job.payload.notify) });
        await onProgress({ currentStep: 'Goal forecast and evaluation complete', progressPercent: 100 });
        result = {
          goalId: goal._id,
          status: evaluation ? evaluation.status : goal.status,
          forecastValue: evaluation ? evaluation.forecastValue : goal.forecastValue,
          progressPercent: evaluation ? evaluation.progressPercent : goal.progressPercent,
          resourcePath: `/projects/${project._id}/goals`,
          resourceType: 'marketing_goal'
        };
      } else if (job.type === 'content_pipeline') {
        const recommendation = await services.Recommendation.findOne({
          _id: job.payload.recommendationId,
          projectId: project._id
        });
        if (!recommendation) {
          const error = new Error('Recommendation not found for this content pipeline.');
          error.statusCode = 404;
          throw error;
        }

        await onProgress({ currentStep: 'Checking existing pipeline assets', progressPercent: 12 });
        const requestedType = job.payload.requestedType || '';
        const pipelineTypes = services.selectDraftTypes(recommendation, requestedType);
        const existingDrafts = await services.ContentDraft.find({
          recommendationId: recommendation._id,
          type: { $in: pipelineTypes },
          status: { $ne: 'rejected' }
        }).sort({ createdAt: -1 });
        const existingTypes = new Set(existingDrafts.map((draft) => draft.type));
        const missingTypes = pipelineTypes.filter((type) => !existingTypes.has(type));

        await onProgress({
          currentStep: missingTypes.length
            ? `Generating ${missingTypes.length} evidence-backed asset${missingTypes.length === 1 ? '' : 's'}`
            : 'Using existing pipeline assets',
          progressPercent: missingTypes.length ? 25 : 90
        });

        const drafts = missingTypes.length
          ? await services.generateDraftsForRecommendation({
            project,
            recommendation,
            requestedTypes: missingTypes,
            keyword: job.payload.keyword || ''
          })
          : [];
        const created = drafts.length ? await services.ContentDraft.insertMany(drafts) : [];

        if (created.length) {
          if (recommendation.status === 'accepted') {
            recommendation.status = 'in_progress';
            await recommendation.save();
          }
          await services.incrementUsage(job.userId, 'contentDraftsUsed', created.length);
          await services.recordAiOperation(job.userId, 1);
        }

        await onProgress({ currentStep: 'Saving approval-ready assets', progressPercent: 92 });
        const firstDraft = created[0] || existingDrafts.find((draft) => draft.type === requestedType);
        const query = new URLSearchParams({
          recommendation: recommendation._id.toString(),
          success: created.length
            ? `${created.length} pipeline asset${created.length === 1 ? '' : 's'} generated and ready for review.`
            : `${existingDrafts.length} pipeline assets already exist. No duplicates were created.`
        });
        result = {
          createdCount: created.length,
          recommendationId: recommendation._id,
          resourceId: firstDraft ? firstDraft._id : recommendation._id,
          resourcePath: requestedType && firstDraft
            ? `/content/${firstDraft._id}?generated=${created.length ? '1' : '0'}`
            : `/projects/${project._id}/content?${query.toString()}`,
          resourceType: 'content_pipeline'
        };
      } else if (job.type === 'content_image_generation') {
        await onProgress({ currentStep: 'Loading post and brand assets', progressPercent: 12 });

        const isSocialDraft = job.payload.draftModel === 'SocialDraft';
        const DraftModel = isSocialDraft ? services.SocialDraft : services.ContentDraft;
        const draft = await DraftModel.findOne({
          _id: job.payload.draftId,
          projectId: project._id
        });
        if (!draft) {
          const error = new Error('Draft not found for image generation.');
          error.statusCode = 404;
          throw error;
        }

        const referenceImage = job.payload.referenceImageId
          ? await services.ContentImage.findOne({
            _id: job.payload.referenceImageId,
            draftId: draft._id,
            projectId: project._id,
            status: { $ne: 'rejected' }
          })
          : null;
        if (job.payload.referenceImageId && !referenceImage) {
          const error = new Error('Reference image not found for this draft.');
          error.statusCode = 404;
          throw error;
        }

        const guidance = job.payload.guidance || '';
        const brandLogoReference = guidanceRequestsLogo(guidance) && services.hasProjectLogo(project)
          ? await services.projectLogoReference(project)
          : null;

        await onProgress({ currentStep: 'Generating branded image candidate', progressPercent: 35 });
        const image = await services.generateContentImage({
          project,
          draft,
          userId: job.userId,
          guidance,
          referenceImage,
          brandLogoReference,
          visualFormat: job.payload.visualFormat || '',
          aestheticTheme: job.payload.aestheticTheme || ''
        });

        await onProgress({ currentStep: 'Saving image candidate', progressPercent: 90 });
        await services.incrementUsage(job.userId, 'imageGenerationsUsed', 1);
        await services.recordAiOperation(job.userId, 1);

        const fallbackPath = isSocialDraft
          ? `/projects/${project._id}/calendar?success=${encodeURIComponent('Image candidate generated for this post.')}#post-${draft._id}`
          : `/content/${draft._id}?workspace=visual&imageSuccess=${encodeURIComponent('New image candidate generated. Review and select it before using this asset.')}`;
        result = {
          imageId: image._id,
          resourceId: image._id,
          resourcePath: job.payload.redirectPath || fallbackPath,
          resourceType: 'content_image'
        };
      } else if (job.type === 'competitor_scan') {
        const competitor = await services.Competitor.findOne({
          _id: job.payload.competitorId,
          projectId: project._id
        });
        if (!competitor) {
          const error = new Error('Competitor not found.');
          error.statusCode = 404;
          throw error;
        }

        await onProgress({ currentStep: `Crawling public pages for ${competitor.name}`, progressPercent: 30 });
        const resultScan = await services.crawlCompetitor({
          projectId: project._id,
          competitor
        });
        await services.captureCompetitorSnapshot({ projectId: project._id, competitorId: competitor._id });

        await onProgress({ currentStep: 'Competitor page crawl completed', progressPercent: 95 });
        const message = resultScan.skippedByRobots
          ? 'Competitor homepage is disallowed by robots.txt.'
          : `${resultScan.pages ? resultScan.pages.length : 0} competitor pages scanned.`;

        result = {
          competitorId: competitor._id,
          pagesIndexed: resultScan.pages ? resultScan.pages.length : 0,
          resourcePath: `/projects/${project._id}/competitors/${competitor._id}?success=${encodeURIComponent(message)}`,
          resourceType: 'competitor_scan'
        };
      } else if (job.type === 'competitor_discovery_report') {
        await onProgress({ currentStep: 'Evaluating public search signals and category candidates', progressPercent: 15 });
        const projectPages = await services.Page.find({ projectId: project._id }).sort({ lastCrawledAt: -1 }).limit(80);
        await services.discoverCompetitorsForProject({
          project,
          userId: job.userId,
          projectPages,
          force: true
        });

        const competitors = await services.Competitor.find({
          projectId: project._id,
          userId: job.userId
        }).sort({ createdAt: -1 });

        if (!competitors.length) {
          const diagnostics = project.competitorDiscovery || {};
          const msg = diagnostics.status === 'search_unavailable'
            ? 'Competitor search did not return public results.'
            : `Evaluated ${diagnostics.candidatesEvaluated || 0} public sites but could not verify a direct competitor.`;
          result = {
            competitorCount: 0,
            resourcePath: `/projects/${project._id}/competitors?error=${encodeURIComponent(msg)}`,
            resourceType: 'competitor_discovery_report'
          };
        } else {
          for (let i = 0; i < competitors.length; i++) {
            const comp = competitors[i];
            const pct = Math.round(25 + ((i + 1) / competitors.length) * 45);
            await onProgress({ currentStep: `Crawling ${comp.name} (${i + 1}/${competitors.length})`, progressPercent: pct });
            await services.crawlCompetitor({ projectId: project._id, competitor: comp });
            await services.captureCompetitorSnapshot({ projectId: project._id, competitorId: comp._id });
          }

          await onProgress({ currentStep: 'Synthesizing competitor insights and gap matrix', progressPercent: 85 });
          const generatedInsights = await services.generateCompetitorInsights({
            projectId: project._id
          });

          result = {
            competitorCount: competitors.length,
            insightCount: (generatedInsights || []).length,
            resourcePath: `/projects/${project._id}/competitors/insights?success=${encodeURIComponent('Competitor intelligence report generated.')}`,
            resourceType: 'competitor_discovery_report'
          };
        }
      } else {
        throw new Error(`Unsupported project job type: ${job.type}`);
      }

      job.status = 'completed';
      job.result = result;
      job.currentStep = 'Completed';
      job.progressPercent = 100;
      job.completedAt = new Date();
      await job.save();
      return job;
    } catch (error) {
      job.status = 'failed';
      job.errorMessage = error.message;
      job.currentStep = 'Failed';
      job.completedAt = new Date();
      await job.save();
      if (['ai_report', 'measurement_report', 'content_pipeline', 'content_image_generation'].includes(job.type)) {
        await services.recordAiOperationFailure(job.userId).catch(() => null);
      }
      throw error;
    }
  }

  return {
    findJobForProject,
    findLatestJob,
    findLatestJobs,
    processProjectTask,
    queueMeasurementReport,
    queueContentImageGeneration,
    queueContentPipeline,
    queueSearchConsoleSync,
    queueStrategyPlan,
    queueCompetitorScan,
    queueCompetitorReport,
    queuePaidAdsSync,
    queueStrategicIntelligenceRefresh,
    queueMonthlyStrategyReview,
    queueMarketingGoalEvaluation,
    retryFailedJob
  };
}

module.exports = {
  ...createProjectTaskService(),
  buildFingerprint,
  createProjectTaskService,
  parseRecommendationLimit,
  saveJobProgress,
  stableStringify,
  typeLabel
};
