const OpenAI = require('openai');
const env = require('../config/env');
const CmoReport = require('../models/CmoReport');
const ContentDraft = require('../models/ContentDraft');
const Page = require('../models/Page');
const ProjectSearchProperty = require('../models/ProjectSearchProperty');
const Recommendation = require('../models/Recommendation');
const Scan = require('../models/Scan');
const SearchMetric = require('../models/SearchMetric');
const SeoIssue = require('../models/SeoIssue');
const { buildProjectMeasurementSnapshot } = require('./measurementService');
const buildWeeklyPrompt = require('../src/prompts/weekly-cmo-report.prompt');
const buildMonthlyPrompt = require('../src/prompts/monthly-cmo-report.prompt');

const MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';

async function notifyProgress(handler, update) {
  if (typeof handler !== 'function') return;
  await handler(update);
}

function isoDate(date) {
  return date.toISOString().slice(0, 10);
}

function daysAgo(days) {
  const date = new Date();
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCDate(date.getUTCDate() - days);
  return date;
}

function periodForType(type) {
  const days = type === 'monthly' ? 30 : 7;
  const periodEnd = daysAgo(1);
  const periodStart = new Date(periodEnd);
  periodStart.setUTCDate(periodStart.getUTCDate() - days + 1);

  const previousEnd = new Date(periodStart);
  previousEnd.setUTCDate(previousEnd.getUTCDate() - 1);
  const previousStart = new Date(previousEnd);
  previousStart.setUTCDate(previousStart.getUTCDate() - days + 1);

  return {
    days,
    periodStart: isoDate(periodStart),
    periodEnd: isoDate(periodEnd),
    previousStart: isoDate(previousStart),
    previousEnd: isoDate(previousEnd)
  };
}

function summarize(metrics) {
  const clicks = metrics.reduce((sum, metric) => sum + (metric.clicks || 0), 0);
  const impressions = metrics.reduce((sum, metric) => sum + (metric.impressions || 0), 0);
  const weightedPosition = metrics.reduce((sum, metric) => sum + (metric.position || 0) * (metric.impressions || 0), 0);

  return {
    clicks,
    impressions,
    ctr: impressions ? clicks / impressions : 0,
    position: impressions ? weightedPosition / impressions : 0
  };
}

function change(current, previous) {
  const delta = current - previous;
  return {
    current,
    previous,
    delta,
    percent: previous ? delta / previous : null
  };
}

function groupBy(metrics, key) {
  const map = new Map();
  metrics.forEach((metric) => {
    const value = metric[key] || '(not set)';
    const item = map.get(value) || { value, clicks: 0, impressions: 0, weightedPosition: 0 };
    item.clicks += metric.clicks || 0;
    item.impressions += metric.impressions || 0;
    item.weightedPosition += (metric.position || 0) * (metric.impressions || 0);
    map.set(value, item);
  });

  return [...map.values()].map((item) => ({
    value: item.value,
    clicks: item.clicks,
    impressions: item.impressions,
    ctr: item.impressions ? item.clicks / item.impressions : 0,
    position: item.impressions ? item.weightedPosition / item.impressions : 0
  }));
}

function compareGroups(current, previous, keyName) {
  const previousMap = new Map(previous.map((item) => [item.value, item]));

  return current.map((item) => {
    const oldItem = previousMap.get(item.value) || { clicks: 0, impressions: 0, position: 0 };
    return {
      [keyName]: item.value,
      clicks: item.clicks,
      previousClicks: oldItem.clicks,
      clicksChange: item.clicks - oldItem.clicks,
      impressions: item.impressions,
      previousImpressions: oldItem.impressions,
      impressionsChange: item.impressions - oldItem.impressions,
      position: item.position,
      previousPosition: oldItem.position || null
    };
  });
}

