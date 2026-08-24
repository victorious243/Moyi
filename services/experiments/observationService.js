const ExperimentObservation = require('../../models/ExperimentObservation');
const TrackingEvent = require('../../models/TrackingEvent');
const SocialPostPerformance = require('../../models/SocialPostPerformance');
const PaidMetricSnapshot = require('../../models/PaidMetricSnapshot');

function dateBounds(experiment, now = new Date()) {
  return {
    start: experiment.startDate || experiment.createdAt,
    end: experiment.endDate && new Date(experiment.endDate) < new Date(now) ? experiment.endDate : now
  };
}

function squares(values) {
  return values.reduce((sum, value) => sum + (value * value), 0);
}

function successMatcher(experiment) {
  const config = experiment.measurementConfig || {};
  if (config.successEventName) return (event) => event.eventName === config.successEventName;
  const stageByMetric = {
    lead_rate: 'lead',
    qualified_lead_rate: 'qualified_lead',
    signup_rate: 'signup',
    purchase_rate: 'purchase',
    revenue_rate: 'revenue'
  };
  if (stageByMetric[experiment.primaryMetric]) return (event) => event.funnelStage === stageByMetric[experiment.primaryMetric];
  if (experiment.primaryMetric === 'click_rate') return (event) => ['cta_click', 'link_click'].includes(event.eventName);
  if (experiment.primaryMetric === 'form_completion_rate') return (event) => event.eventName === 'form_submit';
  return (event) => event.eventType === 'conversion';
}

async function collectTracking(experiment, variant, bounds) {
  const events = await TrackingEvent.find({
    projectId: experiment.projectId,
    experimentId: experiment._id,
    experimentVariant: variant.key,
    createdAt: { $gte: bounds.start, $lte: bounds.end }
  }).sort({ createdAt: 1 }).lean();
  const sessions = new Map();
  events.forEach((event) => {
    if (!sessions.has(event.sessionId)) sessions.set(event.sessionId, []);
    sessions.get(event.sessionId).push(event);
  });
  const config = experiment.measurementConfig || {};
  const eligible = Array.from(sessions.values()).filter((sessionEvents) => (
    !config.denominatorEventName || sessionEvents.some((event) => event.eventName === config.denominatorEventName)
  ));
  if (experiment.metricKind === 'rate') {
    const matches = successMatcher(experiment);
    return {
      sampleSize: eligible.length,
      successes: eligible.filter((sessionEvents) => sessionEvents.some(matches)).length,
      sum: null,
      sumSquares: null,
      sourceRecordCount: events.length
    };
  }
  const values = eligible.map((sessionEvents) => sessionEvents.reduce((sum, event) => sum + Number(event.eventValue || 0), 0));
  return {
    sampleSize: values.length,
    successes: null,
    sum: values.reduce((sum, value) => sum + value, 0),
    sumSquares: squares(values),
    sourceRecordCount: events.length
  };
}

async function latestSocialPerformances(projectId, publishJobIds, bounds) {
  if (!publishJobIds.length) return [];
  return SocialPostPerformance.find({
    projectId,
    publishJobId: { $in: publishJobIds },
    publishedAt: { $gte: bounds.start, $lte: bounds.end }
  }).lean();
}

