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
const EngagementSnapshot = require('../models/EngagementSnapshot');
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

  const [snapshots, jobs, trackingEvents, experimentLearningRows, engagementSnapshots] = await Promise.all([
    DailySocialSnapshot.find({ projectId, date: { $gte: startDate } }).lean(),
    PublishJob.find({
      $or: [{ projectId }, { destinationProjectId: projectId }],
      status: 'published',
      publishedAt: { $gte: startDate }
    })
      .populate('draftId')
      .lean(),
    TrackingEvent.find({ projectId, createdAt: { $gte: startDate } }).lean(),
    ExperimentLearning.find({ projectId, status: 'active' }).sort({ appliedAt: -1 }).limit(25).lean(),
    EngagementSnapshot.find({ projectId, capturedAt: { $gte: startDate } }).sort({ capturedAt: -1 }).lean()
  ]);

  // 1. Overall Daily Baselines
  const stateValue = (snapshot, metric) => {
    const state = snapshot.metricStates && snapshot.metricStates[metric];
    if (state && state.status === 'verified' && Number.isFinite(Number(state.value))) return Number(state.value);
    return Number(snapshot[metric]) > 0 ? Number(snapshot[metric]) : null;
  };
  const verifiedRows = snapshots.filter((snapshot) => snapshot.dataStatus === 'verified');
  const verifiedDates = new Set(verifiedRows.map((snapshot) => new Date(snapshot.date).toISOString().slice(0, 10)));
  const daysCount = verifiedDates.size;
  const sumMetric = (metric) => verifiedRows.map((snapshot) => stateValue(snapshot, metric)).filter((value) => value !== null).reduce((sum, value) => sum + value, 0);
  const metricSamples = (metric) => verifiedRows.filter((snapshot) => stateValue(snapshot, metric) !== null).length;
  const totalDailyImp = sumMetric('impressions');
  const totalDailyEng = sumMetric('engagements');
  const trackedRows = snapshots.filter((snapshot) => snapshot.websiteTraffic && snapshot.websiteTraffic.measurementStatus === 'verified');
  const totalReferrals = trackedRows.reduce((sum, snapshot) => sum + Number(snapshot.websiteTraffic.referralSessions || 0), 0);
  const totalConversions = trackedRows.reduce((sum, snapshot) => sum + Number(snapshot.websiteTraffic.conversions || 0), 0);
  const latestEngagementByJob = new Map();
  engagementSnapshots.forEach((snapshot) => {
    const key = String(snapshot.publishJobId);
    if (!latestEngagementByJob.has(key)) latestEngagementByJob.set(key, snapshot);
  });
  const measuredPostEngagements = [...latestEngagementByJob.values()]
    .map((snapshot) => snapshot.engagementTotal)
    .filter(Number.isFinite);

  const overall = {
    avgDailyImpressions: metricSamples('impressions') ? Math.round(totalDailyImp / metricSamples('impressions')) : null,
    avgDailyEngagements: metricSamples('engagements') ? Math.round(totalDailyEng / metricSamples('engagements')) : null,
    avgDailyReferralSessions: trackedRows.length ? Math.round((totalReferrals / trackedRows.length) * 10) / 10 : null,
    avgDailyConversions: trackedRows.length ? Math.round((totalConversions / trackedRows.length) * 10) / 10 : null,
    avgEngagementRate: totalDailyImp > 0 && metricSamples('engagements') ? Math.round((totalDailyEng / totalDailyImp) * 1000) / 10 : null,
    avgPostEngagements: measuredPostEngagements.length ? Math.round(measuredPostEngagements.reduce((sum, value) => sum + value, 0) / measuredPostEngagements.length) : null
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
      impressionSamples: 0,
      engagementSamples: 0,
      referralSamples: 0,
      rates: []
    });
  });

  snapshots.forEach((s) => {
    const p = s.platform;
    if (platformMap.has(p)) {
      const entry = platformMap.get(p);
      const impressions = stateValue(s, 'impressions');
      const engagements = stateValue(s, 'engagements');
      if (impressions === null && engagements === null) return;
      entry.sampleSize += s.postsPublished || 0;
      if (impressions !== null) {
        entry.totalImp += impressions;
        entry.impressionSamples += 1;
      }
      if (engagements !== null) {
        entry.totalEng += engagements;
        entry.engagementSamples += 1;
      }
      if (s.websiteTraffic && s.websiteTraffic.measurementStatus === 'verified' && s.websiteTraffic.referralSessions !== null) {
        entry.totalReferrals += Number(s.websiteTraffic.referralSessions);
        entry.referralSamples += 1;
      }
      if (impressions > 0 && engagements !== null) entry.rates.push((engagements / impressions) * 100);
    }
  });

  const platformBaselines = Array.from(platformMap.values()).map((p) => {
    const avgImp = daysCount && p.impressionSamples ? Math.round(p.totalImp / daysCount) : null;
    const avgEng = daysCount && p.engagementSamples ? Math.round(p.totalEng / daysCount) : null;
    const avgRate = p.totalImp > 0 ? Math.round((p.totalEng / p.totalImp) * 1000) / 10 : null;
    
    // Compute standard deviation of engagement rate
    let stdDev = null;
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
      avgReferralSessions: daysCount && p.referralSamples ? Math.round((p.totalReferrals / daysCount) * 10) / 10 : null,
      stdDevEngagementRate: stdDev
    };
  });

  // 3. Per-Format & Per-Topic & Per-CTA Baselines from Individual Posts
  const formatMap = new Map();
  const topicMap = new Map();
  const ctaMap = new Map();
  const timingMap = new Map();

  const baselinePostEng = overall.avgPostEngagements;

  jobs.forEach((job) => {
    const measurement = latestEngagementByJob.get(String(job._id));
    if (!measurement || !Array.isArray(measurement.availableFields) || !measurement.availableFields.length) return;
    const available = new Set(measurement.availableFields);
    const metrics = measurement.metrics || {};
    const exposureField = available.has('impressions') ? 'impressions' : (available.has('views') ? 'views' : (available.has('reach') ? 'reach' : null));
    const imp = exposureField ? Number(metrics[exposureField]) : null;
    const interactions = ['likes', 'comments', 'shares', 'quotes', 'saves', 'clicks'].filter((field) => available.has(field));
    const eng = interactions.length ? interactions.reduce((sum, field) => sum + Number(metrics[field] || 0), 0) : null;
    const clicks = available.has('clicks') ? Number(metrics.clicks || 0) : null;
    if (imp === null && eng === null) return;

    const format = detectContentFormat(job);
    const text = (job.draftId && job.draftId.body) || (job.content && job.content.text) || '';
    const topic = detectContentCategory(text);
    const cta = detectCtaType(text);

    // Format
    const fEntry = formatMap.get(format) || { format, sampleSize: 0, totalImp: 0, totalEng: 0, totalClicks: 0, impSamples: 0, engSamples: 0, clickSamples: 0 };
    fEntry.sampleSize += 1;
    if (imp !== null) { fEntry.totalImp += imp; fEntry.impSamples += 1; }
    if (eng !== null) { fEntry.totalEng += eng; fEntry.engSamples += 1; }
    if (clicks !== null) { fEntry.totalClicks += clicks; fEntry.clickSamples += 1; }
    formatMap.set(format, fEntry);

    // Topic
    const tEntry = topicMap.get(topic) || { topic, sampleSize: 0, totalImp: 0, totalEng: 0, impSamples: 0, engSamples: 0 };
    tEntry.sampleSize += 1;
    if (imp !== null) { tEntry.totalImp += imp; tEntry.impSamples += 1; }
    if (eng !== null) { tEntry.totalEng += eng; tEntry.engSamples += 1; }
    topicMap.set(topic, tEntry);

    // CTA
    const cEntry = ctaMap.get(cta) || { ctaType: cta, sampleSize: 0, totalClicks: 0, clickSamples: 0 };
    cEntry.sampleSize += 1;
    if (clicks !== null) { cEntry.totalClicks += clicks; cEntry.clickSamples += 1; }
    ctaMap.set(cta, cEntry);

    // Timing
    const pubDate = new Date(job.publishedAt || job.createdAt);
    const day = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][pubDate.getUTCDay()];
    const hour = pubDate.getUTCHours();
    const hourWindow = hour < 12 ? '08:00 - 12:00 UTC' : (hour < 17 ? '12:00 - 17:00 UTC' : '17:00 - 21:00 UTC');
    if (eng !== null) {
      const timingKey = `${job.platform}_${day}_${hourWindow}`;
      const timeEntry = timingMap.get(timingKey) || { platform: job.platform, dayOfWeek: day, hourWindow, sampleSize: 0, totalEng: 0 };
      timeEntry.sampleSize += 1;
      timeEntry.totalEng += eng;
      timingMap.set(timingKey, timeEntry);
    }
  });

  const formatBaselines = Array.from(formatMap.values()).map((f) => {
    const avgImp = f.impSamples ? Math.round(f.totalImp / f.impSamples) : null;
    const avgEng = f.engSamples ? Math.round(f.totalEng / f.engSamples) : null;
    const avgRate = avgImp > 0 && avgEng !== null ? Math.round((avgEng / avgImp) * 1000) / 10 : null;
    const mult = baselinePostEng > 0 && avgEng !== null ? Math.round((avgEng / baselinePostEng) * 10) / 10 : null;
    return {
      format: f.format,
      sampleSize: f.sampleSize,
      avgImpressions: avgImp,
      avgEngagements: avgEng,
      avgEngagementRate: avgRate,
      avgClicks: f.clickSamples ? Math.round(f.totalClicks / f.clickSamples) : null,
      multiplierVsBaseline: f.sampleSize >= MIN_SAMPLE_THRESHOLD ? mult : null
    };
  });

  const topicBaselines = Array.from(topicMap.values()).map((t) => {
    const avgImp = t.impSamples ? Math.round(t.totalImp / t.impSamples) : null;
    const avgEng = t.engSamples ? Math.round(t.totalEng / t.engSamples) : null;
    const avgRate = avgImp > 0 && avgEng !== null ? Math.round((avgEng / avgImp) * 1000) / 10 : null;
    const mult = baselinePostEng > 0 && avgEng !== null ? Math.round((avgEng / baselinePostEng) * 10) / 10 : null;
    return {
      topic: t.topic,
      sampleSize: t.sampleSize,
      avgImpressions: avgImp,
      avgEngagements: avgEng,
      avgEngagementRate: avgRate,
      multiplierVsBaseline: t.sampleSize >= MIN_SAMPLE_THRESHOLD ? mult : null
    };
  });

  const timingBaselines = Array.from(timingMap.values()).map((t) => {
    const avgEng = Math.round(t.totalEng / t.sampleSize);
    const mult = baselinePostEng > 0 ? Math.round((avgEng / baselinePostEng) * 10) / 10 : null;
    return {
      platform: t.platform,
      dayOfWeek: t.dayOfWeek,
      hourWindow: t.hourWindow,
      sampleSize: t.sampleSize,
      avgEngagements: avgEng,
      multiplierVsBaseline: t.sampleSize >= MIN_SAMPLE_THRESHOLD ? mult : null
    };
  });

  const ctaBaselines = Array.from(ctaMap.values()).map((c) => ({
    ctaType: c.ctaType,
    sampleSize: c.sampleSize,
    avgClicks: c.clickSamples ? Math.round((c.totalClicks / c.clickSamples) * 10) / 10 : null,
    avgConversionRate: null
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
        totalPostsAnalyzed: latestEngagementByJob.size,
        measurementStatus: daysCount >= 7 && measuredPostEngagements.length >= MIN_SAMPLE_THRESHOLD ? 'ready' : (daysCount || measuredPostEngagements.length ? 'building' : 'insufficient_data'),
        verifiedBaselineDays: daysCount,
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
