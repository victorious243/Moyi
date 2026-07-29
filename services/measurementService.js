const ContentDraft = require('../models/ContentDraft');
const ConversionGoal = require('../models/ConversionGoal');
const ProjectSearchProperty = require('../models/ProjectSearchProperty');
const Recommendation = require('../models/Recommendation');
const SearchMetric = require('../models/SearchMetric');
const TrackingEvent = require('../models/TrackingEvent');
const { normalizeUrl } = require('../utils/url');

function isoDate(date) {
  return new Date(date).toISOString().slice(0, 10);
}

function startOfDay(value) {
  const date = new Date(value);
  date.setUTCHours(0, 0, 0, 0);
  return date;
}

function endOfDay(value) {
  const date = new Date(value);
  date.setUTCHours(23, 59, 59, 999);
  return date;
}

function addDays(value, days) {
  const date = new Date(value);
  date.setUTCDate(date.getUTCDate() + Number(days || 0));
  return date;
}

function dayDiff(start, end) {
  const startTime = startOfDay(start).getTime();
  const endTime = startOfDay(end).getTime();
  return Math.max(0, Math.round((endTime - startTime) / 86400000));
}

function unique(values) {
  return Array.from(new Set(values.filter(Boolean)));
}

function numericChange(current, previous) {
  const delta = Number(current || 0) - Number(previous || 0);
  return {
    current: Number(current || 0),
    previous: Number(previous || 0),
    delta,
    percent: previous ? delta / previous : null
  };
}

function formatSignedNumber(value, digits = 0) {
  const amount = Number(value || 0);
  const sign = amount > 0 ? '+' : '';
  return `${sign}${amount.toFixed(digits)}`;
}

function formatSignedPercentPoints(value) {
  const amount = Number(value || 0) * 100;
  const sign = amount > 0 ? '+' : '';
  return `${sign}${amount.toFixed(2)}pp`;
}

function formatSignedPercent(value) {
  const amount = Number(value || 0) * 100;
  const sign = amount > 0 ? '+' : '';
  return `${sign}${amount.toFixed(1)}%`;
}

function normalizedUrlSet(urls = []) {
  return new Set(unique(urls.map((url) => {
    try {
      return normalizeUrl(url);
    } catch (error) {
      return '';
    }
  })));
}

function urlMatchesTargets(url, targets) {
  if (!targets || !targets.size) return true;
  try {
    return targets.has(normalizeUrl(url));
  } catch (error) {
    return false;
  }
}

function hasIdentity(event) {
  return Boolean(
    (event && event.resolvedCustomerId) ||
    (event && event.stripeCustomerId) ||
    (event && event.resolvedEmail)
  );
}

function hasAttributionSignal(event) {
  return Boolean(
    hasIdentity(event) ||
    (event && event.utmSource) ||
    (event && event.utmMedium) ||
    (event && event.utmCampaign)
  );
}

function summarizeSearchMetrics(metrics) {
  const clicks = metrics.reduce((sum, metric) => sum + Number(metric.clicks || 0), 0);
  const impressions = metrics.reduce((sum, metric) => sum + Number(metric.impressions || 0), 0);
  const weightedPosition = metrics.reduce((sum, metric) => sum + (Number(metric.position || 0) * Number(metric.impressions || 0)), 0);

  return {
    clicks,
    impressions,
    ctr: impressions ? clicks / impressions : 0,
    position: impressions ? weightedPosition / impressions : 0
  };
}

function summarizeTrackingWindow(events, targetUrls = null) {
  const targets = targetUrls instanceof Set ? targetUrls : normalizedUrlSet(targetUrls || []);
  const pageViews = events.filter((event) => event.eventType === 'page_view' && urlMatchesTargets(event.url, targets));
  const sessionIds = unique(pageViews.map((event) => event.sessionId));
  const scopedSessions = new Set(sessionIds);
  const scopedEvents = scopedSessions.size
    ? events.filter((event) => scopedSessions.has(event.sessionId))
    : [];
  const identifiedSessions = unique(scopedEvents.filter(hasIdentity).map((event) => event.sessionId));
  const attributedSessions = unique(scopedEvents.filter(hasAttributionSignal).map((event) => event.sessionId));
  const conversionEvents = scopedEvents.filter((event) => event.eventType === 'conversion');
  const convertingSessions = unique(conversionEvents.map((event) => event.sessionId));

  return {
    pageViews: pageViews.length,
    sessions: scopedSessions.size,
    conversions: conversionEvents.length,
    convertingSessions: convertingSessions.length,
    identifiedSessions: identifiedSessions.length,
    attributedSessions: attributedSessions.length,
    conversionRate: scopedSessions.size ? convertingSessions.length / scopedSessions.size : 0,
    identifiedRate: scopedSessions.size ? identifiedSessions.length / scopedSessions.size : 0,
    attributedRate: scopedSessions.size ? attributedSessions.length / scopedSessions.size : 0
  };
}

