const Experiment = require('../../models/Experiment');
const ExperimentObservation = require('../../models/ExperimentObservation');
const ExperimentLearning = require('../../models/ExperimentLearning');
const Recommendation = require('../../models/Recommendation');
const { evaluateExperimentData, persistEvaluation } = require('./evaluationService');
const { refreshExperimentObservations } = require('./observationService');

function slugKey(value, fallback) {
  const key = String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 40);
  return key || fallback;
}

function metricDefaults(type) {
  if (['paid_creative', 'campaign_audience'].includes(type)) return { primaryMetric: 'conversion_rate', metricKind: 'rate', measurementSource: 'paid' };
  if (['social_caption', 'hook', 'creative', 'posting_time', 'messaging_angle'].includes(type)) return { primaryMetric: 'engagement_rate', metricKind: 'rate', measurementSource: 'social' };
  if (type === 'email_subject') return { primaryMetric: 'click_rate', metricKind: 'rate', measurementSource: 'tracking' };
  return { primaryMetric: 'conversion_rate', metricKind: 'rate', measurementSource: 'tracking' };
}

async function createFromRecommendation({ recommendation, ownerId }) {
  const existing = await Experiment.findOne({ sourceRecommendationId: recommendation._id, status: { $in: ['draft', 'running', 'paused'] } });
  if (existing) return existing;
  return Experiment.create(recommendationExperimentPayload({ recommendation, ownerId }));
}

function recommendationExperimentPayload({ recommendation, ownerId }) {
  const type = recommendation.actionType === 'content' ? 'messaging_angle' : 'landing_page';
  const defaults = metricDefaults(type);
  return {
    projectId: recommendation.projectId,
    ownerId,
    sourceRecommendationId: recommendation._id,
    name: `Test: ${recommendation.title}`.slice(0, 160),
    hypothesis: recommendation.reason || `Applying ${recommendation.title} will improve ${defaults.primaryMetric}.`,
    type,
    ...defaults,
    variants: [
      { key: 'control', name: 'Current approach', description: 'The existing approved experience or message.', isControl: true, allocationPercent: 50 },
      { key: slugKey(recommendation.title, 'variant_b'), name: 'Recommended approach', description: recommendation.title, isControl: false, allocationPercent: 50 }
    ],
    secondaryMetrics: [],
    audience: '',
    channel: type === 'landing_page' ? 'website' : 'multi',
    measurementConfig: { sourceRecommendationId: String(recommendation._id) }
  };
}

async function evaluateExperiment(experimentId, now = new Date()) {
  const experiment = await Experiment.findById(experimentId);
  if (!experiment) {
    const error = new Error('Experiment not found.');
    error.statusCode = 404;
    throw error;
  }
  const refreshed = await refreshExperimentObservations(experiment, now);
  const observations = refreshed.length
    ? refreshed
    : await ExperimentObservation.find({ experimentId: experiment._id, metric: experiment.primaryMetric });
  const evaluation = evaluateExperimentData(experiment, observations, now);
  await persistEvaluation(experiment, evaluation);
  return { experiment, evaluation };
}

async function dashboard(projectId) {
  const [experiments, learnings] = await Promise.all([
    Experiment.find({ projectId }).populate('ownerId', 'name email').sort({ updatedAt: -1 }).lean(),
    ExperimentLearning.find({ projectId, status: 'active' }).sort({ appliedAt: -1 }).lean()
  ]);
  return {
    active: experiments.filter((item) => ['running', 'paused'].includes(item.status)),
    drafts: experiments.filter((item) => item.status === 'draft'),
    winners: experiments.filter((item) => item.status === 'winner_found'),
    inconclusive: experiments.filter((item) => item.status === 'inconclusive'),
    stopped: experiments.filter((item) => item.status === 'stopped'),
    learnings,
    suggested: await Recommendation.find({ projectId, status: { $in: ['pending', 'accepted', 'in_progress'] } }).sort({ priority: 1 }).limit(8).lean()
  };
}

async function evaluateRunningExperiments({ limit = 100, now = new Date() } = {}) {
  const experiments = await Experiment.find({ status: 'running', startDate: { $ne: null } }).sort({ lastEvaluatedAt: 1 }).limit(limit).select('_id');
  const results = [];
  for (const experiment of experiments) {
    try {
      const output = await evaluateExperiment(experiment._id, now);
      results.push({ experimentId: experiment._id, status: output.experiment.status });
    } catch (error) {
      results.push({ experimentId: experiment._id, error: error.message });
    }
  }
  return results;
}

module.exports = {
  createFromRecommendation,
  dashboard,
  evaluateExperiment,
  evaluateRunningExperiments,
  metricDefaults,
  recommendationExperimentPayload,
  slugKey
};
