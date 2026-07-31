const Project = require('../models/Project');
const ProjectJob = require('../models/ProjectJob');
const Recommendation = require('../models/Recommendation');
const ContentDraft = require('../models/ContentDraft');
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
    content_pipeline: 'content pipeline'
  }[type] || 'job';
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
    enqueueProjectTask,
    generateDraftsForRecommendation,
    generateMeasurementReport,
    generateStrategyPlan,
    syncSearchConsoleProject,
    syncSearchConsoleWindow,
    recordAiOperationFailure,
    incrementUsage,
    recordAiOperation,
    selectDraftTypes,
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
      if (['ai_report', 'measurement_report', 'content_pipeline'].includes(job.type)) {
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
    queueContentPipeline,
    queueSearchConsoleSync,
    queueStrategyPlan,
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
