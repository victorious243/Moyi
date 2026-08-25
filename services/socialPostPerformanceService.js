const EngagementSnapshot = require('../models/EngagementSnapshot');
const GrowthSignal = require('../models/GrowthSignal');
const PublishJob = require('../models/PublishJob');
const SocialPostPerformance = require('../models/SocialPostPerformance');
const TrackingEvent = require('../models/TrackingEvent');
const {
  calculateVelocity,
  captureLifecycleWindows,
  median,
  normalizeMetricFamilies,
  normalizedValue,
  percentileRank
} = require('./socialPerformanceMath');

const BASELINE_MINIMUM = 3;
const COMPARABLE_MINIMUM = 5;

function classifyContentType(job) {
  const media = Array.isArray(job.mediaIds) ? job.mediaIds : [];
  const mimeTypes = media.map((item) => String(item && item.mimeType || '').toLowerCase()).filter(Boolean);
  if (media.length > 1) return 'carousel';
  if (mimeTypes.some((type) => type.startsWith('video/'))) return 'video';
  if (mimeTypes.some((type) => type.startsWith('image/')) || (job.content && job.content.imageUrl)) return 'image';
  return 'text';
}

function latestSnapshot(snapshots) {
  return [...snapshots].sort((left, right) => new Date(right.capturedAt) - new Date(left.capturedAt))[0] || null;
}

function objectiveFor(job) {
  const campaign = job.draftId && job.draftId.campaignId;
  return String(
    (job.publishOptions && job.publishOptions.objective)
    || (campaign && (campaign.objective || campaign.goal))
    || ''
  ).trim().toLowerCase();
}

function paidState(job, latest) {
  const providerData = latest && latest.providerData || {};
  const promoted = Boolean(
    providerData.promoted
    || providerData.isPromoted
    || providerData.paid
    || (job.publishOptions && job.publishOptions.promoted)
  );
  const known = promoted || ['organic', 'promoted'].includes(String(providerData.distributionType || '').toLowerCase());
  return { promoted, paidStatus: promoted ? 'promoted' : (known ? 'organic' : 'unknown') };
}

function completedWindow(performance) {
  return [...(performance.lifecycle || [])].filter((window) => window.complete).sort((a, b) => b.targetAgeMs - a.targetAgeMs)[0] || null;
}

function baselineMetricRows(performance, windowKey) {
  const window = (performance.lifecycle || []).find((item) => item.key === windowKey && item.complete);
  return window ? window.normalizedMetrics || [] : [];
}

function objectiveWeights(objective = '') {
  if (/conversion|lead/.test(objective)) return { conversions: 0.3, leads: 0.25, revenue: 0.2, sessions: 0.1, ctr: 0.1, meaningfulEngagement: 0.05 };
  if (/traffic|acquisition/.test(objective)) return { sessions: 0.3, trafficIntent: 0.25, ctr: 0.3, meaningfulEngagement: 0.1, exposure: 0.05 };
  if (/awareness|reach/.test(objective)) return { exposure: 0.45, meaningfulEngagement: 0.25, socialEngagementRate: 0.2, trafficIntent: 0.1 };
  return { meaningfulEngagement: 0.35, socialEngagementRate: 0.3, exposure: 0.2, trafficIntent: 0.15 };
}

