const MarketingGoal = require('../../models/MarketingGoal');
const StrategicMetricSnapshot = require('../../models/StrategicMetricSnapshot');
const StrategicForecast = require('../../models/StrategicForecast');
const StrategicOpportunity = require('../../models/StrategicOpportunity');
const StrategicDecision = require('../../models/StrategicDecision');
const StrategicReview = require('../../models/StrategicReview');
const CompetitorSnapshot = require('../../models/CompetitorSnapshot');
const Competitor = require('../../models/Competitor');
const GrowthAlert = require('../../models/GrowthAlert');
const EvidenceRecord = require('../../models/EvidenceRecord');
const { buildForecast } = require('./forecastingService');
const { syncStrategicMetricSnapshots } = require('./metricSnapshotService');
const { buildSearchDemandIntelligence } = require('./searchDemandService');
const { buildAudienceIntelligence } = require('./audienceIntelligenceService');
const { diagnoseMetrics } = require('./diagnosticService');
const { buildCoreEvidenceGraph, persistEvidence } = require('./evidenceService');
const { evaluateGoalPacing } = require('./goalPacingService');
const { buildExecutivePriority } = require('./executivePrioritizationService');
const { metricDefinition } = require('./metricRegistry');
const { strategicSignificance } = require('./strategicSignificanceService');

const GOAL_METRIC = {
  revenue: 'revenue',
  marketing_attributed_revenue: 'revenue',
  qualified_leads: 'qualified_leads',
  signups: 'signups',
  conversion_rate: 'conversion_rate',
  organic_traffic: 'organic_traffic',
  paid_traffic: 'paid_traffic',
  cac: 'cac',
  cpa: 'cpa',
  roas: 'roas'
};

const SOURCE_PRIORITY = {
  revenue: ['tracking', 'paid_ads'],
  leads: ['tracking', 'paid_ads'],
  qualified_leads: ['tracking', 'paid_ads'],
  signups: ['tracking'],
  conversions: ['tracking', 'paid_ads'],
  conversion_rate: ['tracking'],
  traffic: ['tracking'],
  organic_traffic: ['search_console'],
  paid_traffic: ['paid_ads'],
  cac: ['paid_ads'],
  cpa: ['paid_ads'],
  roas: ['paid_ads'],
  spend: ['paid_ads'],
  search_impressions: ['search_console'],
  search_clicks: ['search_console']
};

function startOfWeek(now) {
  const date = new Date(now);
  const offset = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - offset);
  date.setUTCHours(0, 0, 0, 0);
  return date;
}

function endOfWeek(now) {
  const date = startOfWeek(now);
  date.setUTCDate(date.getUTCDate() + 6);
  date.setUTCHours(23, 59, 59, 999);
  return date;
}

function startOfMonth(now) {
  const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  return date;
}

function endOfMonth(now) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0, 23, 59, 59, 999));
}

function pointsForMetric(snapshots, metric) {
  const sources = SOURCE_PRIORITY[metric] || [];
  for (const source of sources) {
    const points = snapshots.filter((item) => item.metric === metric && item.source === source);
    if (points.length) return points;
  }
  return snapshots.filter((item) => item.metric === metric);
}

function forecastDocument({ projectId, goal = null, metric, horizon, periodStart, periodEnd, forecast }) {
  return {
    projectId,
    goalId: goal ? goal._id : null,
    metric,
    horizon,
    periodStart,
    periodEnd,
    targetValue: goal ? goal.targetValue : null,
    ...forecast,
    generatedAt: new Date()
  };
}

async function upsertForecast(payload) {
  return StrategicForecast.findOneAndUpdate(
    { projectId: payload.projectId, metric: payload.metric, horizon: payload.horizon, goalId: payload.goalId },
    { $set: payload },
    { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true }
  );
}

function forecastAlertType(goal, forecast) {
  if (forecast.confidence.band === 'insufficient' || forecast.goalAchievementProbability === null) return '';
  if (forecast.goalAchievementProbability < 40) return 'goal_at_risk';
  if (forecast.goalAchievementProbability >= 80) return 'goal_ahead_of_plan';
  if (goal.direction === 'decrease') return forecast.forecastValue > goal.targetValue ? 'forecast_below_target' : 'forecast_above_target';
  return forecast.forecastValue < goal.targetValue ? 'forecast_below_target' : 'forecast_above_target';
}

async function persistStrategicAlert(projectId, input) {
  if (!input.type) return null;
  const dedupeKey = input.dedupeKey || `strategy:${input.type}:${input.key}`;
  return GrowthAlert.findOneAndUpdate(
    { projectId, dedupeKey },
    { $set: {
      projectId,
      type: input.type,
      category: 'strategic_intelligence',
      severity: input.severity || 'warning',
      urgency: input.urgency || 'normal',
      confidence: input.confidence,
      title: input.title,
      summary: input.summary,
      businessImpact: input.businessImpact || input.summary,
      evidenceData: input.evidence || {},
      evidenceIds: input.evidenceIds || [],
      recommendedAction: input.recommendedAction || '',
      ctaUrl: `/projects/${projectId}/strategy-intelligence`,
      ctaLabel: 'Review strategy',
      channels: ['in_app'],
      deliveryPolicy: 'in_app_only',
      deliveryStatus: 'sent',
      resolutionStatus: 'open',
      resolvedAt: null,
      dedupeKey
    } },
    { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true }
  );
}