async function buildMetricsSnapshot({ projectId, userId, type }) {
  const period = periodForType(type);
  const property = await ProjectSearchProperty.findOne({ projectId, userId }).lean();

  const [currentMetrics, previousMetrics] = property
    ? await Promise.all([
      SearchMetric.find({
        projectId,
        userId,
        date: { $gte: period.periodStart, $lte: period.periodEnd }
      }).lean(),
      SearchMetric.find({
        projectId,
        userId,
        date: { $gte: period.previousStart, $lte: period.previousEnd }
      }).lean()
    ])
    : [[], []];

  const currentSummary = summarize(currentMetrics);
  const previousSummary = summarize(previousMetrics);
  const currentPages = groupBy(currentMetrics, 'page').filter((item) => item.value !== '(not set)');
  const previousPages = groupBy(previousMetrics, 'page').filter((item) => item.value !== '(not set)');
  const currentQueries = groupBy(currentMetrics, 'query').filter((item) => item.value !== '(not set)');
  const previousQueries = groupBy(previousMetrics, 'query').filter((item) => item.value !== '(not set)');

  const pageComparison = compareGroups(currentPages, previousPages, 'page');
  const queryComparison = compareGroups(currentQueries, previousQueries, 'query');

  return {
    period,
    searchConsoleConnected: Boolean(property),
    siteUrl: property ? property.siteUrl : '',
    lastSyncedAt: property ? property.lastSyncedAt : null,
    current: currentSummary,
    previous: previousSummary,
    changes: {
      clicks: change(currentSummary.clicks, previousSummary.clicks),
      impressions: change(currentSummary.impressions, previousSummary.impressions),
      ctr: change(currentSummary.ctr, previousSummary.ctr),
      position: change(currentSummary.position, previousSummary.position)
    },
    topGainingPages: pageComparison.filter((item) => item.impressionsChange > 0).sort((a, b) => b.impressionsChange - a.impressionsChange).slice(0, 10),
    topLosingPages: pageComparison.filter((item) => item.impressionsChange < 0).sort((a, b) => a.impressionsChange - b.impressionsChange).slice(0, 10),
    topGainingQueries: queryComparison.filter((item) => item.impressionsChange > 0).sort((a, b) => b.impressionsChange - a.impressionsChange).slice(0, 10),
    lowCtrOpportunities: currentPages
      .filter((item) => item.impressions >= 50 && item.ctr < 0.02)
      .sort((a, b) => b.impressions - a.impressions)
      .slice(0, 10)
  };
}

async function buildOperationalContext({ project, userId, period }) {
  const [
    latestScan,
    openIssues,
    issueCounts,
    openRecommendations,
    recommendationCounts,
    contentCompleted,
    draftCounts,
    pages,
    totalPages
  ] = await Promise.all([
    Scan.findOne({ projectId: project._id }).sort({ createdAt: -1 }).lean(),
    SeoIssue.find({ project: project._id, status: { $ne: 'resolved' } }).sort({ severity: 1, createdAt: -1 }).limit(20).lean(),
    SeoIssue.aggregate([
      { $match: { project: project._id, status: { $ne: 'resolved' } } },
      { $group: { _id: '$severity', count: { $sum: 1 } } }
    ]),
    Recommendation.find({ projectId: project._id, status: { $in: ['pending', 'accepted', 'in_progress'] } }).sort({ priority: 1, createdAt: -1 }).limit(20).lean(),
    Recommendation.aggregate([
      { $match: { projectId: project._id } },
      { $group: { _id: '$status', count: { $sum: 1 } } }
    ]),
    ContentDraft.find({
      projectId: project._id,
      status: { $in: ['approved', 'published_manually'] },
      updatedAt: { $gte: new Date(period.periodStart), $lte: new Date(`${period.periodEnd}T23:59:59.999Z`) }
    }).sort({ updatedAt: -1 }).limit(20).lean(),
    ContentDraft.aggregate([
      { $match: { projectId: project._id } },
      { $group: { _id: '$status', count: { $sum: 1 } } }
    ]),
    Page.find({ projectId: project._id }).sort({ lastCrawledAt: -1 }).limit(20).lean(),
    Page.countDocuments({ projectId: project._id })
  ]);

  return {
    latestScan: latestScan ? {
      status: latestScan.status,
      pagesFound: latestScan.pagesFound,
      pagesScanned: latestScan.pagesScanned,
      completedAt: latestScan.completedAt
    } : null,
    openIssues: openIssues.map((issue) => ({
      severity: issue.severity,
      title: issue.title,
      url: issue.url,
      recommendation: issue.recommendation
    })),
    openRecommendations: openRecommendations.map((recommendation) => ({
      title: recommendation.title,
      priority: recommendation.priority,
      effort: recommendation.effort,
      status: recommendation.status,
      actionType: recommendation.actionType,
      targetUrls: recommendation.targetUrls
    })),
    contentActionsCompleted: contentCompleted.map((draft) => ({
      title: draft.title,
      type: draft.type,
      status: draft.status,
      targetUrl: draft.targetUrl,
      updatedAt: draft.updatedAt
    })),
    contentDraftStatusCounts: draftCounts.reduce((acc, item) => {
      acc[item._id] = item.count;
      return acc;
    }, {}),
    issueCounts: issueCounts.reduce((acc, item) => {
      acc[item._id] = item.count;
      return acc;
    }, {}),
    recommendationStatusCounts: recommendationCounts.reduce((acc, item) => {
      acc[item._id] = item.count;
      return acc;
    }, {}),
    totalPages,
    recentPages: pages.map((page) => ({
      url: page.url,
      title: page.title,
      statusCode: page.statusCode,
      h1: page.h1,
      wordCount: page.wordCount
    }))
  };
}

