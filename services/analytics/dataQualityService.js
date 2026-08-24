const ConversionGoal = require('../../models/ConversionGoal');
const DailySocialSnapshot = require('../../models/DailySocialSnapshot');
const ProjectSearchProperty = require('../../models/ProjectSearchProperty');
const ProviderSyncRun = require('../../models/ProviderSyncRun');
const SocialAccount = require('../../models/SocialAccount');
const TrackingEvent = require('../../models/TrackingEvent');
const { isVerifiedMetric } = require('./metricStatus');

const TRUSTED_SYNC_STATUSES = new Set(['success', 'partial']);

function confidenceLabel(coverage) {
  if (coverage >= 0.85) return 'high';
  if (coverage >= 0.6) return 'medium';
  if (coverage >= 0.35) return 'low';
  return 'insufficient';
}

function qualityStatus({ connectedPlatforms, verifiedPlatforms, coverage, hasHistory }) {
  if (!connectedPlatforms) return 'setup';
  if (!verifiedPlatforms) return hasHistory ? 'insufficient' : 'collecting';
  if (coverage >= 0.8) return 'reliable';
  return 'provisional';
}

function stateIssue(platform, state, message, syncRun = null) {
  return {
    platform,
    type: state,
    message,
    syncRunId: syncRun ? syncRun.syncRunId : '',
    observedAt: syncRun ? (syncRun.finishedAt || syncRun.startedAt) : null
  };
}