async function persistOpportunity(projectId, opportunity, now = new Date()) {
  return StrategicOpportunity.findOneAndUpdate(
    { projectId, dedupeKey: opportunity.dedupeKey },
    {
      $set: { ...opportunity, projectId, lastDetectedAt: now },
      $setOnInsert: { firstDetectedAt: now, status: 'open' }
    },
    { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true }
  );
}

function impactForMetric(metric) {
  if (['revenue', 'qualified_leads', 'conversions', 'cac', 'roas'].includes(metric)) return 'high';
  if (['leads', 'signups', 'conversion_rate', 'traffic', 'organic_traffic', 'paid_traffic'].includes(metric)) return 'medium';
  return 'low';
}

async function persistForecastEvidence(project, forecastDocumentRow) {
  const forecast = forecastDocumentRow.toObject ? forecastDocumentRow.toObject() : forecastDocumentRow;
  const available = forecast.forecastValue !== null && forecast.validation && forecast.validation.passed;
  return persistEvidence({
    projectId: project._id || project,
    organizationId: project.organizationId || null,
    claimKey: `forecast:${forecast.metric}:${forecast.horizon}`,
    claim: available
      ? `${metricDefinition(forecast.metric)?.displayName || forecast.metric} has a validated ${forecast.horizon.replace(/_/g, ' ')} forecast.`
      : `${metricDefinition(forecast.metric)?.displayName || forecast.metric} cannot currently be forecast with acceptable evidence.`,
    classification: available ? 'modeled' : 'insufficient_evidence',
    metric: forecast.metric,
    source: 'strategic_forecast',
    sourceRecordIds: [forecast._id],
    periodStart: forecast.periodStart,
    periodEnd: forecast.periodEnd,
    observedAt: forecast.generatedAt,
    value: forecast.forecastValue,
    sampleSize: forecast.observedDays,
    confidence: forecast.confidence && forecast.confidence.score,
    dataQualityScore: forecast.evidence && forecast.evidence.dataQuality && forecast.evidence.dataQuality.score || 0,
    forecastValidated: available,
    businessImpact: impactForMetric(forecast.metric),
    evidence: { forecastId: forecast._id, model: forecast.method, range: [forecast.lowerBound, forecast.upperBound], validation: forecast.validation },
    unknowns: available ? [] : ['Future value remains unknown because no candidate model passed all evidence gates.'],
    limitations: [forecast.confidence && forecast.confidence.reason].filter(Boolean),
    dedupeKey: `forecast:${forecast.metric}:${forecast.horizon}:${forecast.goalId || 'all'}`
  });
}

async function persistDiagnosticEvidence(project, diagnostic, now = new Date()) {
  const observed = diagnostic.status === 'observed';
  const noMaterialChange = diagnostic.status === 'no_material_change';
  const label = metricDefinition(diagnostic.metric)?.displayName || diagnostic.metric;
  return persistEvidence({
    projectId: project._id,
    organizationId: project.organizationId || null,
    claimKey: `movement:${diagnostic.metric}:14d`,
    claim: observed
      ? `${label} changed ${diagnostic.changePercent > 0 ? '+' : ''}${diagnostic.changePercent}% across comparable 14-day periods.`
      : noMaterialChange ? `${label} has no material 14-day movement.` : `${label} movement cannot yet be assessed.`,
    classification: diagnostic.status === 'insufficient_evidence' ? 'insufficient_evidence' : 'observed',
    causalLevel: 'OBSERVATIONAL',
    metric: diagnostic.metric,
    source: 'strategic_diagnostics',
    periodStart: diagnostic.quality && diagnostic.quality.firstObservedAt,
    periodEnd: diagnostic.quality && diagnostic.quality.lastObservedAt,
    observedAt: now,
    value: diagnostic.currentValue,
    previousValue: diagnostic.previousValue,
    changePercent: diagnostic.changePercent,
    sampleSize: diagnostic.quality && diagnostic.quality.observations,
    confidence: diagnostic.confidence || 0,
    dataQualityScore: diagnostic.quality && diagnostic.quality.score || 0,
    businessImpact: impactForMetric(diagnostic.metric),
    evidence: { periodDays: diagnostic.periodDays, significance: diagnostic.significance },
    unknowns: observed ? ['The observed movement does not establish its cause.'] : [],
    limitations: diagnostic.quality && diagnostic.quality.issues || [],
    dedupeKey: `movement:${diagnostic.metric}:14d:${now.toISOString().slice(0, 10)}`
  });
}

