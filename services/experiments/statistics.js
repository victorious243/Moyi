function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function normalCdf(value) {
  const sign = value < 0 ? -1 : 1;
  const x = Math.abs(value) / Math.sqrt(2);
  const t = 1 / (1 + (0.3275911 * x));
  const coefficients = [0.254829592, -0.284496736, 1.421413741, -1.453152027, 1.061405429];
  const polynomial = coefficients.reduceRight((acc, coefficient) => (acc * t) + coefficient, 0);
  const erf = sign * (1 - (polynomial * t * Math.exp(-(x * x))));
  return 0.5 * (1 + erf);
}

function clampConfidence(value) {
  return Math.max(0, Math.min(99.99, value));
}

function rateComparison(control, variant) {
  const nControl = finiteNumber(control.sampleSize);
  const nVariant = finiteNumber(variant.sampleSize);
  const successControl = finiteNumber(control.successes);
  const successVariant = finiteNumber(variant.successes);
  if (!nControl || !nVariant || successControl === null || successVariant === null) return null;
  if (successControl > nControl || successVariant > nVariant) return null;
  const controlRate = successControl / nControl;
  const variantRate = successVariant / nVariant;
  const pooledRate = (successControl + successVariant) / (nControl + nVariant);
  const standardError = Math.sqrt(pooledRate * (1 - pooledRate) * ((1 / nControl) + (1 / nVariant)));
  const zScore = standardError > 0 ? (variantRate - controlRate) / standardError : 0;
  const confidence = clampConfidence((2 * normalCdf(Math.abs(zScore)) - 1) * 100);
  return {
    controlValue: controlRate,
    variantValue: variantRate,
    absoluteDifference: variantRate - controlRate,
    uplift: controlRate > 0 ? (variantRate - controlRate) / controlRate : null,
    confidence,
    statistic: zScore
  };
}

function sampleVariance(observation) {
  const n = finiteNumber(observation.sampleSize);
  const sum = finiteNumber(observation.sum);
  const sumSquares = finiteNumber(observation.sumSquares);
  if (!n || n < 2 || sum === null || sumSquares === null) return null;
  return Math.max(0, (sumSquares - ((sum * sum) / n)) / (n - 1));
}

function continuousComparison(control, variant) {
  const nControl = finiteNumber(control.sampleSize);
  const nVariant = finiteNumber(variant.sampleSize);
  const controlSum = finiteNumber(control.sum);
  const variantSum = finiteNumber(variant.sum);
  const controlVariance = sampleVariance(control);
  const variantVariance = sampleVariance(variant);
  if (!nControl || !nVariant || controlSum === null || variantSum === null || controlVariance === null || variantVariance === null) return null;
  const controlValue = controlSum / nControl;
  const variantValue = variantSum / nVariant;
  const standardError = Math.sqrt((controlVariance / nControl) + (variantVariance / nVariant));
  const statistic = standardError > 0 ? (variantValue - controlValue) / standardError : 0;
  const confidence = clampConfidence((2 * normalCdf(Math.abs(statistic)) - 1) * 100);
  return {
    controlValue,
    variantValue,
    absoluteDifference: variantValue - controlValue,
    uplift: controlValue !== 0 ? (variantValue - controlValue) / Math.abs(controlValue) : null,
    confidence,
    statistic
  };
}

function combineObservations(observations, metricKind) {
  const sampleSize = observations.reduce((sum, observation) => sum + Number(observation.sampleSize || 0), 0);
  if (metricKind === 'rate') {
    return {
      sampleSize,
      successes: observations.reduce((sum, observation) => sum + Number(observation.successes || 0), 0)
    };
  }
  return {
    sampleSize,
    sum: observations.reduce((sum, observation) => sum + Number(observation.sum || 0), 0),
    sumSquares: observations.reduce((sum, observation) => sum + Number(observation.sumSquares || 0), 0)
  };
}

function metricValue(observation, metricKind) {
  if (!observation || !observation.sampleSize) return null;
  return metricKind === 'rate'
    ? Number(observation.successes || 0) / observation.sampleSize
    : Number(observation.sum || 0) / observation.sampleSize;
}

module.exports = {
  combineObservations,
  continuousComparison,
  metricValue,
  normalCdf,
  rateComparison,
  sampleVariance
};