function summarizeProjectTrackingWindow(events) {
  const sessionIds = unique(events.map((event) => event.sessionId));
  const conversionEvents = events.filter((event) => event.eventType === 'conversion');
  const convertingSessions = unique(conversionEvents.map((event) => event.sessionId));
  const identifiedSessions = unique(events.filter(hasIdentity).map((event) => event.sessionId));
  const attributedSessions = unique(events.filter(hasAttributionSignal).map((event) => event.sessionId));

  return {
    pageViews: events.filter((event) => event.eventType === 'page_view').length,
    sessions: sessionIds.length,
    conversions: conversionEvents.length,
    convertingSessions: convertingSessions.length,
    identifiedSessions: identifiedSessions.length,
    attributedSessions: attributedSessions.length,
    conversionRate: sessionIds.length ? convertingSessions.length / sessionIds.length : 0,
    identifiedRate: sessionIds.length ? identifiedSessions.length / sessionIds.length : 0,
    attributedRate: sessionIds.length ? attributedSessions.length / sessionIds.length : 0
  };
}

function scoreAttributionReadiness({
  conversionGoalCount = 0,
  trackedConversions = 0,
  identifiedSessions = 0,
  attributedSessions = 0,
  revenueSourceConnected = false
}) {
  let score = 0;

  if (conversionGoalCount > 0) score += 20;
  if (trackedConversions > 0) score += 20;
  if (identifiedSessions > 0) score += identifiedSessions >= Math.max(1, Math.ceil(trackedConversions * 0.3)) ? 20 : 10;
  if (attributedSessions > 0) score += attributedSessions >= Math.max(1, Math.ceil(trackedConversions * 0.5)) ? 20 : 10;
  if (revenueSourceConnected) score += 20;

  return {
    score,
    level: score >= 80 ? 'High' : (score >= 50 ? 'Medium' : 'Low'),
    revenueReady: revenueSourceConnected,
    revenueStatus: revenueSourceConnected
      ? 'Real revenue records are connected, so revenue attribution can use source data instead of guesswork.'
      : 'Revenue attribution stays locked until a real payment or CRM source is connected. Until then, Moyi reports conversions and pipeline signals only.'
  };
}