function searchOpportunity(signal) {
  if (!['emerging_keyword', 'demand_increase'].includes(signal.kind)) return null;
  return {
    type: 'search',
    title: signal.kind === 'emerging_keyword' ? `Emerging search demand: ${signal.query}` : `Search demand is rising: ${signal.query}`,
    opportunity: `Capture growing demand around “${signal.query}” while the signal remains active.`,
    evidence: signal,
    evidenceSummary: signal.evidence,
    confidence: Math.round(signal.confidence),
    potentialImpact: signal.current.impressions >= 500 ? 'high' : 'medium',
    difficulty: 'medium',
    recommendedAction: 'Review search intent, defend or create the most relevant page, and test conversion messaging before increasing investment.',
    channel: 'organic_search',
    timeSensitivity: signal.kind === 'emerging_keyword' ? 'high' : 'normal',
    dedupeKey: `search:${signal.kind}:${signal.cluster}`,
    sourceRefs: { query: signal.query, cluster: signal.cluster }
  };
}

function audienceOpportunity(signal) {
  if (signal.changePoints <= 0 || !['channel', 'geography'].includes(signal.type)) return null;
  return {
    type: signal.type === 'geography' ? 'geography' : 'channel',
    title: `${signal.segment} is gaining audience share`,
    opportunity: `Validate whether the growing ${signal.type} segment produces qualified outcomes before allocating more resources.`,
    evidence: signal,
    evidenceSummary: `${signal.segment} increased its session share by ${signal.changePoints.toFixed(1)} percentage points across comparable 28-day windows.`,
    confidence: signal.confidence,
    potentialImpact: Math.abs(signal.changePoints) >= 20 ? 'high' : 'medium',
    difficulty: 'low',
    recommendedAction: `Create a controlled campaign or experiment for ${signal.segment}; increase investment only if conversion quality holds.`,
    channel: signal.type === 'channel' ? signal.segment : 'multi',
    timeSensitivity: 'normal',
    dedupeKey: `audience:${signal.type}:${signal.segment}`,
    sourceRefs: { segment: signal.segment }
  };
}

function competitorOpportunity(snapshot, competitor) {
  if (!competitor) return null;
  const change = (snapshot.changes || []).find((item) => ['new_campaign', 'pricing_change', 'offer_change', 'positioning_change'].includes(item.type));
  if (!change) return null;
  return {
    type: 'competitor_weakness',
    title: `${competitor.name}: ${change.type.replace(/_/g, ' ')}`,
    opportunity: 'Assess whether this public competitor move creates an opening to differentiate, defend demand, or improve the offer.',
    evidence: { competitorId: competitor._id, capturedAt: snapshot.capturedAt, change },
    evidenceSummary: change.summary,
    confidence: change.confidence,
    potentialImpact: ['pricing_change', 'positioning_change'].includes(change.type) ? 'high' : 'medium',
    difficulty: 'medium',
    recommendedAction: 'Review the changed public page, compare it with customer evidence, and approve a response only if it supports Moyi’s positioning.',
    channel: 'competitive_intelligence',
    timeSensitivity: 'high',
    dedupeKey: `competitor:${competitor._id}:${change.type}:${change.url || 'positioning'}`,
    sourceRefs: { competitorId: competitor._id, snapshotId: snapshot._id }
  };
}

function measurementForOpportunity(opportunity) {
  const evidence = opportunity.evidence || {};
  if (opportunity.type === 'search' && evidence.current && Number.isFinite(Number(evidence.current.impressions))) {
    return { metric: `search_impressions:${evidence.query}`, beforeValue: Number(evidence.current.impressions) };
  }
  if (['channel', 'geography', 'audience'].includes(opportunity.type) && Number.isFinite(Number(evidence.currentShare))) {
    return { metric: `audience_share:${evidence.type}:${evidence.segment}`, beforeValue: Number(evidence.currentShare) * 100 };
  }
  return { metric: '', beforeValue: null };
}

function applyDecisionAction(decision, action, reason = '', now = new Date()) {
  if (action === 'reject') {
    decision.decision = 'rejected';
    decision.decidedAt = now;
  } else if (action === 'defer') {
    decision.decision = 'deferred';
    decision.decidedAt = now;
  } else if (action === 'start' && decision.decision === 'accepted' && decision.executionStatus === 'not_started') {
    decision.executionStatus = 'in_progress';
  } else if (action === 'complete' && decision.executionStatus === 'in_progress') {
    decision.executionStatus = 'completed';
    decision.executedAt = now;
    decision.measurementDueAt = new Date(now.getTime() + 30 * 86400000);
  }
  if (reason) decision.decisionReason = String(reason);
  return decision;
}

