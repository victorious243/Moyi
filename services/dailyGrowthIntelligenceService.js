/**
 * Moyi Daily Growth Intelligence Engine Service
 *
 * Implements the full CMO analytics standard:
 * Data -> Insight -> Diagnosis -> Recommendation -> Action -> Measurement -> Learning
 *
 * 1. Normalized Multi-Platform Data Collection (LinkedIn, FB, IG, X, TikTok, YouTube, Threads, Bluesky)
 * 2. Daily Historical Snapshots & Multi-Window Comparisons (Yesterday, 7D vs 7D, 30D vs 30D)
 * 3. Objective-Based Platform Performance Analysis (Reach, Engagement, Traffic, Leads, Conversions, Revenue)
 * 4. Deep Content Intelligence & Pattern Detection (Formats, Topics, CTAs, Timing, Multipliers)
 * 5. Daily Diagnosis Engine (Observation -> Evidence -> Root Cause -> Impact -> Action)
 * 6. Proactive Opportunity Detection (Viral Breakouts, High-Converting Topics, Repurposing Arbitrage)
 * 7. Problem / Risk Detection (Reach decline, CTR contraction, audience fatigue)
 * 8. 6-Dimensional Growth Score Breakdown (Audience, Content, Engagement, Traffic, Conversion, Brand Visibility)
 * 9. Closed-Loop Website Attribution with Auto-UTM Tagging
 * 10. Adaptive Daily Growth Brief Reporting (Normal, Opportunity, Performance Alert, Milestone)
 * 11. Human-Governed Action Execution ('Moyi proposes. Humans decide.')
 */

const DailySocialSnapshot = require('../models/DailySocialSnapshot');
const DailyGrowthIntelligence = require('../models/DailyGrowthIntelligence');
const PublishJob = require('../models/PublishJob');
const SocialAccount = require('../models/SocialAccount');
const SocialDraft = require('../models/SocialDraft');
const ContentDraft = require('../models/ContentDraft');
const MediaAsset = require('../models/MediaAsset');
const Campaign = require('../models/Campaign');
const TrackingEvent = require('../models/TrackingEvent');
const Project = require('../models/Project');
const EngagementSnapshot = require('../models/EngagementSnapshot');
const SocialPostPerformance = require('../models/SocialPostPerformance');
const ConversionGoal = require('../models/ConversionGoal');
const { assessDailyDataQuality } = require('./analytics/dataQualityService');
const { freshnessFor, isVerifiedMetric, metricValue } = require('./analytics/metricStatus');
const { median, normalizeMetricFamilies, normalizedValue } = require('./socialPerformanceMath');

const SUPPORTED_PLATFORMS = DailySocialSnapshot.SUPPORTED_PLATFORMS;

function normalizeDate(inputDate) {
  const d = inputDate ? new Date(inputDate) : new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

function daysAgo(days, baseDate = new Date()) {
  const d = new Date(baseDate);
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() - days);
  return d;
}

function timeZoneParts(inputDate, timezone = 'UTC') {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone || 'UTC',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23'
  });
  const parts = Object.fromEntries(formatter.formatToParts(new Date(inputDate))
    .filter((part) => part.type !== 'literal')
    .map((part) => [part.type, Number(part.value)]));
  return parts;
}

function projectLocalDateKey(inputDate = new Date(), timezone = 'UTC') {
  try {
    const parts = timeZoneParts(inputDate, timezone);
    return new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
  } catch (error) {
    return normalizeDate(inputDate);
  }
}

function utcForProjectLocalMidnight(dateKey, timezone = 'UTC') {
  const localKey = normalizeDate(dateKey);
  const localClockAsUtc = Date.UTC(localKey.getUTCFullYear(), localKey.getUTCMonth(), localKey.getUTCDate());
  let candidate = new Date(localClockAsUtc);
  try {
    // Iterate because the offset can change near daylight-saving boundaries.
    for (let iteration = 0; iteration < 3; iteration += 1) {
      const parts = timeZoneParts(candidate, timezone);
      const representedLocalClock = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
      candidate = new Date(candidate.getTime() + (localClockAsUtc - representedLocalClock));
    }
    return candidate;
  } catch (error) {
    return localKey;
  }
}

function projectReportingContext(inputDate = new Date(), timezone = 'UTC') {
  const reportDate = projectLocalDateKey(inputDate, timezone);
  const reportingDate = daysAgo(1, reportDate);
  const nextReportingDate = daysAgo(-1, reportingDate);
  return {
    reportDate,
    reportingDate,
    reportingWindow: {
      start: utcForProjectLocalMidnight(reportingDate, timezone),
      end: utcForProjectLocalMidnight(nextReportingDate, timezone)
    }
  };
}

function safeNumber(val, defaultVal = 0) {
  const num = Number(val);
  return Number.isFinite(num) ? num : defaultVal;
}

function nullableNumber(val) {
  return metricValue(val);
}

function verifiedState(value, source, observedAt, extras = {}) {
  const normalized = nullableNumber(value);
  return {
    value: normalized,
    status: normalized === null ? 'pending' : 'verified',
    source,
    observedAt: observedAt || null,
    fetchedAt: extras.fetchedAt || observedAt || null,
    freshness: freshnessFor(observedAt),
    sampleSize: extras.sampleSize || 0,
    availableSamples: extras.availableSamples || 0,
    expectedSamples: extras.expectedSamples || 0,
    providerMetric: extras.providerMetric || '',
    syncRunIds: extras.syncRunIds || []
  };
}

function metricState(snapshot, metric) {
  const states = snapshot && snapshot.metricStates ? snapshot.metricStates : {};
  const state = states instanceof Map ? states.get(metric) : states[metric];
  if (state && state.status) return state;
  const value = snapshot ? nullableNumber(snapshot[metric]) : null;
  // Legacy positive values can be used as evidence. Legacy zeros have no provenance.
  return value !== null && value > 0
    ? { value, status: 'verified', freshness: 'unknown', source: 'legacy_snapshot' }
    : { value: null, status: 'pending', freshness: 'unknown', source: 'legacy_snapshot' };
}

function calculateDelta(current, previous) {
  const curr = safeNumber(current, 0);
  const prev = safeNumber(previous, 0);
  const diff = curr - prev;
  const percent = prev > 0 ? ((curr - prev) / prev) * 100 : (curr > 0 ? 100 : 0);
  return {
    rawCurrent: curr,
    rawPrevious: prev,
    diff,
    percentage: Math.round(percent * 10) / 10,
    direction: diff > 0 ? 'up' : (diff < 0 ? 'down' : 'flat')
  };
}

function verifiedMetricNames(data = {}) {
  const metricMap = {
    impressions: 'impressions',
    reach: 'reach',
    engagements: 'engagements',
    likes: 'likes',
    comments: 'comments',
    shares: 'shares',
    linkClicks: 'link clicks',
    videoViews: 'video views',
    referralSessions: 'tracked referral sessions',
    leadsGenerated: 'tracked leads',
    conversions: 'tracked conversions',
    attributedRevenue: 'attributed revenue',
    followersGained: 'follower growth'
  };

  const states = data.metricStates || {};
  return Object.entries(metricMap)
    .filter(([key]) => {
      const state = states[key];
      if (state && state.status === 'verified') return nullableNumber(state.value) !== null;
      return nullableNumber(data[key]) !== null && nullableNumber(data[key]) > 0;
    })
    .map(([, label]) => label);
}

function hasVerifiedGrowthData(data = {}) {
  return verifiedMetricNames(data).length > 0;
}

/**
 * Generate standard first-party tracking UTM link for social publishing
 */
function generateSocialUtmLink({ baseUrl = '', platform = 'social', campaignName = 'organic', postId = '', contentId = '', contentTitle = '' }) {
  const cleanBase = String(baseUrl || '').split('?')[0];
  const url = cleanBase || 'https://moyi-cmo.com';
  const cleanCampaign = String(campaignName || 'general').toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const cleanContent = postId || String(contentTitle || 'post').toLowerCase().slice(0, 30).replace(/[^a-z0-9]+/g, '-');
  
  const params = new URLSearchParams({
    utm_source: platform,
    utm_medium: 'social',
    utm_campaign: cleanCampaign,
    utm_content: cleanContent
  });
  if (postId) params.set('moyi_post_id', String(postId));
  if (contentId) params.set('moyi_content_id', String(contentId));
  return `${url}?${params.toString()}`;
}

/**
 * Categorize post content format
 */
function detectContentFormat(job = {}) {
  const media = Array.isArray(job.mediaIds) ? job.mediaIds : [];
  if (media.length > 1) return 'carousel';
  const mimeTypes = media.map((m) => String((m && m.mimeType) || '').toLowerCase());
  if (mimeTypes.some((t) => t.startsWith('video/')) || job.platform === 'tiktok' || job.platform === 'youtube') {
    return 'video';
  }
  if (mimeTypes.some((t) => t.startsWith('image/')) || (job.content && job.content.imageUrl)) {
    return 'image';
  }
  return 'text';
}

/**
 * Categorize post topic / angle
 */
function detectContentCategory(text = '') {
  const t = String(text || '').toLowerCase();
  if (/founder|built|journey|lesson|mistake|story|started|hustle/i.test(t)) return 'founder_story';
  if (/tutorial|how to|step by step|guide|checklist|framework|breakdown/i.test(t)) return 'tutorial';
  if (/product|feature|update|released|launched|new in|announcing|v2|upgrade/i.test(t)) return 'product_update';
  if (/case study|results|client|revenue|growth|metric|case|proof/i.test(t)) return 'case_study';
  if (/trend|seo|algorithm|google|industry|market|insight|data|report/i.test(t)) return 'industry_insight';
  if (/discount|offer|deal|pricing|buy|start trial|coupon|sale/i.test(t)) return 'promotional';
  return 'thought_leadership';
}

/**
 * 1. Synchronize or create daily social snapshots for a project
 */
