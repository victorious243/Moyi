const SocialDraft = require('../models/SocialDraft');
const Campaign = require('../models/Campaign');
const SocialAccount = require('../models/SocialAccount');
const SocialPostPerformance = require('../models/SocialPostPerformance');
const GrowthSignal = require('../models/GrowthSignal');
const { median, normalizedValue } = require('./socialPerformanceMath');

const DAY_MS = 24 * 60 * 60 * 1000;
const ANALYSIS_DAYS = 60;
const UPCOMING_DAYS = 30;
const CACHE_TTL_MS = 5 * 60 * 1000;
const MIN_PLATFORM_SAMPLE = 6;
const MIN_SEGMENT_SAMPLE = 3;
const STALE_AFTER_DAYS = 30;
const cache = new Map();

const SEVERITY_WEIGHT = Object.freeze({ critical: 4, warning: 3, opportunity: 2, info: 1 });
const CONFIDENCE_WEIGHT = Object.freeze({ high: 3, medium: 2, low: 1, insufficient: 0 });
const CONTENT_LABELS = Object.freeze({
  educational: 'Educational',
  promotional: 'Promotional',
  thought_leadership: 'Thought leadership',
  community: 'Engagement / community',
  product: 'Product',
  proof: 'Proof / case study',
  unknown: 'Unclassified'
});

function validDate(value) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

function idOf(value) {
  return String(value && value._id ? value._id : value || '');
}

function daysBetween(left, right) {
  return Math.max(0, (validDate(right) - validDate(left)) / DAY_MS);
}

function capitalize(value) {
  const text = String(value || '').replace(/_/g, ' ');
  return text ? text[0].toUpperCase() + text.slice(1) : '';
}

function localParts(date, timezone = 'UTC') {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    weekday: 'long',
    hour: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(date);
  const value = (type) => parts.find((part) => part.type === type)?.value || '';
  return { weekday: value('weekday'), hour: Number(value('hour')) };
}

function timeWindow(hour) {
  if (hour >= 6 && hour < 12) return { key: '06-12', label: '06:00-12:00', start: 6, end: 12 };
  if (hour >= 12 && hour < 17) return { key: '12-17', label: '12:00-17:00', start: 12, end: 17 };
  if (hour >= 17 && hour < 21) return { key: '17-21', label: '17:00-21:00', start: 17, end: 21 };
  return { key: '21-06', label: '21:00-06:00', start: 21, end: 6 };
}

function classifyContent(draft = {}) {
  const configured = String(
    draft.metadata?.contentCategory
    || draft.metadata?.category
    || draft.metadata?.objective
    || ''
  ).toLowerCase();
  const text = `${configured} ${draft.title || ''} ${draft.body || ''}`.toLowerCase();
  if (!text.trim() || text.trim().length < 20) return 'unknown';
  if (/case study|customer result|testimonial|proof|before and after|success story|client result/.test(text)) return 'proof';
  if (/discount|offer|sale|coupon|limited time|buy now|start trial|book a demo|pricing/.test(text)) return 'promotional';
  if (/product|feature|release|launch|new in|upgrade|roadmap|how it works/.test(text)) return 'product';
  if (/question|poll|community|share your|what do you think|tell us|join the conversation/.test(text)) return 'community';
  if (/how to|tutorial|guide|checklist|framework|tips|step by step|learn|explainer/.test(text)) return 'educational';
  if (/founder|opinion|perspective|lesson|industry|market|trend|insight|leadership/.test(text)) return 'thought_leadership';
  return 'unknown';
}

function performanceMetric(performance) {
  const normalized = performance.latestNormalizedMetrics || [];
  const rate = normalizedValue(normalized, 'socialEngagementRate');
  if (rate !== null) return { family: 'socialEngagementRate', value: rate };
  const engagement = normalizedValue(normalized, 'meaningfulEngagement');
  if (engagement !== null) return { family: 'meaningfulEngagement', value: engagement };
  return null;
}

function confidenceFor({ platformSample = 0, segmentSample = 0, consistency = 0, freshestAt, now }) {
  const sample = Math.min(1, platformSample / 12) * 0.35 + Math.min(1, segmentSample / 6) * 0.25;
  const recencyDays = freshestAt ? daysBetween(freshestAt, now) : 999;
  const recency = recencyDays <= 7 ? 1 : recencyDays <= 14 ? 0.8 : recencyDays <= 30 ? 0.5 : 0;
  const score = Math.round((sample + Math.min(1, consistency) * 0.2 + recency * 0.2) * 100);
  const level = score >= 78 ? 'high' : score >= 55 ? 'medium' : score >= 35 ? 'low' : 'insufficient';
  return { level, score, platformSample, segmentSample, consistency: Math.round(consistency * 100) / 100, recencyDays: Math.round(recencyDays) };
}

