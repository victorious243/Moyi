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

function safeNumber(val, defaultVal = 0) {
  const num = Number(val);
  return Number.isFinite(num) ? num : defaultVal;
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

/**
 * Generate standard first-party tracking UTM link for social publishing
 */
function generateSocialUtmLink({ baseUrl = '', platform = 'social', campaignName = 'organic', postId = '', contentTitle = '' }) {
  const cleanBase = String(baseUrl || '').split('?')[0];
  const url = cleanBase || 'https://moyi-cmo.com';
  const cleanCampaign = String(campaignName || 'general').toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const cleanContent = postId || String(contentTitle || 'post').toLowerCase().slice(0, 30).replace(/[^a-z0-9]+/g, '-');
  
  return `${url}?utm_source=${encodeURIComponent(platform)}&utm_medium=social&utm_campaign=${encodeURIComponent(cleanCampaign)}&utm_content=${encodeURIComponent(cleanContent)}`;
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
async function syncDailySnapshotsForProject(projectId, targetDate = new Date()) {
  const date = normalizeDate(targetDate);
  const nextDate = new Date(date.getTime() + 24 * 60 * 60 * 1000);

  // Find all connected social accounts for the project
  const accounts = await SocialAccount.find({
    $or: [{ projectId }, { sharedWithProjectIds: projectId }],
    revokedAt: null
  });

  // Query published jobs in this date range
  const jobs = await PublishJob.find({
    $or: [{ projectId }, { destinationProjectId: projectId }],
    status: 'published',
    publishedAt: { $gte: date, $lt: nextDate }
  }).lean();

  // Query tracking events for website traffic attribution
  const trackingEvents = await TrackingEvent.find({
    projectId,
    createdAt: { $gte: date, $lt: nextDate }
  }).lean();

  const platformMap = new Map();
  SUPPORTED_PLATFORMS.forEach((p) => {
    platformMap.set(p, {
      projectId,
      platform: p,
      date,
      followers: 0,
      followersGained: 0,
      followersLost: 0,
      profileVisits: 0,
      impressions: 0,
      reach: 0,
      engagements: 0,
      engagementRate: 0,
      likes: 0,
      comments: 0,
      shares: 0,
      saves: 0,
      reposts: 0,
      linkClicks: 0,
      videoViews: 0,
      videoCompletionRate: 0,
      watchTimeSeconds: 0,
      postsPublished: 0,
      publishJobIds: [],
      websiteTraffic: {
        referralSessions: 0,
        uniqueVisitors: 0,
        leadsGenerated: 0,
        conversions: 0,
        attributedRevenue: 0
      },
      rawProviderData: {}
    });
  });

  // Aggregate job metrics
  for (const job of jobs) {
    const p = job.platform;
    if (!platformMap.has(p)) continue;
    const entry = platformMap.get(p);
    entry.postsPublished += 1;
    entry.publishJobIds.push(job._id);

    const m = job.metricsLatest || {};
    entry.impressions += safeNumber(m.impressions || m.views || m.reach, 0);
    entry.reach += safeNumber(m.reach || m.impressions, 0);
    entry.likes += safeNumber(m.likes, 0);
    entry.comments += safeNumber(m.comments, 0);
    entry.shares += safeNumber(m.shares || m.quotes, 0);
    entry.saves += safeNumber(m.saves, 0);
    entry.reposts += safeNumber(m.reposts || m.shares, 0);
    entry.linkClicks += safeNumber(m.clicks, 0);
    entry.videoViews += safeNumber(m.videoViews || m.views, 0);
    entry.watchTimeSeconds += safeNumber(m.watchTimeMs ? m.watchTimeMs / 1000 : 0, 0);

    const interactions = entry.likes + entry.comments + entry.shares + entry.saves + entry.linkClicks;
    entry.engagements = interactions;
    entry.engagementRate = entry.impressions > 0 ? (interactions / entry.impressions) * 100 : 0;
  }

  // Aggregate website referral traffic & conversions
  for (const event of trackingEvents) {
    const src = String(event.utmSource || event.referrer || '').toLowerCase();
    let matchedPlatform = null;
    if (src.includes('linkedin')) matchedPlatform = 'linkedin';
    else if (src.includes('twitter') || src.includes('t.co') || src.includes('x.com')) matchedPlatform = 'x';
    else if (src.includes('facebook') || src.includes('fb')) matchedPlatform = 'facebook';
    else if (src.includes('instagram')) matchedPlatform = 'instagram';
    else if (src.includes('tiktok')) matchedPlatform = 'tiktok';
    else if (src.includes('youtube') || src.includes('youtu.be')) matchedPlatform = 'youtube';

    if (matchedPlatform && platformMap.has(matchedPlatform)) {
      const entry = platformMap.get(matchedPlatform);
      entry.websiteTraffic.referralSessions += 1;
      if (event.eventType === 'lead' || event.eventType === 'signup') {
        entry.websiteTraffic.leadsGenerated += 1;
      }
      if (event.eventType === 'purchase' || event.eventType === 'conversion') {
        entry.websiteTraffic.conversions += 1;
        entry.websiteTraffic.attributedRevenue += safeNumber(event.revenue || event.amount, 0);
      }
    }
  }

  // Upsert daily snapshots
  const snapshots = [];
  for (const [, entry] of platformMap.entries()) {
    const matchingAccount = accounts.find((a) => a.platform === entry.platform);
    if (matchingAccount) {
      entry.accountId = matchingAccount._id;
      entry.followers = safeNumber(matchingAccount.accountDetails && matchingAccount.accountDetails.followersCount, 0);
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

  const [
    yesterdaySnaps,
    prevDaySnaps,
    recent7dSnaps,
    prev7dSnaps,
    recent30dSnaps,
    prev30dSnaps
  ] = await Promise.all([
    DailySocialSnapshot.find({ projectId, date: yesterday }),
    DailySocialSnapshot.find({ projectId, date: prevDay }),
    DailySocialSnapshot.find({ projectId, date: { $gte: recent7dStart, $lt: yesterday } }),
    DailySocialSnapshot.find({ projectId, date: { $gte: prev7dStart, $lt: recent7dStart } }),
    DailySocialSnapshot.find({ projectId, date: { $gte: recent30dStart, $lt: yesterday } }),
    DailySocialSnapshot.find({ projectId, date: { $gte: prev30dStart, $lt: recent30dStart } })
  ]);

  function aggregate(snapshots) {
    const totals = {
      impressions: 0,
      reach: 0,
      engagements: 0,
      engagementRate: 0,
      likes: 0,
      comments: 0,
      shares: 0,
      linkClicks: 0,
      videoViews: 0,
      postsPublished: 0,
      referralSessions: 0,
      leadsGenerated: 0,
      conversions: 0,
      attributedRevenue: 0
    };
    snapshots.forEach((s) => {
      totals.impressions += s.impressions || 0;
      totals.reach += s.reach || 0;
      totals.engagements += s.engagements || 0;
      totals.likes += s.likes || 0;
      totals.comments += s.comments || 0;
      totals.shares += s.shares || 0;
      totals.linkClicks += s.linkClicks || 0;
      totals.videoViews += s.videoViews || 0;
      totals.postsPublished += s.postsPublished || 0;
      if (s.websiteTraffic) {
        totals.referralSessions += s.websiteTraffic.referralSessions || 0;
        totals.leadsGenerated += s.websiteTraffic.leadsGenerated || 0;
        totals.conversions += s.websiteTraffic.conversions || 0;
        totals.attributedRevenue += s.websiteTraffic.attributedRevenue || 0;
      }
    });
    totals.engagementRate = totals.impressions > 0 ? (totals.engagements / totals.impressions) * 100 : 0;
    return totals;
  }

  function compareTotals(currTotals, prevTotals) {
    const deltas = {};
    const improved = [];
    const declined = [];

    Object.keys(currTotals).forEach((k) => {
      const delta = calculateDelta(currTotals[k], prevTotals[k]);
      deltas[k] = delta;
      if (delta.diff > 0 && ['impressions', 'reach', 'engagements', 'engagementRate', 'referralSessions', 'leadsGenerated', 'conversions', 'attributedRevenue'].includes(k)) {
        improved.push({ metric: k, delta });
      } else if (delta.diff < 0 && ['impressions', 'reach', 'engagements', 'engagementRate', 'referralSessions', 'leadsGenerated', 'conversions'].includes(k)) {
        declined.push({ metric: k, delta });
      }
    });

    return { current: currTotals, previous: prevTotals, deltas, improved, declined };
  }

  const yTotals = aggregate(yesterdaySnaps);
  const pTotals = aggregate(prevDaySnaps);
  const r7Totals = aggregate(recent7dSnaps);
  const p7Totals = aggregate(prev7dSnaps);
  const r30Totals = aggregate(recent30dSnaps);
  const p30Totals = aggregate(prev30dSnaps);

  return {
    yesterdayVsPrev: compareTotals(yTotals, pTotals),
    last7dVsPrev7d: compareTotals(r7Totals, p7Totals),
    last30dVsPrev30d: compareTotals(r30Totals, p30Totals)
  };
}

/**
 * 3. Multi-Objective Platform Champions
 */
function analyzePlatformChampions(snapshots = []) {
  const platformAgg = new Map();

  snapshots.forEach((s) => {
    const p = s.platform;
    const item = platformAgg.get(p) || {
      platform: p,
      impressions: 0,
      reach: 0,
      engagements: 0,
      followersGained: 0,
      referralSessions: 0,
      leads: 0,
      conversions: 0,
      revenue: 0
    };

    item.impressions += s.impressions || 0;
    item.reach += s.reach || 0;
    item.engagements += s.engagements || 0;
    item.followersGained += s.followersGained || 0;
    if (s.websiteTraffic) {
      item.referralSessions += s.websiteTraffic.referralSessions || 0;
      item.leads += s.websiteTraffic.leadsGenerated || 0;
      item.conversions += s.websiteTraffic.conversions || 0;
      item.revenue += s.websiteTraffic.attributedRevenue || 0;
    }
    platformAgg.set(p, item);
  });

  const list = Array.from(platformAgg.values()).map((item) => ({
    ...item,
    engagementRate: item.impressions > 0 ? (item.engagements / item.impressions) * 100 : 0
  }));

  const totalImpressions = list.reduce((sum, i) => sum + i.impressions, 0);

  // Determine winners
  const reachWinner = list.slice().sort((a, b) => b.impressions - a.impressions)[0] || { platform: 'linkedin', impressions: 0 };
  const engagementWinner = list.slice().filter((i) => i.impressions > 50).sort((a, b) => b.engagementRate - a.engagementRate)[0]
    || list.slice().sort((a, b) => b.engagements - a.engagements)[0]
    || { platform: 'x', engagements: 0, engagementRate: 0 };
  const growthWinner = list.slice().sort((a, b) => b.followersGained - a.followersGained)[0] || { platform: 'linkedin', followersGained: 0 };
  const trafficWinner = list.slice().sort((a, b) => b.referralSessions - a.referralSessions)[0] || { platform: 'linkedin', referralSessions: 0 };
  const leadWinner = list.slice().sort((a, b) => b.leads - a.leads)[0] || { platform: 'linkedin', leads: 0 };
  const convWinner = list.slice().sort((a, b) => b.conversions - a.conversions)[0] || { platform: 'linkedin', conversions: 0 };
  const revenueWinner = list.slice().sort((a, b) => b.revenue - a.revenue)[0] || { platform: 'linkedin', revenue: 0 };

  const reachShare = totalImpressions > 0 ? Math.round((reachWinner.impressions / totalImpressions) * 100) : 0;

  return {
    bestForReach: {
      platform: reachWinner.platform,
      value: reachWinner.impressions,
      sharePercentage: reachShare,
      rationale: reachShare > 0
        ? `${capitalize(reachWinner.platform)} generated ${reachShare}% of total social reach with ${reachWinner.impressions.toLocaleString()} impressions.`
        : `${capitalize(reachWinner.platform)} provided the strongest brand exposure.`
    },
    bestForEngagement: {
      platform: engagementWinner.platform,
      value: engagementWinner.engagements,
      rate: Math.round(engagementWinner.engagementRate * 10) / 10,
      rationale: `${capitalize(engagementWinner.platform)} recorded the strongest audience response (${Math.round(engagementWinner.engagementRate * 10) / 10}% engagement rate).`
    },
    bestForFollowerGrowth: {
      platform: growthWinner.platform,
      netGained: growthWinner.followersGained,
      rationale: `${capitalize(growthWinner.platform)} led net new community expansion with +${growthWinner.followersGained} followers.`
    },
    bestForWebsiteTraffic: {
      platform: trafficWinner.platform,
      sessions: trafficWinner.referralSessions,
      rationale: `${capitalize(trafficWinner.platform)} delivered the highest-volume inbound traffic with ${trafficWinner.referralSessions} referral visits.`
    },
    bestForLeads: {
      platform: leadWinner.platform,
      leads: leadWinner.leads,
      rationale: `${capitalize(leadWinner.platform)} drove the highest lead volume (${leadWinner.leads} captured signups/inquiries).`
    },
    bestForConversions: {
      platform: convWinner.platform,
      conversions: convWinner.conversions,
      rationale: `${capitalize(convWinner.platform)} produced the highest bottom-funnel conversions (${convWinner.conversions} transactions).`
    },
    bestForRevenue: {
      platform: revenueWinner.platform,
      revenue: revenueWinner.revenue,
      rationale: `${capitalize(revenueWinner.platform)} accounted for the highest attributed revenue ($${revenueWinner.revenue.toLocaleString()}).`
    }
  };
}

function capitalize(s = '') {
  return String(s).charAt(0).toUpperCase() + String(s).slice(1);
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

  // Map post performance
  const posts = jobs.map((job) => {
    const metrics = job.metricsLatest || {};
    const impressions = safeNumber(metrics.impressions || metrics.reach || metrics.views, 0);
    const likes = safeNumber(metrics.likes, 0);
    const comments = safeNumber(metrics.comments, 0);
    const shares = safeNumber(metrics.shares || metrics.quotes, 0);
    const saves = safeNumber(metrics.saves, 0);
    const clicks = safeNumber(metrics.clicks, 0);
    const engagements = likes + comments + shares + saves + clicks;
    const engagementRate = impressions > 0 ? (engagements / impressions) * 100 : 0;
    const format = detectContentFormat(job);
    const textBody = (job.draftId && job.draftId.body) || (job.content && job.content.text) || '';
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
      engagements,
      engagementRate: Math.round(engagementRate * 10) / 10,
      websiteClicks: clicks
    };
  });

  // Calculate baseline metrics
  const avgImpressions = posts.reduce((sum, p) => sum + p.impressions, 0) / posts.length;
  const avgEngagements = posts.reduce((sum, p) => sum + p.engagements, 0) / posts.length;

  // Top & Underperforming posts
  const topPosts = posts
    .slice()
    .sort((a, b) => b.engagements - a.engagements)
    .slice(0, 4)
    .map((p) => ({
      ...p,
      whyItWon: p.engagements > avgEngagements * 1.5
        ? `Generated ${(p.engagements / (avgEngagements || 1)).toFixed(1)}x normal engagement due to strong ${p.category.replace('_', ' ')} hook and high share rate.`
        : 'Outperformed baseline with consistent platform engagement.'
    }));

  const worstPosts = posts
    .slice()
    .filter((p) => p.impressions > 0)
    .sort((a, b) => a.engagementRate - b.engagementRate)
    .slice(0, 3)
    .map((p) => ({
      ...p,
      frictionPoint: p.engagementRate < 0.8
        ? 'Low engagement rate suggests weak opening hook or generic promotional copy.'
        : 'Underperformed channel benchmark.'
    }));

  // Format Breakdown
  const formatMap = new Map();
  posts.forEach((p) => {
    const f = p.contentType;
    const item = formatMap.get(f) || { contentType: f, postCount: 0, totalImp: 0, totalEng: 0, totalClicks: 0 };
    item.postCount += 1;
    item.totalImp += p.impressions;
    item.totalEng += p.engagements;
    item.totalClicks += p.websiteClicks;
    formatMap.set(f, item);
  });

  const contentTypeBreakdown = Array.from(formatMap.values()).map((item) => {
    const avgImp = Math.round(item.totalImp / item.postCount);
    const avgEng = Math.round(item.totalEng / item.postCount);
    const avgRate = avgImp > 0 ? (avgEng / avgImp) * 100 : 0;
    const multiplier = avgEngagements > 0 ? Math.round((avgEng / avgEngagements) * 10) / 10 : 1.0;
    return {
      contentType: item.contentType,
      postCount: item.postCount,
      avgImpressions: avgImp,
      avgEngagements: avgEng,
      avgEngagementRate: Math.round(avgRate * 10) / 10,
      avgWebsiteClicks: Math.round(item.totalClicks / item.postCount),
      performanceMultiplier: multiplier
    };
  });

  // Pattern Detection with Minimum Sample Thresholds (>= 3 posts)
  const categoryMap = new Map();
  posts.forEach((p) => {
    const c = p.category;
    const item = categoryMap.get(c) || { category: c, postCount: 0, totalEng: 0, totalClicks: 0 };
    item.postCount += 1;
    item.totalEng += p.engagements;
    item.totalClicks += p.websiteClicks;
    categoryMap.set(c, item);
  });

  const detectedPatterns = [];
  for (const [, item] of categoryMap.entries()) {
    if (item.postCount >= 3) {
      const avgCatEng = item.totalEng / item.postCount;
      const multiplier = avgEngagements > 0 ? Math.round((avgCatEng / avgEngagements) * 10) / 10 : 1.0;
      if (multiplier >= 1.5) {
        detectedPatterns.push({
          patternName: `${capitalize(item.category.replace('_', ' '))} Content Advantage`,
          observation: `${capitalize(item.category.replace('_', ' '))} posts outperform overall average engagement by ${multiplier}x.`,
          evidence: `Sample of ${item.postCount} posts averaged ${Math.round(avgCatEng)} engagements vs ${Math.round(avgEngagements)} baseline.`,
          confidence: item.postCount >= 5 ? 'high' : 'medium',
          sampleSize: item.postCount,
          multiplier,
          recommendation: `Increase ${item.category.replace('_', ' ')} post frequency in your weekly content calendar.`
        });
      }
    }
  }

  // Format Pattern Advantage
  contentTypeBreakdown.forEach((item) => {
    if (item.postCount >= 3 && item.performanceMultiplier >= 1.4) {
      detectedPatterns.push({
        patternName: `${capitalize(item.contentType)} Format Multiplier`,
        observation: `${capitalize(item.contentType)} posts generate ${item.performanceMultiplier}x higher audience engagement than standard text posts.`,
        evidence: `Analyzed ${item.postCount} ${item.contentType} assets yielding ${item.avgEngagementRate}% average engagement rate.`,
        confidence: item.postCount >= 6 ? 'high' : 'medium',
        sampleSize: item.postCount,
        multiplier: item.performanceMultiplier,
        recommendation: `Prioritize ${item.contentType} flyers and assets when publishing high-priority announcements.`
      });
    }
  });

  // Optimal Timing Heatmap
  const timingMap = new Map();
  posts.forEach((p) => {
    const d = new Date(p.publishedAt);
    const day = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][d.getUTCDay()];
    const hour = d.getUTCHours();
    const hourWindow = hour < 12 ? '08:00 - 12:00 UTC' : (hour < 17 ? '12:00 - 17:00 UTC' : '17:00 - 21:00 UTC');
    const key = `${p.platform}_${day}_${hourWindow}`;
    const item = timingMap.get(key) || { platform: p.platform, bestDay: day, bestHourWindow: hourWindow, count: 0, totalEng: 0 };
    item.count += 1;
    item.totalEng += p.engagements;
    timingMap.set(key, item);
  });

  const optimalTiming = Array.from(timingMap.values())
    .filter((t) => t.count >= 2)
    .map((t) => ({
      platform: t.platform,
      bestDay: t.bestDay,
      bestHourWindow: t.bestHourWindow,
      performanceMultiplier: avgEngagements > 0 ? Math.round(((t.totalEng / t.count) / avgEngagements) * 10) / 10 : 1.2,
      sampleSize: t.count
    }))
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
  if (yDelta.impressions && Math.abs(yDelta.impressions.percentage) >= 15) {
    const isUp = yDelta.impressions.diff > 0;
    const topPost = (contentIntel.topPerformingPosts && contentIntel.topPerformingPosts[0]) || null;
    diagnoses.push({
      id: 'diag-reach-movement',
      observation: `Overall social impressions ${isUp ? 'surged' : 'contracted'} by ${Math.abs(yDelta.impressions.percentage)}% yesterday (${yDelta.impressions.rawCurrent.toLocaleString()} vs ${yDelta.impressions.rawPrevious.toLocaleString()}).`,
      evidence: topPost
        ? `Top asset "${topPost.title.slice(0, 45)}..." drove ${topPost.impressions.toLocaleString()} impressions on ${capitalize(topPost.platform)}.`
        : `Total impressions reached ${yDelta.impressions.rawCurrent.toLocaleString()}.`,
      likelyExplanation: isUp
        ? 'High organic algorithmic distribution on top-performing content asset with strong early velocity.'
        : 'Lower publishing frequency or audience saturation on recent promotional themes.',
      confidence: 'high',
      businessImpact: 'reach',
      recommendedAction: isUp
        ? 'Publish a follow-up commentary post within 24 hours to ride the algorithmic engagement tail.'
        : 'Rotate post angles toward educational frameworks or founder narratives to restore engagement velocity.',
      priority: isUp ? 'high' : 'medium'
    });
  }

  // Diagnosis 2: Website Traffic & Conversion Contribution
  if (yDelta.referralSessions) {
    const sessions = yDelta.referralSessions.rawCurrent;
    const bestTraffic = platformChampions.bestForWebsiteTraffic || {};
    if (sessions > 0) {
      diagnoses.push({
        id: 'diag-traffic-contribution',
        observation: `Social channels contributed ${sessions} direct referral visits to your website yesterday.`,
        evidence: `${capitalize(bestTraffic.platform || 'LinkedIn')} was the primary traffic driver with ${bestTraffic.sessions || sessions} referral sessions.`,
        likelyExplanation: 'Audience demonstrated high intent by clicking through from social copy directly into landing page URLs.',
        confidence: 'high',
        businessImpact: 'traffic',
        recommendedAction: 'Verify landing page conversion funnel and ensure retargeting / email capture modal is active.',
        priority: 'high'
      });
    } else if (yDelta.impressions && yDelta.impressions.rawCurrent > 300) {
      diagnoses.push({
        id: 'diag-conversion-gap',
        observation: 'High social exposure resulted in minimal direct website click-throughs.',
        evidence: `Generated ${yDelta.impressions.rawCurrent.toLocaleString()} impressions but 0 recorded website referral sessions.`,
        likelyExplanation: 'Posts focused on top-of-funnel exposure without a compelling next step to visit the website.',
        confidence: 'medium',
        businessImpact: 'conversions',
        recommendedAction: 'Attach a specific free resource (e.g. Free SEO Quick Scan or PDF Guide) in the first comment or post CTA.',
        priority: 'critical'
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
      likelyExplanation: 'Audience engages significantly deeper with authentic, value-dense frameworks than generic updates.',
      confidence: pattern.confidence,
      businessImpact: 'brand_equity',
      recommendedAction: pattern.recommendation,
      priority: 'high'
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
    opportunities.push({
      id: 'opp-viral-repurpose',
      type: 'viral_breakout',
      title: `High-Velocity Asset on ${capitalize(topPost.platform)}: Repurpose across channels`,
      description: `Your ${topPost.contentType} post "${topPost.title.slice(0, 50)}..." generated ${topPost.engagements} engagements (${topPost.engagementRate}% rate). Repurpose it into a long-form article and thread for secondary channels.`,
      evidence: `Generated ${topPost.impressions.toLocaleString()} impressions and ${topPost.engagements} interactions.`,
      actionType: 'repurpose_post',
      actionPayload: { sourcePostId: topPost.postId, platform: topPost.platform, title: topPost.title },
      priority: 'critical',
      status: 'pending'
    });
  }

  // Opportunity 2: High-Converting Topic Expansion
  const patterns = contentIntel.detectedPatterns || [];
  const winningPattern = patterns.find((p) => p.multiplier >= 1.5);
  if (winningPattern) {
    opportunities.push({
      id: 'opp-topic-expansion',
      type: 'high_converting_topic',
      title: `Scale High-ROI Topic: ${winningPattern.patternName}`,
      description: `Data confirms ${winningPattern.patternName} produces ${winningPattern.multiplier}x higher response. Schedule a 3-part weekly content sprint around this angle.`,
      evidence: winningPattern.evidence,
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
function calculateGrowthScoreBreakdown(yData = {}, prevData = {}) {
  const imp = yData.impressions || 0;
  const prevImp = prevData.impressions || 0;
  const eng = yData.engagements || 0;
  const rate = yData.engagementRate || 0;
  const sessions = yData.referralSessions || 0;
  const leads = yData.leadsGenerated || 0;
  const conversions = yData.conversions || 0;

  // Sub-scores (0–100)
  const audienceGrowth = Math.min(100, Math.max(50, 65 + (yData.followersGained || 0) * 5));
  const contentPerformance = Math.min(100, Math.max(50, 70 + (rate > 2 ? 15 : (rate > 1 ? 5 : -5))));
  const engagement = Math.min(100, Math.max(50, 65 + (eng > 50 ? 20 : (eng > 10 ? 10 : 0))));
  const websiteAcquisition = Math.min(100, Math.max(45, 60 + sessions * 2));
  const conversion = Math.min(100, Math.max(40, 55 + leads * 5 + conversions * 10));
  const brandVisibility = Math.min(100, Math.max(50, 65 + (imp > 1000 ? 20 : (imp > 200 ? 10 : 0))));

  const overallScore = Math.round(
    audienceGrowth * 0.15 +
    contentPerformance * 0.20 +
    engagement * 0.20 +
    websiteAcquisition * 0.20 +
    conversion * 0.15 +
    brandVisibility * 0.10
  );

  const prevScore = Math.min(100, Math.max(50, 70 + (prevImp > 1000 ? 10 : 0)));
  const scoreDelta = overallScore - prevScore;

  let movementExplanation = 'Growth Score is steady reflecting consistent baseline publishing.';
  if (scoreDelta > 0) {
    movementExplanation = `Growth Score improved +${scoreDelta} points driven by stronger engagement (${eng} interactions) and ${sessions} website referral visits.`;
  } else if (scoreDelta < 0) {
    movementExplanation = `Growth Score adjusted ${scoreDelta} points due to lower daily impressions and click-through activity.`;
  }

  return {
    overallScore,
    scoreDelta,
    movementExplanation,
    audienceGrowth,
    contentPerformance,
    engagement,
    websiteAcquisition,
    conversion,
    brandVisibility
  };
}

/**
 * 9. Executive Morning Brief Assembly
 */
async function generateDailyGrowthIntelligenceReport(projectId, targetDate = new Date()) {
  const project = await Project.findById(projectId);
  if (!project) throw new Error('Project not found for growth intelligence report.');

  // 1. Sync daily snapshots
  const snapshots = await syncDailySnapshotsForProject(projectId, targetDate);

  // 2. Multi-window comparisons
  const windowComparisons = await calculateWindowComparisons(projectId, targetDate);

  // 3. Multi-objective platform champions
  const yesterdaySnaps = snapshots.filter((s) => s.date.getTime() === normalizeDate(daysAgo(1, targetDate)).getTime()) || snapshots;
  const platformChampions = analyzePlatformChampions(yesterdaySnaps.length ? yesterdaySnaps : snapshots);

  // 4. Deep Content Intelligence
  const contentIntelligence = await analyzeContentIntelligence(projectId, 30);

  // 5. Daily Diagnoses
  const diagnoses = runDailyDiagnosisEngine(windowComparisons, platformChampions, contentIntelligence);

  // 6. Proactive Opportunities
  const opportunities = detectGrowthOpportunities(contentIntelligence);

  // 7. Problem / Risk Detection
  const risksAndProblems = detectRisksAndProblems(windowComparisons);

  // 8. Downstream Attribution
  const yData = windowComparisons.yesterdayVsPrev ? windowComparisons.yesterdayVsPrev.current : {};
  const prevData = windowComparisons.yesterdayVsPrev ? windowComparisons.yesterdayVsPrev.previous : {};
  const downstreamAttribution = {
    totalReferralTraffic: yData.referralSessions || 0,
    totalLeads: yData.leadsGenerated || 0,
    totalConversions: yData.conversions || 0,
    totalRevenue: yData.attributedRevenue || 0,
    platformBreakdown: snapshots.map((s) => ({
      platform: s.platform,
      referralSessions: (s.websiteTraffic && s.websiteTraffic.referralSessions) || 0,
      uniqueVisitors: (s.websiteTraffic && s.websiteTraffic.uniqueVisitors) || 0,
      leads: (s.websiteTraffic && s.websiteTraffic.leadsGenerated) || 0,
      conversions: (s.websiteTraffic && s.websiteTraffic.conversions) || 0,
      revenue: (s.websiteTraffic && s.websiteTraffic.attributedRevenue) || 0,
      conversionRate: s.websiteTraffic && s.websiteTraffic.referralSessions > 0
        ? Math.round(((s.websiteTraffic.conversions || 0) / s.websiteTraffic.referralSessions) * 1000) / 10
        : 0
    }))
  };

  // 9. 6-Dimensional Growth Score
  const growthScoreBreakdown = calculateGrowthScoreBreakdown(yData, prevData);
  const score = growthScoreBreakdown.overallScore;
  const grade = score >= 90 ? 'A+' : (score >= 80 ? 'A' : (score >= 70 ? 'B' : (score >= 60 ? 'C' : 'D')));

  // 10. Key Wins
  const keyWins = [];
  if (platformChampions.bestForReach.value > 0) {
    keyWins.push(`${capitalize(platformChampions.bestForReach.platform)} captured ${platformChampions.bestForReach.sharePercentage}% of total social reach.`);
  }
  if (downstreamAttribution.totalReferralTraffic > 0) {
    keyWins.push(`Social generated ${downstreamAttribution.totalReferralTraffic} direct website referral sessions.`);
  }
  if (downstreamAttribution.totalConversions > 0) {
    keyWins.push(`Closed ${downstreamAttribution.totalConversions} customer conversions ($${downstreamAttribution.totalRevenue.toLocaleString()} revenue).`);
  }
  if (!keyWins.length) {
    keyWins.push('Steady baseline engagement maintained across active social connections.');
  }

  // 11. Adaptive Report Mode
  let reportMode = 'normal';
  if (opportunities.length && opportunities.some((o) => o.priority === 'critical')) {
    reportMode = 'opportunity';
  } else if (risksAndProblems.length && risksAndProblems.some((r) => r.severity === 'critical')) {
    reportMode = 'performance_alert';
  } else if (downstreamAttribution.totalReferralTraffic >= 100 || (yData.impressions || 0) >= 10000) {
    reportMode = 'milestone';
  }

  // 12. Adaptive Executive Summary
  const topPlatform = platformChampions.bestForReach.platform;
  let executiveSummary = '';
  if (reportMode === 'opportunity') {
    executiveSummary = `GROWTH OPPORTUNITY DETECTED: Your ${topPlatform} engagement velocity is outperforming normal baseline. Moyi recommends capitalizing on this algorithmic momentum today with a targeted follow-up post.`;
  } else if (reportMode === 'performance_alert') {
    executiveSummary = `PERFORMANCE ALERT: ${risksAndProblems[0].title}. Primary signal: ${risksAndProblems[0].primarySignal}`;
  } else if (reportMode === 'milestone') {
    executiveSummary = `GROWTH MILESTONE: Multi-channel social ecosystem reached high-volume distribution yesterday with ${(yData.impressions || 0).toLocaleString()} impressions and ${downstreamAttribution.totalReferralTraffic} inbound visitors.`;
  } else {
    executiveSummary = `Yesterday, ${project.name}'s social channels generated ${(yData.impressions || 0).toLocaleString()} impressions and ${(yData.engagements || 0).toLocaleString()} engagements across active channels. ${capitalize(topPlatform)} was your strongest brand exposure driver, delivering ${downstreamAttribution.totalReferralTraffic} website referral visits. Performance is tracking on baseline.`;
  }

  // 13. Prioritized Today Action List (1-2-3 Execution)
  const todayActionList = [
    {
      priority: 1,
      action: (opportunities[0] && opportunities[0].title) || 'Review today\'s prepared Daily Content Intelligence draft in Content Studio.',
      platform: (opportunities[0] && opportunities[0].actionPayload && opportunities[0].actionPayload.platform) || topPlatform,
      expectedImpact: 'High audience reach & website engagement.',
      rationale: (opportunities[0] && opportunities[0].evidence) || 'Maintains daily organic visibility and search authority.'
    },
    {
      priority: 2,
      action: (diagnoses[0] && diagnoses[0].recommendedAction) || 'Audit landing page CTA links on primary social account bio.',
      platform: platformChampions.bestForWebsiteTraffic.platform || 'all',
      expectedImpact: 'Improves visitor conversion rate.',
      rationale: 'Closes the loop between social exposure and revenue.'
    },
    {
      priority: 3,
      action: 'Check Content Calendar for upcoming weekly campaigns and approved flyers.',
      platform: 'all',
      expectedImpact: 'Ensures consistent multi-channel publishing frequency.',
      rationale: 'Consistent cadence compounds domain authority and follower growth.'
    }
  ];

  const reportDate = normalizeDate(targetDate);
  const reportDoc = await DailyGrowthIntelligence.findOneAndUpdate(
    { projectId, date: reportDate },
    {
      $set: {
        projectId,
        date: reportDate,
        status: 'generated',
        reportMode,
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

  return reportDoc;
}

/**
 * Get or generate dashboard data for view
 */
async function getGrowthIntelligenceDashboardData(projectId, options = {}) {
  const targetDate = options.date ? new Date(options.date) : new Date();
  const date = normalizeDate(targetDate);

  let report = await DailyGrowthIntelligence.findOne({ projectId, date });
  if (!report || options.forceRefresh) {
    report = await generateDailyGrowthIntelligenceReport(projectId, targetDate);
  }

  const project = await Project.findById(projectId);
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
  calculateDelta,
  generateSocialUtmLink,
  detectContentFormat,
  detectContentCategory,
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