async function assessDailyDataQuality(projectId, reportingWindow = {}) {
  const windowStart = reportingWindow.start || new Date(Date.now() - 24 * 60 * 60 * 1000);
  const windowEnd = reportingWindow.end || new Date();
  const historyStart = new Date(windowStart.getTime() - 28 * 24 * 60 * 60 * 1000);

  const [accounts, snapshots, syncRuns, trackedEvents, conversionGoals, searchProperty, historicalDates] = await Promise.all([
    SocialAccount.find({
      $or: [{ projectId }, { sharedWithProjectIds: projectId }],
      revokedAt: null
    }).lean(),
    DailySocialSnapshot.find({ projectId, date: { $gte: windowStart, $lt: windowEnd } }).lean(),
    ProviderSyncRun.find({ projectId, startedAt: { $gte: historyStart, $lt: windowEnd } }).sort({ startedAt: -1 }).lean(),
    TrackingEvent.find({ projectId, createdAt: { $gte: windowStart, $lt: windowEnd } }).select('eventType funnelStage eventValue createdAt').lean(),
    ConversionGoal.find({ projectId }).lean(),
    ProjectSearchProperty.findOne({ projectId }).lean(),
    DailySocialSnapshot.distinct('date', { projectId, date: { $gte: historyStart, $lt: windowStart }, dataStatus: 'verified' })
  ]);

  const activeAccounts = accounts.filter((account) => account.status !== 'disconnected');
  const connectedPlatforms = [...new Set(activeAccounts.map((account) => account.platform))];
  const latestRunByPlatform = new Map();
  syncRuns.forEach((run) => {
    if (!latestRunByPlatform.has(run.platform)) latestRunByPlatform.set(run.platform, run);
  });

  const health = [];
  const issues = [];
  let verifiedMetrics = 0;
  let expectedMetrics = 0;
  let freshnessPoints = 0;
  let freshnessSamples = 0;
  const verifiedPlatforms = new Set();

  connectedPlatforms.forEach((platform) => {
    const account = activeAccounts.find((item) => item.platform === platform);
    const platformRows = snapshots.filter((snapshot) => snapshot.platform === platform);
    const latestRun = latestRunByPlatform.get(platform) || null;
    const states = platformRows.flatMap((snapshot) => Object.values(snapshot.metricStates || {}));
    const verified = states.filter((state) => isVerifiedMetric(state));
    const stale = states.filter((state) => state && state.status === 'verified' && state.freshness === 'stale');
    const expectedStates = states.filter((state) => state && !['unsupported', 'not_applicable'].includes(state.status));
    const expected = expectedStates.length || (platformRows.some((row) => row.postsPublished > 0) ? 2 : 0);
    expectedMetrics += expected;
    verifiedMetrics += verified.length;
    if (verified.length && (!latestRun || TRUSTED_SYNC_STATUSES.has(latestRun.status))) verifiedPlatforms.add(platform);

    verified.forEach((state) => {
      freshnessSamples += 1;
      freshnessPoints += state.freshness === 'fresh' ? 1 : (state.freshness === 'aging' ? 0.5 : 0);
    });

    let status = 'pending';
    let message = 'Waiting for the first verified analytics response.';
    if (account.status === 'reconnect_required') {
      status = 'permission_denied';
      message = account.statusMessage || 'Reconnect this account before analytics can resume.';
    } else if (account.metricsStatus === 'unsupported') {
      status = 'unsupported';
      message = account.metricsStatusMessage || 'This provider does not expose supported metrics to this app.';
    } else if (account.metricsStatus === 'error' || (latestRun && latestRun.status === 'failed')) {
      status = latestRun && latestRun.permissionStatus === 'denied' ? 'permission_denied' : 'provider_error';
      message = account.metricsStatusMessage || (latestRun && latestRun.errorMessage) || 'The latest provider analytics sync failed.';
    } else if (verified.length) {
      status = 'verified';
      message = `${verified.length} verified metric${verified.length === 1 ? '' : 's'} collected.`;
    } else if (stale.length) {
      status = 'stale';
      message = `${stale.length} previously verified metric${stale.length === 1 ? ' is' : 's are'} now stale; waiting for reconciliation.`;
    }
    if (status !== 'verified' && status !== 'unsupported') issues.push(stateIssue(platform, status, message, latestRun));
    health.push({
      source: platform,
      label: platform,
      status,
      message,
      lastSyncedAt: account.lastMetricsSyncAt || (latestRun && latestRun.finishedAt) || null,
      syncRunId: latestRun ? latestRun.syncRunId : '',
      metricsVerified: verified.length,
      metricsExpected: expected
    });
  });

  const trackerStatus = trackedEvents.length ? 'verified' : 'pending';
  health.push({
    source: 'website',
    label: 'Website Analytics',
    status: trackerStatus,
    message: trackedEvents.length ? `${trackedEvents.length} first-party event${trackedEvents.length === 1 ? '' : 's'} received in this window.` : 'No first-party events were received in this reporting window.',
    lastSyncedAt: trackedEvents.length ? trackedEvents[trackedEvents.length - 1].createdAt : null
  });
  if (!trackedEvents.length) issues.push(stateIssue('website', 'pending', 'No first-party tracking events were received.'));

  health.push({
    source: 'search_console',
    label: 'Google Search Console',
    status: searchProperty ? (searchProperty.lastSyncedAt ? 'verified' : 'pending') : 'not_connected',
    message: searchProperty ? (searchProperty.lastSyncedAt ? 'Search Console property has synchronized.' : 'Property connected; waiting for its first synchronization.') : 'Search Console is not connected.',
    lastSyncedAt: searchProperty && searchProperty.lastSyncedAt
  });

  const revenueConfigured = conversionGoals.some((goal) => goal.funnelStage === 'revenue' || goal.funnelStage === 'purchase');
  const revenueEvents = trackedEvents.filter((event) => ['purchase', 'revenue'].includes(event.funnelStage));
  health.push({
    source: 'revenue',
    label: 'Revenue Attribution',
    status: revenueConfigured ? (trackedEvents.length ? 'verified' : 'pending') : 'not_connected',
    message: revenueConfigured ? (trackedEvents.length ? `${revenueEvents.length} revenue event${revenueEvents.length === 1 ? '' : 's'} observed; verified zero remains valid.` : 'Revenue goals exist, but this window has not been measured yet.') : 'No purchase or revenue goal is configured.',
    lastSyncedAt: revenueEvents.length ? revenueEvents[revenueEvents.length - 1].createdAt : null,
    configured: revenueConfigured
  });

  const denominator = Math.max(expectedMetrics, connectedPlatforms.length ? connectedPlatforms.length * 2 : 1);
  const coverage = Math.max(0, Math.min(1, verifiedMetrics / denominator));
  const freshness = freshnessSamples ? freshnessPoints / freshnessSamples : 0;
  const confidence = Math.round((coverage * 0.75 + freshness * 0.25) * 100);
  const status = qualityStatus({
    connectedPlatforms: connectedPlatforms.length,
    verifiedPlatforms: verifiedPlatforms.size,
    coverage,
    hasHistory: historicalDates.length > 0
  });

  return {
    status,
    coverage,
    freshness,
    confidence,
    confidenceLabel: confidenceLabel(coverage),
    verifiedMetrics,
    expectedMetrics: denominator,
    eligiblePlatforms: connectedPlatforms.length,
    verifiedPlatforms: verifiedPlatforms.size,
    connectedPlatforms,
    verifiedPlatformNames: [...verifiedPlatforms],
    issues,
    health,
    revenueConfigured,
    hasHistoricalBaseline: historicalDates.length >= 7,
    baselineDays: historicalDates.length
  };
}

module.exports = { assessDailyDataQuality, confidenceLabel, qualityStatus };