function makeInsight(input) {
  const insight = {
    type: input.type,
    title: input.title,
    summary: input.summary,
    classification: input.classification || 'measured',
    severity: input.severity || 'info',
    confidence: input.confidence || { level: 'high', score: 100 },
    evidence: input.evidence || { lines: [] },
    affectedDraftIds: (input.affectedDraftIds || []).map(String),
    recommendedAction: input.recommendedAction || null,
    urgency: Number(input.urgency || 0),
    generatedAt: input.generatedAt || new Date()
  };
  insight.rankScore = (SEVERITY_WEIGHT[insight.severity] || 0) * 100
    + (CONFIDENCE_WEIGHT[insight.confidence.level] || 0) * 20
    + Math.min(20, insight.urgency)
    + (insight.recommendedAction ? 10 : 0);
  return insight;
}

function futureDrafts(records, now, days = UPCOMING_DAYS) {
  const end = new Date(now.getTime() + days * DAY_MS);
  return records.filter((draft) => {
    const scheduled = validDate(draft.scheduledFor);
    return scheduled && scheduled >= now && scheduled < end && draft.publishStatus !== 'published';
  });
}

function buildContentMix(upcoming) {
  const counts = new Map();
  upcoming.forEach((draft) => {
    const category = classifyContent(draft);
    counts.set(category, (counts.get(category) || 0) + 1);
  });
  return [...counts.entries()]
    .map(([category, count]) => ({
      category,
      label: CONTENT_LABELS[category],
      count,
      percentage: upcoming.length ? Math.round((count / upcoming.length) * 100) : 0
    }))
    .sort((left, right) => right.count - left.count);
}

function measuredPerformances(performances, now) {
  const cutoff = new Date(now.getTime() - ANALYSIS_DAYS * DAY_MS);
  return performances.map((performance) => {
    const publishedAt = validDate(performance.publishedAt);
    const observedAt = validDate(performance.lastObservedAt);
    const metric = performanceMetric(performance);
    if (!publishedAt || publishedAt < cutoff || !observedAt || daysBetween(observedAt, now) > STALE_AFTER_DAYS || !metric) return null;
    return { performance, publishedAt, observedAt, metric };
  }).filter(Boolean);
}