async function measureDueDecisions(projectId, { searchDemand = [], audience = { signals: [] }, now = new Date() } = {}) {
  const decisions = await StrategicDecision.find({
    projectId,
    executionStatus: 'completed',
    measuredAt: null,
    measurementDueAt: { $ne: null, $lte: now }
  });
  let measured = 0;
  for (const decision of decisions) {
    const metric = decision.outcome && decision.outcome.metric || '';
    let afterValue = null;
    if (metric.startsWith('search_impressions:')) {
      const query = metric.slice('search_impressions:'.length);
      const signal = searchDemand.find((item) => item.query === query);
      if (signal && signal.current) afterValue = Number(signal.current.impressions);
    } else if (metric.startsWith('audience_share:')) {
      const [, type, ...segmentParts] = metric.split(':');
      const segment = segmentParts.join(':');
      const signal = (audience.signals || []).find((item) => item.type === type && item.segment === segment);
      if (signal) afterValue = Number(signal.currentShare) * 100;
    }
    const beforeValue = Number(decision.outcome && decision.outcome.beforeValue);
    if (!Number.isFinite(afterValue) || !Number.isFinite(beforeValue)) continue;
    const changePercent = beforeValue ? ((afterValue - beforeValue) / Math.abs(beforeValue)) * 100 : null;
    decision.outcome.afterValue = afterValue;
    decision.outcome.changePercent = Number.isFinite(changePercent) ? Math.round(changePercent * 10) / 10 : null;
    decision.outcome.confidence = Math.min(85, Number(decision.confidenceAtDecision || 0));
    decision.outcome.summary = Number.isFinite(changePercent)
      ? `${metric.split(':')[0].replace(/_/g, ' ')} changed ${changePercent >= 0 ? '+' : ''}${decision.outcome.changePercent}% after execution. This is an observed association, not guaranteed causation.`
      : `A comparable post-execution value of ${afterValue} was observed; percentage change is unavailable because the baseline was zero.`;
    decision.outcomeClassification = Number.isFinite(changePercent)
      ? Math.abs(changePercent) < 3 ? 'neutral' : changePercent > 0 ? 'success' : 'failure'
      : 'insufficient_evidence';
    decision.lessonLearned = Number.isFinite(changePercent)
      ? `A ${decision.outcomeClassification} outcome was observed after this decision. Reuse this evidence only for comparable contexts; it does not establish causation.`
      : 'The decision did not produce enough comparable evidence for a measured lesson.';
    decision.measuredAt = now;
    await decision.save();
    measured += 1;
  }
  return measured;
}

async function buildAndPersistForecasts(projectOrId, now = new Date()) {
  const project = projectOrId && projectOrId._id ? projectOrId : { _id: projectOrId, organizationId: null };
  const projectId = project._id;
  const [snapshots, goals] = await Promise.all([
    StrategicMetricSnapshot.find({ projectId }).sort({ date: 1 }).lean(),
    MarketingGoal.find({ projectId, status: { $ne: 'paused' } })
  ]);
  const metrics = [...new Set(snapshots.map((item) => item.metric))];
  const forecasts = [];
  for (const metric of metrics) {
    const points = pointsForMetric(snapshots, metric);
    for (const horizon of [
      { name: 'end_of_week', start: startOfWeek(now), end: endOfWeek(now) },
      { name: 'end_of_month', start: startOfMonth(now), end: endOfMonth(now) }
    ]) {
      const forecast = buildForecast({ metric, points, periodStart: horizon.start, periodEnd: horizon.end, now });
      const document = await upsertForecast(forecastDocument({ projectId, metric, horizon: horizon.name, periodStart: horizon.start, periodEnd: horizon.end, forecast }));
      forecasts.push(document);
      await persistForecastEvidence(project, document);
    }
  }
  for (const goal of goals) {
    const metric = GOAL_METRIC[goal.metric];
    if (!metric) continue;
    const forecast = buildForecast({ metric, points: pointsForMetric(snapshots, metric), periodStart: goal.periodStart, periodEnd: goal.periodEnd, targetValue: Number(goal.targetValue), direction: goal.direction, now });
    const document = await upsertForecast(forecastDocument({ projectId, goal, metric, horizon: 'goal_period', periodStart: goal.periodStart, periodEnd: goal.periodEnd, forecast }));
    forecasts.push(document);
    const forecastEvidence = await persistForecastEvidence(project, document);
    goal.forecastValue = forecast.forecastValue;
    goal.forecastLowerBound = forecast.lowerBound;
    goal.forecastUpperBound = forecast.upperBound;
    goal.forecastConfidence = forecast.confidence.score;
    goal.goalAchievementProbability = forecast.goalAchievementProbability;
    goal.lastEvaluatedAt = now;
    await goal.save();
    const type = forecastAlertType(goal, forecast);
    if (type) await persistStrategicAlert(projectId, {
      type,
      key: `goal:${goal._id}:${new Date(goal.periodEnd).toISOString().slice(0, 10)}`,
      confidence: forecast.confidence.score,
      severity: type.includes('risk') || type.includes('below') ? 'warning' : 'growth_opportunity',
      title: `${goal.name}: ${type.replace(/_/g, ' ')}`,
      summary: `Moyi forecasts ${forecast.forecastValue} (${forecast.lowerBound}–${forecast.upperBound}) against a target of ${goal.targetValue}. Goal achievement probability is ${forecast.goalAchievementProbability}%.`,
      evidence: { goalId: goal._id, forecastId: document._id, ...forecast },
      evidenceIds: [forecastEvidence._id],
      recommendedAction: type.includes('risk') || type.includes('below') ? 'Review the largest controllable gap and approve a corrective action.' : 'Validate the winning drivers before increasing investment.'
    });
  }
  return forecasts;
}