async function syncDailySnapshotsForProject(projectId, targetDate = new Date(), options = {}) {
  const date = normalizeDate(targetDate);
  const nextDate = new Date(date.getTime() + 24 * 60 * 60 * 1000);
  const windowStart = options.windowStart || date;
  const windowEnd = options.windowEnd || nextDate;

  // Find all connected social accounts for the project
  const accounts = await SocialAccount.find({
    $or: [{ projectId }, { sharedWithProjectIds: projectId }],
    revokedAt: null
  });

  // Query published jobs in this date range
  const jobs = await PublishJob.find({
    $or: [{ projectId }, { destinationProjectId: projectId }],
    status: 'published',
    publishedAt: { $gte: windowStart, $lt: windowEnd }
  }).lean();

  const jobIds = jobs.map((job) => job._id);
  const [engagementSnapshots, trackingEvents, conversionGoals] = await Promise.all([
    jobIds.length
      ? EngagementSnapshot.find({ projectId, publishJobId: { $in: jobIds } }).sort({ capturedAt: -1 }).lean()
      : [],
    TrackingEvent.find({ projectId, createdAt: { $gte: windowStart, $lt: windowEnd } }).lean(),
    ConversionGoal.find({ projectId }).lean()
  ]);
  const latestByJob = new Map();
  engagementSnapshots.forEach((snapshot) => {
    const key = String(snapshot.publishJobId);
    if (!latestByJob.has(key)) latestByJob.set(key, snapshot);
  });
  const revenueConfigured = conversionGoals.some((goal) => ['purchase', 'revenue'].includes(goal.funnelStage));

  const platformMap = new Map();
  SUPPORTED_PLATFORMS.forEach((p) => {
    platformMap.set(p, {
      projectId,
      platform: p,
      date,
      followers: null,
      followersGained: null,
      followersLost: null,
      profileVisits: null,
      impressions: null,
      reach: null,
      engagements: null,
      engagementRate: null,
      likes: null,
      comments: null,
      shares: null,
      saves: null,
      reposts: null,
      linkClicks: null,
      videoViews: null,
      videoCompletionRate: null,
      watchTimeSeconds: null,
      postsPublished: 0,
      publishJobIds: [],
      metricStates: {},
      dataStatus: 'not_connected',
      source: `${p}_api`,
      freshness: 'unknown',
      syncRunIds: [],
      websiteTraffic: {
        referralSessions: null,
        uniqueVisitors: null,
        leadsGenerated: null,
        conversions: null,
        attributedRevenue: null,
        measurementStatus: 'pending',
        revenueConfigured
      },
      rawProviderData: {}
    });
  });

  const metricBuckets = new Map();
  const addMetric = (platform, metric, value, snapshot, providerMetric = metric) => {
    const normalized = nullableNumber(value);
    if (normalized === null) return;
    const key = `${platform}:${metric}`;
    const bucket = metricBuckets.get(key) || { total: 0, samples: 0, expected: 0, observedAt: null, syncRunIds: [] };
    bucket.total += normalized;
    bucket.samples += 1;
    if (!bucket.observedAt || new Date(snapshot.capturedAt) > new Date(bucket.observedAt)) bucket.observedAt = snapshot.capturedAt;
    if (snapshot.syncRunId) bucket.syncRunIds.push(snapshot.syncRunId);
    bucket.providerMetric = providerMetric;
    metricBuckets.set(key, bucket);
  };

  for (const job of jobs) {
    const p = job.platform;
    if (!platformMap.has(p)) continue;
    const entry = platformMap.get(p);
    entry.postsPublished += 1;
    entry.publishJobIds.push(job._id);
    const snapshot = latestByJob.get(String(job._id));
    if (!snapshot) continue;
    const metrics = snapshot.metrics || {};
    const available = new Set(snapshot.availableFields || []);
    const exposureField = available.has('impressions') ? 'impressions' : (available.has('views') ? 'views' : null);
    if (exposureField) addMetric(p, 'impressions', metrics[exposureField], snapshot, exposureField);
    if (available.has('reach')) addMetric(p, 'reach', metrics.reach, snapshot);
    if (available.has('likes')) addMetric(p, 'likes', metrics.likes, snapshot);
    if (available.has('comments')) addMetric(p, 'comments', metrics.comments, snapshot);
    if (available.has('shares')) addMetric(p, 'shares', metrics.shares, snapshot);
    if (available.has('quotes')) addMetric(p, 'reposts', metrics.quotes, snapshot, 'quotes');
    if (available.has('saves')) addMetric(p, 'saves', metrics.saves, snapshot);
    if (available.has('clicks')) addMetric(p, 'linkClicks', metrics.clicks, snapshot, 'clicks');
    if (available.has('videoViews')) addMetric(p, 'videoViews', metrics.videoViews, snapshot);
    if (available.has('watchTimeMs')) addMetric(p, 'watchTimeSeconds', Number(metrics.watchTimeMs) / 1000, snapshot, 'watchTimeMs');
  }

  for (const [platform, entry] of platformMap.entries()) {
    const platformJobs = jobs.filter((job) => job.platform === platform).length;
    const metrics = ['impressions', 'reach', 'likes', 'comments', 'shares', 'saves', 'reposts', 'linkClicks', 'videoViews', 'watchTimeSeconds'];
    metrics.forEach((metric) => {
      const bucket = metricBuckets.get(`${platform}:${metric}`);
      if (!bucket) {
        entry.metricStates[metric] = { value: null, status: platformJobs ? 'pending' : 'not_applicable', source: `${platform}_api`, freshness: 'unknown', expectedSamples: platformJobs };
        return;
      }
      entry[metric] = bucket.total;
      entry.metricStates[metric] = verifiedState(bucket.total, `${platform}_api`, bucket.observedAt, {
        sampleSize: bucket.samples,
        availableSamples: bucket.samples,
        expectedSamples: platformJobs,
        providerMetric: bucket.providerMetric,
        syncRunIds: [...new Set(bucket.syncRunIds)]
      });
      entry.syncRunIds.push(...bucket.syncRunIds);
      if (!entry.lastObservedAt || new Date(bucket.observedAt) > new Date(entry.lastObservedAt)) entry.lastObservedAt = bucket.observedAt;
    });
    const interactionMetrics = ['likes', 'comments', 'shares', 'saves', 'reposts', 'linkClicks']
      .filter((metric) => entry.metricStates[metric] && entry.metricStates[metric].status === 'verified');
    if (interactionMetrics.length) {
      entry.engagements = interactionMetrics.reduce((sum, metric) => sum + entry[metric], 0);
      entry.metricStates.engagements = verifiedState(entry.engagements, `${platform}_api`, entry.lastObservedAt, { sampleSize: interactionMetrics.length });
    }
    if (entry.engagements !== null && entry.impressions !== null && entry.impressions > 0) {
      entry.engagementRate = (entry.engagements / entry.impressions) * 100;
      entry.metricStates.engagementRate = verifiedState(entry.engagementRate, 'moyi_normalized', entry.lastObservedAt, { sampleSize: entry.postsPublished });
    } else {
      entry.metricStates.engagementRate = { value: null, status: 'not_applicable', source: 'moyi_normalized', freshness: entry.freshness };
    }
    const verifiedCount = Object.values(entry.metricStates).filter((state) => state.status === 'verified').length;
    const account = accounts.find((item) => item.platform === platform);
    entry.dataStatus = verifiedCount ? 'verified' : (account ? (account.metricsStatus === 'unsupported' ? 'unsupported' : account.metricsStatus === 'error' ? 'provider_error' : 'pending') : 'not_connected');
    entry.lastFetchedAt = entry.lastObservedAt;
    entry.freshness = freshnessFor(entry.lastObservedAt);
    entry.syncRunIds = [...new Set(entry.syncRunIds)];
  }

  // Aggregate website referral traffic & conversions
  const attributedSessions = new Map();
  const attributedVisitors = new Map();
  const latestTrackingEventAt = new Map();
  const platformForSource = (input) => {
    const source = String(input || '').toLowerCase();
    if (source.includes('linkedin')) return 'linkedin';
    if (source.includes('twitter') || source.includes('t.co') || source.includes('x.com')) return 'x';
    if (source.includes('facebook') || source.includes('fb')) return 'facebook';
    if (source.includes('instagram')) return 'instagram';
    if (source.includes('threads')) return 'threads';
    if (source.includes('tiktok')) return 'tiktok';
    if (source.includes('youtube') || source.includes('youtu.be')) return 'youtube';
    if (source.includes('bsky') || source.includes('bluesky')) return 'bluesky';
    return null;
  };
  for (const event of trackingEvents) {
    const src = String(event.utmSource || event.referrer || '').toLowerCase();
    const matchedPlatform = platformForSource(src);

    if (matchedPlatform && platformMap.has(matchedPlatform)) {
      const entry = platformMap.get(matchedPlatform);
      if (!attributedSessions.has(matchedPlatform)) attributedSessions.set(matchedPlatform, new Set());
      if (!attributedVisitors.has(matchedPlatform)) attributedVisitors.set(matchedPlatform, new Set());
      if (event.sessionId) attributedSessions.get(matchedPlatform).add(event.sessionId);
      if (event.visitorId) attributedVisitors.get(matchedPlatform).add(event.visitorId);
      latestTrackingEventAt.set(matchedPlatform, event.createdAt);
      if (entry.websiteTraffic.leadsGenerated === null) entry.websiteTraffic.leadsGenerated = 0;
      if (entry.websiteTraffic.conversions === null) entry.websiteTraffic.conversions = 0;
      if (revenueConfigured && entry.websiteTraffic.attributedRevenue === null) entry.websiteTraffic.attributedRevenue = 0;
      if (['lead', 'qualified_lead', 'signup'].includes(event.funnelStage)) entry.websiteTraffic.leadsGenerated += 1;
      if (event.eventType === 'conversion' || ['purchase', 'revenue'].includes(event.funnelStage)) entry.websiteTraffic.conversions += 1;
      if (revenueConfigured && event.funnelStage === 'revenue') entry.websiteTraffic.attributedRevenue += safeNumber(event.eventValue, 0);
      entry.websiteTraffic.measurementStatus = 'verified';
    }
  }
  attributedSessions.forEach((sessions, platform) => {
    const entry = platformMap.get(platform);
    entry.websiteTraffic.referralSessions = sessions.size;
    entry.websiteTraffic.uniqueVisitors = (attributedVisitors.get(platform) || new Set()).size;
    const observedAt = latestTrackingEventAt.get(platform);
    entry.metricStates.referralSessions = verifiedState(entry.websiteTraffic.referralSessions, 'moyi_tracker', observedAt);
    entry.metricStates.uniqueVisitors = verifiedState(entry.websiteTraffic.uniqueVisitors, 'moyi_tracker', observedAt);
    entry.metricStates.leadsGenerated = verifiedState(entry.websiteTraffic.leadsGenerated, 'moyi_tracker', observedAt);
    entry.metricStates.conversions = verifiedState(entry.websiteTraffic.conversions, 'moyi_tracker', observedAt);
    entry.metricStates.attributedRevenue = revenueConfigured
      ? verifiedState(entry.websiteTraffic.attributedRevenue, 'moyi_tracker', observedAt)
      : { value: null, status: 'not_connected', source: 'moyi_tracker', freshness: 'unknown' };
  });

  // Upsert daily snapshots
  const snapshots = [];
  for (const [, entry] of platformMap.entries()) {
    const matchingAccount = accounts.find((a) => a.platform === entry.platform);
    if (matchingAccount) {
      entry.accountId = matchingAccount._id;
      const followerCount = nullableNumber(matchingAccount.metadata && matchingAccount.metadata.followersCount);
      if (followerCount !== null) {
        entry.followers = followerCount;
        entry.metricStates.followers = verifiedState(followerCount, `${entry.platform}_api`, matchingAccount.lastMetricsSyncAt);
      }
    }

    const doc = await DailySocialSnapshot.findOneAndUpdate(
      { projectId, platform: entry.platform, date },
      { $set: entry },
      { upsert: true, returnDocument: 'after' }
    );
    snapshots.push(doc);
  }

  return snapshots;
}