function compareWithBaselines(performance, comparable) {
  const window = completedWindow(performance);
  if (!window) return { comparisonWindow: '', sampleSize: 0, metrics: {}, status: 'unavailable' };
  const rows = comparable.filter((item) => baselineMetricRows(item, window.key).length);
  const currentMetrics = window.normalizedMetrics || [];
  const families = ['exposure', 'meaningfulEngagement', 'socialEngagementRate', 'trafficIntent', 'ctr'];
  const metrics = {};
  families.forEach((family) => {
    const observed = normalizedValue(currentMetrics, family);
    const values = rows.map((item) => normalizedValue(baselineMetricRows(item, window.key), family)).filter((value) => value !== null);
    const baselineMedian = median(values);
    if (observed === null || baselineMedian === null) return;
    metrics[family] = {
      observed,
      median: baselineMedian,
      delta: baselineMedian > 0 ? (observed - baselineMedian) / baselineMedian : null,
      percentile: values.length >= BASELINE_MINIMUM ? percentileRank(values, observed) : null,
      sampleSize: values.length
    };
  });
  ['sessions', 'leads', 'conversions', 'revenue'].forEach((family) => {
    const observed = performance.attribution && performance.attribution.status === 'verified'
      ? Number(performance.attribution[family])
      : null;
    const values = rows.map((item) => (
      item.attribution && item.attribution.status === 'verified' && Number.isFinite(Number(item.attribution[family]))
        ? Number(item.attribution[family])
        : null
    )).filter((value) => value !== null);
    const baselineMedian = median(values);
    if (!Number.isFinite(observed) || baselineMedian === null) return;
    metrics[family] = {
      observed,
      median: baselineMedian,
      delta: baselineMedian > 0 ? (observed - baselineMedian) / baselineMedian : null,
      percentile: values.length >= BASELINE_MINIMUM ? percentileRank(values, observed) : null,
      sampleSize: values.length,
      source: 'first_party_attribution'
    };
  });
  return {
    comparisonWindow: window.key,
    sampleSize: rows.length,
    metrics,
    status: rows.length >= COMPARABLE_MINIMUM ? 'comparable' : (rows.length >= BASELINE_MINIMUM ? 'provisional' : 'unavailable')
  };
}

function mostComparableHistory(performance, comparable) {
  const sameObjective = performance.objective
    ? comparable.filter((item) => item.objective === performance.objective)
    : [];
  if (sameObjective.length >= COMPARABLE_MINIMUM) {
    const sameObjectiveAndFormat = sameObjective.filter((item) => item.contentType === performance.contentType);
    return sameObjectiveAndFormat.length >= COMPARABLE_MINIMUM ? sameObjectiveAndFormat : sameObjective;
  }
  const sameFormat = comparable.filter((item) => item.contentType === performance.contentType);
  return sameFormat.length >= COMPARABLE_MINIMUM ? sameFormat : comparable;
}

function scoreFromComparison(comparison, objective) {
  const weights = objectiveWeights(objective);
  const available = Object.entries(weights).filter(([family]) => {
    const metric = comparison.metrics && comparison.metrics[family];
    return metric && Number.isFinite(metric.percentile);
  });
  if (!available.length) return null;
  const denominator = available.reduce((sum, [, weight]) => sum + weight, 0);
  return Math.round(available.reduce((sum, [family, weight]) => sum + comparison.metrics[family].percentile * weight, 0) / denominator);
}

function confidenceFor(performance, comparison) {
  const latestStates = performance.latestMetricStates || [];
  const supported = latestStates.filter((state) => state.status === 'verified').length;
  const unresolved = latestStates.filter((state) => ['pending', 'provider_error'].includes(state.status)).length;
  const requested = Math.max(1, supported + unresolved);
  const providerCoverage = supported / requested;
  const lifecycleCompleteness = Number(performance.lifecycleCompleteness || 0);
  const sampleScore = Math.min(1, Number(comparison.sampleSize || 0) / 10);
  const freshnessDays = performance.lastObservedAt ? Math.max(0, (Date.now() - new Date(performance.lastObservedAt)) / 86400000) : 999;
  const freshness = freshnessDays <= 2 ? 1 : freshnessDays <= 7 ? 0.7 : freshnessDays <= 30 ? 0.4 : 0.1;
  const score = Math.round((sampleScore * 0.4 + providerCoverage * 0.2 + lifecycleCompleteness * 0.25 + freshness * 0.15) * 100) / 100;
  const label = score >= 0.8 ? 'strong' : score >= 0.6 ? 'moderate' : score >= 0.35 ? 'emerging' : 'insufficient';
  return { score, label, sampleSize: comparison.sampleSize || 0, providerCoverage, lifecycleCompleteness, freshness };
}