async function refreshStrategicIntelligence(project, { now = new Date(), persist = true } = {}) {
  const sync = await syncStrategicMetricSnapshots(project._id, 90, now);
  const forecasts = await buildAndPersistForecasts(project, now);
  const [searchDemand, audience, competitors, latestSnapshots, snapshots] = await Promise.all([
    buildSearchDemandIntelligence(project, now),
    buildAudienceIntelligence(project._id, now),
    Competitor.find({ projectId: project._id }).lean(),
    CompetitorSnapshot.aggregate([
      { $match: { projectId: project._id } },
      { $sort: { capturedAt: -1 } },
      { $group: { _id: '$competitorId', snapshot: { $first: '$$ROOT' } } }
    ]),
    StrategicMetricSnapshot.find({ projectId: project._id }).sort({ date: 1 }).lean()
  ]);
  const diagnostics = diagnoseMetrics(snapshots, { now, windowDays: 14 });
  const diagnosticEvidence = persist
    ? await Promise.all(diagnostics.map((item) => persistDiagnosticEvidence(project, item, now)))
    : [];
  if (persist) {
    const activeGoals = await MarketingGoal.find({ projectId: project._id, status: { $ne: 'paused' } }).lean();
    await buildCoreEvidenceGraph({ project, goals: activeGoals, forecasts });
  }
  const competitorMap = new Map(competitors.map((item) => [String(item._id), item]));
  const candidates = [
    ...searchDemand.map(searchOpportunity),
    ...audience.signals.map(audienceOpportunity),
    ...latestSnapshots.map(({ snapshot }) => competitorOpportunity(snapshot, competitorMap.get(String(snapshot.competitorId))))
  ].filter(Boolean);
  const enrichedCandidates = await Promise.all(candidates.map(async (item) => {
    const significance = strategicSignificance({
      businessImpact: item.potentialImpact === 'transformational' ? 'critical' : item.potentialImpact,
      confidence: item.confidence,
      urgency: item.timeSensitivity === 'immediate' ? 100 : item.timeSensitivity === 'high' ? 80 : 50,
      goalRelevance: 60,
      persistence: 50,
      magnitude: Math.min(100, Number(item.evidence && (item.evidence.changePercent || item.evidence.changePoints) || 25) * 2),
      effort: item.difficulty,
      risk: 'medium'
    });
    if (!significance.shouldSurface) return null;
    const evidenceRecord = persist ? await persistEvidence({
      projectId: project._id,
      organizationId: project.organizationId || null,
      claimKey: `opportunity:${item.dedupeKey}`,
      claim: item.evidenceSummary,
      classification: 'derived',
      causalLevel: 'OBSERVATIONAL',
      metric: item.evidence && item.evidence.metric || '',
      source: item.type === 'search' ? 'search_console' : item.type === 'competitor_weakness' ? 'public_competitor_pages' : 'first_party_tracking',
      observedAt: now,
      sampleSize: Number(item.evidence && (item.evidence.sampleSize || item.evidence.current && item.evidence.current.impressions) || 0),
      confidence: item.confidence,
      dataQualityScore: item.confidence,
      businessImpact: item.potentialImpact === 'transformational' ? 'critical' : item.potentialImpact,
      evidence: item.evidence,
      unknowns: ['This opportunity is evidence-backed but its incremental outcome is not yet known.'],
      dedupeKey: `opportunity:${item.dedupeKey}`
    }) : null;
    return { ...item, evidenceIds: evidenceRecord ? [evidenceRecord._id] : [], evidenceClassification: 'derived', strategicPriority: significance.score, urgencyScore: item.timeSensitivity === 'high' ? 80 : 50, risk: 'medium' };
  }));
  const opportunities = persist
    ? await Promise.all(enrichedCandidates.filter(Boolean).map((item) => persistOpportunity(project._id, item, now)))
    : enrichedCandidates.filter(Boolean);

  if (persist) {
    const activeDiagnosticRiskKeys = [];
    for (let index = 0; index < diagnostics.length; index += 1) {
      const diagnostic = diagnostics[index];
      const definition = metricDefinition(diagnostic.metric);
      const change = Number(diagnostic.changePercent);
      const deterioration = diagnostic.status === 'observed' && (
        (definition && definition.directionality === 'higher' && change < 0)
        || (definition && definition.directionality === 'lower' && change > 0)
      );
      if (!deterioration || !diagnostic.significance || !diagnostic.significance.shouldSurface) continue;
      const dedupeKey = `diagnostic:${diagnostic.metric}:deterioration`;
      activeDiagnosticRiskKeys.push(dedupeKey);
      await persistStrategicAlert(project._id, {
        type: 'strategic_metric_deterioration', dedupeKey, confidence: diagnostic.confidence,
        severity: diagnostic.significance.priority === 'immediate' ? 'critical' : 'warning',
        urgency: diagnostic.significance.priority === 'immediate' ? 'immediate' : 'high',
        title: `${metricDefinition(diagnostic.metric).displayName} deteriorated`,
        summary: `${metricDefinition(diagnostic.metric).displayName} changed ${change > 0 ? '+' : ''}${change}% across comparable ${diagnostic.periodDays}-day periods.`,
        businessImpact: `${impactForMetric(diagnostic.metric)} potential impact`,
        evidence: diagnostic,
        evidenceIds: diagnosticEvidence[index] ? [diagnosticEvidence[index]._id] : [],
        recommendedAction: 'Review related funnel and channel evidence before approving a corrective action.'
      });
    }
    await GrowthAlert.updateMany(
      { projectId: project._id, category: 'strategic_intelligence', dedupeKey: { $regex: '^diagnostic:', $nin: activeDiagnosticRiskKeys }, resolutionStatus: 'open' },
      { $set: { resolutionStatus: 'resolved', resolvedAt: now } }
    );
    for (const opportunity of opportunities) {
      await persistStrategicAlert(project._id, {
        type: opportunity.type === 'market' ? 'market_opportunity' : 'growth_opportunity',
        key: opportunity.dedupeKey,
        confidence: opportunity.confidence,
        severity: 'growth_opportunity',
        title: opportunity.title,
        summary: opportunity.evidenceSummary,
        evidence: { opportunityId: opportunity._id, ...opportunity.evidence },
        evidenceIds: opportunity.evidenceIds || [],
        recommendedAction: opportunity.recommendedAction
      });
    }
  }

  for (const signal of searchDemand.filter((item) => ['demand_increase', 'demand_decline'].includes(item.kind))) {
    await persistStrategicAlert(project._id, {
      type: 'search_demand_shift', key: `search:${signal.kind}:${signal.cluster}`, confidence: signal.confidence,
      severity: signal.kind === 'demand_decline' ? 'warning' : 'growth_opportunity',
      title: `${signal.cluster}: ${signal.kind.replace(/_/g, ' ')}`,
      summary: signal.evidence,
      evidence: signal,
      recommendedAction: signal.kind === 'demand_decline' ? 'Reduce assumptions based on historical volume and review adjacent demand.' : 'Validate intent and prioritize the pages best positioned to capture this demand.'
    });
  }
  for (const signal of audience.signals) {
    await persistStrategicAlert(project._id, {
      type: signal.type === 'channel' ? 'channel_shift' : 'audience_shift', key: `${signal.type}:${signal.segment}`, confidence: signal.confidence,
      severity: 'info', title: `${signal.segment} audience mix changed`,
      summary: `Share changed by ${signal.changePoints.toFixed(1)} percentage points across comparable 28-day windows.`, evidence: signal,
      recommendedAction: 'Check conversion quality before changing channel or audience investment.'
    });
  }
  for (const { snapshot } of latestSnapshots) {
    const competitor = competitorMap.get(String(snapshot.competitorId));
    if (!competitor) continue;
    for (const change of (snapshot.changes || [])) {
      await persistStrategicAlert(project._id, {
        type: 'competitor_strategy_change', key: `${snapshot._id}:${change.type}:${change.url}`, confidence: change.confidence,
        severity: change.confidence >= 80 ? 'warning' : 'info', title: `${competitor.name}: ${change.type.replace(/_/g, ' ')}`,
        summary: change.summary, evidence: { competitorId: competitor._id, snapshotId: snapshot._id, change },
        recommendedAction: 'Review the public evidence and decide whether a response is strategically necessary.'
      });
    }
  }
  const measuredDecisions = await measureDueDecisions(project._id, { searchDemand, audience, now });
  return { sync, forecasts, diagnostics, diagnosticEvidence, searchDemand, audience, competitorSnapshots: latestSnapshots.map((item) => item.snapshot), opportunities, measuredDecisions };
}