function cadenceInsights({ drafts, performances, accounts, now, timezone, generatedAt }) {
  const insights = [];
  const historyStart = new Date(now.getTime() - 28 * DAY_MS);
  const nextWeekEnd = new Date(now.getTime() + 7 * DAY_MS);
  const history = performances.filter((item) => {
    const published = validDate(item.publishedAt);
    return published && published >= historyStart && published < now;
  });
  const upcoming = drafts.filter((draft) => {
    const scheduled = validDate(draft.scheduledFor);
    return scheduled && scheduled >= now && scheduled < nextWeekEnd && draft.publishStatus !== 'published';
  });
  const platforms = new Set([
    ...accounts.filter((account) => account.status === 'connected').map((account) => account.platform),
    ...history.map((row) => row.platform)
  ]);

  platforms.forEach((platform) => {
    const historicalCount = history.filter((row) => row.platform === platform).length;
    const historicalWeekly = historicalCount / 4;
    const futureRows = upcoming.filter((draft) => draft.channel === platform);
    const laterRows = futureDrafts(drafts, now, UPCOMING_DAYS)
      .filter((draft) => draft.channel === platform)
      .sort((left, right) => validDate(left.scheduledFor) - validDate(right.scheduledFor));
    const historicalDates = history.filter((row) => row.platform === platform).map((row) => validDate(row.publishedAt)).sort((left, right) => left - right);
    const historicalGaps = historicalDates.slice(1).map((date, index) => daysBetween(historicalDates[index], date));
    const normalGapDays = median(historicalGaps);
    const nextGapDays = laterRows[0] ? daysBetween(now, laterRows[0].scheduledFor) : null;
    if (historicalWeekly >= 1 && futureRows.length === 0) {
      const unusuallyLong = nextGapDays !== null && normalGapDays !== null && nextGapDays >= Math.max(7, normalGapDays * 2);
      insights.push(makeInsight({
        type: unusuallyLong ? 'unusually_long_gap' : 'platform_content_gap',
        title: unusuallyLong ? `${capitalize(platform)} has an unusually long publishing gap` : `${capitalize(platform)} has no content scheduled next week`,
        summary: unusuallyLong
          ? `The next ${capitalize(platform)} post is ${Math.round(nextGapDays)} days away versus a recent median gap of ${Math.round(normalGapDays * 10) / 10} days.`
          : `The recent measured cadence is ${Math.round(historicalWeekly * 10) / 10} posts per week, while the next seven days currently contain none.`,
        classification: 'measured',
        severity: historicalWeekly >= 3 ? 'warning' : 'opportunity',
        confidence: { level: historicalCount >= 12 ? 'high' : historicalCount >= 6 ? 'medium' : 'low', score: Math.min(95, 35 + historicalCount * 5), sampleSize: historicalCount },
        evidence: { lines: [`${historicalCount} ${capitalize(platform)} posts published in the previous 28 days`, '0 posts scheduled in the next 7 days', ...(unusuallyLong ? [`Recent median gap: ${Math.round(normalGapDays * 10) / 10} days`, `Next scheduled gap: ${Math.round(nextGapDays)} days`] : [])], windowDays: 28 },
        recommendedAction: { label: 'Generate content', href: 'content#planner' },
        urgency: 14,
        generatedAt
      }));
    } else if (historicalWeekly >= 2 && futureRows.length < historicalWeekly * 0.5) {
      insights.push(makeInsight({
        type: 'cadence_drop',
        title: `${capitalize(platform)} cadence is materially lighter next week`,
        summary: `Recent cadence averaged ${Math.round(historicalWeekly * 10) / 10} posts per week; ${futureRows.length} ${futureRows.length === 1 ? 'is' : 'are'} scheduled next week.`,
        classification: 'measured',
        severity: 'opportunity',
        confidence: { level: historicalCount >= 12 ? 'high' : 'medium', score: Math.min(90, 45 + historicalCount * 4), sampleSize: historicalCount },
        evidence: { lines: [`${historicalCount} published posts over 28 days`, `${futureRows.length} scheduled in the next 7 days`] },
        affectedDraftIds: futureRows.map((draft) => idOf(draft)),
        recommendedAction: { label: 'Review schedule', href: `calendar?view=week&platform=${encodeURIComponent(platform)}` },
        urgency: 8,
        generatedAt
      }));
    }
  });

  if (upcoming.length >= 6) {
    const weekdays = new Map();
    upcoming.forEach((draft) => {
      const day = localParts(validDate(draft.scheduledFor), timezone).weekday;
      weekdays.set(day, (weekdays.get(day) || 0) + 1);
    });
    const busiest = [...weekdays.entries()].sort((left, right) => right[1] - left[1])[0];
    const emptyBusinessDay = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'].find((day) => !weekdays.has(day));
    if (busiest && busiest[1] >= Math.ceil(upcoming.length * 0.5) && emptyBusinessDay) {
      insights.push(makeInsight({
        type: 'schedule_concentration',
        title: `Next week's schedule is concentrated on ${busiest[0]}`,
        summary: `${busiest[1]} of ${upcoming.length} posts are scheduled on ${busiest[0]}, while ${emptyBusinessDay} is open.`,
        classification: 'measured',
        severity: 'info',
        confidence: { level: 'high', score: 95, sampleSize: upcoming.length },
        evidence: { lines: [`${busiest[1]} of ${upcoming.length} scheduled posts fall on ${busiest[0]}`, `${emptyBusinessDay} has no scheduled post`] },
        affectedDraftIds: upcoming.filter((draft) => localParts(validDate(draft.scheduledFor), timezone).weekday === busiest[0]).map(idOf),
        recommendedAction: { label: 'Review schedule', href: 'calendar?view=week' },
        urgency: 4,
        generatedAt
      }));
    }
  }
  return insights;
}

