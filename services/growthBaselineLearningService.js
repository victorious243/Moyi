/**
 * Growth Baseline Learning Engine Service
 *
 * Implements Section 13 (Historical Learning & Rolling Baselines):
 * 1. Maintains rolling baselines per platform, format, topic, timing, and CTA.
 * 2. Compares individual posts & daily performance against historical moving averages.
 * 3. Enforces minimum sample thresholds (>= 3 posts) before deriving causal insights.
 * 4. Grounded in deterministic mathematical calculations (no hallucinated assumptions).
 */

const ProjectGrowthBaseline = require('../models/ProjectGrowthBaseline');
const DailySocialSnapshot = require('../models/DailySocialSnapshot');
const PublishJob = require('../models/PublishJob');
const TrackingEvent = require('../models/TrackingEvent');
const ExperimentLearning = require('../models/ExperimentLearning');
const {
  daysAgo,
  detectContentFormat,
  detectContentCategory,
  SUPPORTED_PLATFORMS
} = require('./dailyGrowthIntelligenceService');

const MIN_SAMPLE_THRESHOLD = 3;

function safeNum(val, defaultVal = 0) {
  const n = Number(val);
  return Number.isFinite(n) ? n : defaultVal;
}

function detectCtaType(text = '') {
  const t = String(text || '').toLowerCase();
  if (/\?|what do you think|share your thoughts|agree\?/i.test(t)) return 'question';
  if (/trial|sign ?up|book.*demo|get started|try free/i.test(t)) return 'product_trial';
  if (/free guide|free scan|checklist|download|template|pdf|resource/i.test(t)) return 'lead_magnet';
  if (/http|link in|click here|check out/i.test(t)) return 'direct_link';
  return 'general';
}

/**
 * Calculate and persist rolling historical baselines for a project
 */
