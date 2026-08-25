const ExperimentLearning = require('../../models/ExperimentLearning');
const GrowthAlert = require('../../models/GrowthAlert');
const Recommendation = require('../../models/Recommendation');
const {
  combineObservations,
  continuousComparison,
  metricValue,
  rateComparison
} = require('./statistics');

const DAY_MS = 24 * 60 * 60 * 1000;

function durationDays(experiment, now = new Date()) {
  if (!experiment.startDate) return 0;
  return Math.max(0, (new Date(now).getTime() - new Date(experiment.startDate).getTime()) / DAY_MS);
}

function summarizeResult(winner, comparison, metric) {
  const uplift = comparison.uplift === null ? '' : ` (${comparison.uplift >= 0 ? '+' : ''}${(comparison.uplift * 100).toFixed(1)}%)`;
  return `${winner.name} produced ${comparison.variantValue.toFixed(4)} ${metric}${uplift} versus the control's ${comparison.controlValue.toFixed(4)}.`;
}

function evaluateExperimentData(experiment, observations, now = new Date()) {
  const groups = new Map();
  experiment.variants.forEach((variant) => groups.set(variant.key, []));
  observations.forEach((observation) => {
    if (groups.has(observation.variantKey) && observation.metric === experiment.primaryMetric) {
      groups.get(observation.variantKey).push(observation);
    }
  });
  const outcomes = experiment.variants.map((variant) => {
    const combined = combineObservations(groups.get(variant.key) || [], experiment.metricKind);
    return { variant, combined, value: metricValue(combined, experiment.metricKind) };
  });
  const control = outcomes.find((outcome) => outcome.variant.isControl);
  const samplesReady = outcomes.every((outcome) => outcome.combined.sampleSize >= experiment.minimumSamplePerVariant);
  const durationReady = durationDays(experiment, now) >= experiment.minimumDurationDays;
  const comparisons = outcomes
    .filter((outcome) => !outcome.variant.isControl)
    .map((outcome) => ({
      outcome,
      comparison: experiment.metricKind === 'rate'
        ? rateComparison(control.combined, outcome.combined)
        : continuousComparison(control.combined, outcome.combined)
    }))
    .filter((item) => item.comparison);
  const best = comparisons
    .filter((item) => item.comparison.absoluteDifference > 0)
    .sort((a, b) => b.comparison.confidence - a.comparison.confidence || b.comparison.absoluteDifference - a.comparison.absoluteDifference)[0] || null;
  const endReached = experiment.endDate ? new Date(now) >= new Date(experiment.endDate) : false;
  let status = experiment.status;
  let reason = '';
  let winner = null;

  if (samplesReady && durationReady && best && best.comparison.confidence >= experiment.requiredConfidence) {
    status = 'winner_found';
    winner = best;
    reason = 'A variant cleared the configured sample, duration, and confidence gates.';
  } else if (endReached) {
    status = 'inconclusive';
    reason = !samplesReady
      ? 'The measurement window ended before every variant reached its minimum sample.'
      : !durationReady
        ? 'The configured minimum duration was not reached.'
        : 'No variant cleared the required confidence threshold.';
  }

  return {
    status,
    reason,
    winner,
    comparisons,
    outcomes,
    samplesReady,
    durationReady,
    endReached
  };
}

async function persistAlert(experiment, type, title, summary, severity = 'warning') {
  const dedupeKey = `experiment:${experiment._id}:${type}:${experiment.status}`;
  return GrowthAlert.findOneAndUpdate(
    { projectId: experiment.projectId, dedupeKey },
    { $set: {
      type,
      severity,
      category: 'experimentation',
      urgency: severity === 'critical' ? 'high' : 'normal',
      confidence: experiment.confidence,
      title,
      summary,
      businessImpact: summary,
      evidenceData: { experimentId: experiment._id, status: experiment.status },
      recommendedAction: `Review the evidence and experiment decision for ${experiment.name}.`,
      ctaUrl: `/projects/${experiment.projectId}/experiments/${experiment._id}`,
      ctaLabel: 'Review experiment',
      channels: ['in_app'],
      deliveryPolicy: 'in_app_only',
      deliveryStatus: 'sent',
      dedupeKey
    } },
    { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true }
  );
}

