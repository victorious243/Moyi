const { assessEvidenceMaturity } = require('./evidenceMaturityService');
const { metricDefinition } = require('./metricRegistry');
const { evaluateMetricDataQuality } = require('./strategicDataQualityService');

const SUM_METRICS = new Set(['revenue', 'leads', 'qualified_leads', 'signups', 'conversions', 'traffic', 'organic_traffic', 'paid_traffic', 'spend', 'search_impressions', 'search_clicks']);

function round(value, digits = 2) {
  if (!Number.isFinite(value)) return null;
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

function normalCdf(value) {
  const sign = value < 0 ? -1 : 1;
  const x = Math.abs(value) / Math.sqrt(2);
  const t = 1 / (1 + 0.3275911 * x);
  const erf = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return 0.5 * (1 + sign * erf);
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

function weightedStats(values = []) {
  const totalWeight = values.reduce((sum, _value, index) => sum + index + 1, 0);
  if (!totalWeight) return { mean: 0, standardDeviation: 0 };
  const mean = values.reduce((sum, value, index) => sum + value * (index + 1), 0) / totalWeight;
  const variance = values.reduce((sum, value, index) => sum + (index + 1) * ((value - mean) ** 2), 0) / totalWeight;
  return { mean, standardDeviation: Math.sqrt(variance) };
}

function exponentialMean(values, alpha = 0.35) {
  if (!values.length) return null;
  return values.slice(1).reduce((level, value) => alpha * value + (1 - alpha) * level, values[0]);
}

const CANDIDATES = [
  { method: 'naive_baseline', predict: (values) => values.at(-1) },
  { method: 'moving_average', predict: (values) => weightedStats(values.slice(-7)).mean },
  { method: 'exponential_smoothing', predict: (values) => exponentialMean(values) },
  { method: 'linear_daily_trend', predict: (values, offset = 1) => { const model = regression(values); return model ? model.intercept + model.slope * (values.length - 1 + offset) : null; } }
];

function errorMetrics(actual, predicted) {
  if (!actual.length || actual.length !== predicted.length) return null;
  const errors = actual.map((value, index) => predicted[index] - value);
  const mae = errors.reduce((sum, value) => sum + Math.abs(value), 0) / errors.length;
  const rmse = Math.sqrt(errors.reduce((sum, value) => sum + value ** 2, 0) / errors.length);
  const nonZero = actual.map((value, index) => ({ value, predicted: predicted[index] })).filter((row) => Math.abs(row.value) > 0.000001);
  const mape = nonZero.length ? nonZero.reduce((sum, row) => sum + Math.abs((row.predicted - row.value) / row.value), 0) / nonZero.length : null;
  const scale = Math.max(1, actual.reduce((sum, value) => sum + Math.abs(value), 0) / actual.length);
  return { mae: round(mae, 4), rmse: round(rmse, 4), mape: mape === null ? null : round(mape, 4), normalizedError: round(mae / scale, 4) };
}

function backtestCandidates(values, options = {}) {
  const minimumTraining = Math.max(14, Number(options.minimumTraining || 14));
  const backtestWindow = Math.min(14, Math.max(0, values.length - minimumTraining));
  if (backtestWindow < 7) return { winner: null, candidates: [], backtestWindow, reason: 'At least 7 holdout observations are required for forecast backtesting.' };
  const start = values.length - backtestWindow;
  const candidates = CANDIDATES.map((candidate) => {
    const actual = [];
    const predicted = [];
    for (let index = start; index < values.length; index += 1) {
      const prediction = candidate.predict(values.slice(0, index), 1);
      if (Number.isFinite(prediction)) {
        actual.push(values[index]);
        predicted.push(Math.max(0, prediction));
      }
    }
    return { method: candidate.method, ...errorMetrics(actual, predicted) };
  }).filter((candidate) => Number.isFinite(candidate.normalizedError));
  candidates.sort((a, b) => a.normalizedError - b.normalizedError || a.rmse - b.rmse);
  return { winner: candidates[0] || null, candidates, backtestWindow, reason: candidates.length ? '' : 'No candidate model produced a valid backtest.' };
}

function confidenceFor(points, model, options = {}) {
  const qualityScore = Number(options.qualityScore || 0);
  const validation = options.validation || {};
  if (!validation.passed) return { score: 0, band: 'insufficient', coverage: options.coverage || 0, reason: validation.rejectionReason || 'Forecast validation did not pass.' };
  const errorQuality = Math.max(0, 1 - Number(validation.normalizedError || 1));
  const sampleQuality = Math.min(1, points.length / 90);
  const score = Math.round(qualityScore * 0.4 + errorQuality * 100 * 0.4 + sampleQuality * 100 * 0.2);
  return { score, band: score >= 85 ? 'high' : score >= 70 ? 'medium' : 'low', coverage: options.coverage || 0, reason: `${points.length} observed daily values; data quality ${qualityScore}/100; backtest normalized error ${round(validation.normalizedError * 100, 1)}%.`, rSquared: model ? round(model.rSquared, 4) : null };
}

function probabilityOfGoal({ forecastValue, standardError, targetValue, direction = 'increase' }) {
  if (![forecastValue, standardError, targetValue].every(Number.isFinite) || standardError <= 0) return null;
  const z = (targetValue - forecastValue) / standardError;
  const probability = direction === 'decrease' ? normalCdf(z) : 1 - normalCdf(z);
  return round(Math.max(0, Math.min(100, probability * 100)), 1);
}

function unavailableForecast({ metric, history, currentValue, period, quality, maturity, method = 'insufficient_data', validation = {} }) {
  const rejectionReason = validation.rejectionReason || quality.issues.join(' ') || 'This metric requires more reliable history before forecasting.';
  return {
    metric, method, observedDays: history.length, historyDays: quality.spanDays, currentValue,
    forecastValue: null, lowerBound: null, upperBound: null, goalAchievementProbability: null,
    confidence: { score: 0, band: 'insufficient', coverage: quality.density, rSquared: null, reason: rejectionReason },
    validation: { passed: false, backtestWindow: validation.backtestWindow || 0, mae: validation.mae ?? null, rmse: validation.rmse ?? null, mape: validation.mape ?? null, normalizedError: validation.normalizedError ?? null, candidateCount: validation.candidateCount || 0, rejectionReason },
    evidence: { ...period, sourcePointCount: history.length, dataQuality: { ...quality, usablePoints: undefined }, maturity }
  };
}

function buildForecast({ metric, points = [], periodStart, periodEnd, targetValue = null, direction = 'increase', now = new Date() }) {
  const definition = metricDefinition(metric);
  const quality = evaluateMetricDataQuality(metric, points, now);
  const history = quality.usablePoints.slice(-90);
  const values = history.map((point) => point.value);
  const periodStartDate = new Date(periodStart);
  const periodEndDate = new Date(periodEnd);
  const currentPeriod = history.filter((point) => point.date >= periodStartDate && point.date <= now && point.date <= periodEndDate);
  const elapsedDays = Math.max(0, Math.floor((Math.min(now, periodEndDate) - periodStartDate) / 86400000) + 1);
  const totalDays = Math.max(1, Math.floor((periodEndDate - periodStartDate) / 86400000) + 1);
  const remainingDays = Math.max(0, totalDays - elapsedDays);
  const isSum = SUM_METRICS.has(metric) || definition?.aggregationMethod === 'sum';
  const currentValue = isSum ? currentPeriod.reduce((sum, point) => sum + point.value, 0) : (currentPeriod.at(-1)?.value ?? null);
  const period = { totalDays, elapsedDays, remainingDays };
  const minimumObservations = Number(definition?.minimumObservations || 28);
  let maturity = assessEvidenceMaturity({ observations: history.length, qualityScore: quality.score, definition, forecastValidated: false });

  if (!definition || history.length < minimumObservations || quality.score < definition.reliabilityRequirements.minimumQualityScore || quality.density < definition.reliabilityRequirements.minimumDensity) {
    const reason = !definition ? 'This metric has no canonical forecasting definition.' : history.length < minimumObservations ? `${definition.displayName} requires at least ${minimumObservations} usable daily observations; ${history.length} are available.` : `Data quality does not meet the ${definition.displayName} forecasting requirements.`;
    return unavailableForecast({ metric, history, currentValue, period, quality, maturity, validation: { rejectionReason: reason } });
  }

  const backtest = backtestCandidates(values, { minimumTraining: Math.max(14, minimumObservations - 14) });
  const winner = backtest.winner;
  if (!winner || winner.normalizedError > definition.maximumBacktestError) {
    const reason = winner ? `Enough history exists, but the best model's ${round(winner.normalizedError * 100, 1)}% normalized backtest error exceeds the ${round(definition.maximumBacktestError * 100, 1)}% limit.` : backtest.reason;
    return unavailableForecast({ metric, history, currentValue, period, quality, maturity, method: 'failed_backtest', validation: { ...(winner || {}), backtestWindow: backtest.backtestWindow, candidateCount: backtest.candidates.length, rejectionReason: reason } });
  }

  const candidate = CANDIDATES.find((item) => item.method === winner.method);
  const projected = [];
  for (let offset = 1; offset <= Math.max(1, remainingDays); offset += 1) projected.push(Math.max(0, candidate.predict(values, offset)));
  const forecastValue = isSum ? currentValue + projected.slice(0, remainingDays).reduce((sum, value) => sum + value, 0) : projected[0];
  const standardError = Math.max(Number(winner.rmse || 0) * Math.sqrt(Math.max(1, isSum ? remainingDays : 1)), Math.abs(forecastValue) * 0.03, 0.01);
  const margin = 1.96 * standardError;
  const validation = { passed: true, backtestWindow: backtest.backtestWindow, mae: winner.mae, rmse: winner.rmse, mape: winner.mape, normalizedError: winner.normalizedError, candidateCount: backtest.candidates.length, rejectionReason: '' };
  const model = regression(values);
  const confidence = confidenceFor(history, model, { qualityScore: quality.score, coverage: quality.density, validation });
  maturity = assessEvidenceMaturity({ observations: history.length, qualityScore: quality.score, definition, forecastValidated: true });

  return {
    metric, method: winner.method, observedDays: history.length, historyDays: quality.spanDays,
    currentValue: round(currentValue), forecastValue: round(forecastValue),
    lowerBound: round(Math.max(0, forecastValue - margin)), upperBound: round(Math.max(0, forecastValue + margin)),
    goalAchievementProbability: Number.isFinite(targetValue) ? probabilityOfGoal({ forecastValue, standardError, targetValue, direction }) : null,
    confidence, validation,
    evidence: { ...period, sourcePointCount: history.length, dataQuality: { ...quality, usablePoints: undefined }, maturity, candidates: backtest.candidates }
  };
}

module.exports = { CANDIDATES, SUM_METRICS, backtestCandidates, buildForecast, confidenceFor, errorMetrics, normalCdf, probabilityOfGoal, regression, weightedStats };