/**
 * 2. Multi-Window Historical Comparisons
 */
async function calculateWindowComparisons(projectId, targetDate = new Date()) {
  const yesterday = normalizeDate(daysAgo(1, targetDate));
  const prevDay = normalizeDate(daysAgo(2, targetDate));
  const recent7dStart = normalizeDate(daysAgo(7, targetDate));
  const prev7dStart = normalizeDate(daysAgo(14, targetDate));
  const recent30dStart = normalizeDate(daysAgo(30, targetDate));
  const prev30dStart = normalizeDate(daysAgo(60, targetDate));
  const scoringBaselineStart = normalizeDate(daysAgo(8, targetDate));
  const targetDay = normalizeDate(targetDate);

  const [
    yesterdaySnaps,
    prevDaySnaps,
    recent7dSnaps,
    prev7dSnaps,
    recent30dSnaps,
    prev30dSnaps,
    scoringBaselineSnaps
  ] = await Promise.all([
    DailySocialSnapshot.find({ projectId, date: yesterday }),
    DailySocialSnapshot.find({ projectId, date: prevDay }),
    DailySocialSnapshot.find({ projectId, date: { $gte: recent7dStart, $lt: targetDay } }),
    DailySocialSnapshot.find({ projectId, date: { $gte: prev7dStart, $lt: recent7dStart } }),
    DailySocialSnapshot.find({ projectId, date: { $gte: recent30dStart, $lt: targetDay } }),
    DailySocialSnapshot.find({ projectId, date: { $gte: prev30dStart, $lt: recent30dStart } }),
    DailySocialSnapshot.find({ projectId, date: { $gte: scoringBaselineStart, $lt: yesterday } })
  ]);

  function aggregate(snapshots, { requireFresh = false } = {}) {
    const totals = {
      postsPublished: snapshots.reduce((sum, snapshot) => sum + Number(snapshot.postsPublished || 0), 0),
      metricStates: {},
      dailyAverage: {},
      daysObserved: 0
    };
    const observedDates = new Set(snapshots.filter((snapshot) => snapshot.dataStatus === 'verified').map((snapshot) => normalizeDate(snapshot.date).toISOString()));
    totals.daysObserved = observedDates.size;
    const socialMetrics = ['impressions', 'reach', 'engagements', 'likes', 'comments', 'shares', 'linkClicks', 'videoViews', 'followersGained'];
    socialMetrics.forEach((metric) => {
      const eligible = snapshots.map((snapshot) => ({ snapshot, state: metricState(snapshot, metric) }))
        .filter(({ state }) => state.status === 'verified' && (!requireFresh || state.freshness !== 'stale') && nullableNumber(state.value) !== null);
      totals[metric] = eligible.length ? eligible.reduce((sum, item) => sum + Number(item.state.value), 0) : null;
      totals.metricStates[metric] = {
        value: totals[metric],
        status: eligible.length ? 'verified' : 'pending',
        source: 'daily_social_snapshot',
        sampleSize: eligible.length
      };
      const days = new Set(eligible.map(({ snapshot }) => normalizeDate(snapshot.date).toISOString())).size;
      totals.dailyAverage[metric] = days ? totals[metric] / days : null;
    });
    const websiteMetrics = ['referralSessions', 'leadsGenerated', 'conversions', 'attributedRevenue'];
    websiteMetrics.forEach((metric) => {
      const eligible = snapshots.filter((snapshot) => snapshot.websiteTraffic
        && snapshot.websiteTraffic.measurementStatus === 'verified'
        && nullableNumber(snapshot.websiteTraffic[metric]) !== null
        && (metric !== 'attributedRevenue' || snapshot.websiteTraffic.revenueConfigured));
      totals[metric] = eligible.length ? eligible.reduce((sum, snapshot) => sum + Number(snapshot.websiteTraffic[metric]), 0) : null;
      totals.metricStates[metric] = {
        value: totals[metric],
        status: eligible.length ? 'verified' : 'pending',
        source: 'moyi_tracker',
        sampleSize: eligible.length
      };
      const days = new Set(eligible.map((snapshot) => normalizeDate(snapshot.date).toISOString())).size;
      totals.dailyAverage[metric] = days ? totals[metric] / days : null;
    });
    totals.engagementRate = totals.impressions !== null && totals.engagements !== null && totals.impressions > 0
      ? (totals.engagements / totals.impressions) * 100
      : null;
    totals.metricStates.engagementRate = {
      value: totals.engagementRate,
      status: totals.engagementRate === null ? 'not_applicable' : 'verified',
      source: 'moyi_normalized',
      sampleSize: totals.metricStates.impressions.sampleSize
    };
    totals.dailyAverage.engagementRate = totals.engagementRate;
    return totals;
  }

  function compareTotals(currTotals, prevTotals) {
    const deltas = {};
    const improved = [];
    const declined = [];

    Object.keys(currTotals).filter((key) => key !== 'metricStates').forEach((k) => {
      const currentState = currTotals.metricStates[k];
      const previousState = prevTotals.metricStates[k];
      if (!currentState || !previousState || currentState.status !== 'verified' || previousState.status !== 'verified') {
        deltas[k] = { rawCurrent: currTotals[k], rawPrevious: prevTotals[k], diff: null, percentage: null, direction: 'unknown', status: 'insufficient_data' };
        return;
      }
      const delta = { ...calculateDelta(currTotals[k], prevTotals[k]), status: 'verified' };
      deltas[k] = delta;
      if (delta.diff > 0 && ['impressions', 'reach', 'engagements', 'engagementRate', 'referralSessions', 'leadsGenerated', 'conversions', 'attributedRevenue'].includes(k)) {
        improved.push({ metric: k, delta });
      } else if (delta.diff < 0 && ['impressions', 'reach', 'engagements', 'engagementRate', 'referralSessions', 'leadsGenerated', 'conversions'].includes(k)) {
        declined.push({ metric: k, delta });
      }
    });

    return { current: currTotals, previous: prevTotals, deltas, improved, declined };
  }

  const yTotals = aggregate(yesterdaySnaps, { requireFresh: true });
  const pTotals = aggregate(prevDaySnaps);
  const r7Totals = aggregate(recent7dSnaps);
  const p7Totals = aggregate(prev7dSnaps);
  const r30Totals = aggregate(recent30dSnaps);
  const p30Totals = aggregate(prev30dSnaps);
  const scoringBaselineTotals = aggregate(scoringBaselineSnaps);
  const scoringBaseline = {
    ...scoringBaselineTotals,
    ...scoringBaselineTotals.dailyAverage,
    metricStates: Object.fromEntries(Object.entries(scoringBaselineTotals.metricStates).map(([metric, state]) => [metric, {
      ...state,
      value: scoringBaselineTotals.dailyAverage[metric]
    }]))
  };

  return {
    yesterdayVsPrev: compareTotals(yTotals, pTotals),
    last7dVsPrev7d: compareTotals(r7Totals, p7Totals),
    last30dVsPrev30d: compareTotals(r30Totals, p30Totals),
    scoringBaseline
  };
}

/**
 * 3. Multi-Objective Platform Champions
 */