async function collectSocial(experiment, variant, bounds) {
  const publishJobIds = Array.isArray(variant.sourceRefs && variant.sourceRefs.publishJobIds)
    ? variant.sourceRefs.publishJobIds.filter((value) => /^[a-f\d]{24}$/i.test(String(value)))
    : [];
  const rows = await latestSocialPerformances(experiment.projectId, publishJobIds, bounds);
  if (experiment.metricKind === 'rate') {
    const family = experiment.primaryMetric === 'ctr' || experiment.primaryMetric === 'click_rate' ? 'trafficIntent' : 'socialEngagement';
    const eligible = rows.map((row) => {
      const exposure = (row.latestNormalizedMetrics || []).find((metric) => metric.family === 'exposure' && metric.status === 'verified');
      const numerator = (row.latestNormalizedMetrics || []).find((metric) => metric.family === family && metric.status === 'verified');
      return exposure && numerator ? { exposure: Number(exposure.value), numerator: Number(numerator.value) } : null;
    }).filter(Boolean);
    const denominator = eligible.reduce((sum, row) => sum + row.exposure, 0);
    const successes = eligible.reduce((sum, row) => sum + row.numerator, 0);
    return { sampleSize: denominator, successes: Math.min(successes, denominator), sum: null, sumSquares: null, sourceRecordCount: rows.length };
  }
  const metric = experiment.primaryMetric;
  const familyByMetric = { engagements: 'socialEngagement', meaningful_engagements: 'meaningfulEngagement', clicks: 'trafficIntent' };
  const values = rows.map((row) => {
    const family = familyByMetric[metric];
    if (family) {
      const normalized = (row.latestNormalizedMetrics || []).find((item) => item.family === family && item.status === 'verified');
      return normalized ? Number(normalized.value) : null;
    }
    const value = row.latestNativeMetrics && row.latestNativeMetrics[metric];
    return value === null || value === undefined ? null : Number(value);
  }).filter((value) => Number.isFinite(value));
  return {
    sampleSize: values.length,
    successes: null,
    sum: values.reduce((sum, value) => sum + value, 0),
    sumSquares: squares(values),
    sourceRecordCount: rows.length
  };
}

async function collectPaid(experiment, variant, bounds) {
  const externalEntityIds = Array.isArray(variant.sourceRefs && variant.sourceRefs.externalEntityIds)
    ? variant.sourceRefs.externalEntityIds
    : [];
  const rows = await PaidMetricSnapshot.find({
    projectId: experiment.projectId,
    externalEntityId: { $in: externalEntityIds },
    date: { $gte: bounds.start, $lte: bounds.end }
  }).lean();
  if (experiment.metricKind === 'rate') {
    const numeratorMetric = experiment.primaryMetric === 'ctr' ? 'clicks' : 'conversions';
    const denominatorMetric = experiment.primaryMetric === 'ctr' ? 'impressions' : 'clicks';
    const denominator = rows.reduce((sum, row) => sum + Number(row.metrics[denominatorMetric] || 0), 0);
    const successes = rows.reduce((sum, row) => sum + Number(row.metrics[numeratorMetric] || 0), 0);
    return { sampleSize: denominator, successes: Math.min(successes, denominator), sum: null, sumSquares: null, sourceRecordCount: rows.length };
  }
  const values = rows.map((row) => Number(row.metrics[experiment.primaryMetric])).filter(Number.isFinite);
  return {
    sampleSize: values.length,
    successes: null,
    sum: values.reduce((sum, value) => sum + value, 0),
    sumSquares: squares(values),
    sourceRecordCount: rows.length
  };
}

async function refreshExperimentObservations(experiment, now = new Date()) {
  if (!experiment.startDate) return [];
  const bounds = dateBounds(experiment, now);
  const collectors = { tracking: collectTracking, social: collectSocial, paid: collectPaid };
  const collect = collectors[experiment.measurementSource];
  const observations = [];
  for (const variant of experiment.variants) {
    const values = await collect(experiment, variant, bounds);
    const sourceKey = `${experiment.measurementSource}:cumulative`;
    const observation = await ExperimentObservation.findOneAndUpdate(
      { experimentId: experiment._id, variantKey: variant.key, metric: experiment.primaryMetric, sourceKey },
      { $set: {
        projectId: experiment.projectId,
        experimentId: experiment._id,
        variantKey: variant.key,
        metric: experiment.primaryMetric,
        metricKind: experiment.metricKind,
        source: experiment.measurementSource,
        sourceKey,
        ...values,
        observedFrom: bounds.start,
        observedTo: bounds.end,
        metadata: { collectedFromRealRecords: true }
      } },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    observations.push(observation);
  }
  return observations;
}

module.exports = {
  collectPaid,
  collectSocial,
  collectTracking,
  dateBounds,
  refreshExperimentObservations
};
