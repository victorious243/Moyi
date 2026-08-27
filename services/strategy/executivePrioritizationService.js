const SEVERITY_SCORE = Object.freeze({ critical: 95, warning: 78, growth_opportunity: 55, info: 30 });

function clamp(value) {
  return Math.max(0, Math.min(100, Number(value || 0)));
}

function goalCandidate(goal) {
  const pacing = goal && goal.pacing;
  if (!pacing || !['at_risk', 'behind'].includes(pacing.status)) return null;
  return {
    findingType: 'risk',
    headline: `${goal.name} is ${String(pacing.status).replace(/_/g, ' ')}.`,
    whatChanged: `Current progress is ${pacing.currentProgress} against ${pacing.expectedProgress} expected by today.`,
    whyItMatters: `The goal needs a pace of ${pacing.requiredPace} per day for the remainder of the period.`,
    evidenceSummary: `Gap to expected pace: ${pacing.gapPercent === null ? 'unavailable' : `${pacing.gapPercent}%`}.`,
    confidence: pacing.evidenceQuality === 'high' ? 85 : pacing.evidenceQuality === 'medium' ? 70 : 55,
    businessImpact: 'high',
    recommendedAction: 'Review the largest evidence-backed funnel or channel gap before changing investment.',
    alternatives: ['Collect more evidence if the current value is incomplete.'],
    risks: ['Acting on incomplete goal inputs can misallocate effort.'],
    unknowns: pacing.projectedOutcome === null ? ['A validated projected outcome is not available.'] : [],
    shouldAct: pacing.evidenceQuality !== 'low',
    priority: pacing.status === 'at_risk' ? 92 : 75,
    evidenceIds: [],
    sourceType: 'goal',
    sourceId: String(goal._id)
  };
}

function riskCandidate(alert) {
  if (!alert || !['warning', 'critical'].includes(alert.severity)) return null;
  const confidence = clamp(alert.confidence);
  return {
    findingType: 'risk', headline: alert.title, whatChanged: alert.summary,
    whyItMatters: alert.businessImpact || 'This signal may affect an active business objective.',
    evidenceSummary: alert.summary, confidence,
    businessImpact: alert.severity === 'critical' ? 'critical' : 'high',
    recommendedAction: alert.recommendedAction || 'Review the evidence before approving a corrective action.',
    alternatives: ['Continue observing until the signal persists.'],
    risks: ['The signal is observational unless experimental evidence says otherwise.'],
    unknowns: confidence < 80 ? ['The available evidence does not establish causation.'] : [],
    shouldAct: confidence >= 60,
    priority: Math.round(SEVERITY_SCORE[alert.severity] * 0.7 + confidence * 0.3),
    evidenceIds: alert.evidenceIds || [], sourceType: 'alert', sourceId: String(alert._id)
  };
}

function opportunityCandidate(opportunity) {
  if (!opportunity || opportunity.status !== 'open') return null;
  const confidence = clamp(opportunity.confidence);
  return {
    findingType: 'opportunity', headline: opportunity.title, whatChanged: opportunity.opportunity,
    whyItMatters: `${String(opportunity.potentialImpact || 'unknown').replace(/_/g, ' ')} potential impact with ${String(opportunity.difficulty || 'unknown')} implementation difficulty.`,
    evidenceSummary: opportunity.evidenceSummary, confidence, businessImpact: opportunity.potentialImpact,
    recommendedAction: opportunity.recommendedAction,
    alternatives: ['Create a controlled experiment before broader rollout.'],
    risks: [`Execution risk is ${opportunity.risk || 'unknown'}.`],
    unknowns: ['The incremental outcome is not proven until the action is measured.'],
    shouldAct: confidence >= 60 && Number(opportunity.strategicPriority || 0) >= 45,
    priority: clamp(opportunity.strategicPriority), evidenceIds: opportunity.evidenceIds || [],
    sourceType: 'opportunity', sourceId: String(opportunity._id)
  };
}

function abstentionBrief(readiness = {}) {
  const hasEvidence = Number(readiness.evidenceCount || 0) > 0;
  return {
    findingType: hasEvidence ? 'no_material_change' : 'insufficient_evidence',
    headline: hasEvidence ? 'No strategically significant change requires action now.' : 'Moyi is still learning this business.',
    whatChanged: hasEvidence ? 'Current evidence did not clear the significance and confidence gates.' : 'No usable strategic evidence is available yet.',
    whyItMatters: 'Waiting protects the business from decisions based on weak or incomplete signals.',
    evidenceSummary: `${Number(readiness.evidenceCount || 0)} evidence records and ${Number(readiness.validatedForecastCount || 0)} validated forecasts are available.`,
    confidence: hasEvidence ? 70 : 100, businessImpact: 'unknown',
    recommendedAction: hasEvidence ? 'Continue monitoring and act only when a material signal persists.' : 'Connect business evidence and define accountable goals.',
    alternatives: [], risks: [], unknowns: ['No supported executive conclusion is available.'],
    shouldAct: false, priority: 0, evidenceIds: [], sourceType: '', sourceId: ''
  };
}

function buildExecutivePriority({ opportunities = [], alerts = [], goals = [], readiness = {} } = {}) {
  const candidates = [...goals.map(goalCandidate), ...alerts.map(riskCandidate), ...opportunities.map(opportunityCandidate)]
    .filter((item) => item && item.shouldAct)
    .sort((left, right) => right.priority - left.priority || right.confidence - left.confidence);
  return candidates[0] || abstentionBrief(readiness);
}

module.exports = { abstentionBrief, buildExecutivePriority, goalCandidate, opportunityCandidate, riskCandidate };