function analyzePlatformChampions(snapshots = []) {
  const platformAgg = new Map();

  const eligibleSocial = (snapshot, metric) => {
    const state = metricState(snapshot, metric);
    return state.status === 'verified' && state.freshness !== 'stale' && nullableNumber(state.value) !== null;
  };
  const eligibleWebsite = (snapshot, metric) => {
    if (!snapshot.websiteTraffic) return false;
    if (metric === 'attributedRevenue' && snapshot.websiteTraffic.revenueConfigured === false) return false;
    if (snapshot.websiteTraffic.measurementStatus === 'verified') return nullableNumber(snapshot.websiteTraffic[metric]) !== null;
    return nullableNumber(snapshot.websiteTraffic[metric]) !== null && Number(snapshot.websiteTraffic[metric]) > 0;
  };

  snapshots.forEach((s) => {
    const p = s.platform;
    const item = platformAgg.get(p) || {
      platform: p,
      metrics: {},
      samples: {},
      postsPublished: 0
    };
    item.postsPublished += Number(s.postsPublished || 0);
    ['impressions', 'reach', 'engagements', 'followersGained'].forEach((metric) => {
      if (!eligibleSocial(s, metric)) return;
      item.metrics[metric] = Number(item.metrics[metric] || 0) + Number(metricState(s, metric).value);
      item.samples[metric] = Number(item.samples[metric] || 0) + 1;
    });
    const websiteMap = { referralSessions: 'referralSessions', leads: 'leadsGenerated', conversions: 'conversions', revenue: 'attributedRevenue' };
    Object.entries(websiteMap).forEach(([target, source]) => {
      if (!eligibleWebsite(s, source)) return;
      item.metrics[target] = Number(item.metrics[target] || 0) + Number(s.websiteTraffic[source]);
      item.samples[target] = Number(item.samples[target] || 0) + 1;
    });
    platformAgg.set(p, item);
  });

  const list = Array.from(platformAgg.values()).map((item) => {
    const impressions = item.metrics.impressions;
    const engagements = item.metrics.engagements;
    return {
      platform: item.platform,
      ...item.metrics,
      samples: item.samples,
      postsPublished: item.postsPublished,
      engagementRate: impressions !== undefined && engagements !== undefined && impressions > 0
        ? (engagements / impressions) * 100
        : null
    };
  });

  const totalImpressions = list.filter((item) => item.impressions !== undefined).reduce((sum, i) => sum + i.impressions, 0);
  const noWinner = (metric, rationale) => ({
    platform: '',
    noData: true,
    value: null,
    sharePercentage: null,
    rate: null,
    netGained: null,
    sessions: null,
    leads: null,
    conversions: null,
    revenue: null,
    metric,
    coverage: { eligible: 0, compared: list.length },
    rationale
  });
  const topBy = (metric) => list
    .filter((item) => nullableNumber(item[metric]) !== null && item[metric] > 0)
    .sort((a, b) => Number(b[metric]) - Number(a[metric]))[0] || null;

  const reachWinner = topBy('impressions');
  const engagementWinner = list.slice()
    .filter((i) => i.impressions > 0 && i.engagements > 0 && i.engagementRate !== null)
    .sort((a, b) => b.engagementRate - a.engagementRate)[0]
    || topBy('engagements');
  const growthWinner = topBy('followersGained');
  const trafficWinner = topBy('referralSessions');
  const leadWinner = topBy('leads');
  const convWinner = topBy('conversions');
  const revenueWinner = topBy('revenue');

  const reachShare = reachWinner && totalImpressions > 0 ? Math.round((reachWinner.impressions / totalImpressions) * 100) : 0;
  const coverageFor = (metric) => ({
    eligible: list.filter((item) => nullableNumber(item[metric]) !== null).length,
    compared: list.length
  });
  const rationaleSuffix = (metric) => {
    const coverage = coverageFor(metric);
    return ` Highest verified result across ${coverage.eligible} of ${coverage.compared} measured channel${coverage.compared === 1 ? '' : 's'}.`;
  };

  return {
    bestForReach: reachWinner ? {
      platform: reachWinner.platform,
      noData: false,
      value: reachWinner.impressions,
      sharePercentage: reachShare,
      coverage: coverageFor('impressions'),
      rationale: `${capitalize(reachWinner.platform)} generated ${reachShare}% of verified social exposure with ${reachWinner.impressions.toLocaleString()} impressions.${rationaleSuffix('impressions')}`
    } : noWinner('impressions', 'No verified impression metrics have been collected yet, so Moyi is not naming a reach winner.'),
    bestForEngagement: engagementWinner ? {
      platform: engagementWinner.platform,
      noData: false,
      value: engagementWinner.engagements,
      rate: engagementWinner.engagementRate === null ? null : Math.round(engagementWinner.engagementRate * 10) / 10,
      coverage: coverageFor('engagements'),
      rationale: engagementWinner.engagementRate === null
        ? `${capitalize(engagementWinner.platform)} recorded the highest verified interaction total (${engagementWinner.engagements}), but exposure is unavailable so no engagement rate can be calculated.${rationaleSuffix('engagements')}`
        : `${capitalize(engagementWinner.platform)} recorded the strongest verified audience response (${Math.round(engagementWinner.engagementRate * 10) / 10}% engagement rate).${rationaleSuffix('engagements')}`
    } : noWinner('engagements', 'No verified engagement counters have been collected yet, so Moyi is not naming an engagement winner.'),
    bestForFollowerGrowth: growthWinner ? {
      platform: growthWinner.platform,
      noData: false,
      netGained: growthWinner.followersGained,
      coverage: coverageFor('followersGained'),
      rationale: `${capitalize(growthWinner.platform)} led verified community expansion with +${growthWinner.followersGained} followers.${rationaleSuffix('followersGained')}`
    } : noWinner('followersGained', 'No verified follower-growth metrics have been collected yet.'),
    bestForWebsiteTraffic: trafficWinner ? {
      platform: trafficWinner.platform,
      noData: false,
      sessions: trafficWinner.referralSessions,
      coverage: coverageFor('referralSessions'),
      rationale: `${capitalize(trafficWinner.platform)} delivered the highest verified inbound traffic with ${trafficWinner.referralSessions} referral visits.${rationaleSuffix('referralSessions')}`
    } : noWinner('referralSessions', 'No tracked social referral sessions were recorded yet, so Moyi is not naming a traffic winner.'),
    bestForLeads: leadWinner ? {
      platform: leadWinner.platform,
      noData: false,
      leads: leadWinner.leads,
      coverage: coverageFor('leads'),
      rationale: `${capitalize(leadWinner.platform)} drove the highest verified lead volume (${leadWinner.leads}).${rationaleSuffix('leads')}`
    } : noWinner('leads', 'No tracked social leads were recorded yet.'),
    bestForConversions: convWinner ? {
      platform: convWinner.platform,
      noData: false,
      conversions: convWinner.conversions,
      coverage: coverageFor('conversions'),
      rationale: `${capitalize(convWinner.platform)} produced the highest verified conversions (${convWinner.conversions}).${rationaleSuffix('conversions')}`
    } : noWinner('conversions', 'No tracked social conversions were recorded yet.'),
    bestForRevenue: revenueWinner ? {
      platform: revenueWinner.platform,
      noData: false,
      revenue: revenueWinner.revenue,
      coverage: coverageFor('revenue'),
      rationale: `${capitalize(revenueWinner.platform)} accounted for the highest verified attributed revenue (${revenueWinner.revenue.toLocaleString()}).${rationaleSuffix('revenue')}`
    } : noWinner('revenue', 'No verified attributed revenue is available. Revenue may be unconfigured, awaiting attribution, or a verified zero; no champion is assigned.')
  };
}

function capitalize(s = '') {
  return String(s).charAt(0).toUpperCase() + String(s).slice(1);
}

function contentIntelligenceMetrics(performance, snapshot, platform) {
  let normalized = performance && performance.latestNormalizedMetrics;
  let source = 'canonical';
  if (!normalized || !normalized.length) {
    const metrics = (snapshot && snapshot.metrics) || {};
    let metricStates = (snapshot && snapshot.metricStates) || [];
    if (!metricStates.length && snapshot) {
      const available = new Set(snapshot.availableFields || Object.keys(metrics));
      const knownMetrics = [
        'impressions', 'reach', 'views', 'videoViews', 'likes', 'reactions',
        'comments', 'shares', 'reposts', 'quotes', 'saves', 'clicks',
        'linkClicks', 'profileClicks', 'watchTimeMs'
      ];
      metricStates = knownMetrics.map((metric) => ({
        metric,
        status: available.has(metric) && nullableNumber(metrics[metric]) !== null ? 'verified' : 'unsupported'
      }));
    }
    normalized = normalizeMetricFamilies({ metrics, metricStates, platform });
    source = 'snapshot_fallback';
  }
  return {
    impressions: normalizedValue(normalized, 'exposure'),
    engagements: normalizedValue(normalized, 'socialEngagement'),
    meaningfulEngagement: normalizedValue(normalized, 'meaningfulEngagement'),
    websiteClicks: normalizedValue(normalized, 'trafficIntent'),
    engagementRate: normalizedValue(normalized, 'socialEngagementRate'),
    source
  };
}

/**
 * 4. Deep Content Intelligence & Pattern Detection
 */