function detectAnomalies(comparison) {
  const metrics = comparison.metrics || {};
  const anomalies = [];
  const exposure = metrics.exposure;
  const engagement = metrics.meaningfulEngagement;
  const ctr = metrics.ctr;
  const sessions = metrics.sessions;
  const conversions = metrics.conversions;
  if (exposure && exposure.delta >= 1) anomalies.push({ type: 'breakout_exposure', severity: 'positive', evidence: exposure });
  if (exposure && exposure.delta >= 0.5 && engagement && engagement.delta <= -0.3) {
    anomalies.push({ type: 'high_exposure_weak_engagement', severity: 'warning', evidence: { exposure, meaningfulEngagement: engagement } });
  }
  if (engagement && engagement.delta >= 0.5 && ctr && ctr.delta <= -0.3) {
    anomalies.push({ type: 'high_engagement_weak_clicks', severity: 'warning', evidence: { meaningfulEngagement: engagement, ctr } });
  }
  if (ctr && ctr.delta >= 1) anomalies.push({ type: 'ctr_breakout', severity: 'positive', evidence: ctr });
  if (sessions && sessions.delta >= 0.5 && conversions && conversions.delta !== null && conversions.delta <= -0.3) {
    anomalies.push({ type: 'high_traffic_weak_conversions', severity: 'warning', evidence: { sessions, conversions } });
  }
  return anomalies;
}

async function attributionFor(job) {
  const projectId = job.destinationProjectId || job.projectId;
  const identifiers = [String(job._id), String(job.platformPostId || ''), String(job.draftId && job.draftId._id || job.draftId || '')].filter(Boolean);
  const events = await TrackingEvent.find({ projectId, moyiPostId: { $in: identifiers } })
    .select('sessionId funnelStage eventType eventValue currency createdAt')
    .lean();
  if (!events.length) return { status: 'unavailable', sessions: null, leads: null, conversions: null, revenue: null, currency: '' };
  const sessions = new Set(events.map((event) => event.sessionId).filter(Boolean)).size;
  const leads = events.filter((event) => ['lead', 'qualified_lead'].includes(event.funnelStage)).length;
  const conversions = events.filter((event) => event.eventType === 'conversion' || ['signup', 'purchase', 'revenue'].includes(event.funnelStage)).length;
  const revenueEvents = events.filter((event) => ['purchase', 'revenue'].includes(event.funnelStage));
  return {
    status: 'verified',
    sessions,
    leads,
    conversions,
    revenue: revenueEvents.reduce((sum, event) => sum + Number(event.eventValue || 0), 0),
    currency: (revenueEvents.find((event) => event.currency) || {}).currency || ''
  };
}

async function updateGrowthSignalFromPerformance(performance) {
  const comparison = performance.baselineComparison || {};
  const evidenceKey = `${performance.publishJobId}:${comparison.comparisonWindow || 'latest'}`;
  const summary = comparison.status === 'unavailable'
    ? `${performance.platform} post performance is measured, but comparable lifecycle evidence is still insufficient.`
    : `${performance.platform} post compared with ${comparison.sampleSize} historical posts at ${comparison.comparisonWindow}.`;
  return GrowthSignal.findOneAndUpdate(
    { publishJobId: performance.publishJobId },
    { $set: {
      projectId: performance.projectId,
      sourceProjectId: performance.sourceProjectId,
      publishJobId: performance.publishJobId,
      draftId: performance.draftId,
      platform: performance.platform,
      signalType: 'social_post_performance',
      score: performance.performanceScore,
      summary,
      evidence: {
        evidenceKey,
        sourcePostPerformanceId: performance._id,
        evidenceSnapshotIds: (performance.lifecycle || []).filter((item) => item.snapshotId).map((item) => item.snapshotId),
        comparisonWindow: comparison.comparisonWindow,
        baselineComparison: comparison,
        confidence: performance.confidence,
        latestMetrics: performance.latestNativeMetrics,
        normalizedMetrics: performance.latestNormalizedMetrics,
        attribution: performance.attribution,
        anomalies: performance.anomalies,
        contentType: performance.contentType,
        objective: performance.objective,
        promoted: performance.promoted,
        publishedAt: performance.publishedAt
      },
      observedAt: performance.lastObservedAt
    } },
    { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true }
  );
}