function describeExecutionImpact({ visibilityChanges, trafficChanges, comparisonDays }) {
  if (comparisonDays < 3) {
    return {
      status: 'Too early to measure',
      whatChanged: [],
      whatMoved: [],
      whatDidNotMove: [
        'Not enough post-launch time has passed to compare before and after windows credibly.'
      ]
    };
  }

  const changed = [];
  const moved = [];
  const staticItems = [];
  let positiveSignals = 0;
  let negativeSignals = 0;

  if (visibilityChanges.clicks.delta !== 0) {
    changed.push(`Clicks ${formatSignedNumber(visibilityChanges.clicks.delta)} across the measured page set.`);
    if (visibilityChanges.clicks.delta > 0) {
      moved.push('Visibility turned into more search clicks.');
      positiveSignals += 1;
    } else {
      negativeSignals += 1;
    }
  } else {
    staticItems.push('Search clicks did not move yet.');
  }

  if (visibilityChanges.impressions.delta !== 0) {
    changed.push(`Impressions ${formatSignedNumber(visibilityChanges.impressions.delta)} after execution.`);
    if (visibilityChanges.impressions.delta > 0) {
      moved.push('Search visibility improved on the affected pages.');
      positiveSignals += 1;
    } else {
      negativeSignals += 1;
    }
  } else {
    staticItems.push('Search visibility stayed flat.');
  }

  if (Math.abs(visibilityChanges.ctr.delta) >= 0.0025) {
    changed.push(`CTR ${formatSignedPercentPoints(visibilityChanges.ctr.delta)} versus the baseline window.`);
    if (visibilityChanges.ctr.delta > 0) {
      moved.push('Snippet performance improved.');
      positiveSignals += 1;
    } else {
      negativeSignals += 1;
    }
  } else {
    staticItems.push('CTR has not materially changed yet.');
  }

  if (trafficChanges.conversions.delta !== 0) {
    changed.push(`Conversions from sessions touching the page ${formatSignedNumber(trafficChanges.conversions.delta)}.`);
    if (trafficChanges.conversions.delta > 0) {
      moved.push('More converting sessions are flowing through the affected page.');
      positiveSignals += 1;
    } else {
      negativeSignals += 1;
    }
  } else {
    staticItems.push('Conversion count from affected-page sessions has not moved yet.');
  }

  if (Math.abs(trafficChanges.conversionRate.delta) >= 0.01) {
    changed.push(`Page-level conversion rate ${formatSignedPercentPoints(trafficChanges.conversionRate.delta)}.`);
    if (trafficChanges.conversionRate.delta > 0) {
      moved.push('Traffic quality improved on the affected page sessions.');
      positiveSignals += 1;
    } else {
      negativeSignals += 1;
    }
  } else {
    staticItems.push('Page-level traffic quality is still broadly flat.');
  }

  if (Math.abs(trafficChanges.identifiedSessions.delta) > 0) {
    changed.push(`Identified sessions ${formatSignedNumber(trafficChanges.identifiedSessions.delta)}.`);
    if (trafficChanges.identifiedSessions.delta > 0) {
      moved.push('Pipeline signal quality improved through more identifiable sessions.');
      positiveSignals += 1;
    } else {
      negativeSignals += 1;
    }
  } else {
    staticItems.push('Identified pipeline signals did not materially change.');
  }

  return {
    status: positiveSignals > negativeSignals
      ? 'Moved'
      : (negativeSignals > positiveSignals ? 'Moved backward' : 'No clear movement yet'),
    whatChanged: changed,
    whatMoved: unique(moved),
    whatDidNotMove: unique(staticItems)
  };
}

async function buildAttributionReadiness(projectId) {
  const lookbackStart = startOfDay(addDays(new Date(), -89));
  const [goals, conversions, allEvents, property] = await Promise.all([
    ConversionGoal.countDocuments({ projectId }),
    TrackingEvent.find({
      projectId,
      createdAt: { $gte: lookbackStart },
      eventType: 'conversion'
    }).lean(),
    TrackingEvent.find({
      projectId,
      createdAt: { $gte: lookbackStart }
    }).lean(),
    ProjectSearchProperty.findOne({ projectId }).lean()
  ]);

  const identifiedSessions = unique(allEvents.filter(hasIdentity).map((event) => event.sessionId)).length;
  const attributedSessions = unique(allEvents.filter(hasAttributionSignal).map((event) => event.sessionId)).length;
  const readiness = scoreAttributionReadiness({
    conversionGoalCount: goals,
    trackedConversions: conversions.length,
    identifiedSessions,
    attributedSessions,
    revenueSourceConnected: false
  });

  return {
    ...readiness,
    conversionGoalCount: goals,
    trackedConversions: conversions.length,
    identifiedSessions,
    attributedSessions,
    searchConsoleConnected: Boolean(property),
    pipelineStatus: conversions.length
      ? 'Conversion tracking exists, so Moyi can talk about pipeline and conversion movement now.'
      : 'Conversion tracking is still too thin for strong before/after attribution claims.',
    rules: [
      'Revenue appears only when a real payment or CRM source exists.',
      'Until then, reports focus on conversions, identifiable sessions, and page-level movement.'
    ]
  };
}

async function buildTrackingComparison({ projectId, currentStart, currentEnd, previousStart, previousEnd }) {
  const [currentEvents, previousEvents] = await Promise.all([
    TrackingEvent.find({
      projectId,
      createdAt: { $gte: currentStart, $lte: currentEnd }
    }).lean(),
    TrackingEvent.find({
      projectId,
      createdAt: { $gte: previousStart, $lte: previousEnd }
    }).lean()
  ]);

  const current = summarizeProjectTrackingWindow(currentEvents);
  const previous = summarizeProjectTrackingWindow(previousEvents);

  return {
    current,
    previous,
    changes: {
      conversions: numericChange(current.conversions, previous.conversions),
      convertingSessions: numericChange(current.convertingSessions, previous.convertingSessions),
      identifiedSessions: numericChange(current.identifiedSessions, previous.identifiedSessions),
      attributedSessions: numericChange(current.attributedSessions, previous.attributedSessions),
      conversionRate: numericChange(current.conversionRate, previous.conversionRate),
      identifiedRate: numericChange(current.identifiedRate, previous.identifiedRate)
    }
  };
}