async function analyzeContentIntelligence(projectId, windowDays = 30) {
  const startDate = daysAgo(windowDays);

  const jobs = await PublishJob.find({
    $or: [{ projectId }, { destinationProjectId: projectId }],
    status: 'published',
    publishedAt: { $gte: startDate }
  })
    .populate('draftId')
    .sort({ publishedAt: -1 })
    .lean();

  if (!jobs.length) {
    return {
      topPerformingPosts: [],
      worstPerformingPosts: [],
      contentTypeBreakdown: [],
      detectedPatterns: [],
      optimalTiming: []
    };
  }

  const jobIds = jobs.map((job) => job._id);
  const [performances, engagementSnapshots, project] = await Promise.all([
    SocialPostPerformance.find({ projectId, publishJobId: { $in: jobIds } }).lean(),
    EngagementSnapshot.find({ projectId, publishJobId: { $in: jobIds } }).sort({ capturedAt: -1 }).lean(),
    Project.findById(projectId).select('timezone').lean()
  ]);
  const performanceByJob = new Map(performances.map((performance) => [String(performance.publishJobId), performance]));
  const latestByJob = new Map();
  engagementSnapshots.forEach((snapshot) => {
    const key = String(snapshot.publishJobId);
    if (!latestByJob.has(key)) latestByJob.set(key, snapshot);
  });

  // Canonical performance owns post-level intelligence. Raw snapshots are retained
  // only as a compatibility fallback until historical rows have been backfilled.
  const posts = jobs.map((job) => {
    const performance = performanceByJob.get(String(job._id));
    const snapshot = latestByJob.get(String(job._id));
    if (!performance && !snapshot) return null;
    const measured = contentIntelligenceMetrics(performance, snapshot, job.platform);
    const impressions = measured.impressions;
    const engagementTotal = measured.engagements;
    const meaningfulEngagement = measured.meaningfulEngagement;
    const clicks = measured.websiteClicks;
    const normalizedRate = measured.engagementRate;
    if (impressions === null && engagementTotal === null && clicks === null) return null;
    const engagementRate = normalizedRate === null ? null : normalizedRate * 100;
    const format = detectContentFormat(job);
    const textBody = (job.draftId && job.draftId.body) || (job.content && job.content.body) || '';
    const category = detectContentCategory(textBody);
    const title = (job.draftId && job.draftId.title) || textBody.slice(0, 70) || `${job.platform} post`;

    return {
      postId: String(job._id),
      platform: job.platform,
      contentType: format,
      category,
      title,
      bodyExcerpt: textBody.slice(0, 160),
      publishedAt: job.publishedAt || job.createdAt,
      impressions,
      engagements: engagementTotal,
      meaningfulEngagement,
      engagementRate: engagementRate === null ? null : Math.round(engagementRate * 10) / 10,
      websiteClicks: clicks,
      performanceScore: performance && performance.performanceScore !== null ? performance.performanceScore : null,
      scoreStatus: performance ? performance.scoreStatus : 'unavailable',
      confidence: performance && performance.confidence ? performance.confidence : { score: 0, label: 'insufficient' },
      measurementSource: measured.source
    };
  }).filter(Boolean);

  if (!posts.length) {
    return {
      topPerformingPosts: [],
      worstPerformingPosts: [],
      contentTypeBreakdown: [],
      detectedPatterns: [],
      optimalTiming: [],
      measurementStatus: 'insufficient_data'
    };
  }

  // Medians resist single-post spikes and are the baseline used by Social Performance.
  const engagementPosts = posts.filter((post) => post.engagements !== null);
  const medianEngagements = median(engagementPosts.map((post) => post.engagements));

  // Top & Underperforming posts
  const topPosts = posts
    .slice()
    .filter((post) => post.performanceScore !== null || post.engagements !== null)
    .sort((a, b) => {
      if (a.performanceScore !== null || b.performanceScore !== null) {
        return (b.performanceScore ?? -1) - (a.performanceScore ?? -1);
      }
      return (b.engagements ?? -1) - (a.engagements ?? -1);
    })
    .slice(0, 4)
    .map((p) => ({
      ...p,
      whyItWon: p.scoreStatus === 'comparable' && p.performanceScore !== null
        ? `Ranked at ${p.performanceScore}/100 against comparable ${capitalize(p.platform)} posts. The score reflects measured performance, not a causal claim.`
        : (medianEngagements !== null && medianEngagements > 0 && p.engagements > medianEngagements * 1.5
          ? `Generated ${(p.engagements / medianEngagements).toFixed(1)}x the measured post median. The data identifies performance, not a causal reason.`
          : 'This post ranked among the highest measured results in the selected window; more comparable samples are needed.')
    }));

  const worstPosts = posts
    .slice()
    .filter((p) => p.impressions > 0 && p.engagementRate !== null)
    .sort((a, b) => a.engagementRate - b.engagementRate)
    .slice(0, 3)
    .map((p) => ({
      ...p,
      frictionPoint: p.engagementRate < 0.8
        ? 'Observed engagement rate was low. Hook quality is a hypothesis to test, not an established cause.'
        : 'Measured below the comparable post median; investigate content and distribution differences.'
    }));

  // Format Breakdown
  const formatMap = new Map();
  posts.forEach((p) => {
    const f = `${p.platform}:${p.contentType}`;
    const item = formatMap.get(f) || {
      contentType: f,
      platform: p.platform,
      format: p.contentType,
      postCount: 0,
      totalImp: 0,
      totalEng: 0,
      totalClicks: 0,
      impressionSamples: 0,
      engagementSamples: 0,
      clickSamples: 0
    };
    item.postCount += 1;
    if (p.impressions !== null) {
      item.totalImp += p.impressions;
      item.impressionSamples += 1;
    }
    if (p.engagements !== null) {
      item.totalEng += p.engagements;
      item.engagementSamples += 1;
    }
    if (p.websiteClicks !== null) {
      item.totalClicks += p.websiteClicks;
      item.clickSamples += 1;
    }
    formatMap.set(f, item);
  });

  const contentTypeBreakdown = Array.from(formatMap.values()).map((item) => {
    const matching = posts.filter((post) => post.platform === item.platform && post.contentType === item.format);
    const avgImp = median(matching.map((post) => post.impressions));
    const avgEng = median(matching.map((post) => post.engagements));
    const avgClicks = median(matching.map((post) => post.websiteClicks));
    const avgRate = median(matching.map((post) => post.engagementRate));
    const multiplier = medianEngagements > 0 && avgEng !== null ? Math.round((avgEng / medianEngagements) * 10) / 10 : null;
    return {
      contentType: item.format,
      platform: item.platform,
      postCount: item.postCount,
      avgImpressions: avgImp,
      avgEngagements: avgEng,
      avgEngagementRate: avgRate === null ? null : Math.round(avgRate * 10) / 10,
      avgWebsiteClicks: avgClicks,
      impressionSamples: item.impressionSamples,
      engagementSamples: item.engagementSamples,
      clickSamples: item.clickSamples,
      performanceMultiplier: multiplier
    };
  });

  // Pattern Detection with Minimum Sample Thresholds (>= 3 posts)
  const categoryMap = new Map();
  posts.forEach((p) => {
    const c = `${p.platform}:${p.category}`;
    const item = categoryMap.get(c) || { category: p.category, platform: p.platform, postCount: 0, engagements: [], clicks: [], engagementSamples: 0, clickSamples: 0 };
    item.postCount += 1;
    if (p.engagements !== null) {
      item.engagements.push(p.engagements);
      item.engagementSamples += 1;
    }
    if (p.websiteClicks !== null) {
      item.clicks.push(p.websiteClicks);
      item.clickSamples += 1;
    }
    categoryMap.set(c, item);
  });

  const detectedPatterns = [];
  for (const [, item] of categoryMap.entries()) {
    const platformBaseline = median(posts.filter((post) => post.platform === item.platform).map((post) => post.engagements));
    if (item.engagementSamples >= 3 && platformBaseline > 0) {
      const avgCatEng = median(item.engagements);
      const multiplier = Math.round((avgCatEng / platformBaseline) * 10) / 10;
      if (multiplier >= 1.5) {
        detectedPatterns.push({
          patternName: `${capitalize(item.platform)} ${capitalize(item.category.replace('_', ' '))} Content Advantage`,
          observation: `${capitalize(item.category.replace('_', ' '))} posts on ${capitalize(item.platform)} outperform that platform's median engagement by ${multiplier}x.`,
          evidence: `Sample of ${item.engagementSamples} measured posts had ${Math.round(avgCatEng)} median engagements vs ${Math.round(platformBaseline)} for comparable ${capitalize(item.platform)} posts.`,
          confidence: item.engagementSamples >= 7 ? 'high' : (item.engagementSamples >= 5 ? 'medium' : 'early_signal'),
          signalStatus: item.engagementSamples >= 5 ? 'proven_pattern' : 'emerging_signal',
          sampleSize: item.engagementSamples,
          multiplier,
          recommendation: `Increase ${item.category.replace('_', ' ')} post frequency in your weekly content calendar.`
        });
      }
    }
  }

  // Format Pattern Advantage
  contentTypeBreakdown.forEach((item) => {
    if (item.engagementSamples >= 3 && item.performanceMultiplier !== null && item.performanceMultiplier >= 1.4) {
      detectedPatterns.push({
        patternName: `${capitalize(item.platform)} ${capitalize(item.contentType)} Format Multiplier`,
        observation: `${capitalize(item.contentType)} posts on ${capitalize(item.platform)} generate ${item.performanceMultiplier}x higher audience engagement than that platform's median.`,
        evidence: item.avgEngagementRate === null
          ? `Analyzed ${item.engagementSamples} ${item.contentType} assets with verified engagement totals; exposure was unavailable for a rate calculation.`
          : `Analyzed ${item.engagementSamples} ${item.contentType} assets yielding ${item.avgEngagementRate}% average engagement rate.`,
        confidence: item.engagementSamples >= 7 ? 'high' : (item.engagementSamples >= 5 ? 'medium' : 'early_signal'),
        signalStatus: item.engagementSamples >= 5 ? 'proven_pattern' : 'emerging_signal',
        sampleSize: item.engagementSamples,
        multiplier: item.performanceMultiplier,
        recommendation: `Prioritize ${item.contentType} flyers and assets when publishing high-priority announcements.`
      });
    }
  });

  // Optimal Timing Heatmap
  const timingMap = new Map();
  const timezone = (project && project.timezone) || 'UTC';
  posts.forEach((p) => {
    const d = new Date(p.publishedAt);
    const local = timeZoneParts(d, timezone);
    const localClock = new Date(Date.UTC(local.year, local.month - 1, local.day));
    const day = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][localClock.getUTCDay()];
    const hour = local.hour;
    const hourWindow = hour < 12 ? `08:00 - 12:00 ${timezone}` : (hour < 17 ? `12:00 - 17:00 ${timezone}` : `17:00 - 21:00 ${timezone}`);
    const key = `${p.platform}_${day}_${hourWindow}`;
    const item = timingMap.get(key) || { platform: p.platform, bestDay: day, bestHourWindow: hourWindow, count: 0, totalEng: 0, engagementSamples: 0 };
    item.count += 1;
    if (p.engagements !== null) {
      item.totalEng += p.engagements;
      item.engagementSamples += 1;
    }
    timingMap.set(key, item);
  });

  const optimalTiming = Array.from(timingMap.values())
    .filter((t) => t.engagementSamples >= 3)
    .map((t) => ({
      platform: t.platform,
      bestDay: t.bestDay,
      bestHourWindow: t.bestHourWindow,
      performanceMultiplier: (() => {
        const platformMedian = median(posts.filter((post) => post.platform === t.platform).map((post) => post.engagements));
        return platformMedian > 0 ? Math.round(((t.totalEng / t.engagementSamples) / platformMedian) * 10) / 10 : null;
      })(),
      sampleSize: t.engagementSamples
    }))
    .filter((item) => item.performanceMultiplier !== null)
    .sort((a, b) => b.performanceMultiplier - a.performanceMultiplier)
    .slice(0, 3);

  return {
    topPerformingPosts: topPosts,
    worstPerformingPosts: worstPosts,
    contentTypeBreakdown,
    detectedPatterns,
    optimalTiming
  };
}

