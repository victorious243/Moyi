const LIFECYCLE_WINDOWS = Object.freeze([
  { key: 'first30m', targetAgeMs: 30 * 60 * 1000, toleranceMs: 20 * 60 * 1000 },
  { key: 'first2h', targetAgeMs: 2 * 60 * 60 * 1000, toleranceMs: 45 * 60 * 1000 },
  { key: 'first6h', targetAgeMs: 6 * 60 * 60 * 1000, toleranceMs: 90 * 60 * 1000 },
  { key: 'first24h', targetAgeMs: 24 * 60 * 60 * 1000, toleranceMs: 6 * 60 * 60 * 1000 },
  { key: 'first48h', targetAgeMs: 48 * 60 * 60 * 1000, toleranceMs: 12 * 60 * 60 * 1000 },
  { key: 'first7d', targetAgeMs: 7 * 24 * 60 * 60 * 1000, toleranceMs: 36 * 60 * 60 * 1000 }
]);

const VERIFIED = 'verified';

function numeric(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function valueStatus(metrics, states, metric) {
  const state = (states || []).find((item) => item.metric === metric);
  const value = numeric(metrics && metrics[metric]);
  if (state) return { value: state.status === VERIFIED ? value : null, status: state.status, source: state.source || '', providerMetric: state.providerMetric || metric };
  return { value, status: value === null ? 'pending' : VERIFIED, source: '', providerMetric: metric };
}

function sumKnown(entries) {
  if (entries.some((entry) => entry.status === 'provider_error')) return { value: null, status: 'provider_error' };
  if (entries.some((entry) => entry.status === 'pending')) return { value: null, status: 'pending' };
  const verified = entries.filter((entry) => entry.status === VERIFIED && entry.value !== null);
  if (!verified.length) {
    const resolvedUnsupported = entries.length && entries.every((entry) => ['unsupported', 'not_applicable'].includes(entry.status));
    return { value: null, status: resolvedUnsupported ? 'unsupported' : 'pending' };
  }
  return { value: verified.reduce((sum, entry) => sum + entry.value, 0), status: VERIFIED };
}

function preferredMetric(entries) {
  const verified = entries.find((entry) => entry.status === VERIFIED && entry.value !== null);
  if (verified) return verified;
  if (entries.some((entry) => entry.status === 'provider_error')) return { value: null, status: 'provider_error', source: '', providerMetric: '' };
  if (entries.some((entry) => entry.status === 'pending')) return { value: null, status: 'pending', source: '', providerMetric: '' };
  return { value: null, status: 'unsupported', source: '', providerMetric: '' };
}

function exposureMetric(metrics, states) {
  for (const metric of ['impressions', 'reach', 'views', 'videoViews']) {
    const entry = valueStatus(metrics, states, metric);
    if (entry.status === VERIFIED && entry.value !== null) return { ...entry, metric };
  }
  return { metric: '', value: null, status: 'pending', source: '', providerMetric: '' };
}

function normalizeMetricFamilies({ metrics = {}, metricStates = [], platform = '' } = {}) {
  const likes = valueStatus(metrics, metricStates, 'likes');
  const reactions = valueStatus(metrics, metricStates, 'reactions');
  const interaction = preferredMetric([reactions, likes]);
  const shares = valueStatus(metrics, metricStates, 'shares');
  const reposts = valueStatus(metrics, metricStates, 'reposts');
  const reshares = preferredMetric([reposts, shares]);
  const meaningfulEntries = [
    valueStatus(metrics, metricStates, 'comments'),
    reshares,
    valueStatus(metrics, metricStates, 'quotes'),
    valueStatus(metrics, metricStates, 'saves')
  ];
  const meaningful = sumKnown(meaningfulEntries);
  const socialTotal = sumKnown([interaction, ...meaningfulEntries]);
  const aggregateClicks = valueStatus(metrics, metricStates, 'clicks');
  const linkClicks = valueStatus(metrics, metricStates, 'linkClicks');
  const profileClicks = valueStatus(metrics, metricStates, 'profileClicks');
  const specificClicks = sumKnown([linkClicks, profileClicks]);
  const clicks = [linkClicks, profileClicks].some((entry) => entry.status === VERIFIED)
    ? specificClicks
    : aggregateClicks;
  const exposure = exposureMetric(metrics, metricStates);
  const uniqueReach = valueStatus(metrics, metricStates, 'reach');
  const videoViews = valueStatus(metrics, metricStates, 'videoViews');
  const watchTime = valueStatus(metrics, metricStates, 'watchTimeMs');
  const rate = socialTotal.value !== null && exposure.value !== null && exposure.value > 0
    ? socialTotal.value / exposure.value
    : null;
  const ctr = clicks.value !== null && exposure.value !== null && exposure.value > 0
    ? clicks.value / exposure.value
    : null;
  const normalized = [
    { family: 'exposure', value: exposure.value, status: exposure.status, sourceMetric: exposure.metric, provider: platform, comparableAcrossPlatforms: false },
    { family: 'uniqueReach', value: uniqueReach.value, status: uniqueReach.status, sourceMetric: 'reach', provider: platform, comparableAcrossPlatforms: true },
    { family: 'socialInteraction', value: interaction.value, status: interaction.status, sourceMetric: interaction.providerMetric || 'reactions|likes', provider: platform, comparableAcrossPlatforms: false },
    { family: 'meaningfulEngagement', value: meaningful.value, status: meaningful.status, sourceMetric: 'comments+(reposts|shares)+quotes+saves', provider: platform, comparableAcrossPlatforms: false },
    { family: 'socialEngagement', value: socialTotal.value, status: socialTotal.status, sourceMetric: '(reactions|likes)+comments+(reposts|shares)+quotes+saves', provider: platform, comparableAcrossPlatforms: false },
    { family: 'socialEngagementRate', value: rate, status: rate === null ? 'not_applicable' : VERIFIED, sourceMetric: exposure.metric ? `socialEngagement/${exposure.metric}` : '', provider: platform, comparableAcrossPlatforms: false },
    { family: 'trafficIntent', value: clicks.value, status: clicks.status, sourceMetric: [linkClicks, profileClicks].some((entry) => entry.status === VERIFIED) ? 'linkClicks+profileClicks' : 'clicks', provider: platform, comparableAcrossPlatforms: false },
    { family: 'ctr', value: ctr, status: ctr === null ? 'not_applicable' : VERIFIED, sourceMetric: exposure.metric ? `clicks/${exposure.metric}` : '', provider: platform, comparableAcrossPlatforms: false },
    { family: 'videoConsumption', value: videoViews.value, status: videoViews.status, sourceMetric: 'videoViews', provider: platform, comparableAcrossPlatforms: false },
    { family: 'watchTime', value: watchTime.value, status: watchTime.status, sourceMetric: 'watchTimeMs', provider: platform, comparableAcrossPlatforms: false }
  ];
  return normalized;
}

function normalizedValue(rows, family) {
  const row = (rows || []).find((item) => item.family === family);
  return row && row.status === VERIFIED ? numeric(row.value) : null;
}

function captureLifecycleWindows(snapshots, publishedAt) {
  const publishedMs = new Date(publishedAt).getTime();
  const valid = (snapshots || []).filter((snapshot) => {
    const captured = new Date(snapshot.capturedAt).getTime();
    return Number.isFinite(captured) && captured >= publishedMs;
  });
  return LIFECYCLE_WINDOWS.map((window) => {
    const nearest = valid.reduce((best, snapshot) => {
      const observedAgeMs = new Date(snapshot.capturedAt).getTime() - publishedMs;
      const distance = Math.abs(observedAgeMs - window.targetAgeMs);
      return !best || distance < best.distance ? { snapshot, observedAgeMs, distance } : best;
    }, null);
    if (!nearest || nearest.distance > window.toleranceMs) {
      return { key: window.key, targetAgeMs: window.targetAgeMs, observedAgeMs: null, complete: false, snapshotId: null, capturedAt: null, nativeMetrics: {}, normalizedMetrics: [] };
    }
    return {
      key: window.key,
      targetAgeMs: window.targetAgeMs,
      observedAgeMs: nearest.observedAgeMs,
      complete: true,
      snapshotId: nearest.snapshot._id || null,
      capturedAt: nearest.snapshot.capturedAt,
      nativeMetrics: nearest.snapshot.metrics || {},
      normalizedMetrics: normalizeMetricFamilies({ metrics: nearest.snapshot.metrics, metricStates: nearest.snapshot.metricStates, platform: nearest.snapshot.platform })
    };
  });
}

function calculateVelocity(snapshots, publishedAt) {
  const publishedMs = new Date(publishedAt).getTime();
  const sorted = [...(snapshots || [])].filter((row) => row.capturedAt).sort((a, b) => new Date(a.capturedAt) - new Date(b.capturedAt));
  const intervals = [];
  const regressions = [];
  for (let index = 1; index < sorted.length; index += 1) {
    const previous = sorted[index - 1];
    const current = sorted[index];
    const hours = (new Date(current.capturedAt) - new Date(previous.capturedAt)) / 3600000;
    if (!(hours > 0)) continue;
    const rates = {};
    [
      'impressions', 'reach', 'views', 'videoViews', 'likes', 'reactions',
      'comments', 'shares', 'reposts', 'quotes', 'saves', 'clicks',
      'linkClicks', 'profileClicks', 'watchTimeMs'
    ].forEach((metric) => {
      const before = numeric(previous.metrics && previous.metrics[metric]);
      const after = numeric(current.metrics && current.metrics[metric]);
      if (before === null || after === null) return;
      const delta = after - before;
      if (delta < 0) regressions.push({ metric, previous: before, observed: after, capturedAt: current.capturedAt });
      else rates[metric] = delta / hours;
    });
    const previousNormalized = normalizeMetricFamilies({
      metrics: previous.metrics,
      metricStates: previous.metricStates,
      platform: previous.platform
    });
    const currentNormalized = normalizeMetricFamilies({
      metrics: current.metrics,
      metricStates: current.metricStates,
      platform: current.platform
    });
    ['socialEngagement', 'meaningfulEngagement', 'trafficIntent'].forEach((family) => {
      const before = normalizedValue(previousNormalized, family);
      const after = normalizedValue(currentNormalized, family);
      if (before === null || after === null) return;
      const delta = after - before;
      if (delta < 0) regressions.push({ metric: family, previous: before, observed: after, capturedAt: current.capturedAt });
      else rates[family] = delta / hours;
    });
    intervals.push({ fromAgeMs: new Date(previous.capturedAt).getTime() - publishedMs, toAgeMs: new Date(current.capturedAt).getTime() - publishedMs, hours, rates });
  }
  return { intervals, latest: intervals.length ? intervals[intervals.length - 1].rates : {}, counterRegressions: regressions };
}

function median(values) {
  const sorted = values.map(numeric).filter((value) => value !== null).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function percentileRank(values, observed) {
  const clean = values.map(numeric).filter((value) => value !== null).sort((a, b) => a - b);
  const value = numeric(observed);
  if (!clean.length || value === null) return null;
  const below = clean.filter((item) => item < value).length;
  const equal = clean.filter((item) => item === value).length;
  return Math.round(((below + (equal * 0.5)) / clean.length) * 100);
}

function recencyWeight(observedAt, now = new Date()) {
  const days = Math.max(0, (new Date(now) - new Date(observedAt)) / 86400000);
  if (days <= 30) return 1;
  if (days <= 90) return 0.7;
  if (days <= 180) return 0.4;
  return 0.2;
}

module.exports = {
  LIFECYCLE_WINDOWS,
  calculateVelocity,
  captureLifecycleWindows,
  exposureMetric,
  median,
  normalizeMetricFamilies,
  normalizedValue,
  numeric,
  percentileRank,
  recencyWeight
};