function buildEvidenceSnapshot({ operationalContext, measurementSnapshot }) {
  const issues = operationalContext.issueCounts || {};
  const recommendations = operationalContext.recommendationStatusCounts || {};
  const draftCounts = operationalContext.contentDraftStatusCounts || {};
  const latestScan = operationalContext.latestScan || {};
  const trackingCurrent = measurementSnapshot.tracking && measurementSnapshot.tracking.current
    ? measurementSnapshot.tracking.current
    : {};
  const readiness = measurementSnapshot.attributionReadiness || {};

  return {
    pagesScanned: Number(latestScan.pagesScanned || 0),
    pagesFound: Number(latestScan.pagesFound || operationalContext.totalPages || 0),
    criticalIssues: Number(issues.critical || 0),
    warnings: Number(issues.warning || 0),
    opportunities: Number(issues.opportunity || 0),
    openRecommendations: Number(recommendations.pending || 0)
      + Number(recommendations.accepted || 0)
      + Number(recommendations.in_progress || 0),
    acceptedRecommendations: Number(recommendations.accepted || 0),
    inProgressRecommendations: Number(recommendations.in_progress || 0),
    completedRecommendations: Number(recommendations.done || 0),
    approvedDrafts: Number(draftCounts.approved || 0),
    publishedDrafts: Number(draftCounts.published_manually || 0),
    completedContentThisPeriod: operationalContext.contentActionsCompleted.length,
    trackedSessions: Number(trackingCurrent.sessions || 0),
    trackedPageViews: Number(trackingCurrent.pageViews || 0),
    trackingReadinessScore: Number(readiness.score || 0)
  };
}

function projectContext(project) {
  return {
    name: project.name,
    websiteUrl: project.websiteUrl,
    industry: project.industry,
    targetAudience: project.targetAudience,
    targetCountry: project.targetCountry,
    mainGoal: project.mainGoal,
    mainOffer: project.mainOffer,
    brandTone: project.brandTone
  };
}

function parseJson(content) {
  const trimmed = String(content || '').trim();
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  const json = start >= 0 && end >= start ? trimmed.slice(start, end + 1) : trimmed;
  return JSON.parse(json);
}

function list(value, max = 12) {
  return Array.isArray(value) ? value.slice(0, max).map(String).filter(Boolean) : [];
}

function sanitizeAiReport(parsed) {
  return {
    summary: String(parsed.summary || ''),
    organicSearchPerformance: String(parsed.organicSearchPerformance || ''),
    wins: list(parsed.wins),
    losses: list(parsed.losses),
    opportunities: list(parsed.opportunities),
    nextActions: list(parsed.nextActions),
    nextSevenDaysActionPlan: list(parsed.nextSevenDaysActionPlan),
    nextThirtyDaysActionPlan: list(parsed.nextThirtyDaysActionPlan),
    warningsLimitations: list(parsed.warningsLimitations, 8)
  };
}

function formatNumber(value) {
  return new Intl.NumberFormat('en').format(Math.round(value || 0));
}

function formatPercent(value) {
  if (value === null || Number.isNaN(value)) return 'no previous data';
  return `${value >= 0 ? '+' : ''}${(value * 100).toFixed(1)}%`;
}