/**
 * 5. Daily Diagnosis Engine
 */
function runDailyDiagnosisEngine(windowComparisons = {}, platformChampions = {}, contentIntel = {}) {
  const diagnoses = [];
  const yDelta = windowComparisons.yesterdayVsPrev ? windowComparisons.yesterdayVsPrev.deltas : {};

  // Diagnosis 1: Reach / Exposure Movement
  if (yDelta.impressions && yDelta.impressions.status !== 'insufficient_data' && Math.abs(yDelta.impressions.percentage) >= 15) {
    const isUp = yDelta.impressions.diff > 0;
    const topPost = (contentIntel.topPerformingPosts && contentIntel.topPerformingPosts[0]) || null;
    diagnoses.push({
      id: 'diag-reach-movement',
      observation: `Overall social impressions ${isUp ? 'surged' : 'contracted'} by ${Math.abs(yDelta.impressions.percentage)}% yesterday (${yDelta.impressions.rawCurrent.toLocaleString()} vs ${yDelta.impressions.rawPrevious.toLocaleString()}).`,
      evidence: topPost && topPost.impressions !== null
        ? `Top asset "${topPost.title.slice(0, 45)}..." drove ${topPost.impressions.toLocaleString()} impressions on ${capitalize(topPost.platform)}.`
        : `Total impressions reached ${yDelta.impressions.rawCurrent.toLocaleString()}.`,
      likelyExplanation: isUp
        ? 'The top measured asset is a plausible contributor. Provider metrics cannot establish the platform algorithm as the cause.'
        : 'Publishing cadence, topic fit, and distribution are hypotheses to investigate; this comparison alone does not establish causality.',
      confidence: topPost && topPost.impressions !== null ? 'medium' : 'low',
      businessImpact: 'reach',
      recommendedAction: isUp
        ? 'Test a related follow-up post within 24 hours and compare its verified reach with the project baseline.'
        : 'Test a different post angle and compare its verified reach with the project baseline.',
      priority: isUp ? 'high' : 'medium',
      evidenceIds: topPost ? [`publish_job:${topPost.postId}`] : ['comparison:impressions:yesterday'],
      evidenceObjects: [{ metric: 'impressions', current: yDelta.impressions.rawCurrent, baseline: yDelta.impressions.rawPrevious, changePercentage: yDelta.impressions.percentage, source: 'verified_daily_snapshots' }]
    });
  }

  // Diagnosis 2: Website Traffic & Conversion Contribution
  if (yDelta.referralSessions && yDelta.referralSessions.status !== 'insufficient_data') {
    const sessions = yDelta.referralSessions.rawCurrent;
    const bestTraffic = platformChampions.bestForWebsiteTraffic || {};
    if (sessions > 0) {
      diagnoses.push({
        id: 'diag-traffic-contribution',
        observation: `Social channels contributed ${sessions} direct referral visits to your website yesterday.`,
        evidence: bestTraffic.platform
          ? `${capitalize(bestTraffic.platform)} was the highest verified traffic source with ${bestTraffic.sessions} referral sessions.`
          : `${sessions} unique tracked social sessions were observed.`,
        likelyExplanation: 'First-party UTM attribution confirms the sessions originated from measured social links; downstream intent still requires conversion evidence.',
        confidence: 'high',
        businessImpact: 'traffic',
        recommendedAction: 'Verify landing page conversion funnel and ensure retargeting / email capture modal is active.',
        priority: 'high',
        evidenceIds: ['tracking:referral_sessions:yesterday'],
        evidenceObjects: [{ metric: 'referralSessions', current: sessions, source: 'moyi_tracker' }]
      });
    } else if (yDelta.impressions && yDelta.impressions.status !== 'insufficient_data' && yDelta.impressions.rawCurrent > 300) {
      diagnoses.push({
        id: 'diag-conversion-gap',
        observation: 'High social exposure resulted in minimal direct website click-throughs.',
        evidence: `Generated ${yDelta.impressions.rawCurrent.toLocaleString()} impressions but 0 recorded website referral sessions.`,
        likelyExplanation: 'Posts focused on top-of-funnel exposure without a compelling next step to visit the website.',
        confidence: 'medium',
        businessImpact: 'conversions',
        recommendedAction: 'Attach a specific free resource (e.g. Free SEO Quick Scan or PDF Guide) in the first comment or post CTA.',
        priority: 'critical',
        evidenceIds: ['comparison:impressions:yesterday', 'tracking:referral_sessions:yesterday'],
        evidenceObjects: [
          { metric: 'impressions', current: yDelta.impressions.rawCurrent, source: 'verified_daily_snapshots' },
          { metric: 'referralSessions', current: 0, source: 'moyi_tracker', status: 'verified' }
        ]
      });
    }
  }

  // Diagnosis 3: Format & Angle Dominance
  const pattern = (contentIntel.detectedPatterns && contentIntel.detectedPatterns[0]) || null;
  if (pattern) {
    diagnoses.push({
      id: 'diag-content-pattern',
      observation: pattern.observation,
      evidence: pattern.evidence,
      likelyExplanation: 'The observed pattern may reflect topic or format fit. A controlled follow-up sample is needed before treating it as causal.',
      confidence: pattern.confidence,
      businessImpact: 'brand_equity',
      recommendedAction: pattern.recommendation,
      priority: pattern.signalStatus === 'proven_pattern' ? 'high' : 'medium',
      evidenceIds: [`content_pattern:${pattern.patternName}`],
      evidenceObjects: [{ metric: 'engagements', sampleSize: pattern.sampleSize, multiplier: pattern.multiplier, source: 'engagement_snapshots', signalStatus: pattern.signalStatus }]
    });
  }

  return diagnoses;
}

/**
 * 6. Proactive Opportunity Detection
 */
function detectGrowthOpportunities(contentIntel = {}) {
  const opportunities = [];

  // Opportunity 1: Viral Breakout Repurposing
  const topPost = (contentIntel.topPerformingPosts && contentIntel.topPerformingPosts[0]) || null;
  if (topPost && topPost.engagements >= 50) {
    const measuredSignals = [topPost.impressions, topPost.engagementRate, topPost.websiteClicks]
      .filter((value) => nullableNumber(value) !== null).length;
    const exposureEvidence = topPost.impressions === null
      ? 'Exposure was not supplied by the provider.'
      : `Generated ${topPost.impressions.toLocaleString()} impressions.`;
    const rateText = topPost.engagementRate === null ? '' : ` (${topPost.engagementRate}% rate)`;
    opportunities.push({
      id: 'opp-viral-repurpose',
      type: 'viral_breakout',
      title: `High-Velocity Asset on ${capitalize(topPost.platform)}: Repurpose across channels`,
      description: `Your ${topPost.contentType} post "${topPost.title.slice(0, 50)}..." generated ${topPost.engagements} verified engagements${rateText}. Test repurposing it into a long-form article or thread for a secondary channel.`,
      evidence: `${exposureEvidence} Recorded ${topPost.engagements} verified interactions.`,
      evidenceIds: [`publish_job:${topPost.postId}`],
      confidence: Math.min(80, 50 + (measuredSignals * 10)),
      hypothesis: 'Repurposing a measured high-response asset may transfer its message fit to another format or channel.',
      expectedOutcome: 'Produce a comparable post that exceeds the project median engagement rate.',
      measurement: { metric: 'engagementRate', reviewAfter: '7d', minimumComparablePosts: 3 },
      actionType: 'repurpose_post',
      actionPayload: { sourcePostId: topPost.postId, platform: topPost.platform, title: topPost.title },
      priority: 'critical',
      status: 'pending'
    });
  }

  // Opportunity 2: High-Converting Topic Expansion
  const patterns = contentIntel.detectedPatterns || [];
  const winningPattern = patterns.find((p) => p.multiplier >= 1.5 && p.sampleSize >= 3);
  if (winningPattern) {
    opportunities.push({
      id: 'opp-topic-expansion',
      type: 'high_converting_topic',
      title: `Test the observed topic signal: ${winningPattern.patternName}`,
      description: `${winningPattern.patternName} showed ${winningPattern.multiplier}x the measured baseline response in a sample of ${winningPattern.sampleSize} posts. Run a controlled follow-up before increasing its share of the calendar.`,
      evidence: winningPattern.evidence,
      evidenceIds: [`content_pattern:${winningPattern.patternName}`],
      confidence: winningPattern.confidence === 'high' ? 90 : (winningPattern.confidence === 'medium' ? 75 : 55),
      hypothesis: `${winningPattern.patternName} will continue to outperform the project content baseline in a controlled follow-up sample.`,
      expectedOutcome: 'Increase median engagement while preserving referral or conversion quality.',
      measurement: { metric: 'engagementRate', reviewAfter: '14d', minimumComparablePosts: 3 },
      actionType: 'create_article',
      actionPayload: { pattern: winningPattern.patternName, recommendation: winningPattern.recommendation },
      priority: 'high',
      status: 'pending'
    });
  }

  // Opportunity 3: Optimal Timing Execution
  const timing = (contentIntel.optimalTiming && contentIntel.optimalTiming[0]) || null;
  if (timing) {
    opportunities.push({
      id: 'opp-optimal-timing',
      type: 'optimal_timing',
      title: `Schedule Tomorrow's Post in Peak Window (${timing.bestDay} ${timing.bestHourWindow})`,
      description: `Publishing on ${capitalize(timing.platform)} during ${timing.bestHourWindow} yields ${timing.performanceMultiplier}x higher average engagement.`,
      evidence: `Validated across ${timing.sampleSize} historical posts.`,
      evidenceIds: [`timing:${timing.platform}:${timing.bestDay}:${timing.bestHourWindow}`],
      confidence: timing.sampleSize >= 6 ? 80 : 60,
      hypothesis: 'The observed time window may contribute to stronger distribution for comparable posts.',
      expectedOutcome: 'Improve median engagement rate for the next comparable posting sample.',
      measurement: { metric: 'engagementRate', reviewAfter: '14d', minimumComparablePosts: 3 },
      actionType: 'schedule_slot',
      actionPayload: { platform: timing.platform, window: timing.bestHourWindow },
      priority: 'medium',
      status: 'pending'
    });
  }

  return opportunities;
}

