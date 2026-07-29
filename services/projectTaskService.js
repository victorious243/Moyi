const Project = require('../models/Project');
const ProjectJob = require('../models/ProjectJob');
const { enqueueProjectTask } = require('../queues/projectTaskQueue');
const {
  generateMeasurementReport,
  generateStrategyPlan,
  syncSearchConsoleWindow
} = require('./projectWorkflowService');
const { syncSearchConsoleProject } = require('./searchConsoleService');

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
    search_console_sync: 'Search Console sync'
  }[type] || 'job';
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
    enqueueProjectTask,
    generateMeasurementReport,
    generateStrategyPlan,
    syncSearchConsoleProject,
    syncSearchConsoleWindow,
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
          recommendationLimit: Number.isFinite(Number(job.payload.recommendationLimit))
            ? Number(job.payload.recommendationLimit)
            : Infinity,
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
      throw error;
    }
  }

  return {
    findJobForProject,
    findLatestJob,
    findLatestJobs,
    processProjectTask,
    queueMeasurementReport,
    queueSearchConsoleSync,
    queueStrategyPlan
  };
}

module.exports = {
  ...createProjectTaskService(),
  buildFingerprint,
  createProjectTaskService,
  saveJobProgress,
  stableStringify,
  typeLabel
};