function timingInsights({ measured, drafts, now, timezone, generatedAt }) {
  const insights = [];
  const byPlatform = new Map();
  measured.forEach((row) => {
    if (!byPlatform.has(row.performance.platform)) byPlatform.set(row.performance.platform, []);
    byPlatform.get(row.performance.platform).push(row);
  });
  const upcoming = futureDrafts(drafts, now, UPCOMING_DAYS);

  byPlatform.forEach((rows, platform) => {
    const family = rows.filter((row) => row.metric.family === 'socialEngagementRate').length >= MIN_PLATFORM_SAMPLE
      ? 'socialEngagementRate'
      : 'meaningfulEngagement';
    const comparable = rows.filter((row) => row.metric.family === family);
    if (comparable.length < MIN_PLATFORM_SAMPLE) return;
    const platformMedian = median(comparable.map((row) => row.metric.value));
    if (platformMedian === null || platformMedian <= 0) return;
    const windows = new Map();
    comparable.forEach((row) => {
      const parts = localParts(row.publishedAt, timezone);
      const window = timeWindow(parts.hour);
      const key = `${parts.weekday}:${window.key}`;
      const group = windows.get(key) || { weekday: parts.weekday, window, rows: [] };
      group.rows.push(row);
      windows.set(key, group);
    });
    const candidates = [...windows.values()].filter((group) => group.rows.length >= MIN_SEGMENT_SAMPLE).map((group) => {
      const segmentMedian = median(group.rows.map((row) => row.metric.value));
      const consistency = group.rows.filter((row) => row.metric.value > platformMedian).length / group.rows.length;
      return { ...group, segmentMedian, multiplier: segmentMedian / platformMedian, consistency };
    }).sort((left, right) => right.multiplier - left.multiplier);
    const best = candidates[0];
    if (!best || best.multiplier < 1.25) return;
    const confidence = confidenceFor({
      platformSample: comparable.length,
      segmentSample: best.rows.length,
      consistency: best.consistency,
      freshestAt: comparable.reduce((latest, row) => !latest || row.observedAt > latest ? row.observedAt : latest, null),
      now
    });
    if (confidence.level === 'insufficient') return;
    const affected = upcoming.filter((draft) => {
      if (draft.channel !== platform) return false;
      const parts = localParts(validDate(draft.scheduledFor), timezone);
      const window = timeWindow(parts.hour);
      return parts.weekday !== best.weekday || window.key !== best.window.key;
    });
    insights.push(makeInsight({
      type: 'stronger_timing_window',
      title: `${capitalize(platform)} has a stronger observed publishing window`,
      summary: `${best.weekday} ${best.window.label} produced ${Math.round((best.multiplier - 1) * 100)}% higher median ${family === 'socialEngagementRate' ? 'engagement rate' : 'meaningful engagement'} than the ${capitalize(platform)} baseline.`,
      classification: 'measured',
      severity: affected.length ? 'opportunity' : 'info',
      confidence,
      evidence: {
        lines: [
          `${best.rows.length} posts in ${best.weekday} ${best.window.label}`,
          `${comparable.length} comparable ${capitalize(platform)} posts in the last ${ANALYSIS_DAYS} days`,
          `Median comparison: ${Math.round(best.multiplier * 100) / 100}x`
        ],
        formula: 'segment median per-post metric / same-platform median per-post metric',
        metricFamily: family,
        correlationNotice: 'Observed association only; timing is not proven to be the cause.'
      },
      affectedDraftIds: affected.map(idOf),
      recommendedAction: affected.length ? { label: `Review ${affected.length} scheduled ${affected.length === 1 ? 'post' : 'posts'}`, href: `calendar?view=list&platform=${encodeURIComponent(platform)}` } : null,
      urgency: affected.length ? 7 : 1,
      generatedAt
    }));
  });
  return insights;
}