/**
 * 7. Problem / Risk Detection Engine
 */
function detectRisksAndProblems(windowComparisons = {}) {
  const risks = [];
  const w7Delta = windowComparisons.last7dVsPrev7d ? windowComparisons.last7dVsPrev7d.deltas : {};
  const yDelta = windowComparisons.yesterdayVsPrev ? windowComparisons.yesterdayVsPrev.deltas : {};

  // Risk 1: Sustained Reach Contraction
  if (w7Delta.impressions && w7Delta.impressions.percentage <= -20) {
    risks.push({
      id: 'risk-sustained-reach-drop',
      title: `Sustained Reach Contraction (${Math.abs(w7Delta.impressions.percentage)}% over last 7 days)`,
      primarySignal: `7-day impressions fell from ${w7Delta.impressions.rawPrevious.toLocaleString()} to ${w7Delta.impressions.rawCurrent.toLocaleString()}.`,
      impact: 'Decreased top-of-funnel brand visibility and follower velocity.',
      severity: 'critical',
      recommendation: 'Audit recent post hooks, increase publishing frequency, and test carousel or video formats.'
    });
  }

  // Risk 2: High Impression to Zero Click Friction
  if (yDelta.impressions && yDelta.impressions.rawCurrent > 500 && yDelta.linkClicks && yDelta.linkClicks.rawCurrent === 0) {
    risks.push({
      id: 'risk-click-friction',
      title: 'High Exposure with Zero Link Click-Throughs',
      primarySignal: `${yDelta.impressions.rawCurrent.toLocaleString()} impressions yielded 0 link clicks.`,
      impact: 'Social audience is consuming content passively without converting into website traffic.',
      severity: 'warning',
      recommendation: 'Add an explicit value-first call to action (e.g. Free Scan / Case Study download) in the first comment or closing hook.'
    });
  }

  return risks;
}

/**
 * 8. Configurable 6-Dimensional Growth Score Calculation
 */
function calculateGrowthScoreBreakdown(yData = {}, prevData = {}, options = {}) {
  const observedMetrics = verifiedMetricNames(yData);
  const dataQuality = options.dataQuality || {};
  const currentValue = (metric) => {
    const state = yData.metricStates && yData.metricStates[metric];
    if (state) return state.status === 'verified' ? nullableNumber(state.value) : null;
    const value = nullableNumber(yData[metric]);
    return value !== null && value > 0 ? value : null;
  };
  const baselineValue = (metric) => {
    const state = prevData.metricStates && prevData.metricStates[metric];
    if (state) return state.status === 'verified' ? nullableNumber(state.value) : null;
    const value = nullableNumber(prevData[metric]);
    return value !== null && value > 0 ? value : null;
  };
  const scoreAgainstBaseline = (current, baseline) => {
    if (current === null || baseline === null) return null;
    if (current === 0 && baseline === 0) return 50;
    if (baseline === 0) return current > 0 ? 75 : 50;
    const ratio = Math.max(0.0625, Math.min(16, current / baseline));
    return Math.round(Math.max(0, Math.min(100, 50 + 25 * Math.log2(ratio))));
  };
  const compositeValue = (data, primary, fallback) => {
    const state = data.metricStates && data.metricStates[primary];
    const value = state && state.status === 'verified' ? nullableNumber(state.value) : nullableNumber(data[primary]);
    if (value !== null && (state || value > 0)) return value;
    const fallbackState = data.metricStates && data.metricStates[fallback];
    const fallbackValue = fallbackState && fallbackState.status === 'verified' ? nullableNumber(fallbackState.value) : nullableNumber(data[fallback]);
    return fallbackValue !== null && (fallbackState || fallbackValue > 0) ? fallbackValue : null;
  };

  const dimensions = {
    audienceGrowth: scoreAgainstBaseline(currentValue('followersGained'), baselineValue('followersGained')),
    contentPerformance: scoreAgainstBaseline(currentValue('engagementRate'), baselineValue('engagementRate')),
    engagement: scoreAgainstBaseline(currentValue('engagements'), baselineValue('engagements')),
    websiteAcquisition: scoreAgainstBaseline(currentValue('referralSessions'), baselineValue('referralSessions')),
    conversion: scoreAgainstBaseline(
      compositeValue(yData, 'conversions', 'leadsGenerated'),
      compositeValue(prevData, 'conversions', 'leadsGenerated')
    ),
    brandVisibility: scoreAgainstBaseline(currentValue('impressions'), baselineValue('impressions'))
  };
  const scoredDimensions = Object.entries(dimensions).filter(([, value]) => Number.isFinite(value));
  const inferredBaseline = scoredDimensions.length >= 3;
  const hasHistoricalBaseline = options.hasHistoricalBaseline === undefined
    ? inferredBaseline
    : Boolean(options.hasHistoricalBaseline);
  const dataConfidence = Number.isFinite(dataQuality.confidence)
    ? dataQuality.confidence
    : Math.round((scoredDimensions.length / 6) * 100);

  if (!observedMetrics.length || !hasHistoricalBaseline || scoredDimensions.length < 3) {
    const buildingBaseline = observedMetrics.length > 0 && !hasHistoricalBaseline;
    return {
      overallScore: null,
      scoreDelta: null,
      status: buildingBaseline ? 'building_baseline' : 'insufficient_data',
      dataConfidence,
      baselineStatus: buildingBaseline ? `Building baseline${dataQuality.baselineDays ? `: ${dataQuality.baselineDays} verified day${dataQuality.baselineDays === 1 ? '' : 's'} collected` : ''}.` : 'No comparable verified baseline is available.',
      movementExplanation: buildingBaseline
        ? 'Moyi has verified current metrics, but it will not score performance until a comparable historical baseline exists.'
        : 'Moyi has not collected enough comparable verified metrics to score growth honestly.',
      ...dimensions,
      dataQuality: {
        hasVerifiedData: observedMetrics.length > 0,
        reason: observedMetrics.length
          ? `Current evidence exists for ${observedMetrics.join(', ')}, but fewer than three score dimensions have a valid baseline.`
          : 'No verified provider metrics or first-party attribution evidence was available for the report window.',
        observedMetrics
      }
    };
  }

  const weights = { audienceGrowth: 0.15, contentPerformance: 0.2, engagement: 0.2, websiteAcquisition: 0.2, conversion: 0.15, brandVisibility: 0.1 };
  const activeWeight = scoredDimensions.reduce((sum, [name]) => sum + weights[name], 0);
  const overallScore = Math.round(scoredDimensions.reduce((sum, [name, value]) => sum + value * weights[name], 0) / activeWeight);
  const strongest = scoredDimensions.slice().sort((a, b) => Math.abs(b[1] - 50) - Math.abs(a[1] - 50))[0];
  const scoreDelta = Math.round(overallScore - 50);
  const movementExplanation = strongest
    ? `Score is ${overallScore >= 50 ? 'above' : 'below'} the verified historical baseline; ${strongest[0].replace(/([A-Z])/g, ' $1').toLowerCase()} contributed the largest measured difference.`
    : 'Score is based on comparable verified historical metrics.';

  return {
    overallScore,
    scoreDelta,
    status: 'scored',
    dataConfidence,
    baselineStatus: 'Comparable verified baseline available.',
    movementExplanation,
    ...dimensions,
    dataQuality: {
      hasVerifiedData: true,
      reason: `Score uses ${scoredDimensions.length} comparable dimensions: ${scoredDimensions.map(([name]) => name).join(', ')}.`,
      observedMetrics
    }
  };
}

/**
 * 9. Executive Morning Brief Assembly
 */
