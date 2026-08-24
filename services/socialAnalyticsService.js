const GrowthSignal = require('../models/GrowthSignal');
const PublishJob = require('../models/PublishJob');
const Project = require('../models/Project');
const SocialAccount = require('../models/SocialAccount');
const SocialPostPerformance = require('../models/SocialPostPerformance');
const { median, normalizedValue, recencyWeight } = require('./socialPerformanceMath');

const ANALYTICS_WINDOWS = new Set([7, 30, 90]);
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const TOPIC_STOPWORDS = new Set([
  'about', 'after', 'again', 'also', 'and', 'are', 'because', 'before', 'being', 'built',
  'business', 'can', 'cmo', 'content', 'from', 'growth', 'have', 'help', 'helps', 'into',
  'learn', 'marketing', 'more', 'moyi', 'post', 'that', 'the', 'their', 'this', 'through',
  'today', 'users', 'with', 'your'
]);
const EMPTY_RECOMMENDATION_INPUTS = {
  evidenceQuality: {
    confidence: 'none',
    sampleSize: 0,
    note: 'No engagement snapshots have been collected in this window.'
  },
  bestContentPatterns: [],
  weakContentPatterns: [],
  suggestedNextActions: []
};
const EMPTY_GROWTH_BRAIN_UPGRADE = {
  whatWorked: [],
  bestPostingTimes: [],
  bestPlatforms: [],
  winningHooks: [],
  winningTopics: [],
  winningFormats: [],
  lowPerformingWarnings: [],
  improvedDraftSuggestions: []
};

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
  const values = [
    metricNumber(metrics.reactions) ?? metricNumber(metrics.likes),
    metricNumber(metrics.comments),
    metricNumber(metrics.reposts) ?? metricNumber(metrics.shares),
    metricNumber(metrics.quotes),
    metricNumber(metrics.saves)
  ].filter((value) => value !== null);
  return values.length ? values.reduce((total, value) => total + value, 0) : null;
}

function meaningfulEngagementTotal(metrics = {}) {
  const values = [
    metricNumber(metrics.comments),
    metricNumber(metrics.reposts) ?? metricNumber(metrics.shares),
    metricNumber(metrics.quotes),
    metricNumber(metrics.saves)
  ].filter((value) => value !== null);
  return values.length ? values.reduce((total, value) => total + value, 0) : null;
}

function clickTotal(metrics = {}) {
  const linkClicks = metricNumber(metrics.linkClicks);
  const profileClicks = metricNumber(metrics.profileClicks);
  if (linkClicks !== null || profileClicks !== null) return (linkClicks || 0) + (profileClicks || 0);
  return metricNumber(metrics.clicks);
}

function publicMetrics(metrics = {}) {
  return Object.fromEntries(Object.entries(metrics || {})
    .map(([field, value]) => [field, metricNumber(value)])
    .filter(([, value]) => value !== null));
}

function classifyContentType(job) {
  const media = Array.isArray(job.mediaIds) ? job.mediaIds : [];
  const mimeTypes = media.map((item) => String(item && item.mimeType || '').toLowerCase()).filter(Boolean);
  if (media.length > 1) return 'carousel';
  if (mimeTypes.some((mimeType) => mimeType.startsWith('video/'))) return 'video';
  if (
    mimeTypes.some((mimeType) => mimeType.startsWith('image/'))
    || (job.content && job.content.imageUrl)
    || (job.draftId && job.draftId.contentImageId)
  ) return 'image';
  return 'text';
}

function postPerformanceRow(job) {
  const metrics = publicMetrics(job.metricsLatest || {});
  const exposure = primaryExposure(metrics);
  const engagements = interactionTotal(metrics);
  const sourceMatchesDestination = String(job.projectId) === String(job.destinationProjectId || job.projectId);
  const campaign = sourceMatchesDestination && job.draftId && job.draftId.campaignId
    ? job.draftId.campaignId
    : null;
  return {
    id: String(job._id),
    platform: job.platform,
    accountId: job.accountId && job.accountId._id ? String(job.accountId._id) : String(job.accountId || ''),
    accountName: job.accountId && job.accountId.accountName ? job.accountId.accountName : 'Connected account',
    title: sourceMatchesDestination && job.draftId && job.draftId.title ? job.draftId.title : '',
    campaignId: campaign && campaign._id ? String(campaign._id) : '',
    campaignName: campaign && campaign.name ? campaign.name : 'Unassigned campaign',
    campaignGoal: campaign && campaign.goal ? campaign.goal : '',
    campaignChannel: campaign && campaign.channel ? campaign.channel : '',
    contentType: classifyContentType(job),
    publishedAt: job.publishedAt,
    platformUrl: job.platformUrl || '',
    metricsStatus: job.metricsStatus || 'pending',
    metricsCapturedAt: job.metricsCapturedAt || null,
    availableFields: job.metricsAvailableFields || [],
    metrics,
    exposureField: exposure.field,
    exposure: exposure.value,
    engagements,
    meaningfulEngagements: meaningfulEngagementTotal(metrics),
    clicks: clickTotal(metrics),
    engagementRate: exposure.value !== null && exposure.value > 0 && engagements !== null
      ? engagements / exposure.value
      : null
  };
}

