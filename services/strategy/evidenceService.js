const EvidenceRecord = require('../../models/EvidenceRecord');
const EvidenceRelationship = require('../../models/EvidenceRelationship');

function nullableNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
const { assessEvidenceMaturity } = require('./evidenceMaturityService');
const { metricDefinition } = require('./metricRegistry');

function evidencePayload(input) {
  if (!input.projectId) throw new Error('Evidence requires a projectId.');
  if (!input.claimKey || !input.claim) throw new Error('Evidence requires a claim key and claim.');
  const definition = metricDefinition(input.metric);
  const maturity = assessEvidenceMaturity({
    observations: input.sampleSize,
    qualityScore: input.dataQualityScore,
    definition,
    causalLevel: input.causalLevel,
    forecastValidated: Boolean(input.forecastValidated)
  });
  return {
    projectId: input.projectId,
    organizationId: input.organizationId || null,
    claimKey: input.claimKey,
    claim: input.claim,
    classification: input.classification,
    causalLevel: input.causalLevel || 'NONE',
    metric: input.metric || '',
    source: input.source,
    sourceRecordIds: (input.sourceRecordIds || []).map(String),
    periodStart: input.periodStart || null,
    periodEnd: input.periodEnd || null,
    observedAt: input.observedAt || new Date(),
    value: nullableNumber(input.value),
    previousValue: nullableNumber(input.previousValue),
    changePercent: nullableNumber(input.changePercent),
    sampleSize: Math.max(0, Number(input.sampleSize || 0)),
    confidence: Math.max(0, Math.min(100, Number(input.confidence || 0))),
    dataQualityScore: Math.max(0, Math.min(100, Number(input.dataQualityScore || 0))),
    maturityLevel: maturity.level,
    businessImpact: input.businessImpact || 'unknown',
    evidence: input.evidence || {},
    assumptions: input.assumptions || [],
    unknowns: input.unknowns || [],
    limitations: input.limitations || [],
    dedupeKey: input.dedupeKey || input.claimKey,
    expiresAt: input.expiresAt || null
  };
}

async function persistEvidence(input) {
  const payload = evidencePayload(input);
  return EvidenceRecord.findOneAndUpdate(
    { projectId: payload.projectId, dedupeKey: payload.dedupeKey },
    { $set: payload },
    { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true }
  );
}

async function linkEvidence(input) {
  if (!input.projectId || !input.fromType || !input.fromId || !input.relationship || !input.toType || !input.toId) {
    throw new Error('Evidence relationship is incomplete.');
  }
  const key = {
    projectId: input.projectId,
    fromType: input.fromType,
    fromId: String(input.fromId),
    relationship: input.relationship,
    toType: input.toType,
    toId: String(input.toId)
  };
  return EvidenceRelationship.findOneAndUpdate(
    key,
    { $set: { ...key, organizationId: input.organizationId || null, evidenceIds: input.evidenceIds || [], causalLevel: input.causalLevel || 'NONE', confidence: input.confidence || 0, lastObservedAt: input.lastObservedAt || new Date(), active: input.active !== false, metadata: input.metadata || {} }, $setOnInsert: { firstObservedAt: input.firstObservedAt || new Date() } },
    { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true }
  );
}

async function buildCoreEvidenceGraph({ project, goals = [], forecasts = [] }) {
  const links = [];
  for (const goal of goals) {
    links.push(await linkEvidence({
      projectId: project._id,
      organizationId: project.organizationId || null,
      fromType: 'business_goal',
      fromId: goal._id,
      relationship: 'measured_by',
      toType: 'metric',
      toId: goal.metric,
      confidence: goal.dataSource === 'manual' ? 60 : 85,
      metadata: { direction: goal.direction, targetValue: goal.targetValue, periodEnd: goal.periodEnd }
    }));
  }
  for (const forecast of forecasts) {
    if (!forecast.goalId) continue;
    links.push(await linkEvidence({
      projectId: project._id,
      organizationId: project.organizationId || null,
      fromType: 'business_goal',
      fromId: forecast.goalId,
      relationship: 'forecast_by',
      toType: 'forecast',
      toId: forecast._id,
      confidence: forecast.confidence && forecast.confidence.score || 0,
      metadata: { metric: forecast.metric, validationPassed: Boolean(forecast.validation && forecast.validation.passed) }
    }));
  }
  return links;
}

module.exports = { buildCoreEvidenceGraph, evidencePayload, linkEvidence, persistEvidence };
