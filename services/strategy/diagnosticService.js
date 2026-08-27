const { assessEvidenceMaturity } = require('./evidenceMaturityService');
const { metricDefinition } = require('./metricRegistry');
const { evaluateMetricDataQuality } = require('./strategicDataQualityService');
const { strategicSignificance } = require('./strategicSignificanceService');

function sum(values) {
  return values.reduce((total, value) => total + Number(value || 0), 0);
}

function mean(values) {
  return values.length ? sum(values) / values.length : null;
}

function periodMovement(metric, points = [], options = {}) {
  const windowDays = Math.max(7, Number(options.windowDays || 14));
  const quality = evaluateMetricDataQuality(metric, points, options.now || new Date());
  const definition = metricDefinition(metric);
  const history = quality.usablePoints;
  const maturity = assessEvidenceMaturity({ observations: history.length, qualityScore: quality.score, definition, forecastValidated: false });
  if (!maturity.canDetectMovement || history.length < windowDays * 2) {
    return { status: 'insufficient_evidence', metric, quality, maturity, currentValue: null, previousValue: null, changePercent: null };
  }
  const current = history.slice(-windowDays);
  const previous = history.slice(-(windowDays * 2), -windowDays);
  const aggregate = definition?.aggregationMethod === 'sum' ? sum : mean;
  const currentValue = aggregate(current.map((point) => point.value));
  const previousValue = aggregate(previous.map((point) => point.value));
  const changePercent = previousValue === 0 ? null : ((currentValue - previousValue) / Math.abs(previousValue)) * 100;
  const minimumMagnitude = Number(definition?.anomalyRules.minimumMagnitudePct || 15);
  const isMaterial = Number.isFinite(changePercent) && Math.abs(changePercent) >= minimumMagnitude;
  const confidence = Math.round(Math.min(95, quality.score * 0.75 + Math.min(20, history.length / 3)));
  const significance = strategicSignificance({
    businessImpact: ['revenue', 'qualified_leads', 'conversions', 'cac', 'roas'].includes(metric) ? 'high' : 'medium',
    confidence,
    urgency: isMaterial ? 70 : 35,
    magnitude: Number.isFinite(changePercent) ? Math.min(100, Math.abs(changePercent) * 2) : 0,
    persistence: 60,
    effort: 'medium',
    risk: 'low'
  });
  return {
    status: isMaterial ? 'observed' : 'no_material_change',
    metric,
    currentValue,
    previousValue,
    changePercent: Number.isFinite(changePercent) ? Math.round(changePercent * 10) / 10 : null,
    periodDays: windowDays,
    confidence,
    quality,
    maturity,
    significance
  };
}

function diagnoseMetrics(snapshots = [], options = {}) {
  const metrics = [...new Set(snapshots.map((item) => item.metric))];
  return metrics.map((metric) => periodMovement(metric, snapshots.filter((item) => item.metric === metric), options));
}

module.exports = { diagnoseMetrics, periodMovement };