async function applyLearning(experiment, evaluation) {
  if (!evaluation.winner) return null;
  const winner = evaluation.winner.outcome.variant;
  const decision = experiment.decision || `Use ${winner.name} more often in comparable ${experiment.channel || 'marketing'} activity, with continued human review.`;
  const payload = learningPayload(experiment, evaluation, decision);
  const learning = await ExperimentLearning.findOneAndUpdate(
    { experimentId: experiment._id },
    { $set: payload },
    { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true }
  );
  if (experiment.sourceRecommendationId) {
    await Recommendation.findByIdAndUpdate(experiment.sourceRecommendationId, { $set: { status: 'done' } });
  }
  return learning;
}

function learningPayload(experiment, evaluation, decision) {
  const winner = evaluation.winner.outcome.variant;
  const comparison = evaluation.winner.comparison;
  return {
    projectId: experiment.projectId,
    experimentId: experiment._id,
    sourceRecommendationId: experiment.sourceRecommendationId,
    experimentType: experiment.type,
    channel: experiment.channel,
    hypothesis: experiment.hypothesis,
    result: summarizeResult(winner, comparison, experiment.primaryMetric),
    decision,
    winningVariantKey: winner.key,
    confidence: comparison.confidence,
    primaryMetric: experiment.primaryMetric,
    evidence: {
      control: evaluation.outcomes.find((outcome) => outcome.variant.isControl).combined,
      winner: evaluation.winner.outcome.combined,
      uplift: comparison.uplift,
      absoluteDifference: comparison.absoluteDifference
    },
    tags: [experiment.type, experiment.channel, experiment.primaryMetric].filter(Boolean),
    status: 'active',
    appliedAt: new Date()
  };
}

async function persistEvaluation(experiment, evaluation) {
  evaluation.outcomes.forEach((outcome) => {
    const target = experiment.variants.find((variant) => variant.key === outcome.variant.key);
    target.outcome.sampleSize = outcome.combined.sampleSize;
    target.outcome.successes = experiment.metricKind === 'rate' ? outcome.combined.successes : null;
    target.outcome.metricValue = outcome.value;
    const comparison = evaluation.comparisons.find((item) => item.outcome.variant.key === outcome.variant.key);
    target.outcome.upliftVsControl = comparison ? comparison.comparison.uplift : null;
    target.outcome.confidenceVsControl = comparison ? comparison.comparison.confidence : null;
  });
  experiment.lastEvaluatedAt = new Date();
  experiment.status = evaluation.status;
  experiment.result = evaluation.winner
    ? summarizeResult(evaluation.winner.outcome.variant, evaluation.winner.comparison, experiment.primaryMetric)
    : evaluation.reason;
  experiment.confidence = evaluation.winner
    ? evaluation.winner.comparison.confidence
    : evaluation.comparisons.reduce((highest, item) => Math.max(highest, item.comparison.confidence), 0) || null;
  experiment.winningVariantKey = evaluation.winner ? evaluation.winner.outcome.variant.key : '';
  if (['winner_found', 'inconclusive'].includes(experiment.status)) experiment.completedAt = new Date();
  await experiment.save();

  if (evaluation.winner) {
    await applyLearning(experiment, evaluation);
    await persistAlert(experiment, 'experiment_winner_detected', `${experiment.name} found a measured winner`, experiment.result, 'growth_opportunity');
    await persistAlert(experiment, 'experiment_result', `${experiment.name} completed`, experiment.result, 'growth_opportunity');
  } else if (experiment.status === 'inconclusive') {
    await persistAlert(experiment, 'experiment_inconclusive', `${experiment.name} was inconclusive`, evaluation.reason);
    if (!evaluation.samplesReady) await persistAlert(experiment, 'experiment_sample_too_small', `${experiment.name} did not reach minimum sample`, evaluation.reason);
  } else if (!evaluation.samplesReady) {
    await persistAlert(experiment, 'experiment_sample_too_small', `${experiment.name} is still gathering evidence`, 'At least one variant is below the configured minimum sample.', 'info');
  }
  const harmful = evaluation.comparisons.find((item) => item.comparison.absoluteDifference < 0 && item.comparison.confidence >= experiment.requiredConfidence);
  if (harmful) await persistAlert(experiment, 'experiment_performance_risk', `${harmful.outcome.variant.name} is materially underperforming`, 'A variant is underperforming the control with sufficient measured confidence.', 'critical');
  return experiment;
}

module.exports = {
  durationDays,
  evaluateExperimentData,
  learningPayload,
  persistEvaluation,
  summarizeResult
};