function canonicalPostPerformanceRow(performance) {
  const metrics = publicMetrics(performance.latestNativeMetrics || {});
  const exposure = primaryExposure(metrics);
  const engagements = normalizedValue(performance.latestNormalizedMetrics, 'socialEngagement');
  const meaningfulEngagements = normalizedValue(performance.latestNormalizedMetrics, 'meaningfulEngagement');
  const clicks = normalizedValue(performance.latestNormalizedMetrics, 'trafficIntent');
  const rate = normalizedValue(performance.latestNormalizedMetrics, 'socialEngagementRate');
  const ctr = normalizedValue(performance.latestNormalizedMetrics, 'ctr');
  const campaign = performance.campaignId || {};
  const draft = performance.draftId || {};
  const account = performance.socialAccountId || {};
  const job = performance.publishJobId || {};
  return {
    id: String(performance.publishJobId && performance.publishJobId._id || performance.publishJobId),
    performanceId: String(performance._id),
    platform: performance.platform,
    accountId: account._id ? String(account._id) : String(performance.socialAccountId || ''),
    accountName: account.accountName || 'Connected account',
    title: draft.title || '',
    campaignId: campaign._id ? String(campaign._id) : '',
    campaignName: campaign.name || 'Unassigned campaign',
    campaignGoal: campaign.goal || '',
    campaignChannel: campaign.channel || '',
    contentType: performance.contentType,
    objective: performance.objective || '',
    promoted: Boolean(performance.promoted),
    publishedAt: performance.publishedAt,
    platformUrl: job.platformUrl || '',
    metricsStatus: job.metricsStatus || 'pending',
    metricsCapturedAt: performance.lastObservedAt,
    availableFields: (performance.latestMetricStates || []).filter((state) => state.status === 'verified').map((state) => state.metric),
    metrics,
    exposureField: exposure.field,
    exposure: exposure.value,
    engagements,
    meaningfulEngagements,
    clicks,
    engagementRate: rate,
    ctr,
    performanceScore: performance.performanceScore,
    scoreStatus: performance.scoreStatus,
    confidence: performance.confidence || {},
    lifecycle: performance.lifecycle || [],
    velocity: performance.velocity || {},
    baselineComparison: performance.baselineComparison || {},
    attribution: performance.attribution || {},
    anomalies: performance.anomalies || []
  };
}

function sumAvailableMetrics(posts, fields) {
  const values = posts.flatMap((post) => fields
    .map((field) => metricNumber(post.metrics[field]))
    .filter((value) => value !== null));
  return values.length ? values.reduce((total, value) => total + value, 0) : null;
}

