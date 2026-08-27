const IMPACT = Object.freeze({ unknown: 20, low: 30, medium: 55, high: 80, critical: 100 });
const EFFORT_PENALTY = Object.freeze({ low: 0, medium: 8, high: 18 });
const RISK_PENALTY = Object.freeze({ low: 0, medium: 6, high: 15 });

function strategicSignificance(input = {}) {
  const impact = IMPACT[input.businessImpact] ?? IMPACT.unknown;
  const confidence = Math.max(0, Math.min(100, Number(input.confidence || 0)));
  const urgency = Math.max(0, Math.min(100, Number(input.urgency || 50)));
  const goalRelevance = Math.max(0, Math.min(100, Number(input.goalRelevance || 40)));
  const persistence = Math.max(0, Math.min(100, Number(input.persistence || 40)));
  const magnitude = Math.max(0, Math.min(100, Number(input.magnitude || 0)));
  const raw = impact * 0.25 + confidence * 0.2 + urgency * 0.15 + goalRelevance * 0.15 + persistence * 0.1 + magnitude * 0.15;
  const score = Math.round(Math.max(0, Math.min(100, raw - (EFFORT_PENALTY[input.effort] || 0) - (RISK_PENALTY[input.risk] || 0))));
  return {
    score,
    priority: score >= 80 ? 'immediate' : score >= 65 ? 'high' : score >= 45 ? 'medium' : 'low',
    shouldSurface: score >= 45 && confidence >= 60
  };
}

module.exports = { strategicSignificance };
