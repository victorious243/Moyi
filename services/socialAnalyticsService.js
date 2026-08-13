const GrowthSignal = require('../models/GrowthSignal');
const PublishJob = require('../models/PublishJob');
const SocialAccount = require('../models/SocialAccount');

const ANALYTICS_WINDOWS = new Set([7, 30, 90]);
const INTERACTION_FIELDS = ['likes', 'comments', 'shares', 'quotes', 'saves', 'clicks'];

function normalizeAnalyticsDays(value) {
  const days = Number(value || 30);
  return ANALYTICS_WINDOWS.has(days) ? days : 30;
}

function destinationProjectFilter(projectId) {
  return {
    $or: [
      { destinationProjectId: projectId },
      { projectId, destinationProjectId: null },
      { projectId, destinationProjectId: { $exists: false } }
    ]
  };
}

function metricNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function primaryExposure(metrics = {}) {
  for (const field of ['impressions', 'reach', 'views', 'videoViews']) {
    const value = metricNumber(metrics[field]);
    if (value !== null) return { field, value };
  }
  return { field: '', value: null };
}

function interactionTotal(metrics = {}) {
  const values = INTERACTION_FIELDS
    .map((field) => metricNumber(metrics[field]))
    .filter((value) => value !== null);
  return values.length ? values.reduce((total, value) => total + value, 0) : null;
}

function publicMetrics(metrics = {}) {
  return Object.fromEntries(Object.entries(metrics || {})
    .map(([field, value]) => [field, metricNumber(value)])
    .filter(([, value]) => value !== null));
}

function postPerformanceRow(job) {
  const metrics = publicMetrics(job.metricsLatest || {});
  const exposure = primaryExposure(metrics);
  const engagements = interactionTotal(metrics);
  const sourceMatchesDestination = String(job.projectId) === String(job.destinationProjectId || job.projectId);
  return {
    id: String(job._id),
    platform: job.platform,
    accountName: job.accountId && job.accountId.accountName ? job.accountId.accountName : 'Connected account',
    title: sourceMatchesDestination && job.draftId && job.draftId.title ? job.draftId.title : '',
    publishedAt: job.publishedAt,
    platformUrl: job.platformUrl || '',
    metricsStatus: job.metricsStatus || 'pending',
    metricsCapturedAt: job.metricsCapturedAt || null,
    availableFields: job.metricsAvailableFields || [],
    metrics,
    exposureField: exposure.field,
    exposure: exposure.value,
    engagements,
    engagementRate: exposure.value !== null && exposure.value > 0 && engagements !== null
      ? engagements / exposure.value
      : null
  };
}

function sumAvailableMetrics(posts, fields) {
  const values = posts.flatMap((post) => fields
    .map((field) => metricNumber(post.metrics[field]))
    .filter((value) => value !== null));
  return values.length ? values.reduce((total, value) => total + value, 0) : null;
}

function summarizePostMetrics(posts) {
  const exposurePosts = posts.filter((post) => post.exposure !== null);
  const engagementPosts = posts.filter((post) => post.engagements !== null);
  const ratePosts = engagementPosts.filter((post) => post.exposure !== null);
  const exposure = exposurePosts.length
    ? exposurePosts.reduce((total, post) => total + post.exposure, 0)
    : null;
  const engagements = engagementPosts.length
    ? engagementPosts.reduce((total, post) => total + post.engagements, 0)
    : null;
  const engagementExposure = ratePosts.reduce((total, post) => total + post.exposure, 0);
  const rateEngagements = ratePosts.reduce((total, post) => total + post.engagements, 0);
  return {
    exposure,
    engagements,
    clicks: sumAvailableMetrics(posts, ['clicks']),
    likes: sumAvailableMetrics(posts, ['likes']),
    comments: sumAvailableMetrics(posts, ['comments']),
    shares: sumAvailableMetrics(posts, ['shares', 'quotes']),
    engagementRate: ratePosts.length && engagementExposure > 0
      ? rateEngagements / engagementExposure
      : null
  };
}

function summarizePlatforms(posts) {
  const grouped = new Map();
  posts.forEach((post) => {
    if (!grouped.has(post.platform)) grouped.set(post.platform, []);
    grouped.get(post.platform).push(post);
  });
  return [...grouped.entries()]
    .map(([platform, platformPosts]) => ({
      platform,
      posts: platformPosts.length,
      measuredPosts: platformPosts.filter((post) => post.availableFields.length).length,
      ...summarizePostMetrics(platformPosts)
    }))
    .sort((left, right) => (
      Number(right.exposure || 0) - Number(left.exposure || 0)
      || Number(right.engagements || 0) - Number(left.engagements || 0)
    ));
}

function reliabilitySummary(jobs, accounts) {
  const count = (statuses) => jobs.filter((job) => statuses.includes(job.status)).length;
  return {
    queued: count(['queued', 'preparing_media']),
    publishing: count(['publishing', 'provider_processing']),
    retrying: count(['retry_wait']),
    published: count(['published']),
    deadLetter: count(['dead_letter', 'failed']),
    reconnectRequired: accounts.filter((account) => account.status === 'reconnect_required').length
  };
}