function buildSystemReport({ type, metricsSnapshot, operationalContext, measurementSnapshot, evidenceSnapshot = null }) {
  const hasMetrics = metricsSnapshot.searchConsoleConnected && metricsSnapshot.current.impressions > 0;
  const openRecommendations = operationalContext.openRecommendations.slice(0, 5).map((item) => item.title);
  const completedCount = operationalContext.contentActionsCompleted.length;
  const conversionChanges = measurementSnapshot.tracking.changes;
  const impactSummary = measurementSnapshot.executionImpact.summary;
  const readiness = measurementSnapshot.attributionReadiness;
  const evidence = evidenceSnapshot || buildEvidenceSnapshot({ operationalContext, measurementSnapshot });
  const hasScanEvidence = evidence.pagesScanned || evidence.pagesFound || evidence.criticalIssues || evidence.warnings || evidence.opportunities;
  const hasOperationalEvidence = hasScanEvidence || evidence.openRecommendations || evidence.approvedDrafts || evidence.publishedDrafts;

  const summary = hasMetrics
    ? `${type === 'monthly' ? 'Monthly' : 'Weekly'} update: organic search recorded ${formatNumber(metricsSnapshot.current.clicks)} clicks and ${formatNumber(metricsSnapshot.current.impressions)} impressions for the period, while conversions changed ${formatPercent(conversionChanges.conversions.percent)} against the prior window.`
    : hasOperationalEvidence
      ? `${type === 'monthly' ? 'Monthly' : 'Weekly'} update: no Search Console clicks or conversion events were measured in this window, but Moyi has factual workspace evidence to act on: ${formatNumber(evidence.pagesScanned)} pages scanned, ${formatNumber(evidence.criticalIssues)} critical issues, ${formatNumber(evidence.warnings)} warnings, and ${formatNumber(evidence.openRecommendations)} open recommendations.`
      : `Search Console performance data and conversion events are missing for this period, so this report is waiting for measurable input before it can judge performance.`;

  return {
    summary,
    organicSearchPerformance: hasMetrics
      ? `Clicks changed ${formatPercent(metricsSnapshot.changes.clicks.percent)}, impressions changed ${formatPercent(metricsSnapshot.changes.impressions.percent)}, CTR is ${(metricsSnapshot.current.ctr * 100).toFixed(2)}%, and average position is ${metricsSnapshot.current.position.toFixed(1)}.`
      : 'No Search Console metrics are available. Connect and sync Search Console to compare clicks, impressions, CTR, and average position.',
    wins: [
      completedCount ? `${completedCount} content action${completedCount === 1 ? '' : 's'} completed in this period.` : '',
      evidence.completedRecommendations ? `${evidence.completedRecommendations} recommendation${evidence.completedRecommendations === 1 ? '' : 's'} marked done in the workspace.` : '',
      metricsSnapshot.topGainingPages[0] ? `Top gaining page by impressions: ${metricsSnapshot.topGainingPages[0].page}.` : '',
      impactSummary.movedCount ? `${impactSummary.movedCount} executed recommendation${impactSummary.movedCount === 1 ? '' : 's'} showed positive movement.` : '',
      conversionChanges.conversions.delta > 0 ? `Tracked conversions increased by ${formatNumber(conversionChanges.conversions.delta)} versus the previous period.` : ''
    ].filter(Boolean),
    losses: [
      !hasMetrics && evidence.criticalIssues ? `${formatNumber(evidence.criticalIssues)} critical SEO issue${evidence.criticalIssues === 1 ? '' : 's'} remain open from scan evidence.` : '',
      !hasMetrics && evidence.warnings ? `${formatNumber(evidence.warnings)} warning${evidence.warnings === 1 ? '' : 's'} remain open from scan evidence.` : '',
      ...metricsSnapshot.topLosingPages
        .filter((item) => item.impressionsChange < 0)
        .slice(0, 3)
        .map((item) => `${item.page} lost ${formatNumber(Math.abs(item.impressionsChange))} impressions versus the previous period.`),
      ...(impactSummary.backwardCount ? [`${impactSummary.backwardCount} executed recommendation${impactSummary.backwardCount === 1 ? '' : 's'} moved backward and need review.`] : [])
    ],
    opportunities: [
      ...metricsSnapshot.lowCtrOpportunities.slice(0, 3).map((item) => `${item.value} has high impressions and low CTR.`),
      ...openRecommendations.slice(0, 3).map((title) => `Open recommendation: ${title}.`),
      !hasMetrics && hasScanEvidence ? 'Connect and sync Search Console so the next report can compare real clicks, impressions, CTR, and ranking movement against these scan findings.' : '',
      readiness.conversionGoalCount ? '' : 'Add at least one conversion goal so Moyi can measure pipeline actions instead of only visibility and scan evidence.',
      ...(impactSummary.noMovementCount ? [`${impactSummary.noMovementCount} executed recommendation${impactSummary.noMovementCount === 1 ? '' : 's'} did not move yet, so the page, proof, or CTA should be revisited.`] : [])
    ].filter(Boolean),
    nextActions: openRecommendations.length ? openRecommendations : ['Review open SEO recommendations and choose the next content or metadata action.'],
    nextSevenDaysActionPlan: openRecommendations.slice(0, 4),
    nextThirtyDaysActionPlan: [
      ...openRecommendations.slice(0, 6),
      'Run or refresh a website scan before the next report.'
    ],
    warningsLimitations: [
      hasMetrics ? '' : 'Search Console data was unavailable or empty for this period.',
      evidence.trackedSessions ? '' : 'No Moyi tracking sessions were recorded in this report window.',
      readiness.revenueStatus,
      'Revenue is never attributed here without a real payment or CRM source.'
    ].filter(Boolean)
  };
}