async function strategyDashboard(project, options = {}) {
  if (options.refresh) await refreshStrategicIntelligence(project, options);
  const [forecasts, goals, opportunities, decisions, competitorSnapshots, alerts, reviews, evidenceRecords, metricSnapshots] = await Promise.all([
    StrategicForecast.find({ projectId: project._id }).sort({ generatedAt: -1 }).lean(),
    MarketingGoal.find({ projectId: project._id }).sort({ periodEnd: 1 }).lean(),
    StrategicOpportunity.find({ projectId: project._id }).sort({ status: 1, confidence: -1, lastDetectedAt: -1 }).lean(),
    StrategicDecision.find({ projectId: project._id }).sort({ createdAt: -1 }).populate('ownerId', 'name email').lean(),
    CompetitorSnapshot.find({ projectId: project._id }).sort({ capturedAt: -1 }).limit(30).lean(),
    GrowthAlert.find({ projectId: project._id, category: 'strategic_intelligence', resolutionStatus: 'open' }).sort({ createdAt: -1 }).limit(30).lean(),
    StrategicReview.find({ projectId: project._id }).sort({ periodEnd: -1 }).limit(12).lean(),
    EvidenceRecord.find({ projectId: project._id }).sort({ observedAt: -1, createdAt: -1 }).limit(150).lean(),
    StrategicMetricSnapshot.find({ projectId: project._id }).sort({ date: -1 }).limit(1000).lean()
  ]);
  const metricReadiness = [...new Set(metricSnapshots.map((item) => item.metric))].map((metric) => {
    const relevant = metricSnapshots.filter((item) => item.metric === metric);
    const latestForecast = forecasts.find((item) => item.metric === metric && item.horizon === 'end_of_month');
    const maturity = latestForecast && latestForecast.evidence && latestForecast.evidence.maturity;
    return {
      metric,
      observations: new Set(relevant.map((item) => new Date(item.date).toISOString().slice(0, 10))).size,
      maturity: maturity || null,
      forecastStatus: latestForecast && latestForecast.validation && latestForecast.validation.passed ? 'validated' : latestForecast ? 'abstained' : 'not_evaluated',
      reason: latestForecast && latestForecast.confidence && latestForecast.confidence.reason || ''
    };
  });
  const validatedForecasts = forecasts.filter((item) => item.validation && item.validation.passed && item.forecastValue !== null);
  const maximumMetricObservations = metricReadiness.reduce((maximum, item) => Math.max(maximum, item.observations), 0);
  const dataQualityScores = evidenceRecords.map((item) => Number(item.dataQualityScore)).filter(Number.isFinite);
  const readiness = {
    stage: validatedForecasts.length ? 'forecast_ready' : maximumMetricObservations >= 14 ? 'directional' : maximumMetricObservations > 0 ? 'observing' : 'no_evidence',
    dataQualityScore: dataQualityScores.length ? Math.round(dataQualityScores.reduce((sum, value) => sum + value, 0) / dataQualityScores.length) : 0,
    evidenceCount: evidenceRecords.length,
    validatedForecastCount: validatedForecasts.length,
    abstainedForecastCount: forecasts.filter((item) => item.method === 'insufficient_data' || item.method === 'failed_backtest').length,
    metricReadiness,
    missingContext: [
      !project.businessModel && 'Business model',
      !project.targetAudience && 'Target audience',
      !project.strategicContext?.monthlyMarketingBudget && 'Marketing budget',
      !project.strategicContext?.riskTolerance && 'Risk tolerance'
    ].filter(Boolean)
  };
  const goalsWithPacing = goals.map((goal) => ({ ...goal, pacing: evaluateGoalPacing(goal) }));
  const executivePriority = buildExecutivePriority({ opportunities, alerts, goals: goalsWithPacing, readiness });
  return { forecasts, goals: goalsWithPacing, opportunities, decisions, competitorSnapshots, alerts, reviews, evidenceRecords, metricSnapshots, readiness, executivePriority };
}