function performancePatternInsights({ measured, drafts, growthSignals, now, generatedAt }) {
  const insights = [];
  const draftById = new Map(drafts.map((draft) => [idOf(draft), draft]));
  const byPlatform = new Map();
  measured.forEach((row) => {
    if (!byPlatform.has(row.performance.platform)) byPlatform.set(row.performance.platform, []);
    byPlatform.get(row.performance.platform).push(row);
  });

  byPlatform.forEach((rows, platform) => {
    const family = rows.filter((row) => row.metric.family === 'socialEngagementRate').length >= MIN_PLATFORM_SAMPLE
      ? 'socialEngagementRate'
      : 'meaningfulEngagement';
    const comparable = rows.filter((row) => row.metric.family === family);
    if (comparable.length < MIN_PLATFORM_SAMPLE) return;
    const baseline = median(comparable.map((row) => row.metric.value));
    if (baseline === null || baseline <= 0) return;
    const groups = new Map();
    comparable.forEach((row) => {
      const format = String(row.performance.contentType || 'unknown');
      const group = groups.get(format) || [];
      group.push(row);
      groups.set(format, group);
    });
    const winner = [...groups.entries()].map(([format, groupRows]) => ({
      format,
      rows: groupRows,
      value: median(groupRows.map((row) => row.metric.value))
    })).filter((group) => group.rows.length >= MIN_SEGMENT_SAMPLE && group.value !== null)
      .sort((left, right) => right.value - left.value)[0];
    if (!winner || winner.value / baseline < 1.4) return;
    const consistency = winner.rows.filter((row) => row.metric.value > baseline).length / winner.rows.length;
    const confidence = confidenceFor({
      platformSample: comparable.length,
      segmentSample: winner.rows.length,
      consistency,
      freshestAt: comparable.reduce((latest, row) => !latest || row.observedAt > latest ? row.observedAt : latest, null),
      now
    });
    if (confidence.level === 'insufficient') return;
    const matchingSignals = growthSignals.filter((signal) => signal.platform === platform
      && signal.evidence?.contentType === winner.format
      && daysBetween(signal.observedAt, now) <= STALE_AFTER_DAYS);
    const upcomingMatches = futureDrafts(drafts, now).filter((draft) => draft.channel === platform && String(draft.metadata?.contentType || 'unknown') === winner.format);
    insights.push(makeInsight({
      type: 'content_format_advantage',
      title: `${capitalize(winner.format)} content is outperforming on ${capitalize(platform)}`,
      summary: `${capitalize(winner.format)} posts generated ${Math.round((winner.value / baseline) * 10) / 10}x the same-platform median ${family === 'socialEngagementRate' ? 'engagement rate' : 'meaningful engagement'}.`,
      classification: 'measured',
      severity: 'opportunity',
      confidence,
      evidence: {
        lines: [
          `${winner.rows.length} measured ${winner.format} posts`,
          `${comparable.length} comparable ${capitalize(platform)} posts`,
          `${matchingSignals.length} canonical GrowthSignal ${matchingSignals.length === 1 ? 'record' : 'records'} support this format comparison`
        ],
        growthSignalIds: matchingSignals.map(idOf),
        formula: 'format median per-post metric / same-platform median per-post metric'
      },
      affectedDraftIds: upcomingMatches.map(idOf),
      recommendedAction: { label: 'Create matching content', href: 'content#planner' },
      urgency: 5,
      generatedAt
    }));

    const topicGroups = new Map();
    comparable.forEach((row) => {
      const category = classifyContent(draftById.get(idOf(row.performance.draftId)) || {});
      if (category === 'unknown') return;
      const group = topicGroups.get(category) || [];
      group.push(row);
      topicGroups.set(category, group);
    });
    const topicWinner = [...topicGroups.entries()].map(([category, groupRows]) => ({ category, rows: groupRows, value: median(groupRows.map((row) => row.metric.value)) }))
      .filter((group) => group.rows.length >= MIN_SEGMENT_SAMPLE && group.value !== null)
      .sort((left, right) => right.value - left.value)[0];
    if (topicWinner && topicWinner.value / baseline >= 1.4) {
      const topicConfidence = confidenceFor({
        platformSample: comparable.length,
        segmentSample: topicWinner.rows.length,
        consistency: topicWinner.rows.filter((row) => row.metric.value > baseline).length / topicWinner.rows.length,
        freshestAt: comparable.reduce((latest, row) => !latest || row.observedAt > latest ? row.observedAt : latest, null),
        now
      });
      if (topicConfidence.level !== 'insufficient') {
        insights.push(makeInsight({
          type: 'content_topic_advantage',
          title: `${CONTENT_LABELS[topicWinner.category]} content is a measured ${capitalize(platform)} opportunity`,
          summary: `This content category produced ${Math.round((topicWinner.value / baseline) * 10) / 10}x the same-platform median ${family === 'socialEngagementRate' ? 'engagement rate' : 'meaningful engagement'}.`,
          classification: 'measured',
          severity: 'opportunity',
          confidence: topicConfidence,
          evidence: { lines: [`${topicWinner.rows.length} classified posts in this category`, `${comparable.length} comparable ${capitalize(platform)} posts`], formula: 'category median per-post metric / same-platform median per-post metric' },
          recommendedAction: { label: 'Create related content', href: 'content#planner' },
          urgency: 4,
          generatedAt
        }));
      }
    }
  });
  return insights;
}

