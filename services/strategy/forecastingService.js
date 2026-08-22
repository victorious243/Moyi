const SUM_METRICS = new Set(['revenue', 'leads', 'qualified_leads', 'signups', 'conversions', 'traffic', 'organic_traffic', 'paid_traffic', 'spend', 'search_impressions', 'search_clicks']);

function normalCdf(value) {
  const sign = value < 0 ? -1 : 1;
  const x = Math.abs(value) / Math.sqrt(2);
  const t = 1 / (1 + 0.3275911 * x);
  const erf = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return 0.5 * (1 + sign * erf);
}

function round(value, digits = 2) {
  if (!Number.isFinite(value)) return null;
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

function regression(values) {
  const n = values.length;
  if (n < 2) return null;
  const xMean = (n - 1) / 2;
  const yMean = values.reduce((sum, value) => sum + value, 0) / n;
  let numerator = 0;
  let denominator = 0;
  values.forEach((value, index) => {
    numerator += (index - xMean) * (value - yMean);
    denominator += (index - xMean) ** 2;
  });
  const slope = denominator ? numerator / denominator : 0;
  const intercept = yMean - slope * xMean;
  const residuals = values.map((value, index) => value - (intercept + slope * index));
  const sse = residuals.reduce((sum, value) => sum + value ** 2, 0);
  const sst = values.reduce((sum, value) => sum + (value - yMean) ** 2, 0);
  const residualStdDev = Math.sqrt(sse / Math.max(1, n - 2));
  return { slope, intercept, mean: yMean, residualStdDev, rSquared: sst ? Math.max(0, 1 - (sse / sst)) : 1 };
}

function confidenceFor(points, model) {
  if (points.length < 7 || !model) return { score: 0, band: 'insufficient', reason: 'At least 7 observed daily values are required.' };
  const first = new Date(points[0].date);
  const last = new Date(points[points.length - 1].date);
  const spanDays = Math.max(1, Math.round((last - first) / 86400000) + 1);
  const coverage = Math.min(1, points.length / spanDays);
  const meanAbs = Math.max(1, Math.abs(model.mean));
  const stability = Math.max(0, 1 - Math.min(1, model.residualStdDev / meanAbs));
  const sample = Math.min(1, points.length / 28);
  const score = Math.round(20 + sample * 30 + coverage * 25 + stability * 25);
  const band = score >= 80 ? 'high' : score >= 60 ? 'medium' : 'low';
  return {
    score,
    band,
    coverage: round(coverage, 4),
    reason: `${points.length} observed days across a ${spanDays}-day span; ${Math.round(coverage * 100)}% date coverage.`
  };
}

function probabilityOfGoal({ forecastValue, standardError, targetValue, direction = 'increase' }) {
  if (![forecastValue, standardError, targetValue].every(Number.isFinite) || standardError <= 0) return null;
  const z = (targetValue - forecastValue) / standardError;
  const probability = direction === 'decrease' ? normalCdf(z) : 1 - normalCdf(z);
  return round(Math.max(0, Math.min(100, probability * 100)), 1);
}

function weightedStats(values = []) {
  const totalWeight = values.reduce((sum, _value, index) => sum + index + 1, 0);
  if (!totalWeight) return { mean: 0, standardDeviation: 0 };
  const mean = values.reduce((sum, value, index) => sum + value * (index + 1), 0) / totalWeight;
  const variance = values.reduce((sum, value, index) => sum + (index + 1) * ((value - mean) ** 2), 0) / totalWeight;
  return { mean, standardDeviation: Math.sqrt(variance) };
}

function buildForecast({ metric, points = [], periodStart, periodEnd, targetValue = null, direction = 'increase', now = new Date() }) {
  const usable = points
    .map((point) => ({ date: new Date(point.date), value: Number(point.value) }))
    .filter((point) => !Number.isNaN(point.date.getTime()) && Number.isFinite(point.value))
    .sort((a, b) => a.date - b.date);
  const history = usable.slice(-90);
  const values = history.map((point) => point.value);
  const model = regression(values);
  const confidence = confidenceFor(history, model);
  const periodStartDate = new Date(periodStart);
  const periodEndDate = new Date(periodEnd);
  const currentPeriod = history.filter((point) => point.date >= periodStartDate && point.date <= now && point.date <= periodEndDate);
  const elapsedDays = Math.max(0, Math.floor((Math.min(now, periodEndDate) - periodStartDate) / 86400000) + 1);
  const totalDays = Math.max(1, Math.floor((periodEndDate - periodStartDate) / 86400000) + 1);
  const remainingDays = Math.max(0, totalDays - elapsedDays);
  const isSum = SUM_METRICS.has(metric);

  if (confidence.band === 'insufficient') {
    return {
      metric,
      method: 'insufficient_data',
      observedDays: history.length,
      historyDays: history.length,
      currentValue: isSum ? currentPeriod.reduce((sum, point) => sum + point.value, 0) : (currentPeriod.at(-1)?.value ?? null),
      forecastValue: null,
      lowerBound: null,
      upperBound: null,
      goalAchievementProbability: null,
      confidence: { ...confidence, coverage: confidence.coverage || 0, rSquared: model ? round(model.rSquared, 4) : null },
      evidence: { totalDays, elapsedDays, remainingDays, sourcePointCount: history.length }
    };
  }

  let currentValue;
  let forecastValue;
  let standardError;
  if (isSum) {
    currentValue = currentPeriod.reduce((sum, point) => sum + point.value, 0);
    let projectedRemainder = 0;
    for (let offset = 1; offset <= remainingDays; offset += 1) {
      projectedRemainder += Math.max(0, model.intercept + model.slope * (values.length - 1 + offset));
    }
    forecastValue = currentValue + projectedRemainder;
    standardError = model.residualStdDev * Math.sqrt(Math.max(1, remainingDays));
  } else {
    const currentStats = weightedStats((currentPeriod.length ? currentPeriod : history).map((point) => point.value));
    const historyStats = weightedStats(values);
    currentValue = currentStats.mean;
    forecastValue = Math.max(0, historyStats.mean);
    standardError = historyStats.standardDeviation / Math.sqrt(Math.max(1, values.length));
  }
  // A small uncertainty floor prevents perfectly flat or linear history from being presented as certainty.
  standardError = Math.max(standardError, Math.abs(forecastValue) * 0.05, 0.01);
  const margin = 1.96 * standardError;
  return {
    metric,
    method: isSum ? 'linear_daily_trend' : 'weighted_ratio',
    observedDays: history.length,
    historyDays: history.length,
    currentValue: round(currentValue),
    forecastValue: round(forecastValue),
    lowerBound: round(Math.max(0, forecastValue - margin)),
    upperBound: round(Math.max(0, forecastValue + margin)),
    goalAchievementProbability: Number.isFinite(targetValue)
      ? probabilityOfGoal({ forecastValue, standardError, targetValue, direction })
      : null,
    confidence: { ...confidence, rSquared: round(model.rSquared, 4) },
    evidence: {
      totalDays,
      elapsedDays,
      remainingDays,
      sourcePointCount: history.length,
      dailySlope: round(model.slope, 4),
      residualStdDev: round(model.residualStdDev, 4)
    }
  };
}

module.exports = { SUM_METRICS, buildForecast, confidenceFor, normalCdf, probabilityOfGoal, regression, weightedStats };