function reviewSections({ dashboard, periodStart, periodEnd }) {
  const goalForecasts = dashboard.forecasts.filter((item) => item.goalId && item.horizon === 'goal_period');
  const risks = dashboard.alerts.filter((item) => ['warning', 'critical'].includes(item.severity));
  const winners = dashboard.opportunities.filter((item) => item.status !== 'dismissed').slice(0, 5);
  const competitorChanges = dashboard.competitorSnapshots.flatMap((item) => item.changes || []).slice(0, 10);
  const searchOpportunities = dashboard.opportunities.filter((item) => item.type === 'search');
  const audienceOpportunities = dashboard.opportunities.filter((item) => ['audience', 'geography', 'channel'].includes(item.type));
  const fmtForecast = (item) => `${item.metric}: forecast ${item.forecastValue === null ? 'unavailable' : item.forecastValue} (${item.lowerBound ?? 'n/a'}–${item.upperBound ?? 'n/a'}), ${item.confidence.band} confidence.`;
  return {
    whatChanged: [...dashboard.alerts.slice(0, 5).map((item) => item.summary), ...competitorChanges.slice(0, 3).map((item) => item.summary)],
    performanceVsGoals: goalForecasts.map(fmtForecast),
    revenuePipeline: dashboard.forecasts.filter((item) => ['revenue', 'leads', 'qualified_leads'].includes(item.metric) && item.horizon === 'end_of_month').map(fmtForecast),
    winningChannels: audienceOpportunities.filter((item) => item.type === 'channel').map((item) => item.evidenceSummary),
    underperformingChannels: dashboard.alerts.filter((item) => item.type === 'channel_shift' && item.severity === 'warning').map((item) => item.summary),
    competitiveMovement: competitorChanges.map((item) => item.summary),
    audienceChanges: audienceOpportunities.map((item) => item.evidenceSummary),
    searchDemand: searchOpportunities.map((item) => item.evidenceSummary),
    campaignResults: dashboard.alerts.filter((item) => /campaign|roas|cac|spend/.test(item.type)).map((item) => item.summary),
    majorRisks: risks.slice(0, 6).map((item) => `${item.title}: ${item.summary}`),
    majorOpportunities: winners.map((item) => `${item.title}: ${item.opportunity}`),
    whatToStop: risks.filter((item) => item.confidence >= 70).slice(0, 3).map((item) => `Stop scaling the affected activity until this is reviewed: ${item.title}.`),
    whatToContinue: dashboard.decisions.filter((item) => item.decision === 'accepted' && item.outcome && Number(item.outcome.changePercent) > 0).map((item) => item.title),
    whatToIncrease: winners.filter((item) => item.confidence >= 75).slice(0, 3).map((item) => item.recommendedAction),
    whatToTest: winners.filter((item) => item.confidence < 75).slice(0, 4).map((item) => item.recommendedAction),
    nextMonthPriorities: [...risks.slice(0, 3).map((item) => item.recommendedAction), ...winners.slice(0, 3).map((item) => item.recommendedAction)].filter(Boolean).slice(0, 6),
    periodStart,
    periodEnd
  };
}