function sumPreferredMetric(posts, preferredField, fallbackField) {
  const values = posts.map((post) => (
    metricNumber(post.metrics[preferredField]) ?? metricNumber(post.metrics[fallbackField])
  )).filter((value) => value !== null);
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
  const exposureValues = exposurePosts.map((post) => post.exposure);
  const engagementValues = engagementPosts.map((post) => post.engagements);
  const meaningfulValues = posts.map((post) => post.meaningfulEngagements).filter((value) => value !== null);
  const rateValues = posts.map((post) => post.engagementRate).filter((value) => value !== null);
  const ctrValues = posts.map((post) => post.ctr).filter((value) => value !== null);
  const verifiedAttribution = posts.filter((post) => post.attribution && post.attribution.status === 'verified');
  const sumAttribution = (field) => verifiedAttribution.length
    ? verifiedAttribution.reduce((total, post) => total + Number(post.attribution[field] || 0), 0)
    : null;
  return {
    exposure,
    engagements,
    clicks: posts.map((post) => post.clicks).filter((value) => value !== null).reduce((total, value) => total + value, 0) || (posts.some((post) => post.clicks === 0) ? 0 : null),
    likes: sumPreferredMetric(posts, 'reactions', 'likes'),
    comments: sumAvailableMetrics(posts, ['comments']),
    shares: (() => {
      const reshares = sumPreferredMetric(posts, 'reposts', 'shares');
      const quotes = sumAvailableMetrics(posts, ['quotes']);
      return reshares === null && quotes === null ? null : (reshares || 0) + (quotes || 0);
    })(),
    meaningfulEngagements: meaningfulValues.length ? meaningfulValues.reduce((total, value) => total + value, 0) : null,
    engagementRate: ratePosts.length && engagementExposure > 0
      ? rateEngagements / engagementExposure
      : null,
    medianExposurePerPost: median(exposureValues),
    medianEngagementsPerPost: median(engagementValues),
    medianMeaningfulEngagementsPerPost: median(meaningfulValues),
    medianEngagementRate: median(rateValues),
    medianCtr: median(ctrValues),
    sessions: sumAttribution('sessions'),
    leads: sumAttribution('leads'),
    conversions: sumAttribution('conversions'),
    revenue: sumAttribution('revenue')
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

function summarizeCampaigns(posts) {
  const grouped = new Map();
  posts.forEach((post) => {
    const key = post.campaignId || `unassigned:${post.campaignName}`;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(post);
  });
  return [...grouped.values()]
    .map((campaignPosts) => ({
      campaignId: campaignPosts[0].campaignId,
      campaignName: campaignPosts[0].campaignName,
      campaignGoal: campaignPosts[0].campaignGoal,
      campaignChannel: campaignPosts[0].campaignChannel,
      posts: campaignPosts.length,
      measuredPosts: campaignPosts.filter((post) => post.availableFields.length).length,
      ...summarizePostMetrics(campaignPosts)
    }))
    .sort((left, right) => (
      Number(right.engagements || 0) - Number(left.engagements || 0)
      || Number(right.exposure || 0) - Number(left.exposure || 0)
    ));
}

function summarizeContentTypes(posts) {
  const grouped = new Map();
  posts.forEach((post) => {
    if (!grouped.has(post.contentType)) grouped.set(post.contentType, []);
    grouped.get(post.contentType).push(post);
  });
  return [...grouped.entries()]
    .map(([contentType, contentPosts]) => ({
      contentType,
      posts: contentPosts.length,
      measuredPosts: contentPosts.filter((post) => post.availableFields.length).length,
      ...summarizePostMetrics(contentPosts)
    }))
    .sort((left, right) => (
      Number(right.engagementRate || 0) - Number(left.engagementRate || 0)
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

function socialDataHealth(accounts, posts, now = new Date()) {
  const byPlatform = accounts.map((account) => {
    const measured = posts.filter((post) => (
      String(post.accountId) === String(account._id)
      && post.availableFields.length
    ));
    const lastSync = account.lastMetricsSyncAt || measured.map((post) => post.metricsCapturedAt).filter(Boolean).sort((a, b) => new Date(b) - new Date(a))[0] || null;
    const ageHours = lastSync ? Math.max(0, (new Date(now) - new Date(lastSync)) / 3600000) : null;
    const freshness = ageHours === null ? 'unknown' : ageHours <= 1 ? 'fresh' : ageHours <= 24 ? 'aging' : 'stale';
    return {
      platform: account.platform,
      accountName: account.accountName,
      connectionState: account.status,
      metricsStatus: account.metricsStatus,
      limitation: account.metricsStatusMessage || '',
      lastSyncAt: lastSync,
      measuredPosts: measured.length,
      freshness
    };
  });
  const healthy = byPlatform.filter((row) => row.connectionState === 'connected' && ['fresh', 'aging'].includes(row.freshness) && row.metricsStatus === 'active').length;
  return {
    score: byPlatform.length ? Math.round((healthy / byPlatform.length) * 100) : null,
    label: !byPlatform.length ? 'No accounts' : healthy === byPlatform.length ? 'Healthy' : healthy ? 'Partial coverage' : 'Needs attention',
    providers: byPlatform
  };
}

async function buildSocialPerformanceDashboard({ projectId, days = 30 }) {
  const normalizedDays = normalizeAnalyticsDays(days);
  const since = new Date(Date.now() - normalizedDays * 24 * 60 * 60 * 1000);
  const destinationFilter = destinationProjectFilter(projectId);
  const [publishedJobs, canonicalPerformances, operationalJobs, accounts] = await Promise.all([
    PublishJob.find({
      ...destinationFilter,
      status: 'published',
      publishedAt: { $gte: since }
    })
      .sort({ publishedAt: -1 })
      .populate('accountId', 'accountName platform status')
      .populate({
        path: 'draftId',
        select: 'title body channel campaignId contentImageId',
        populate: {
          path: 'campaignId',
          select: 'name goal channel cadence'
        }
      })
      .populate('mediaIds', 'mimeType')
      .lean(),
    SocialPostPerformance.find({ projectId, publishedAt: { $gte: since } })
      .sort({ publishedAt: -1 })
      .populate('socialAccountId', 'accountName platform status')
      .populate('publishJobId', 'platformUrl metricsStatus')
      .populate('draftId', 'title body channel')
      .populate('campaignId', 'name goal channel startDate endDate')
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

  const fallbackPosts = publishedJobs.map(postPerformanceRow);
  const canonicalPosts = canonicalPerformances.map(canonicalPostPerformanceRow);
  const canonicalIds = new Set(canonicalPosts.map((post) => post.id));
  const posts = [...canonicalPosts, ...fallbackPosts.filter((post) => !canonicalIds.has(post.id))]
    .sort((left, right) => new Date(right.publishedAt || 0) - new Date(left.publishedAt || 0));
  const platformRows = summarizePlatforms(posts);
  const campaignRows = summarizeCampaigns(posts);
  const contentTypeRows = summarizeContentTypes(posts);
  const totals = summarizePostMetrics(posts);
  totals.posts = posts.length;
  totals.measuredPosts = posts.filter((post) => post.availableFields.length).length;
  const growthBrain = await buildGrowthBrainSocialContext(projectId, { days: normalizedDays, limit: 12 });
  const dataHealth = socialDataHealth(accounts, posts);

  return {
    days: normalizedDays,
    since,
    generatedAt: new Date(),
    totals,
    platformRows,
    campaignRows,
    contentTypeRows,
    posts: [...posts].sort((left, right) => (
      Number(right.performanceScore ?? -1) - Number(left.performanceScore ?? -1)
      || new Date(right.publishedAt || 0) - new Date(left.publishedAt || 0)
    )),
    recentPosts: posts.slice(0, 50),
    accounts,
    reliability: reliabilitySummary(operationalJobs, accounts),
    dataHealth,
    growthBrain,
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

function signalMetrics(signal) {
  return publicMetrics(signal.evidence && (signal.evidence.latestMetrics || signal.evidence.metrics) || {});
}

function signalEngagementRate(signal) {
  const normalized = signal.evidence && signal.evidence.normalizedMetrics || [];
  return normalizedValue(normalized, 'socialEngagementRate')
    ?? metricNumber(signal.evidence && signal.evidence.engagementRate);
}

function visibleSignalContent(signal, projectId) {
  const sourceMatchesDestination = String(signal.sourceProjectId) === String(projectId);
  return {
    title: sourceMatchesDestination && signal.draftId && signal.draftId.title ? signal.draftId.title : '',
    contentExcerpt: sourceMatchesDestination ? safeDraftExcerpt(signal) : ''
  };
}

function signalContentPattern(row) {
  const text = `${row.title || ''} ${row.contentExcerpt || ''}`.trim();
  if (!text) return 'observed platform copy';
  if (/\?/.test(text)) return 'question-led copy';
  if (/\b(?:case study|proof|result|data|metric|percent|growth|increase|decrease|benchmark)\b|%/.test(text)) return 'proof-led angle';
  if (/\b(?:how to|guide|tips?|steps?|learn|why|what)\b/i.test(text)) return 'educational angle';
  if (/\b(?:book|demo|try|get started|download|visit|learn more|sign up|start)\b|https?:\/\//i.test(text)) return 'clear CTA';
  if (text.length <= 140) return 'short direct copy';
  if (text.length >= 420) return 'long-form copy';
  return 'general campaign copy';
}

function contentFirstLine(row) {
  const text = `${row.title || ''}\n${row.contentExcerpt || ''}`
    .split(/\n+/)
    .map((line) => line.trim())
    .find(Boolean);
  return text ? text.slice(0, 180) : '';
}

function hookClass(text) {
  const hook = String(text || '').trim();
  if (!hook) return 'unknown';
  if (/\?/.test(hook)) return 'question';
  if (/\b(?:\d+(?:\.\d+)?%|statistic|data|benchmark|research)\b/i.test(hook)) return 'statistic';
  if (/\b(?:mistake|wrong|stop|never|myth)\b/i.test(hook)) return 'mistake';
  if (/\b(?:vs\.?|versus|compare|comparison)\b/i.test(hook)) return 'comparison';
  if (/\b(?:how to|steps?|guide)\b/i.test(hook)) return 'how_to';
  if (/\b(?:I |we |when I|story|learned)\b/i.test(hook)) return 'story';
  if (/\b(?:problem|struggle|hard|challenge|cost)\b/i.test(hook)) return 'problem';
  if (/\b(?:will|can|unlock|increase|improve|grow|save)\b/i.test(hook)) return 'promise';
  if (/\b(?:today|now|limited|last chance|urgent)\b/i.test(hook)) return 'urgency';
  return 'statement';
}

function topicWords(row) {
  const text = `${row.title || ''} ${row.contentExcerpt || ''}`.toLowerCase();
  return (text.match(/[a-z][a-z0-9-]{3,}/g) || [])
    .map((word) => word.replace(/^-+|-+$/g, ''))
    .filter((word) => word.length >= 4 && !TOPIC_STOPWORDS.has(word))
    .slice(0, 24);
}

function topicClusters(row) {
  const text = `${row.title || ''} ${row.contentExcerpt || ''}`.toLowerCase();
  const taxonomy = [
    ['customer acquisition', /\b(?:customer acquisition|cac|acquire customers?|lead generation)\b/],
    ['cost efficiency', /\b(?:cost efficiency|reduce costs?|lower cost|roi|roas|budget efficiency)\b/],
    ['growth strategy', /\b(?:growth strategy|growth plan|scale|scaling|market growth)\b/],
    ['marketing attribution', /\b(?:attribution|utm|conversion path|revenue tracking)\b/],
    ['search performance', /\b(?:seo|search console|keyword|organic search|search demand)\b/],
    ['content strategy', /\b(?:content strategy|content plan|editorial|social content)\b/],
    ['conversion optimization', /\b(?:conversion|cro|landing page|cta|funnel)\b/],
    ['brand positioning', /\b(?:brand|positioning|messaging|value proposition)\b/]
  ];
  const matched = taxonomy.filter(([, expression]) => expression.test(text)).map(([topic]) => topic);
  return matched.length ? matched : topicWords(row).slice(0, 3);
}

function recommendationSignalRow(signal, projectId) {
  const metrics = signalMetrics(signal);
  const exposure = primaryExposure(metrics);
  const engagements = interactionTotal(metrics);
  const visibleContent = visibleSignalContent(signal, projectId);
  const publishedAt = signal.evidence && signal.evidence.publishedAt ? signal.evidence.publishedAt : signal.observedAt;
  return {
    platform: signal.platform,
    score: metricNumber(signal.score),
    observedAt: signal.observedAt,
    publishedAt,
    ...visibleContent,
    pattern: signalContentPattern(visibleContent),
    hook: contentFirstLine(visibleContent),
    hookType: hookClass(contentFirstLine(visibleContent)),
    topics: topicClusters(visibleContent),
    contentType: signal.evidence && signal.evidence.contentType ? signal.evidence.contentType : 'unknown',
    metrics,
    exposure: exposure.value,
    engagements,
    engagementRate: signalEngagementRate(signal),
    confidence: signal.evidence && signal.evidence.confidence || { score: 0.4, label: 'emerging', legacy: true },
    baselineComparison: signal.evidence && signal.evidence.baselineComparison || {},
    attribution: signal.evidence && signal.evidence.attribution || {},
    promoted: Boolean(signal.evidence && signal.evidence.promoted),
    recencyWeight: recencyWeight(signal.observedAt)
  };
}

function average(values) {
  return values.length ? values.reduce((total, value) => total + value, 0) / values.length : null;
}

function groupRows(rows, keyFn) {
  const grouped = new Map();
  rows.forEach((row) => {
    const key = keyFn(row);
    if (!key) return;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(row);
  });
  return grouped;
}

function summarizeRowGroup(rows) {
  const scores = rows.map((row) => metricNumber(row.score)).filter((value) => value !== null);
  const exposureValues = rows.map((row) => row.exposure).filter((value) => value !== null);
  const engagementValues = rows.map((row) => row.engagements).filter((value) => value !== null);
  const rateValues = rows.map((row) => row.engagementRate).filter((value) => value !== null);
  return {
    samples: rows.length,
    averageScore: scores.length ? Math.round(average(scores)) : null,
    medianScore: median(scores),
    bestScore: Math.max(...scores, 0),
    averageExposure: exposureValues.length ? Math.round(average(exposureValues)) : null,
    averageEngagements: engagementValues.length ? Math.round(average(engagementValues)) : null,
    averageEngagementRate: average(rateValues),
    medianExposure: median(exposureValues),
    medianEngagements: median(engagementValues),
    medianEngagementRate: median(rateValues)
  };
}

function zonedParts(date, timezone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone || 'UTC', weekday: 'long', hour: '2-digit', hourCycle: 'h23'
  }).formatToParts(date).reduce((result, part) => ({ ...result, [part.type]: part.value }), {});
  return { day: parts.weekday || 'Unknown', hour: Number(parts.hour || 0) };
}

function bestPostingTimesFromRows(rows, timezone = 'UTC') {
  const grouped = groupRows(rows, (row) => {
    const publishedAt = new Date(row.publishedAt || row.observedAt);
    if (Number.isNaN(publishedAt.getTime())) return '';
    const local = zonedParts(publishedAt, timezone);
    const startHour = Math.floor(local.hour / 3) * 3;
    return `${local.day}:${startHour}:${row.platform}`;
  });
  return [...grouped.entries()]
    .map(([key, groupRowsForTime]) => {
      const [day, hour, platform] = key.split(':');
      const hourValue = Number(hour);
      return {
        dayOfWeek: day,
        startHour: hourValue,
        label: `${day} ${String(hourValue).padStart(2, '0')}:00-${String(hourValue + 3).padStart(2, '0')}:00 ${timezone}`,
        platform,
        ...summarizeRowGroup(groupRowsForTime)
      };
    })
    .filter((row) => row.samples >= 3 && row.medianScore !== null)
    .sort((left, right) => (
      right.medianScore - left.medianScore
      || right.samples - left.samples
    ))
    .slice(0, 5);
}

function bestPlatformsFromRows(rows) {
  return [...groupRows(rows, (row) => row.platform).entries()]
    .map(([platform, platformRows]) => ({
      platform,
      ...summarizeRowGroup(platformRows)
    }))
    .sort((left, right) => (
      Number(right.medianScore ?? -1) - Number(left.medianScore ?? -1)
      || right.samples - left.samples
    ))
    .slice(0, 6);
}

function winningHooksFromRows(rows) {
  return [...groupRows(rows, (row) => `${row.platform}:${row.hookType}`).entries()]
    .map(([key, hookRows]) => {
      const [platform, type] = key.split(':');
      return { platform, type, hook: hookRows[0].hook, ...summarizeRowGroup(hookRows) };
    })
    .filter((row) => row.samples >= 3 && row.medianScore !== null)
    .sort((left, right) => right.medianScore - left.medianScore)
    .slice(0, 6);
}

function winningTopicsFromRows(rows) {
  const grouped = new Map();
  rows.forEach((row) => {
    row.topics.forEach((topic) => {
      const key = `${row.platform}:${topic}`;
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key).push(row);
    });
  });
  return [...grouped.entries()]
    .map(([key, topicRows]) => ({
      platform: key.slice(0, key.indexOf(':')),
      topic: key.slice(key.indexOf(':') + 1),
      ...summarizeRowGroup(topicRows)
    }))
    .filter((topic) => topic.samples >= 3 && topic.medianScore !== null)
    .sort((left, right) => (
      right.medianScore - left.medianScore
      || right.samples - left.samples
    ))
    .slice(0, 8);
}

function winningFormatsFromRows(rows) {
  return [...groupRows(rows, (row) => `${row.platform}:${row.contentType}:${row.pattern}`).entries()]
    .map(([key, formatRows]) => {
      const [platform, contentType, pattern] = key.split(':');
      return {
        platform,
        format: contentType === 'unknown' ? pattern : `${contentType} - ${pattern}`,
        contentType,
        pattern,
        platforms: [...new Set(formatRows.map((row) => row.platform))],
        ...summarizeRowGroup(formatRows)
      };
    })
    .filter((row) => row.samples >= 3 && row.medianScore !== null)
    .sort((left, right) => (
      right.medianScore - left.medianScore
      || right.samples - left.samples
    ))
    .slice(0, 6);
}

function lowPerformingWarningsFromRows(rows) {
  const measured = rows.filter((row) => row.score !== null);
  if (measured.length < 2) return [];
  const typicalScore = median(measured.map((row) => row.score));
  return measured
    .filter((row) => row.score <= Math.max(35, typicalScore - 12))
    .sort((left, right) => left.score - right.score)
    .slice(0, 5)
    .map((row) => ({
      platform: row.platform,
      title: row.title,
      pattern: row.pattern,
      contentType: row.contentType,
      score: row.score,
      warning: `Low-performing ${row.pattern} on ${row.platform}. Refresh the hook, offer, or creative before reusing this angle.`
    }));
}

function improvedDraftSuggestionsFromRows({ bestPlatforms, winningHooks, winningTopics, winningFormats, warnings, bestPostingTimes = [] }) {
  const suggestions = [];
  const bestPlatform = bestPlatforms[0];
  const bestHook = winningHooks.find((item) => item.platform === (bestPlatform && bestPlatform.platform));
  const bestTopic = winningTopics.find((item) => item.platform === (bestPlatform && bestPlatform.platform));
  const bestFormat = winningFormats.find((item) => item.platform === (bestPlatform && bestPlatform.platform));
  const bestPostingWindow = bestPostingTimes.find((item) => item.platform === (bestPlatform && bestPlatform.platform));

  if (bestPlatform && bestPlatform.samples >= 3) {
    suggestions.push({
      platform: bestPlatform.platform,
      direction: `Prioritize ${bestPlatform.platform} for the next campaign until another platform beats its average score.`,
      hookTemplate: bestHook ? `Open with a hook similar in structure to: "${bestHook.hook}"` : 'Open with a specific audience pain or outcome.',
      topic: bestTopic ? bestTopic.topic : '',
      format: bestFormat ? bestFormat.format : '',
      avoid: warnings[0] ? warnings[0].pattern : '',
      evidence: { comparablePosts: bestPlatform.samples, medianScore: bestPlatform.medianScore },
      confidence: bestPlatform.samples >= 10 ? 'strong' : 'emerging',
      test: { sampleTarget: 2, measurementWindow: '48h', successMetric: 'meaningfulEngagementRate' },
      postingWindow: bestPostingWindow ? bestPostingWindow.label : ''
    });
  }

  if (bestFormat && bestFormat.samples >= 3) {
    suggestions.push({
      platform: bestPlatform ? bestPlatform.platform : '',
      direction: `Reuse the ${bestFormat.format} format with a new proof point or customer-relevant angle.`,
      hookTemplate: bestHook ? `Adapt the winning hook without copying it: "${bestHook.hook}"` : 'Lead with the clearest observed value proposition.',
      topic: bestTopic ? bestTopic.topic : '',
      format: bestFormat.format,
      avoid: warnings[0] ? `Avoid repeating ${warnings[0].pattern} without a stronger hook.` : '',
      evidence: { comparablePosts: bestFormat.samples, medianScore: bestFormat.medianScore },
      confidence: bestFormat.samples >= 10 ? 'strong' : 'emerging',
      test: { sampleTarget: 2, measurementWindow: '48h', successMetric: 'meaningfulEngagementRate' }
    });
  }

  return suggestions.slice(0, 4);
}

function buildGrowthBrainUpgradeFromSignals(signals, projectId, { timezone = 'UTC' } = {}) {
  if (!signals.length) return EMPTY_GROWTH_BRAIN_UPGRADE;
  const rows = signals.map((signal) => recommendationSignalRow(signal, projectId));
  const whatWorked = rows
    .filter((row) => row.score !== null && row.confidence && row.confidence.label !== 'insufficient')
    .sort((left, right) => right.score - left.score)
    .slice(0, 6)
    .map((row) => ({
      platform: row.platform,
      title: row.title,
      pattern: row.pattern,
      contentType: row.contentType,
      score: row.score,
      reason: `${row.pattern} on ${row.platform} is associated with stronger lifecycle-adjusted performance in this window.`,
      metrics: row.metrics,
      engagementRate: row.engagementRate
    }));
  const bestPostingTimes = bestPostingTimesFromRows(rows, timezone);
  const bestPlatforms = bestPlatformsFromRows(rows);
  const winningHooks = winningHooksFromRows(rows);
  const winningTopics = winningTopicsFromRows(rows);
  const winningFormats = winningFormatsFromRows(rows);
  const lowPerformingWarnings = lowPerformingWarningsFromRows(rows);
  const improvedDraftSuggestions = improvedDraftSuggestionsFromRows({
    bestPlatforms,
    winningHooks,
    winningTopics,
    winningFormats,
    warnings: lowPerformingWarnings,
    bestPostingTimes
  });

  return {
    whatWorked,
    bestPostingTimes,
    bestPlatforms,
    winningHooks,
    winningTopics,
    winningFormats,
    lowPerformingWarnings,
    improvedDraftSuggestions
  };
}

function aggregatePatternRows(rows) {
  const grouped = new Map();
  rows.forEach((row) => {
    const key = `${row.platform}:${row.pattern}`;
    if (!grouped.has(key)) {
      grouped.set(key, {
        platform: row.platform,
        pattern: row.pattern,
        samples: 0,
        scores: [],
        bestScore: 0,
        engagementRates: [],
        confidenceScores: [],
        exposureTotal: 0,
        exposureSamples: 0,
        engagementTotal: 0,
        engagementSamples: 0,
        exampleTitle: '',
        observedAt: row.observedAt
      });
    }
    const group = grouped.get(key);
    group.samples += 1;
    if (row.score !== null) group.scores.push(row.score);
    group.bestScore = Math.max(group.bestScore, row.score || 0);
    if (row.engagementRate !== null) group.engagementRates.push(row.engagementRate);
    const confidenceScore = metricNumber(row.confidence && row.confidence.score);
    if (confidenceScore !== null) group.confidenceScores.push(confidenceScore);
    if (row.exposure !== null) {
      group.exposureTotal += row.exposure;
      group.exposureSamples += 1;
    }
    if (row.engagements !== null) {
      group.engagementTotal += row.engagements;
      group.engagementSamples += 1;
    }
    if (!group.exampleTitle && row.title) group.exampleTitle = row.title;
    if (!group.observedAt || new Date(row.observedAt) > new Date(group.observedAt)) group.observedAt = row.observedAt;
  });

  return [...grouped.values()].map((group) => {
    const medianScore = median(group.scores);
    const confidenceScore = median(group.confidenceScores);
    const consistency = group.scores.length
      ? group.scores.filter((score) => score >= 60).length / group.scores.length
      : 0;
    let status = 'insufficient';
    if (group.samples >= 3 && medianScore >= 60 && confidenceScore >= 0.35) status = 'emerging';
    if (group.samples >= 5 && medianScore >= 62 && consistency >= 0.6 && confidenceScore >= 0.5) status = 'moderate';
    if (group.samples >= 8 && medianScore >= 65 && consistency >= 0.65 && confidenceScore >= 0.65) status = 'strong';
    if (group.samples >= 12 && medianScore >= 70 && consistency >= 0.7 && confidenceScore >= 0.75) status = 'proven';
    return {
      platform: group.platform,
      pattern: group.pattern,
      samples: group.samples,
      averageScore: group.scores.length ? Math.round(average(group.scores)) : null,
      medianScore,
      bestScore: group.bestScore,
      averageEngagementRate: group.engagementRates.length ? average(group.engagementRates) : null,
      medianEngagementRate: median(group.engagementRates),
      confidenceScore,
      consistency,
      averageExposure: group.exposureSamples ? Math.round(group.exposureTotal / group.exposureSamples) : null,
      averageEngagements: group.engagementSamples ? Math.round(group.engagementTotal / group.engagementSamples) : null,
      exampleTitle: group.exampleTitle,
      observedAt: group.observedAt,
      status
    };
  });
}

function evidenceQuality(sampleSize, signals = []) {
  if (!sampleSize) {
    return {
      confidence: 'none',
      sampleSize,
      note: 'No engagement snapshots have been collected in this window.'
    };
  }
  const confidenceScores = signals.map((signal) => metricNumber(signal.evidence && signal.evidence.confidence && signal.evidence.confidence.score)).filter((value) => value !== null);
  const providerCoverage = signals.length
    ? average(signals.map((signal) => metricNumber(signal.evidence && signal.evidence.confidence && signal.evidence.confidence.providerCoverage)).filter((value) => value !== null))
    : null;
  const lifecycleCompleteness = signals.length
    ? average(signals.map((signal) => metricNumber(signal.evidence && signal.evidence.confidence && signal.evidence.confidence.lifecycleCompleteness)).filter((value) => value !== null))
    : null;
  if (sampleSize < 5 || median(confidenceScores) < 0.5) {
    return {
      confidence: 'early',
      sampleSize,
      score: median(confidenceScores),
      providerCoverage,
      lifecycleCompleteness,
      note: 'Use these signals directionally until more posts are measured.'
    };
  }
  if (sampleSize < 15) {
    return {
      confidence: 'medium',
      sampleSize,
      score: median(confidenceScores),
      providerCoverage,
      lifecycleCompleteness,
      note: 'Enough signals exist to guide the next campaign, but continue testing.'
    };
  }
  return {
    confidence: 'strong',
    sampleSize,
    score: median(confidenceScores),
    providerCoverage,
    lifecycleCompleteness,
    note: 'Signals are broad enough to shape recurring content recommendations.'
  };
}

function actionForBestPattern(pattern) {
  return {
    priority: 'high',
    action: `Create two more ${pattern.pattern} posts for ${pattern.platform}.`,
    rationale: `${pattern.samples} comparable posts have a median lifecycle-adjusted score of ${Math.round(pattern.medianScore)}. This is an association to test, not a causal claim.`,
    evidence: {
      platform: pattern.platform,
      pattern: pattern.pattern,
      samples: pattern.samples,
      medianScore: pattern.medianScore,
      status: pattern.status
    },
    confidence: pattern.status,
    successMetric: 'meaningfulEngagementRate',
    measurementWindow: '48h'
  };
}

function actionForWeakPattern(pattern) {
  return {
    priority: 'medium',
    action: `Rewrite or pause ${pattern.pattern} posts on ${pattern.platform}.`,
    rationale: `This pattern is underperforming with an average score of ${pattern.averageScore}. Test a sharper hook, clearer offer, or stronger creative before scaling it.`,
    evidence: {
      platform: pattern.platform,
      pattern: pattern.pattern,
      samples: pattern.samples,
      averageScore: pattern.averageScore
    }
  };
}

function buildRecommendationInputsFromSignals(signals, projectId) {
  if (!signals.length) return EMPTY_RECOMMENDATION_INPUTS;
  const rows = signals.map((signal) => recommendationSignalRow(signal, projectId));
  const groups = aggregatePatternRows(rows);
  const comparableRows = rows.filter((row) => row.score !== null);
  const averageScore = average(comparableRows.map((row) => row.score)) || 0;
  const bestContentPatterns = [...groups]
    .filter((group) => group.samples >= 3 && group.medianScore !== null)
    .sort((left, right) => (
      right.medianScore - left.medianScore
      || right.samples - left.samples
      || right.bestScore - left.bestScore
    ))
    .slice(0, 4);
  const bestKeys = new Set(bestContentPatterns.slice(0, 1).map((item) => `${item.platform}:${item.pattern}`));
  const weakContentPatterns = groups
    .filter((group) => !bestKeys.has(`${group.platform}:${group.pattern}`))
    .filter((group) => group.samples >= 3 && group.medianScore !== null)
    .filter((group) => group.medianScore <= Math.max(45, averageScore - 5))
    .sort((left, right) => (
      left.averageScore - right.averageScore
      || right.samples - left.samples
    ))
    .slice(0, 4);
  const suggestedNextActions = [
    ...bestContentPatterns.slice(0, 2).map(actionForBestPattern),
    ...weakContentPatterns.slice(0, 2).map(actionForWeakPattern)
  ];

  if (signals.length < 5) {
    suggestedNextActions.push({
      priority: 'medium',
      action: 'Collect at least five measured social posts before automating strong channel decisions.',
      rationale: 'The current sample is useful for direction, but still too small for confident pattern selection.',
      evidence: {
        samples: signals.length
      }
    });
  }

  return {
    evidenceQuality: evidenceQuality(signals.length, signals),
    bestContentPatterns,
    weakContentPatterns,
    suggestedNextActions: suggestedNextActions.slice(0, 5)
  };
}

async function buildGrowthBrainSocialContext(projectId, { days = 90, limit = 20 } = {}) {
  const normalizedDays = normalizeAnalyticsDays(days);
  const since = new Date(Date.now() - normalizedDays * 24 * 60 * 60 * 1000);
  const [signals, project] = await Promise.all([
    GrowthSignal.find({ projectId, observedAt: { $gte: since } })
    .sort({ score: -1, observedAt: -1 })
    .limit(Math.min(50, Math.max(1, limit)))
    .populate('draftId', 'title body channel')
    .lean(),
    Project.findById(projectId).select('timezone').lean()
  ]);

  const platformMap = new Map();
  signals.forEach((signal) => {
    if (!platformMap.has(signal.platform)) {
      platformMap.set(signal.platform, { platform: signal.platform, samples: 0, scores: [], bestScore: 0 });
    }
    const row = platformMap.get(signal.platform);
    row.samples += 1;
    const score = metricNumber(signal.score);
    if (score !== null) row.scores.push(score);
    row.bestScore = Math.max(row.bestScore, score || 0);
  });
  const platforms = [...platformMap.values()]
    .map((row) => ({ ...row, averageScore: row.scores.length ? Math.round(average(row.scores)) : null, medianScore: median(row.scores) }))
    .sort((left, right) => Number(right.medianScore ?? -1) - Number(left.medianScore ?? -1));

  return {
    source: 'Canonical social post performance derived from provider observations',
    asOf: signals.length ? signals[0].observedAt : null,
    windowDays: normalizedDays,
    sampleSize: signals.length,
    measurementNote: 'Metrics vary by provider and app permissions. Treat only supplied fields as observed evidence.',
    platforms,
    recommendationInputs: buildRecommendationInputsFromSignals(signals, projectId),
    growthBrainUpgrade: buildGrowthBrainUpgradeFromSignals(signals, projectId, { timezone: project && project.timezone || 'UTC' }),
    strongestObservedPosts: signals.slice(0, 8).map((signal) => ({
      platform: signal.platform,
      score: signal.score,
      observedAt: signal.observedAt,
      ...visibleSignalContent(signal, projectId),
      metrics: signalMetrics(signal),
      engagementRate: signalEngagementRate(signal)
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
    dataHealth: dashboard.dataHealth,
    platforms: dashboard.platformRows,
    campaigns: dashboard.campaignRows || [],
    contentTypes: dashboard.contentTypeRows || [],
    growthBrain: dashboard.growthBrain || {
      source: 'Moyi Content Distribution Engine engagement snapshots',
      asOf: null,
      windowDays: dashboard.days,
      sampleSize: 0,
      measurementNote: 'Metrics vary by provider and app permissions. Treat only supplied fields as observed evidence.',
      platforms: [],
      recommendationInputs: EMPTY_RECOMMENDATION_INPUTS,
      growthBrainUpgrade: EMPTY_GROWTH_BRAIN_UPGRADE,
      strongestObservedPosts: []
    },
    posts: dashboard.recentPosts.map((post) => ({
      id: post.id,
      platform: post.platform,
      accountName: post.accountName,
      title: post.title,
      publishedAt: post.publishedAt,
      platformUrl: post.platformUrl,
      metricsStatus: post.metricsStatus,
      metricsCapturedAt: post.metricsCapturedAt,
      availableFields: post.availableFields,
      campaignId: post.campaignId,
      campaignName: post.campaignName,
      contentType: post.contentType,
      metrics: post.metrics,
      exposureField: post.exposureField,
      exposure: post.exposure,
      engagements: post.engagements,
      engagementRate: post.engagementRate,
      meaningfulEngagements: post.meaningfulEngagements,
      clicks: post.clicks,
      ctr: post.ctr,
      performanceScore: post.performanceScore,
      scoreStatus: post.scoreStatus,
      confidence: post.confidence,
      lifecycle: post.lifecycle,
      velocity: post.velocity,
      baselineComparison: post.baselineComparison,
      attribution: post.attribution,
      anomalies: post.anomalies,
      promoted: post.promoted
    }))
  };
}

module.exports = {
  buildGrowthBrainUpgradeFromSignals,
  buildRecommendationInputsFromSignals,
  buildGrowthBrainSocialContext,
  buildSocialPerformanceDashboard,
  classifyContentType,
  destinationProjectFilter,
  normalizeAnalyticsDays,
  postPerformanceRow,
  socialPerformanceApiPayload,
  summarizeCampaigns,
  summarizeContentTypes,
  summarizePlatforms,
  canonicalPostPerformanceRow,
  clickTotal,
  meaningfulEngagementTotal,
  socialDataHealth
};
