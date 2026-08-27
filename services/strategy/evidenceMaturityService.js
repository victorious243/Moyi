const LEVELS = Object.freeze({
  NO_EVIDENCE: 0,
  OBSERVING: 1,
  EARLY_SIGNAL: 2,
  DIRECTIONAL: 3,
  FORECAST_ELIGIBLE: 4,
  ESTABLISHED: 5,
  CAUSAL: 6
});

const LABELS = ['No evidence', 'Observing', 'Early signal', 'Directional evidence', 'Forecast eligible', 'Established', 'Causal evidence'];

function assessEvidenceMaturity({ observations = 0, qualityScore = 0, definition = null, causalLevel = 'NONE', forecastValidated = false }) {
  const count = Math.max(0, Number(observations || 0));
  let level = count === 0 ? 0 : count < 7 ? 1 : count < 14 ? 2 : count < 28 ? 3 : 4;
  const required = Number(definition && definition.minimumObservations || 28);
  const established = Number(definition && definition.establishedObservations || 56);

  if (count < required || qualityScore < 70 || !forecastValidated) level = Math.min(level, LEVELS.DIRECTIONAL);
  if (count >= established && qualityScore >= 80 && forecastValidated) level = LEVELS.ESTABLISHED;
  if (['EXPERIMENTAL', 'CAUSAL_VALIDATED'].includes(causalLevel)) level = LEVELS.CAUSAL;

  return {
    level,
    key: Object.keys(LEVELS).find((key) => LEVELS[key] === level),
    label: LABELS[level],
    observations: count,
    canDescribe: level >= LEVELS.OBSERVING,
    canDetectMovement: level >= LEVELS.EARLY_SIGNAL,
    canRecommendDirection: level >= LEVELS.DIRECTIONAL,
    canForecast: level >= LEVELS.FORECAST_ELIGIBLE,
    canClaimCausality: level >= LEVELS.CAUSAL,
    nextObservationMilestone: count < 7 ? 7 : count < 14 ? 14 : count < required ? required : count < established ? established : null
  };
}

module.exports = { LABELS, LEVELS, assessEvidenceMaturity };
