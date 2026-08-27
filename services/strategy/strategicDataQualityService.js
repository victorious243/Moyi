const { metricDefinition } = require('./metricRegistry');

const DAY_MS = 86400000;

function dayKey(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString().slice(0, 10);
}

function evaluateMetricDataQuality(metric, points = [], now = new Date()) {
  const definition = metricDefinition(metric);
  const valid = points
    .map((point) => ({ date: new Date(point.date), value: Number(point.value), quality: point.quality || {} }))
    .filter((point) => !Number.isNaN(point.date.getTime()) && Number.isFinite(point.value))
    .sort((a, b) => a.date - b.date);
  const byDate = new Map();
  valid.forEach((point) => byDate.set(dayKey(point.date), point));
  const unique = [...byDate.values()];
  const duplicates = Math.max(0, valid.length - unique.length);
  const first = unique[0] && unique[0].date;
  const last = unique.at(-1) && unique.at(-1).date;
  const spanDays = first && last ? Math.max(1, Math.round((last - first) / DAY_MS) + 1) : 0;
  const density = spanDays ? unique.length / spanDays : 0;
  const staleDays = last ? Math.max(0, (now - last) / DAY_MS) : null;
  const sourceCompleteness = unique.length
    ? unique.reduce((sum, point) => sum + Number(point.quality.completeness ?? 100), 0) / unique.length / 100
    : 0;
  const sourceConfidence = unique.length
    ? unique.reduce((sum, point) => sum + Number(point.quality.confidence ?? 70), 0) / unique.length / 100
    : 0;
  const freshness = staleDays === null ? 0 : staleDays <= 1 ? 1 : staleDays <= 3 ? 0.75 : staleDays <= 7 ? 0.4 : 0;
  const duplicatePenalty = valid.length ? Math.min(0.25, duplicates / valid.length) : 0;
  const score = Math.round(Math.max(0, Math.min(1,
    density * 0.3 + sourceCompleteness * 0.25 + sourceConfidence * 0.25 + freshness * 0.2 - duplicatePenalty
  )) * 100);
  const issues = [];
  if (!unique.length) issues.push('No usable observations.');
  if (density < 0.8 && unique.length) issues.push(`Only ${Math.round(density * 100)}% of days in the observed span contain data.`);
  if (duplicates) issues.push(`${duplicates} duplicate daily observation${duplicates === 1 ? '' : 's'} detected; the latest value per day was used.`);
  if (staleDays !== null && staleDays > Number(definition?.reliabilityRequirements.maximumStalenessDays || 3)) issues.push(`The newest observation is ${Math.floor(staleDays)} days old.`);
  if (sourceCompleteness < 0.7 && unique.length) issues.push('Source completeness is below the reliability threshold.');

  return {
    score,
    status: score >= 85 ? 'strong' : score >= 70 ? 'acceptable' : score >= 45 ? 'weak' : 'insufficient',
    observations: unique.length,
    spanDays,
    density: Math.round(density * 1000) / 1000,
    duplicates,
    staleDays: staleDays === null ? null : Math.round(staleDays * 10) / 10,
    firstObservedAt: first || null,
    lastObservedAt: last || null,
    issues,
    usablePoints: unique
  };
}

module.exports = { dayKey, evaluateMetricDataQuality };