async function buildSocialPerformanceDashboard({ projectId, days = 30 }) {
  const normalizedDays = normalizeAnalyticsDays(days);
  const since = new Date(Date.now() - normalizedDays * 24 * 60 * 60 * 1000);
  const destinationFilter = destinationProjectFilter(projectId);
  const [publishedJobs, operationalJobs, accounts] = await Promise.all([
    PublishJob.find({
      ...destinationFilter,
      status: 'published',
      publishedAt: { $gte: since }
    })
      .sort({ publishedAt: -1 })
      .populate('accountId', 'accountName platform status')
      .populate('draftId', 'title')
      .lean(),
    PublishJob.find({
      ...destinationFilter,
      createdAt: { $gte: since }
    }).select('status').lean(),
    SocialAccount.find({ projectId })
      .select('platform accountName status metricsStatus metricsStatusMessage lastMetricsSyncAt reconnectRequiredAt')
      .sort({ platform: 1, accountName: 1 })
      .lean()
  ]);

  const posts = publishedJobs.map(postPerformanceRow);
  const platformRows = summarizePlatforms(posts);
  const totals = summarizePostMetrics(posts);
  totals.posts = posts.length;
  totals.measuredPosts = posts.filter((post) => post.availableFields.length).length;

  return {
    days: normalizedDays,
    since,
    generatedAt: new Date(),
    totals,
    platformRows,
    posts: [...posts].sort((left, right) => (
      Number(right.engagements || 0) - Number(left.engagements || 0)
      || Number(right.exposure || 0) - Number(left.exposure || 0)
    )),
    recentPosts: posts.slice(0, 50),
    accounts,
    reliability: reliabilitySummary(operationalJobs, accounts),
    lastMetricsSyncAt: posts
      .map((post) => post.metricsCapturedAt)
      .filter(Boolean)
      .sort((left, right) => new Date(right) - new Date(left))[0] || null
  };
}

function safeDraftExcerpt(signal) {
  if (!signal.draftId || !signal.draftId.body) return '';
  return String(signal.draftId.body).replace(/\s+/g, ' ').trim().slice(0, 280);
}

async function buildGrowthBrainSocialContext(projectId, { days = 90, limit = 20 } = {}) {
  const normalizedDays = normalizeAnalyticsDays(days);
  const since = new Date(Date.now() - normalizedDays * 24 * 60 * 60 * 1000);
  const signals = await GrowthSignal.find({ projectId, observedAt: { $gte: since } })
    .sort({ score: -1, observedAt: -1 })
    .limit(Math.min(50, Math.max(1, limit)))
    .populate('draftId', 'title body channel')
    .lean();

  const platformMap = new Map();
  signals.forEach((signal) => {
    if (!platformMap.has(signal.platform)) {
      platformMap.set(signal.platform, { platform: signal.platform, samples: 0, totalScore: 0, bestScore: 0 });
    }
    const row = platformMap.get(signal.platform);
    row.samples += 1;
    row.totalScore += Number(signal.score || 0);
    row.bestScore = Math.max(row.bestScore, Number(signal.score || 0));
  });
  const platforms = [...platformMap.values()]
    .map((row) => ({ ...row, averageScore: Math.round(row.totalScore / Math.max(1, row.samples)) }))
    .sort((left, right) => right.averageScore - left.averageScore);

  return {
    source: 'Moyi Content Distribution Engine engagement snapshots',
    asOf: signals.length ? signals[0].observedAt : null,
    windowDays: normalizedDays,
    sampleSize: signals.length,
    measurementNote: 'Metrics vary by provider and app permissions. Treat only supplied fields as observed evidence.',
    platforms,
    strongestObservedPosts: signals.slice(0, 8).map((signal) => ({
      platform: signal.platform,
      score: signal.score,
      observedAt: signal.observedAt,
      title: String(signal.sourceProjectId) === String(projectId) && signal.draftId && signal.draftId.title ? signal.draftId.title : '',
      contentExcerpt: String(signal.sourceProjectId) === String(projectId) ? safeDraftExcerpt(signal) : '',
      metrics: publicMetrics(signal.evidence && signal.evidence.metrics || {}),
      engagementRate: metricNumber(signal.evidence && signal.evidence.engagementRate)
    }))
  };
}

function socialPerformanceApiPayload(dashboard) {
  return {
    window: {
      days: dashboard.days,
      since: dashboard.since,
      generatedAt: dashboard.generatedAt,
      lastMetricsSyncAt: dashboard.lastMetricsSyncAt
    },
    totals: dashboard.totals,
    reliability: dashboard.reliability,
    platforms: dashboard.platformRows,
    posts: dashboard.recentPosts.map((post) => ({
      id: post.id,
      platform: post.platform,
      accountName: post.accountName,
      publishedAt: post.publishedAt,
      platformUrl: post.platformUrl,
      metricsStatus: post.metricsStatus,
      metricsCapturedAt: post.metricsCapturedAt,
      availableFields: post.availableFields,
      metrics: post.metrics,
      engagementRate: post.engagementRate
    }))
  };
}

module.exports = {
  buildGrowthBrainSocialContext,
  buildSocialPerformanceDashboard,
  destinationProjectFilter,
  normalizeAnalyticsDays,
  postPerformanceRow,
  socialPerformanceApiPayload,
  summarizePlatforms
};