async function generateMonthlyStrategyReview(project, userId, now = new Date()) {
  const periodEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0, 23, 59, 59, 999));
  const periodStart = new Date(Date.UTC(periodEnd.getUTCFullYear(), periodEnd.getUTCMonth(), 1));
  const dashboard = await strategyDashboard(project);
  const sections = reviewSections({ dashboard, periodStart, periodEnd });
  const evidenceCount = dashboard.forecasts.length + dashboard.alerts.length + dashboard.opportunities.length + dashboard.competitorSnapshots.length;
  const executiveSummary = evidenceCount
    ? `${project.name}'s monthly strategy review is based on ${evidenceCount} stored forecast, signal, opportunity, and competitor evidence records. ${sections.majorRisks.length} major risks and ${sections.majorOpportunities.length} opportunities require executive review.`
    : `Moyi does not yet have enough connected evidence to produce a defensible monthly strategy conclusion for ${project.name}.`;
  return StrategicReview.findOneAndUpdate(
    { projectId: project._id, periodStart, periodEnd },
    { $set: { projectId: project._id, createdBy: userId, periodStart, periodEnd, executiveSummary, sections, evidence: { forecastIds: dashboard.forecasts.map((item) => item._id), alertIds: dashboard.alerts.map((item) => item._id), opportunityIds: dashboard.opportunities.map((item) => item._id), competitorSnapshotIds: dashboard.competitorSnapshots.map((item) => item._id) }, limitations: ['Forecasts are directional and include confidence ranges; they are not guarantees.', 'Market-demand conclusions use Search Console evidence for this property, not total-market panels.', 'Competitor monitoring covers only public pages reached by bounded, robots-compliant crawls.'], generatedAt: now } },
    { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true }
  );
}

async function acceptOpportunity({ projectId, opportunityId, userId }) {
  const opportunity = await StrategicOpportunity.findOne({ _id: opportunityId, projectId });
  if (!opportunity) return null;
  opportunity.status = 'accepted';
  opportunity.acceptedBy = userId;
  opportunity.acceptedAt = new Date();
  await opportunity.save();
  const outcome = measurementForOpportunity(opportunity);
  return StrategicDecision.findOneAndUpdate(
    { projectId, opportunityId: opportunity._id },
    { $set: { projectId, opportunityId: opportunity._id, ownerId: userId, title: opportunity.title, recommendation: opportunity.recommendedAction, evidenceAtDecision: opportunity.evidence, evidenceIds: opportunity.evidenceIds || [], confidenceAtDecision: opportunity.confidence, decision: 'accepted', decidedAt: new Date(), expectedOutcome: opportunity.opportunity, expectedTimeframeDays: opportunity.timeSensitivity === 'immediate' ? 14 : 30, risks: [`${opportunity.risk || 'medium'} implementation risk`, 'Observed evidence does not guarantee incremental impact.'], affectedEntities: opportunity.sourceRefs || {}, outcome } },
    { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true }
  );
}

module.exports = {
  GOAL_METRIC,
  acceptOpportunity,
  applyDecisionAction,
  audienceOpportunity,
  buildAndPersistForecasts,
  competitorOpportunity,
  forecastAlertType,
  generateMonthlyStrategyReview,
  measureDueDecisions,
  measurementForOpportunity,
  persistOpportunity,
  refreshStrategicIntelligence,
  reviewSections,
  searchOpportunity,
  strategyDashboard
};