function campaignInsights({ campaigns, drafts, now, generatedAt }) {
  const insights = [];
  const active = campaigns.filter((campaign) => {
    const end = validDate(campaign.endDate);
    return ['active', 'planned'].includes(campaign.status) && end && end >= now;
  });
  active.forEach((campaign) => {
    const campaignDrafts = drafts.filter((draft) => idOf(draft.campaignId) === idOf(campaign));
    const end = validDate(campaign.endDate);
    const upcoming = campaignDrafts.filter((draft) => {
      const scheduled = validDate(draft.scheduledFor);
      return scheduled && scheduled >= now && scheduled <= end && draft.publishStatus !== 'published';
    });
    const unscheduledApproved = campaignDrafts.filter((draft) => !validDate(draft.scheduledFor) && draft.status === 'approved');
    const remainingDays = Math.ceil(daysBetween(now, end));
    const expectedChannel = campaign.channel && campaign.channel !== 'multi' ? campaign.channel : '';
    const requiredChannelRows = expectedChannel ? upcoming.filter((draft) => draft.channel === expectedChannel) : upcoming;
    if (!upcoming.length && remainingDays > 0) {
      insights.push(makeInsight({
        type: 'campaign_content_gap',
        title: `${campaign.name} has no upcoming content`,
        summary: `The campaign ends in ${remainingDays} ${remainingDays === 1 ? 'day' : 'days'}, but no unpublished post is scheduled before its end date.`,
        classification: 'measured',
        severity: remainingDays <= 7 ? 'warning' : 'opportunity',
        confidence: { level: 'high', score: 100, sampleSize: campaignDrafts.length },
        evidence: { lines: [`Campaign end: ${end.toISOString().slice(0, 10)}`, `${campaignDrafts.length} total campaign assets`, '0 upcoming scheduled posts'] },
        recommendedAction: { label: 'Create campaign post', href: 'content#planner' },
        urgency: Math.max(1, 15 - remainingDays),
        generatedAt
      }));
    }
    if (expectedChannel && upcoming.length && !requiredChannelRows.length) {
      insights.push(makeInsight({
        type: 'campaign_channel_gap',
        title: `${campaign.name} lacks ${capitalize(expectedChannel)} coverage`,
        summary: `The campaign is configured for ${capitalize(expectedChannel)}, but none of its upcoming posts target that channel.`,
        classification: 'measured',
        severity: remainingDays <= 7 ? 'warning' : 'opportunity',
        confidence: { level: 'high', score: 100, sampleSize: upcoming.length },
        evidence: { lines: [`Campaign channel: ${capitalize(expectedChannel)}`, `${upcoming.length} upcoming campaign posts`, `0 upcoming ${capitalize(expectedChannel)} posts`] },
        affectedDraftIds: upcoming.map(idOf),
        recommendedAction: { label: `Create ${capitalize(expectedChannel)} post`, href: 'content#planner' },
        urgency: Math.max(2, 12 - remainingDays),
        generatedAt
      }));
    }
    if (unscheduledApproved.length && remainingDays <= 14) {
      insights.push(makeInsight({
        type: 'campaign_assets_unscheduled',
        title: `${campaign.name} has approved assets without a schedule`,
        summary: `${unscheduledApproved.length} approved ${unscheduledApproved.length === 1 ? 'asset remains' : 'assets remain'} unscheduled with ${remainingDays} ${remainingDays === 1 ? 'day' : 'days'} left.`,
        classification: 'measured',
        severity: remainingDays <= 7 ? 'warning' : 'opportunity',
        confidence: { level: 'high', score: 100, sampleSize: unscheduledApproved.length },
        evidence: { lines: [`${unscheduledApproved.length} approved unscheduled assets`, `Campaign ends in ${remainingDays} days`] },
        affectedDraftIds: unscheduledApproved.map(idOf),
        recommendedAction: { label: 'Schedule assets', href: `calendar?view=list&campaign=${encodeURIComponent(idOf(campaign))}` },
        urgency: Math.max(4, 15 - remainingDays),
        generatedAt
      }));
    }
  });
  return insights;
}