async function buildExecutionImpactSnapshot({ projectId, userId, period, websiteUrl = '' }) {
  const periodStart = startOfDay(period.periodStart);
  const periodEnd = endOfDay(period.periodEnd);
  const measurementWindowDays = Math.min(14, Math.max(7, Math.floor(Number(period.days || 7))));

  const publishedDrafts = await ContentDraft.find({
    projectId,
    status: 'published_manually',
    publishedAt: { $gte: periodStart, $lte: periodEnd }
  }).sort({ publishedAt: 1 }).lean();

  if (!publishedDrafts.length) {
    return {
      executedRecommendations: [],
      summary: {
        executedCount: 0,
        movedCount: 0,
        backwardCount: 0,
        noMovementCount: 0,
        tooEarlyCount: 0
      }
    };
  }

  const grouped = publishedDrafts.reduce((acc, draft) => {
    const key = String(draft.recommendationId || draft._id);
    acc[key] = acc[key] || [];
    acc[key].push(draft);
    return acc;
  }, {});
  const recommendationIds = unique(Object.keys(grouped));
  const recommendations = await Recommendation.find({ _id: { $in: recommendationIds } }).lean();
  const recommendationMap = new Map(recommendations.map((recommendation) => [String(recommendation._id), recommendation]));

  const executedRecommendations = [];
  for (const recommendationId of recommendationIds) {
    const drafts = grouped[recommendationId];
    const recommendation = recommendationMap.get(recommendationId);
    const executionDate = drafts.reduce((earliest, draft) => {
      const candidate = draft.publishedAt || draft.updatedAt || draft.createdAt;
      return !earliest || new Date(candidate) < new Date(earliest) ? candidate : earliest;
    }, null);
    const normalizedTargets = normalizedUrlSet([
      ...drafts.map((draft) => draft.targetUrl),
      ...(recommendation ? recommendation.targetUrls || [] : []),
      websiteUrl
    ]);

    const executionDay = startOfDay(executionDate);
    const availablePostDays = Math.max(1, dayDiff(executionDay, periodEnd) + 1);
    const comparisonDays = Math.min(measurementWindowDays, availablePostDays);
    const afterStart = executionDay;
    const afterEnd = endOfDay(addDays(afterStart, comparisonDays - 1) > periodEnd ? periodEnd : addDays(afterStart, comparisonDays - 1));
    const beforeStart = startOfDay(addDays(afterStart, -comparisonDays));
    const beforeEnd = endOfDay(addDays(afterStart, -1));

    const [metrics, events] = await Promise.all([
      SearchMetric.find({
        projectId,
        userId,
        date: { $gte: isoDate(beforeStart), $lte: isoDate(afterEnd) }
      }).lean(),
      TrackingEvent.find({
        projectId,
        createdAt: { $gte: beforeStart, $lte: afterEnd },
        eventType: { $in: ['page_view', 'conversion'] }
      }).lean()
    ]);

    const beforeMetrics = metrics.filter((metric) => {
      const metricDate = startOfDay(metric.date);
      return metricDate >= beforeStart && metricDate <= beforeEnd && urlMatchesTargets(metric.page, normalizedTargets);
    });
    const afterMetrics = metrics.filter((metric) => {
      const metricDate = startOfDay(metric.date);
      return metricDate >= afterStart && metricDate <= startOfDay(afterEnd) && urlMatchesTargets(metric.page, normalizedTargets);
    });

    const beforeEvents = events.filter((event) => event.createdAt >= beforeStart && event.createdAt <= beforeEnd);
    const afterEvents = events.filter((event) => event.createdAt >= afterStart && event.createdAt <= afterEnd);
    const beforeSearch = summarizeSearchMetrics(beforeMetrics);
    const afterSearch = summarizeSearchMetrics(afterMetrics);
    const beforeTraffic = summarizeTrackingWindow(beforeEvents, normalizedTargets);
    const afterTraffic = summarizeTrackingWindow(afterEvents, normalizedTargets);

    const visibilityChanges = {
      clicks: numericChange(afterSearch.clicks, beforeSearch.clicks),
      impressions: numericChange(afterSearch.impressions, beforeSearch.impressions),
      ctr: numericChange(afterSearch.ctr, beforeSearch.ctr),
      position: numericChange(afterSearch.position, beforeSearch.position)
    };
    const trafficChanges = {
      pageViews: numericChange(afterTraffic.pageViews, beforeTraffic.pageViews),
      sessions: numericChange(afterTraffic.sessions, beforeTraffic.sessions),
      conversions: numericChange(afterTraffic.conversions, beforeTraffic.conversions),
      convertingSessions: numericChange(afterTraffic.convertingSessions, beforeTraffic.convertingSessions),
      identifiedSessions: numericChange(afterTraffic.identifiedSessions, beforeTraffic.identifiedSessions),
      attributedSessions: numericChange(afterTraffic.attributedSessions, beforeTraffic.attributedSessions),
      conversionRate: numericChange(afterTraffic.conversionRate, beforeTraffic.conversionRate),
      identifiedRate: numericChange(afterTraffic.identifiedRate, beforeTraffic.identifiedRate)
    };
    const outcome = describeExecutionImpact({ visibilityChanges, trafficChanges, comparisonDays });

    executedRecommendations.push({
      recommendationId,
      recommendationTitle: recommendation ? recommendation.title : (drafts[0].title || 'Executed recommendation'),
      recommendationPriority: recommendation ? recommendation.priority : null,
      recommendationStatus: recommendation ? recommendation.status : '',
      actionType: recommendation ? recommendation.actionType : '',
      executionDate: executionDay.toISOString(),
      measurementWindow: {
        comparisonDays,
        beforeStart: isoDate(beforeStart),
        beforeEnd: isoDate(beforeEnd),
        afterStart: isoDate(afterStart),
        afterEnd: isoDate(afterEnd)
      },
      targetUrls: Array.from(normalizedTargets),
      assets: drafts.map((draft) => ({
        id: String(draft._id),
        title: draft.title || draft.type,
        type: draft.type,
        publishedAt: draft.publishedAt || draft.updatedAt
      })),
      visibility: {
        before: beforeSearch,
        after: afterSearch,
        changes: visibilityChanges
      },
      trafficQuality: {
        before: beforeTraffic,
        after: afterTraffic,
        changes: trafficChanges
      },
      revenue: {
        available: false,
        amount: 0,
        note: 'No real payment or CRM source is connected, so revenue stays out of this impact summary.'
      },
      outcome
    });
  }

  const summary = executedRecommendations.reduce((acc, item) => {
    acc.executedCount += 1;
    if (item.outcome.status === 'Moved') acc.movedCount += 1;
    if (item.outcome.status === 'Moved backward') acc.backwardCount += 1;
    if (item.outcome.status === 'No clear movement yet') acc.noMovementCount += 1;
    if (item.outcome.status === 'Too early to measure') acc.tooEarlyCount += 1;
    return acc;
  }, {
    executedCount: 0,
    movedCount: 0,
    backwardCount: 0,
    noMovementCount: 0,
    tooEarlyCount: 0
  });

  return {
    executedRecommendations,
    summary
  };
}

async function buildProjectMeasurementSnapshot({ projectId, userId, period, websiteUrl = '' }) {
  const currentStart = startOfDay(period.periodStart);
  const currentEnd = endOfDay(period.periodEnd);
  const previousStart = startOfDay(period.previousStart);
  const previousEnd = endOfDay(period.previousEnd);

  const [tracking, attributionReadiness, executionImpact] = await Promise.all([
    buildTrackingComparison({ projectId, currentStart, currentEnd, previousStart, previousEnd }),
    buildAttributionReadiness(projectId),
    buildExecutionImpactSnapshot({ projectId, userId, period, websiteUrl })
  ]);

  return {
    tracking,
    attributionReadiness,
    executionImpact
  };
}

module.exports = {
  buildAttributionReadiness,
  buildProjectMeasurementSnapshot,
  describeExecutionImpact,
  numericChange,
  scoreAttributionReadiness,
  summarizeProjectTrackingWindow,
  summarizeSearchMetrics,
  summarizeTrackingWindow
};