async function requestAiReport({ type, context }) {
  if (!env.openaiApiKey) return null;

  const client = new OpenAI({ apiKey: env.openaiApiKey });
  const prompt = type === 'monthly' ? buildMonthlyPrompt(context) : buildWeeklyPrompt(context);
  const response = await client.chat.completions.create({
    model: MODEL,
    temperature: 0.2,
    response_format: { type: 'json_object' },
    messages: [
      {
        role: 'system',
        content: 'You create evidence-based AI CMO reports from supplied data only. Do not invent rankings, conversions, or URLs.'
      },
      { role: 'user', content: prompt }
    ]
  });

  return sanitizeAiReport(parseJson(response.choices[0].message.content));
}

async function generateCmoReport({ project, userId, type, onProgress = null }) {
  await notifyProgress(onProgress, {
    currentStep: 'Loading Search Console performance snapshots',
    progressPercent: 15
  });
  const metricsSnapshot = await buildMetricsSnapshot({ projectId: project._id, userId, type });
  await notifyProgress(onProgress, {
    currentStep: 'Gathering audit, recommendation, and content context',
    progressPercent: 35
  });
  const operationalContext = await buildOperationalContext({ project, userId, period: metricsSnapshot.period });
  await notifyProgress(onProgress, {
    currentStep: 'Calculating before-and-after measurement impact',
    progressPercent: 55
  });
  const measurementSnapshot = await buildProjectMeasurementSnapshot({
    projectId: project._id,
    userId,
    period: metricsSnapshot.period,
    websiteUrl: project.websiteUrl
  });
  const context = {
    reportType: type,
    project: projectContext(project),
    metricsSnapshot,
    measurementSnapshot,
    auditAndOperations: operationalContext,
    evidenceSnapshot: buildEvidenceSnapshot({ operationalContext, measurementSnapshot })
  };

  let generatedBy = 'system';
  let aiModel = '';
  let reportBody = null;

  try {
    await notifyProgress(onProgress, {
      currentStep: 'Generating the measurement narrative',
      progressPercent: 78
    });
    reportBody = await requestAiReport({ type, context });
    if (reportBody) {
      generatedBy = 'ai';
      aiModel = MODEL;
    }
  } catch (error) {
    reportBody = null;
  }

  if (!reportBody) {
    await notifyProgress(onProgress, {
      currentStep: 'Composing the system fallback report',
      progressPercent: 82
    });
    reportBody = buildSystemReport({
      type,
      metricsSnapshot,
      operationalContext,
      measurementSnapshot,
      evidenceSnapshot: context.evidenceSnapshot
    });
  }

  await notifyProgress(onProgress, {
    currentStep: 'Saving the completed measurement report',
    progressPercent: 94
  });
  const report = await CmoReport.create({
    projectId: project._id,
    userId,
    type,
    periodStart: metricsSnapshot.period.periodStart,
    periodEnd: metricsSnapshot.period.periodEnd,
    ...reportBody,
    metricsSnapshot: {
      ...metricsSnapshot,
      measurement: measurementSnapshot,
      auditAndOperations: operationalContext,
      evidence: context.evidenceSnapshot
    },
    generatedBy,
    aiModel
  });
  await notifyProgress(onProgress, {
    currentStep: 'Measurement report is ready',
    progressPercent: 100
  });

  return report;
}

module.exports = {
  buildEvidenceSnapshot,
  buildSystemReport,
  generateCmoReport
};