function contentMixInsight({ mix, drafts, measured, now, generatedAt }) {
  const upcoming = futureDrafts(drafts, now);
  if (upcoming.length < 4 || !mix.length || mix[0].category === 'unknown' || mix[0].percentage < 60) return null;
  const draftById = new Map(drafts.map((draft) => [idOf(draft), draft]));
  const byCategory = new Map();
  measured.forEach((row) => {
    const category = classifyContent(draftById.get(idOf(row.performance.draftId)) || {});
    if (category === 'unknown') return;
    const rows = byCategory.get(category) || [];
    rows.push(row);
    byCategory.set(category, rows);
  });
  const historical = [...byCategory.entries()].map(([category, rows]) => ({ category, rows, value: median(rows.map((row) => row.metric.value)) }))
    .filter((entry) => entry.rows.length >= MIN_SEGMENT_SAMPLE && entry.value !== null);
  const dominantHistory = historical.find((entry) => entry.category === mix[0].category);
  const stronger = historical.filter((entry) => !dominantHistory || entry.value > dominantHistory.value * 1.25).sort((left, right) => right.value - left.value)[0];
  if (!dominantHistory || !stronger) return null;
  return makeInsight({
    type: 'content_mix_opportunity',
    title: `Upcoming content is concentrated in ${mix[0].label.toLowerCase()} posts`,
    summary: `${mix[0].percentage}% of the next 30 days is ${mix[0].label.toLowerCase()}, while measured ${CONTENT_LABELS[stronger.category].toLowerCase()} posts have produced stronger per-post performance.`,
    classification: 'measured',
    severity: 'opportunity',
    confidence: confidenceFor({ platformSample: measured.length, segmentSample: Math.min(dominantHistory.rows.length, stronger.rows.length), consistency: 0.7, freshestAt: measured.reduce((latest, row) => !latest || row.observedAt > latest ? row.observedAt : latest, null), now }),
    evidence: { lines: [`${mix[0].count} of ${upcoming.length} upcoming posts are ${mix[0].label}`, `${stronger.rows.length} measured ${CONTENT_LABELS[stronger.category]} posts outperformed the dominant category median`], formula: 'category median per-post metric comparison' },
    affectedDraftIds: upcoming.filter((draft) => classifyContent(draft) === mix[0].category).map(idOf),
    recommendedAction: { label: 'Review content mix', href: 'calendar?view=list' },
    urgency: 3,
    generatedAt
  });
}

function buildCampaignCoverage(campaigns, drafts, now) {
  return campaigns.filter((campaign) => ['active', 'planned'].includes(campaign.status) && validDate(campaign.endDate) >= now).map((campaign) => {
    const rows = drafts.filter((draft) => idOf(draft.campaignId) === idOf(campaign));
    const channels = [...new Set(rows.map((draft) => draft.channel).filter(Boolean))];
    return {
      id: idOf(campaign),
      name: campaign.name,
      status: campaign.status,
      endDate: campaign.endDate,
      plannedPosts: rows.length,
      upcomingPosts: rows.filter((draft) => validDate(draft.scheduledFor) >= now && draft.publishStatus !== 'published').length,
      approvedUnscheduled: rows.filter((draft) => !validDate(draft.scheduledFor) && draft.status === 'approved').length,
      channels
    };
  });
}

function buildCalendarIntelligence({ drafts = [], campaigns = [], accounts = [], performances = [], growthSignals = [], now = new Date(), timezone = 'UTC' } = {}) {
  const generatedAt = new Date(now);
  const scheduled = futureDrafts(drafts, now);
  const measured = measuredPerformances(performances, now);
  const contentMix = buildContentMix(scheduled);
  const insights = [
    ...cadenceInsights({ drafts, performances, accounts, now, timezone, generatedAt }),
    ...campaignInsights({ campaigns, drafts, now, generatedAt }),
    ...timingInsights({ measured, drafts, now, timezone, generatedAt }),
    ...performancePatternInsights({ measured, drafts, growthSignals, now, generatedAt })
  ];
  const mixInsight = contentMixInsight({ mix: contentMix, drafts, measured, now, generatedAt });
  if (mixInsight) insights.push(mixInsight);
  insights.sort((left, right) => right.rankScore - left.rankScore || left.title.localeCompare(right.title));
  const newestEvidenceAt = measured.reduce((latest, row) => !latest || row.observedAt > latest ? row.observedAt : latest, null);
  const measuredByPlatform = measured.reduce((counts, row) => {
    counts[row.performance.platform] = (counts[row.performance.platform] || 0) + 1;
    return counts;
  }, {});
  const largestPlatformSample = Math.max(0, ...Object.values(measuredByPlatform));
  const stalePerformanceCount = performances.filter((performance) => performanceMetric(performance)
    && validDate(performance.lastObservedAt)
    && daysBetween(performance.lastObservedAt, now) > STALE_AFTER_DAYS).length;
  return {
    generatedAt,
    insights,
    featured: insights.slice(0, 4),
    contentMix,
    campaignCoverage: buildCampaignCoverage(campaigns, drafts, now),
    dataQuality: {
      status: largestPlatformSample >= MIN_PLATFORM_SAMPLE ? 'sufficient' : measured.length ? 'building' : 'insufficient',
      measuredPosts: measured.length,
      measuredByPlatform,
      largestPlatformSample,
      newestEvidenceAt,
      stalePerformanceCount,
      analysisWindowDays: ANALYSIS_DAYS,
      message: largestPlatformSample >= MIN_PLATFORM_SAMPLE
        ? `Performance recommendations use fresh, same-platform evidence from the last ${ANALYSIS_DAYS} days.`
        : measured.length
          ? `Moyi has ${measured.length} measured ${measured.length === 1 ? 'post' : 'posts'}. At least ${MIN_PLATFORM_SAMPLE} same-platform samples are required for timing and performance recommendations.`
          : 'Moyi needs more published-post performance data before it can recommend your best posting times.'
    },
    methodology: {
      timing: 'Same-platform median per-post engagement rate, falling back to meaningful engagement only when exposure is unavailable.',
      outliers: 'Medians are used so one viral post cannot dominate a recommendation.',
      freshness: `Performance evidence older than ${STALE_AFTER_DAYS} days is excluded.`,
      causality: 'Observed relationships are correlations and are never presented as proven causes.'
    }
  };
}