async function updateProjectGrowthBaselines(projectId, windowDays = 60) {
  const startDate = daysAgo(windowDays);

  const [snapshots, jobs, trackingEvents, experimentLearningRows] = await Promise.all([
    DailySocialSnapshot.find({ projectId, date: { $gte: startDate } }).lean(),
    PublishJob.find({
      $or: [{ projectId }, { destinationProjectId: projectId }],
      status: 'published',
      publishedAt: { $gte: startDate }
    })
      .populate('draftId')
      .lean(),
    TrackingEvent.find({ projectId, createdAt: { $gte: startDate } }).lean(),
    ExperimentLearning.find({ projectId, status: 'active' }).sort({ appliedAt: -1 }).limit(25).lean()
  ]);

  // 1. Overall Daily Baselines
  const daysCount = Math.max(1, Math.min(windowDays, new Set(snapshots.map((s) => s.date.toISOString().slice(0, 10))).size || 1));
  const totalDailyImp = snapshots.reduce((sum, s) => sum + (s.impressions || 0), 0);
  const totalDailyEng = snapshots.reduce((sum, s) => sum + (s.engagements || 0), 0);
  const totalReferrals = snapshots.reduce((sum, s) => sum + ((s.websiteTraffic && s.websiteTraffic.referralSessions) || 0), 0);
  const totalConversions = snapshots.reduce((sum, s) => sum + ((s.websiteTraffic && s.websiteTraffic.conversions) || 0), 0);

  const overall = {
    avgDailyImpressions: Math.round(totalDailyImp / daysCount),
    avgDailyEngagements: Math.round(totalDailyEng / daysCount),
    avgDailyReferralSessions: Math.round((totalReferrals / daysCount) * 10) / 10,
    avgDailyConversions: Math.round((totalConversions / daysCount) * 10) / 10,
    avgEngagementRate: totalDailyImp > 0 ? Math.round((totalDailyEng / totalDailyImp) * 1000) / 10 : 0,
    avgPostEngagements: jobs.length > 0 ? Math.round(totalDailyEng / jobs.length) : 0
  };

  // 2. Per-Platform Baselines
  const platformMap = new Map();
  SUPPORTED_PLATFORMS.forEach((p) => {
    platformMap.set(p, {
      platform: p,
      sampleSize: 0,
      totalImp: 0,
      totalEng: 0,
      totalReferrals: 0,
      rates: []
    });
  });

  snapshots.forEach((s) => {
    const p = s.platform;
    if (platformMap.has(p)) {
      const entry = platformMap.get(p);
      entry.sampleSize += s.postsPublished || 0;
      entry.totalImp += s.impressions || 0;
      entry.totalEng += s.engagements || 0;
      if (s.websiteTraffic) entry.totalReferrals += s.websiteTraffic.referralSessions || 0;
      if (s.impressions > 0) entry.rates.push((s.engagements / s.impressions) * 100);
    }
  });

  const platformBaselines = Array.from(platformMap.values()).map((p) => {
    const avgImp = Math.round(p.totalImp / daysCount);
    const avgEng = Math.round(p.totalEng / daysCount);
    const avgRate = p.totalImp > 0 ? Math.round((p.totalEng / p.totalImp) * 1000) / 10 : 0;
    
    // Compute standard deviation of engagement rate
    let stdDev = 0;
    if (p.rates.length > 1) {
      const mean = p.rates.reduce((sum, r) => sum + r, 0) / p.rates.length;
      const variance = p.rates.reduce((sum, r) => sum + Math.pow(r - mean, 2), 0) / p.rates.length;
      stdDev = Math.round(Math.sqrt(variance) * 10) / 10;
    }

    return {
      platform: p.platform,
      sampleSize: p.sampleSize,
      avgDailyImpressions: avgImp,
      avgDailyEngagements: avgEng,
      avgEngagementRate: avgRate,
      avgReferralSessions: Math.round((p.totalReferrals / daysCount) * 10) / 10,
      stdDevEngagementRate: stdDev
    };
  });

  // 3. Per-Format & Per-Topic & Per-CTA Baselines from Individual Posts
  const formatMap = new Map();
  const topicMap = new Map();
  const ctaMap = new Map();
  const timingMap = new Map();

  const baselinePostEng = overall.avgPostEngagements || 1;

  jobs.forEach((job) => {
    const metrics = job.metricsLatest || {};
    const imp = safeNum(metrics.impressions || metrics.reach || metrics.views, 0);
    const likes = safeNum(metrics.likes, 0);
    const comments = safeNum(metrics.comments, 0);
    const shares = safeNum(metrics.shares || metrics.quotes, 0);
    const saves = safeNum(metrics.saves, 0);
    const clicks = safeNum(metrics.clicks, 0);
    const eng = likes + comments + shares + saves + clicks;

    const format = detectContentFormat(job);
    const text = (job.draftId && job.draftId.body) || (job.content && job.content.text) || '';
    const topic = detectContentCategory(text);
    const cta = detectCtaType(text);

    // Format
    const fEntry = formatMap.get(format) || { format, sampleSize: 0, totalImp: 0, totalEng: 0, totalClicks: 0 };
    fEntry.sampleSize += 1;
    fEntry.totalImp += imp;
    fEntry.totalEng += eng;
    fEntry.totalClicks += clicks;
    formatMap.set(format, fEntry);

    // Topic
    const tEntry = topicMap.get(topic) || { topic, sampleSize: 0, totalImp: 0, totalEng: 0 };
    tEntry.sampleSize += 1;
    tEntry.totalImp += imp;
    tEntry.totalEng += eng;
    topicMap.set(topic, tEntry);

    // CTA
    const cEntry = ctaMap.get(cta) || { ctaType: cta, sampleSize: 0, totalClicks: 0, totalConversions: 0 };
    cEntry.sampleSize += 1;
    cEntry.totalClicks += clicks;
    ctaMap.set(cta, cEntry);

    // Timing
    const pubDate = new Date(job.publishedAt || job.createdAt);
    const day = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][pubDate.getUTCDay()];
    const hour = pubDate.getUTCHours();
    const hourWindow = hour < 12 ? '08:00 - 12:00 UTC' : (hour < 17 ? '12:00 - 17:00 UTC' : '17:00 - 21:00 UTC');
    const timingKey = `${job.platform}_${day}_${hourWindow}`;
    const timeEntry = timingMap.get(timingKey) || { platform: job.platform, dayOfWeek: day, hourWindow, sampleSize: 0, totalEng: 0 };
    timeEntry.sampleSize += 1;
    timeEntry.totalEng += eng;
    timingMap.set(timingKey, timeEntry);
  });

  const formatBaselines = Array.from(formatMap.values()).map((f) => {
    const avgImp = Math.round(f.totalImp / f.sampleSize);
    const avgEng = Math.round(f.totalEng / f.sampleSize);
    const avgRate = avgImp > 0 ? Math.round((avgEng / avgImp) * 1000) / 10 : 0;
    const mult = baselinePostEng > 0 ? Math.round((avgEng / baselinePostEng) * 10) / 10 : 1.0;
    return {
      format: f.format,
      sampleSize: f.sampleSize,
      avgImpressions: avgImp,
      avgEngagements: avgEng,
      avgEngagementRate: avgRate,
      avgClicks: Math.round(f.totalClicks / f.sampleSize),
      multiplierVsBaseline: f.sampleSize >= MIN_SAMPLE_THRESHOLD ? mult : 1.0
    };
  });

  const topicBaselines = Array.from(topicMap.values()).map((t) => {
    const avgImp = Math.round(t.totalImp / t.sampleSize);
    const avgEng = Math.round(t.totalEng / t.sampleSize);
    const avgRate = avgImp > 0 ? Math.round((avgEng / avgImp) * 1000) / 10 : 0;
    const mult = baselinePostEng > 0 ? Math.round((avgEng / baselinePostEng) * 10) / 10 : 1.0;
    return {
      topic: t.topic,
      sampleSize: t.sampleSize,
      avgImpressions: avgImp,
      avgEngagements: avgEng,
      avgEngagementRate: avgRate,
      multiplierVsBaseline: t.sampleSize >= MIN_SAMPLE_THRESHOLD ? mult : 1.0
    };
  });

  const timingBaselines = Array.from(timingMap.values()).map((t) => {
    const avgEng = Math.round(t.totalEng / t.sampleSize);
    const mult = baselinePostEng > 0 ? Math.round((avgEng / baselinePostEng) * 10) / 10 : 1.0;
    return {
      platform: t.platform,
      dayOfWeek: t.dayOfWeek,
      hourWindow: t.hourWindow,
      sampleSize: t.sampleSize,
      avgEngagements: avgEng,
      multiplierVsBaseline: t.sampleSize >= MIN_SAMPLE_THRESHOLD ? mult : 1.0
    };
  });

  const ctaBaselines = Array.from(ctaMap.values()).map((c) => ({
    ctaType: c.ctaType,
    sampleSize: c.sampleSize,
    avgClicks: Math.round((c.totalClicks / c.sampleSize) * 10) / 10,
    avgConversionRate: 0
  }));
  const experimentLearnings = experimentLearningRows.map((learning) => ({
    experimentId: learning.experimentId,
    experimentType: learning.experimentType,
    channel: learning.channel,
    primaryMetric: learning.primaryMetric,
    result: learning.result,
    decision: learning.decision,
    confidence: learning.confidence,
    appliedAt: learning.appliedAt
  }));

  const baselineDoc = await ProjectGrowthBaseline.findOneAndUpdate(
    { projectId },
    {
      $set: {
        projectId,
        calculatedWindowDays: windowDays,
        totalPostsAnalyzed: jobs.length,
        overall,
        platformBaselines,
        formatBaselines,
        topicBaselines,
        timingBaselines,
        ctaBaselines,
        experimentLearnings,
        lastCalculatedAt: new Date()
      }
    },
    { upsert: true, returnDocument: 'after' }
  );

  return baselineDoc;
}

/**
 * Compare a specific post to its topic and format historical baselines
 */
function comparePostAgainstBaseline(post = {}, baselines = {}) {
  const format = post.contentType || 'text';
  const topic = post.category || 'thought_leadership';
  const eng = safeNum(post.engagements, 0);

  const formatBase = (baselines.formatBaselines || []).find((f) => f.format === format);
  const topicBase = (baselines.topicBaselines || []).find((t) => t.topic === topic);
  const overallBase = (baselines.overall && baselines.overall.avgPostEngagements) || 1;

  const topicExpected = (topicBase && topicBase.avgEngagements) || overallBase;
  const multiplierVsTopic = topicExpected > 0 ? Math.round((eng / topicExpected) * 10) / 10 : 1.0;
  const isBreakout = multiplierVsTopic >= 2.0 && eng >= 20;

  return {
    isBreakout,
    multiplierVsTopic,
    topicExpected,
    sampleSufficient: (topicBase && topicBase.sampleSize >= MIN_SAMPLE_THRESHOLD) || false
  };
}

module.exports = {
  MIN_SAMPLE_THRESHOLD,
  detectCtaType,
  updateProjectGrowthBaselines,
  comparePostAgainstBaseline
};