async function rebuildCanonicalPostPerformance(publishJobId) {
  const job = await PublishJob.findById(publishJobId)
    .populate({ path: 'draftId', select: 'title body campaignId contentImageId', populate: { path: 'campaignId', select: 'name goal channel startDate endDate' } })
    .populate('mediaIds', 'mimeType')
    .lean();
  if (!job || job.status !== 'published' || !job.platformPostId || !job.publishedAt) return null;
  const projectId = job.destinationProjectId || job.projectId;
  const snapshots = await EngagementSnapshot.find({ projectId, publishJobId: job._id }).sort({ capturedAt: 1 }).lean();
  if (!snapshots.length) return null;
  const latest = latestSnapshot(snapshots);
  const lifecycle = captureLifecycleWindows(snapshots, job.publishedAt);
  const velocity = calculateVelocity(snapshots, job.publishedAt);
  const paid = paidState(job, latest);
  const base = {
    projectId,
    sourceProjectId: job.projectId,
    publishJobId: job._id,
    draftId: job.draftId && job.draftId._id || job.draftId,
    socialAccountId: job.accountId,
    platform: job.platform,
    remotePostId: job.platformPostId,
    publishedAt: job.publishedAt,
    contentType: classifyContentType(job),
    campaignId: job.draftId && job.draftId.campaignId && job.draftId.campaignId._id || job.draftId && job.draftId.campaignId || null,
    objective: objectiveFor(job),
    ...paid,
    latestSnapshotId: latest._id,
    latestNativeMetrics: latest.metrics || {},
    latestMetricStates: latest.metricStates || [],
    latestNormalizedMetrics: normalizeMetricFamilies({ metrics: latest.metrics, metricStates: latest.metricStates, platform: job.platform }),
    lifecycle,
    lifecycleCompleteness: lifecycle.filter((window) => window.complete).length / lifecycle.length,
    velocity: { intervals: velocity.intervals, latest: velocity.latest },
    counterRegressions: velocity.counterRegressions,
    attribution: await attributionFor(job),
    lastObservedAt: latest.capturedAt,
    lastUpdatedAt: new Date()
  };
  let performance = await SocialPostPerformance.findOneAndUpdate(
    { projectId, publishJobId: job._id },
    { $set: base },
    { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true }
  );
  const comparableFilter = {
    projectId,
    platform: job.platform,
    publishJobId: { $ne: job._id },
    publishedAt: { $gte: new Date(new Date(job.publishedAt).getTime() - 90 * 86400000), $lte: job.publishedAt },
    promoted: paid.promoted
  };
  const comparable = await SocialPostPerformance.find(comparableFilter).sort({ publishedAt: -1 }).limit(100).lean();
  const comparison = compareWithBaselines(
    performance.toObject(),
    mostComparableHistory(performance.toObject(), comparable)
  );
  const score = scoreFromComparison(comparison, base.objective);
  const confidence = confidenceFor(performance.toObject(), comparison);
  const anomalies = detectAnomalies(comparison);
  performance = await SocialPostPerformance.findOneAndUpdate(
    { _id: performance._id },
    { $set: { baselineComparison: comparison, performanceScore: score, scoreStatus: comparison.status, confidence, anomalies, lastUpdatedAt: new Date() } },
    { returnDocument: 'after' }
  );
  await updateGrowthSignalFromPerformance(performance);
  console.info(JSON.stringify({
    event: 'canonical_social_post_performance_updated',
    projectId: String(projectId),
    publishJobId: String(job._id),
    remotePostId: job.platformPostId,
    platform: job.platform,
    snapshots: snapshots.length,
    lifecycleComplete: lifecycle.filter((window) => window.complete).map((window) => window.key),
    scoreStatus: comparison.status
  }));
  return performance;
}

module.exports = {
  BASELINE_MINIMUM,
  COMPARABLE_MINIMUM,
  attributionFor,
  compareWithBaselines,
  confidenceFor,
  detectAnomalies,
  mostComparableHistory,
  rebuildCanonicalPostPerformance,
  scoreFromComparison,
  updateGrowthSignalFromPerformance
};