async function latestTimestamp(Model, projectId, field = 'updatedAt') {
  if (!Model || typeof Model.findOne !== 'function') return '';
  const row = await Model.findOne({ projectId }).sort({ [field]: -1 }).select(field).lean();
  const value = row && validDate(row[field]);
  return value ? value.toISOString() : '';
}

async function sourceFingerprint(models, projectId) {
  const [draft, campaign, account, performance, signal] = await Promise.all([
    latestTimestamp(models.SocialDraft, projectId),
    latestTimestamp(models.Campaign, projectId),
    latestTimestamp(models.SocialAccount, projectId),
    latestTimestamp(models.SocialPostPerformance, projectId),
    latestTimestamp(models.GrowthSignal, projectId, 'observedAt')
  ]);
  return [draft, campaign, account, performance, signal].join('|');
}

async function getCalendarIntelligence({ projectId, timezone = 'UTC', now = new Date(), models = {}, force = false } = {}) {
  const deps = { SocialDraft, Campaign, SocialAccount, SocialPostPerformance, GrowthSignal, ...models };
  const key = String(projectId);
  const fingerprint = await sourceFingerprint(deps, projectId);
  const existing = cache.get(key);
  if (!force && existing && existing.fingerprint === fingerprint && existing.expiresAt > Date.now()) return existing.value;
  const historyStart = new Date(now.getTime() - ANALYSIS_DAYS * DAY_MS);
  const futureEnd = new Date(now.getTime() + UPCOMING_DAYS * DAY_MS);
  const [drafts, campaigns, accounts, performances, growthSignals] = await Promise.all([
    deps.SocialDraft.find({ projectId, $or: [{ scheduledFor: { $gte: historyStart, $lte: futureEnd } }, { scheduledFor: null }, { scheduledFor: { $exists: false } }] }).select('_id campaignId channel title body status publishStatus metadata scheduledFor updatedAt').lean(),
    deps.Campaign.find({ projectId, endDate: { $gte: now }, status: { $in: ['active', 'planned'] } }).select('_id name goal channel startDate endDate status updatedAt').lean(),
    deps.SocialAccount.find({ projectId }).select('_id platform status updatedAt').lean(),
    deps.SocialPostPerformance.find({ projectId, publishedAt: { $gte: historyStart } }).select('_id draftId platform publishedAt contentType latestNormalizedMetrics lastObservedAt confidence scoreStatus updatedAt').lean(),
    deps.GrowthSignal.find({ projectId, observedAt: { $gte: historyStart }, signalType: 'social_post_performance' }).select('_id draftId platform score summary evidence observedAt').lean()
  ]);
  const value = buildCalendarIntelligence({ drafts, campaigns, accounts, performances, growthSignals, now, timezone });
  cache.set(key, { fingerprint, expiresAt: Date.now() + CACHE_TTL_MS, value });
  if (cache.size > 200) cache.delete(cache.keys().next().value);
  return value;
}

function clearCalendarIntelligenceCache(projectId) {
  if (projectId) cache.delete(String(projectId));
  else cache.clear();
}

module.exports = {
  ANALYSIS_DAYS,
  CACHE_TTL_MS,
  MIN_PLATFORM_SAMPLE,
  MIN_SEGMENT_SAMPLE,
  STALE_AFTER_DAYS,
  buildCalendarIntelligence,
  classifyContent,
  clearCalendarIntelligenceCache,
  confidenceFor,
  getCalendarIntelligence,
  performanceMetric,
  timeWindow
};