async function generateDailyGrowthIntelligenceReport(projectId, targetDate = new Date()) {
  const project = await Project.findById(projectId);
  if (!project) throw new Error('Project not found for growth intelligence report.');
  const { reportDate, reportingDate, reportingWindow } = projectReportingContext(targetDate, project.timezone || 'UTC');
  console.info(JSON.stringify({
    event: 'dgi_generation_started',
    projectId: String(projectId),
    timezone: project.timezone || 'UTC',
    reportDate,
    reportingDate,
    windowStart: reportingWindow.start,
    windowEnd: reportingWindow.end
  }));

  const snapshots = await syncDailySnapshotsForProject(projectId, reportingDate, {
    windowStart: reportingWindow.start,
    windowEnd: reportingWindow.end
  });
  const [windowComparisons, contentIntelligence, dataQuality] = await Promise.all([
    calculateWindowComparisons(projectId, reportDate),
    analyzeContentIntelligence(projectId, 30),
    assessDailyDataQuality(projectId, reportingWindow)
  ]);
  const platformChampions = analyzePlatformChampions(snapshots);
  const analysisAllowed = ['provisional', 'reliable'].includes(dataQuality.status) && dataQuality.verifiedMetrics > 0;

  const diagnoses = analysisAllowed
    ? runDailyDiagnosisEngine(windowComparisons, platformChampions, contentIntelligence)
      .filter((item) => item.recommendedAction && item.evidence && item.evidenceObjects && item.evidenceObjects.length)
    : [];
  const opportunities = analysisAllowed
    ? detectGrowthOpportunities(contentIntelligence)
      .filter((item) => item.evidence && item.evidenceIds && item.evidenceIds.length && item.confidence)
    : [];
  const risksAndProblems = analysisAllowed ? detectRisksAndProblems(windowComparisons) : [];

  const yData = windowComparisons.yesterdayVsPrev ? windowComparisons.yesterdayVsPrev.current : {};
  const prevData = windowComparisons.scoringBaseline || {};
  dataQuality.baselineDays = Number(prevData.daysObserved || 0);
  dataQuality.hasHistoricalBaseline = dataQuality.baselineDays >= 7;
  const trackerVerified = isVerifiedMetric(yData.metricStates && yData.metricStates.referralSessions);
  const revenueVerified = dataQuality.revenueConfigured
    && isVerifiedMetric(yData.metricStates && yData.metricStates.attributedRevenue);
  const downstreamAttribution = {
    measurementStatus: trackerVerified ? 'verified' : 'pending',
    revenueStatus: !dataQuality.revenueConfigured ? 'not_configured' : (revenueVerified ? 'verified' : 'pending'),
    totalReferralTraffic: trackerVerified ? nullableNumber(yData.referralSessions) : null,
    totalLeads: isVerifiedMetric(yData.metricStates && yData.metricStates.leadsGenerated) ? nullableNumber(yData.leadsGenerated) : null,
    totalConversions: isVerifiedMetric(yData.metricStates && yData.metricStates.conversions) ? nullableNumber(yData.conversions) : null,
    totalRevenue: revenueVerified ? nullableNumber(yData.attributedRevenue) : null,
    platformBreakdown: snapshots.map((snapshot) => {
      const traffic = snapshot.websiteTraffic || {};
      const states = snapshot.metricStates || {};
      const referralsVerified = isVerifiedMetric(states.referralSessions);
      const conversionsVerified = isVerifiedMetric(states.conversions);
      const referrals = referralsVerified ? nullableNumber(traffic.referralSessions) : null;
      const conversions = conversionsVerified ? nullableNumber(traffic.conversions) : null;
      return {
        platform: snapshot.platform,
        status: snapshot.dataStatus || 'pending',
        referralSessions: referrals,
        uniqueVisitors: isVerifiedMetric(states.uniqueVisitors) ? nullableNumber(traffic.uniqueVisitors) : null,
        leads: isVerifiedMetric(states.leadsGenerated) ? nullableNumber(traffic.leadsGenerated) : null,
        conversions,
        revenue: dataQuality.revenueConfigured && isVerifiedMetric(states.attributedRevenue)
          ? nullableNumber(traffic.attributedRevenue)
          : null,
        conversionRate: referrals !== null && conversions !== null && referrals > 0
          ? Math.round((conversions / referrals) * 1000) / 10
          : null
      };
    })
  };

  const growthScoreBreakdown = calculateGrowthScoreBreakdown(yData, prevData, {
    dataQuality,
    hasHistoricalBaseline: dataQuality.hasHistoricalBaseline
  });
  const score = growthScoreBreakdown.overallScore;
  const hasScore = Number.isFinite(score);
  const grade = !hasScore ? 'N/A' : (score >= 90 ? 'A+' : (score >= 80 ? 'A' : (score >= 70 ? 'B' : (score >= 60 ? 'C' : 'D'))));

  const keyWins = [];
  if (!platformChampions.bestForReach.noData && platformChampions.bestForReach.value > 0) {
    keyWins.push(`${capitalize(platformChampions.bestForReach.platform)} captured ${platformChampions.bestForReach.sharePercentage}% of total social reach.`);
  }
  if (downstreamAttribution.totalReferralTraffic !== null && downstreamAttribution.totalReferralTraffic > 0) {
    keyWins.push(`Social generated ${downstreamAttribution.totalReferralTraffic} direct website referral sessions.`);
  }
  if (downstreamAttribution.totalConversions !== null && downstreamAttribution.totalConversions > 0) {
    const revenueText = downstreamAttribution.totalRevenue === null
      ? ''
      : ` (${downstreamAttribution.totalRevenue.toLocaleString()} attributed revenue)`;
    keyWins.push(`Recorded ${downstreamAttribution.totalConversions} attributed conversion${downstreamAttribution.totalConversions === 1 ? '' : 's'}${revenueText}.`);
  }

  let reportMode = 'normal';
  if (!analysisAllowed || !hasScore) {
    reportMode = 'insufficient_data';
  } else if (opportunities.length && opportunities.some((o) => o.priority === 'critical')) {
    reportMode = 'opportunity';
  } else if (risksAndProblems.length && risksAndProblems.some((r) => r.severity === 'critical')) {
    reportMode = 'performance_alert';
  } else if ((downstreamAttribution.totalReferralTraffic || 0) >= 100 || (nullableNumber(yData.impressions) || 0) >= 10000) {
    reportMode = 'milestone';
  }

  const topPlatform = platformChampions.bestForReach.platform;
  let executiveSummary = '';
  if (reportMode === 'opportunity') {
    const opportunity = opportunities.find((item) => item.priority === 'critical') || opportunities[0];
    executiveSummary = `GROWTH OPPORTUNITY DETECTED: ${opportunity.title}. Evidence: ${opportunity.evidence} Confidence is ${opportunity.confidence}%. Treat the proposed action as a measured test, not a guaranteed outcome.`;
  } else if (reportMode === 'performance_alert') {
    executiveSummary = `PERFORMANCE ALERT: ${risksAndProblems[0].title}. Primary signal: ${risksAndProblems[0].primarySignal}`;
  } else if (reportMode === 'milestone') {
    const milestoneFacts = [];
    if (nullableNumber(yData.impressions) !== null) milestoneFacts.push(`${nullableNumber(yData.impressions).toLocaleString()} verified impressions`);
    if (downstreamAttribution.totalReferralTraffic !== null) milestoneFacts.push(`${downstreamAttribution.totalReferralTraffic} tracked referral sessions`);
    executiveSummary = `GROWTH MILESTONE: ${project.name} recorded ${milestoneFacts.join(' and ')} in the reporting window.`;
  } else if (reportMode === 'insufficient_data' || !topPlatform) {
    executiveSummary = `Moyi could not verify enough fresh data for ${project.name}'s ${reportingDate.toLocaleDateString()} reporting window to calculate a growth score or name a strongest channel. Data confidence is ${dataQuality.confidence}%.`;
  } else {
    const impressions = nullableNumber(yData.impressions);
    const engagements = nullableNumber(yData.engagements);
    const facts = [];
    if (impressions !== null) facts.push(`${impressions.toLocaleString()} verified impressions`);
    if (engagements !== null) facts.push(`${engagements.toLocaleString()} verified engagements`);
    if (downstreamAttribution.totalReferralTraffic !== null) facts.push(`${downstreamAttribution.totalReferralTraffic} tracked referral sessions`);
    executiveSummary = `${project.name} recorded ${facts.join(', ')} in the reporting window. ${capitalize(topPlatform)} led verified reach. Data confidence is ${dataQuality.confidence}%.`;
  }

  const todayActionList = [];
  opportunities.slice(0, 2).forEach((opportunity) => todayActionList.push({
    priority: todayActionList.length + 1,
    action: opportunity.recommendedAction || opportunity.title,
    platform: (opportunity.actionPayload && opportunity.actionPayload.platform) || 'all',
    expectedImpact: opportunity.expectedOutcome || opportunity.potentialImpact || 'Measure the stated primary outcome.',
    rationale: opportunity.evidence
  }));
  diagnoses.slice(0, Math.max(0, 3 - todayActionList.length)).forEach((diagnosis) => todayActionList.push({
    priority: todayActionList.length + 1,
    action: diagnosis.recommendedAction,
    platform: diagnosis.platform || 'all',
    expectedImpact: diagnosis.impact || 'Validate the diagnosed performance signal.',
    rationale: diagnosis.evidence
  }));
  if (!todayActionList.length) {
    dataQuality.issues.slice(0, 3).forEach((issue) => todayActionList.push({
      priority: todayActionList.length + 1,
      action: issue.message,
      platform: issue.platform || 'all',
      expectedImpact: 'Restore verified measurement before making performance decisions.',
      rationale: `Data health status: ${issue.type}.`
    }));
  }

  const reportDoc = await DailyGrowthIntelligence.findOneAndUpdate(
    { projectId, date: reportDate },
    {
      $set: {
        projectId,
        date: reportDate,
        schemaVersion: 2,
        status: 'generated',
        reportMode,
        dataQuality,
        executiveSummary,
        performanceScore: score,
        performanceGrade: grade,
        growthScoreBreakdown,
        keyWins,
        risksAndProblems,
        windowComparisons,
        platformChampions,
        contentIntelligence,
        diagnoses,
        opportunities,
        downstreamAttribution,
        todayActionList,
        generatedAt: new Date()
      }
    },
    { upsert: true, returnDocument: 'after' }
  );
  console.info(JSON.stringify({
    event: 'dgi_generation_completed',
    projectId: String(projectId),
    reportDate,
    reportingDate,
    reportMode,
    score,
    dataConfidence: dataQuality.confidence,
    verifiedMetrics: dataQuality.verifiedMetrics
  }));
  return reportDoc;
}

/**
 * Get or generate dashboard data for view
 */
async function getGrowthIntelligenceDashboardData(projectId, options = {}) {
  const targetDate = options.date ? new Date(options.date) : new Date();
  const project = await Project.findById(projectId);
  if (!project) throw new Error('Project not found for growth intelligence dashboard.');
  const date = projectLocalDateKey(targetDate, project.timezone || 'UTC');

  let report = await DailyGrowthIntelligence.findOne({ projectId, date });
  const legacyReport = report && (
    report.schemaVersion < 2
    || (typeof report.$isDefault === 'function' && report.$isDefault('schemaVersion'))
    || !report.dataQuality
  );
  if (!report || legacyReport || options.forceRefresh) {
    report = await generateDailyGrowthIntelligenceReport(projectId, targetDate);
  }

  const accounts = await SocialAccount.find({
    $or: [{ projectId }, { sharedWithProjectIds: projectId }],
    revokedAt: null
  });

  return {
    project,
    accounts,
    report,
    SUPPORTED_PLATFORMS
  };
}

module.exports = {
  SUPPORTED_PLATFORMS,
  normalizeDate,
  daysAgo,
  projectLocalDateKey,
  projectReportingContext,
  utcForProjectLocalMidnight,
  calculateDelta,
  verifiedMetricNames,
  hasVerifiedGrowthData,
  generateSocialUtmLink,
  detectContentFormat,
  detectContentCategory,
  contentIntelligenceMetrics,
  syncDailySnapshotsForProject,
  calculateWindowComparisons,
  analyzePlatformChampions,
  analyzeContentIntelligence,
  runDailyDiagnosisEngine,
  detectGrowthOpportunities,
  detectRisksAndProblems,
  calculateGrowthScoreBreakdown,
  generateDailyGrowthIntelligenceReport,
  getGrowthIntelligenceDashboardData
};
