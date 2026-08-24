const METRIC_STATUSES = Object.freeze([
  'verified',
  'pending',
  'not_connected',
  'unsupported',
  'permission_denied',
  'stale',
  'provider_error',
  'not_applicable'
]);

const FRESHNESS_STATES = Object.freeze(['fresh', 'aging', 'stale', 'unknown']);

const SYNC_RUN_STATUSES = Object.freeze(['running', 'success', 'partial', 'failed', 'skipped']);

function metricValue(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function isVerifiedMetric(observation) {
  return Boolean(observation)
    && observation.status === 'verified'
    && metricValue(observation.value) !== null
    && observation.freshness !== 'stale';
}

function freshnessFor(observedAt, now = new Date(), maxAgeMs = 36 * 60 * 60 * 1000) {
  if (!observedAt) return 'unknown';
  const age = now.getTime() - new Date(observedAt).getTime();
  if (!Number.isFinite(age) || age < 0) return 'unknown';
  if (age <= maxAgeMs) return 'fresh';
  if (age <= maxAgeMs * 2) return 'aging';
  return 'stale';
}

module.exports = {
  FRESHNESS_STATES,
  METRIC_STATUSES,
  SYNC_RUN_STATUSES,
  freshnessFor,
  isVerifiedMetric,
  metricValue
};
