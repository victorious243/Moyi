const PaidAdAccount = require('../../models/PaidAdAccount');
const PaidAdEntity = require('../../models/PaidAdEntity');
const PaidAttribution = require('../../models/PaidAttribution');
const PaidBudgetRecommendation = require('../../models/PaidBudgetRecommendation');
const PaidMetricSnapshot = require('../../models/PaidMetricSnapshot');
const GrowthAlert = require('../../models/GrowthAlert');
const EngagementSnapshot = require('../../models/EngagementSnapshot');
const { getPaidAdsProvider, providerCatalog } = require('./providerRegistry');
const { accountWithSecrets, usableAccessToken } = require('./accountService');
const { aggregateMetrics, budgetPacing, calculateDerivedMetrics } = require('./metrics');
const { buildBudgetRecommendations, campaignHealth, detectAlerts } = require('./intelligenceService');

function isoDate(value) {
  return new Date(value).toISOString().slice(0, 10);
}

function startOfDay(value) {
  const date = new Date(value);
  date.setUTCHours(0, 0, 0, 0);
  return date;
}

function addDays(value, days) {
  const date = new Date(value);
  date.setUTCDate(date.getUTCDate() + days);
  return date;
}

function dateWindow(days = 7, end = new Date()) {
  const currentEnd = startOfDay(end);
  const currentStart = addDays(currentEnd, -(days - 1));
  const previousEnd = addDays(currentStart, -1);
  const previousStart = addDays(previousEnd, -(days - 1));
  return { currentStart, currentEnd, previousStart, previousEnd };
}

async function upsertInsight(account, row) {
  const entity = await PaidAdEntity.findOneAndUpdate(
    { accountId: account._id, level: row.level, externalId: row.externalId },
    {
      $set: {
        projectId: account.projectId,
        accountId: account._id,
        provider: account.provider,
        level: row.level,
        externalId: row.externalId,
        parentExternalId: row.parentExternalId || '',
        campaignExternalId: row.campaignExternalId || '',
        name: row.name,
        status: row.status,
        objective: row.objective,
        destinationUrl: row.destinationUrl || '',
        metadata: row.metadata || {}
      }
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
  await PaidMetricSnapshot.findOneAndUpdate(
    {
      accountId: account._id,
      level: row.level,
      externalEntityId: row.externalId,
      date: startOfDay(row.date)
    },
    {
      $set: {
        projectId: account.projectId,
        accountId: account._id,
        entityId: entity._id,
        provider: account.provider,
        level: row.level,
        externalEntityId: row.externalId,
        campaignExternalId: row.campaignExternalId || '',
        date: startOfDay(row.date),
        currency: row.currency || account.currency,
        metrics: row.metrics,
        availableMetrics: row.availableMetrics,
        providerData: row.providerData
      }
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
}

async function syncPaidAdAccount(accountId, { startDate, endDate } = {}) {
  const account = await accountWithSecrets(accountId);
  const provider = getPaidAdsProvider(account.provider);
  const end = endDate ? startOfDay(endDate) : startOfDay(new Date());
  const start = startDate ? startOfDay(startDate) : addDays(end, -30);
  account.syncStatus = 'syncing';
  account.lastSyncError = '';
  await account.save();
  try {
    const accessToken = await usableAccessToken(account);
    const rows = await provider.fetchInsights({
      account,
      accessToken,
      startDate: isoDate(start),
      endDate: isoDate(end)
    });
    for (const row of rows) await upsertInsight(account, row);
    account.syncStatus = 'succeeded';
    account.lastSyncedAt = new Date();
    account.lastSyncError = '';
    await account.save();
    return { accountId: account._id, rowsSynced: rows.length };
  } catch (error) {
    const classification = provider.classifyError(error);
    account.syncStatus = classification.code === 'rate_limited' ? 'rate_limited' : 'failed';
    if (classification.reconnectRequired) account.status = 'reconnect_required';
    account.lastSyncError = String(error.message || 'Provider sync failed.').slice(0, 500);
    await account.save();
    error.paidAdsClassification = classification;
    throw error;
  }
}

async function attributionByCampaign(projectId, start, end) {
  const rows = await PaidAttribution.aggregate([
    { $match: { projectId, attributedAt: { $gte: start, $lte: addDays(end, 1) } } },
    {
      $group: {
        _id: { provider: '$provider', campaignExternalId: '$campaignExternalId' },
        websiteSessions: { $addToSet: '$sessionId' },
        leads: { $sum: { $cond: [{ $eq: ['$funnelStage', 'lead'] }, 1, 0] } },
        qualifiedLeads: { $sum: { $cond: [{ $eq: ['$funnelStage', 'qualified_lead'] }, 1, 0] } },
        signups: { $sum: { $cond: [{ $eq: ['$funnelStage', 'signup'] }, 1, 0] } },
        purchases: { $sum: { $cond: [{ $in: ['$funnelStage', ['purchase', 'revenue']] }, 1, 0] } },
        attributedRevenue: { $sum: { $cond: [{ $in: ['$funnelStage', ['purchase', 'revenue']] }, '$value', 0] } },
        confidenceScore: { $avg: '$confidence.score' }
      }
    },
    {
      $project: {
        provider: '$_id.provider',
        campaignExternalId: '$_id.campaignExternalId',
        websiteSessions: { $size: '$websiteSessions' },
        leads: 1,
        qualifiedLeads: 1,
        signups: 1,
        purchases: 1,
        attributedRevenue: 1,
        confidenceScore: 1
      }
    }
  ]);
  return new Map(rows.map((row) => [`${row.provider}:${row.campaignExternalId}`, row]));
}

function mergeAttribution(metrics, attribution) {
  if (!attribution) return { metrics, confidence: null };
  const merged = calculateDerivedMetrics({
    ...metrics,
    websiteSessions: attribution.websiteSessions,
    leads: attribution.leads || metrics.leads,
    qualifiedLeads: attribution.qualifiedLeads,
    signups: attribution.signups,
    purchases: attribution.purchases,
    attributedRevenue: attribution.attributedRevenue
  });
  return {
    metrics: merged,
    confidence: {
      score: Math.round(attribution.confidenceScore || 0),
      band: attribution.confidenceScore >= 85 ? 'high' : attribution.confidenceScore >= 60 ? 'medium' : 'low'
    }
  };
}

async function campaignRows(projectId, start, end) {
  const [snapshots, attributions] = await Promise.all([
    PaidMetricSnapshot.find({ projectId, level: 'campaign', date: { $gte: start, $lte: end } }).lean(),
    attributionByCampaign(projectId, start, end)
  ]);
  const entities = await PaidAdEntity.find({
    _id: { $in: snapshots.map((snapshot) => snapshot.entityId) }
  }).lean();
  const entityMap = new Map(entities.map((entity) => [String(entity._id), entity]));
  const groups = new Map();
  snapshots.forEach((snapshot) => {
    const key = `${snapshot.provider}:${snapshot.externalEntityId}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(snapshot);
  });
  return Array.from(groups.entries()).map(([key, values]) => {
    const sample = values[0];
    const entity = entityMap.get(String(sample.entityId)) || {};
    const merged = mergeAttribution(
      aggregateMetrics(values),
      attributions.get(`${sample.provider}:${sample.campaignExternalId || sample.externalEntityId}`)
    );
    return {
      key,
      name: entity.name || sample.externalEntityId,
      provider: sample.provider,
      currency: sample.currency,
      externalId: sample.externalEntityId,
      metrics: merged.metrics,
      attributionConfidence: merged.confidence,
      entity
    };
  });
}

async function entityRows(projectId, start, end, level) {
  const snapshots = await PaidMetricSnapshot.find({
    projectId,
    level,
    date: { $gte: start, $lte: end }
  }).populate('entityId').lean();
  const groups = new Map();
  snapshots.forEach((snapshot) => {
    const key = `${snapshot.provider}:${snapshot.externalEntityId}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(snapshot);
  });
  return Array.from(groups.entries()).map(([key, values]) => ({
    key,
    name: (values[0].entityId && values[0].entityId.name) || values[0].externalEntityId,
    provider: values[0].provider,
    currency: values[0].currency,
    externalId: values[0].externalEntityId,
    metrics: aggregateMetrics(values),
    attributionConfidence: null,
    entity: values[0].entityId || {}
  }));
}

function aggregateChannels(campaigns) {
  const grouped = new Map();
  campaigns.forEach((campaign) => {
    const key = `${campaign.provider}:${campaign.currency}`;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(campaign);
  });
  return Array.from(grouped.entries()).map(([key, rows]) => ({
    key,
    name: rows[0].provider.replace('_ads', '').replace(/^./, (value) => value.toUpperCase()),
    provider: rows[0].provider,
    currency: rows[0].currency,
    metrics: aggregateMetrics(rows.map((row) => row.metrics)),
    campaignCount: rows.length
  }));
}

async function paidOrganicOpportunities(projectId, campaigns, start, end) {
  const organic = await EngagementSnapshot.aggregate([
    { $match: { projectId, capturedAt: { $gte: start, $lte: addDays(end, 1) } } },
    { $sort: { capturedAt: -1 } },
    {
      $group: {
        _id: '$publishJobId',
        platform: { $first: '$platform' },
        draftId: { $first: '$draftId' },
        engagementTotal: { $first: '$engagementTotal' },
        engagementRate: { $first: '$engagementRate' },
        impressions: { $first: '$metrics.impressions' },
        clicks: { $first: '$metrics.clicks' }
      }
    }
  ]);
  const opportunities = [];
  const organicWinners = organic
    .filter((row) => row.engagementRate !== null && row.engagementRate >= 0.03 && (row.engagementTotal || 0) >= 5)
    .sort((a, b) => b.engagementRate - a.engagementRate)
    .slice(0, 3);
  organicWinners.forEach((row) => opportunities.push({
    type: 'organic_to_paid_test',
    title: `Test a proven ${row.platform} post as paid creative`,
    evidence: `${(row.engagementRate * 100).toFixed(2)}% organic engagement across ${row.engagementTotal} measured engagements.`,
    recommendation: 'Create a controlled paid variant that preserves the winning hook and visual, then compare conversion quality.',
    confidence: row.impressions >= 500 ? 85 : 65
  }));

  campaigns.filter((campaign) => (
    (campaign.metrics.clicks || 0) >= 20 &&
    campaign.metrics.websiteSessions !== null &&
    campaign.metrics.websiteSessions / campaign.metrics.clicks < 0.5
  )).forEach((campaign) => opportunities.push({
    type: 'paid_traffic_landing_page_gap',
    title: `${campaign.name} is losing traffic before the landing session`,
    evidence: `${campaign.metrics.clicks} provider clicks produced ${campaign.metrics.websiteSessions} first-party sessions.`,
    recommendation: 'Audit page speed, redirects, consent behavior, tracking coverage, and message continuity before increasing spend.',
    confidence: campaign.attributionConfidence ? campaign.attributionConfidence.score : 60
  }));
  return opportunities;
}

async function evaluateIntelligence(projectId, currentCampaigns, previousCampaigns, window, persist = false, comparisons = []) {
  const generatedAlerts = [];
  const groups = [{ level: 'campaign', current: currentCampaigns, previous: previousCampaigns }, ...comparisons];
  for (const group of groups) {
    const previousMap = new Map(group.previous.map((entity) => [entity.key, entity]));
    for (const entity of group.current) {
      const previous = previousMap.get(entity.key);
      const pacing = group.level === 'campaign'
        ? budgetPacing({
          spend: entity.metrics.spend,
          budget: entity.metrics.budget,
          periodStart: window.currentStart,
          periodEnd: window.currentEnd,
          asOf: window.currentEnd
        })
        : { status: 'unknown', paceRatio: null, projectedSpend: null };
      if (group.level === 'campaign') {
        entity.pacing = pacing;
        entity.health = campaignHealth(entity.metrics, { pacing });
      }
      generatedAlerts.push(...detectAlerts({
        current: entity.metrics,
        previous: previous ? previous.metrics : {},
        pacing,
        entityName: entity.name,
        level: group.level
      }).map((item) => ({ ...item, entity })));
    }
  }

  if (!persist) return generatedAlerts;

  for (const item of generatedAlerts) {
    const periodKey = isoDate(window.currentEnd);
    await GrowthAlert.findOneAndUpdate(
      { projectId, dedupeKey: `paid:${item.type}:${item.entity.key}:${periodKey}` },
      {
        $set: {
          type: item.type,
          severity: item.severity,
          category: 'paid_performance',
          urgency: item.severity === 'critical' ? 'high' : 'normal',
          confidence: item.entity.attributionConfidence ? item.entity.attributionConfidence.score : 70,
          businessImpact: item.summary,
          title: item.title,
          summary: item.summary,
          evidenceData: item.evidenceData,
          recommendedAction: item.recommendedAction,
          ctaUrl: `/projects/${projectId}/performance-marketing`,
          ctaLabel: 'Review paid performance',
          channels: ['in_app'],
          deliveryPolicy: 'in_app_only',
          deliveryStatus: 'sent',
          dedupeKey: `paid:${item.type}:${item.entity.key}:${periodKey}`
        }
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
  }
  return generatedAlerts;
}

async function buildPerformanceMarketingDashboard(projectId, days = 7, options = {}) {
  const window = dateWindow(Math.min(90, Math.max(1, Number(days || 7))));
  const [accounts, currentCampaigns, previousCampaigns, currentCreatives, previousCreatives, currentAudiences, previousAudiences] = await Promise.all([
    PaidAdAccount.find({ projectId }).sort({ provider: 1, accountName: 1 }).lean(),
    campaignRows(projectId, window.currentStart, window.currentEnd),
    campaignRows(projectId, window.previousStart, window.previousEnd),
    entityRows(projectId, window.currentStart, window.currentEnd, 'creative'),
    entityRows(projectId, window.previousStart, window.previousEnd, 'creative'),
    entityRows(projectId, window.currentStart, window.currentEnd, 'audience'),
    entityRows(projectId, window.previousStart, window.previousEnd, 'audience')
  ]);
  const channels = aggregateChannels(currentCampaigns);
  const previousChannels = aggregateChannels(previousCampaigns);
  const currencies = Array.from(new Set(channels.map((channel) => channel.currency).filter(Boolean)));
  const totals = currencies.length <= 1 ? aggregateMetrics(channels.map((channel) => channel.metrics)) : null;
  const paidOrganic = await paidOrganicOpportunities(projectId, currentCampaigns, window.currentStart, window.currentEnd);
  const alerts = await evaluateIntelligence(
    projectId,
    currentCampaigns,
    previousCampaigns,
    window,
    Boolean(options.persist),
    [
      { level: 'creative', current: currentCreatives, previous: previousCreatives },
      { level: 'audience', current: currentAudiences, previous: previousAudiences }
    ]
  );
  const recommendations = buildBudgetRecommendations(channels, {
    start: window.currentStart,
    end: window.currentEnd
  });
  if (options.persist) {
    for (const recommendation of recommendations) {
      const evidenceKey = `${isoDate(recommendation.evidenceWindow.start)}:${isoDate(recommendation.evidenceWindow.end)}`;
      await Promise.all([
        PaidBudgetRecommendation.findOneAndUpdate(
          {
            projectId,
            type: recommendation.type,
            sourceProvider: recommendation.sourceProvider,
            destinationProvider: recommendation.destinationProvider,
            'evidenceWindow.start': recommendation.evidenceWindow.start,
            'evidenceWindow.end': recommendation.evidenceWindow.end
          },
          { $setOnInsert: { projectId, ...recommendation } },
          { upsert: true, new: true, setDefaultsOnInsert: true }
        ),
        GrowthAlert.findOneAndUpdate(
          { projectId, dedupeKey: `paid:budget_reallocation:${recommendation.sourceProvider}:${recommendation.destinationProvider}:${evidenceKey}` },
          {
            $set: {
              type: 'budget_reallocation_opportunity',
              severity: 'growth_opportunity',
              category: 'paid_performance',
              urgency: 'normal',
              confidence: recommendation.confidence,
              businessImpact: recommendation.businessImpact,
              title: recommendation.title,
              summary: recommendation.proposedChange,
              evidenceData: { evidence: recommendation.evidence, evidenceWindow: recommendation.evidenceWindow },
              recommendedAction: 'Review and explicitly approve or reject this proposed test. Moyi will not change provider budgets automatically.',
              ctaUrl: `/projects/${projectId}/performance-marketing`,
              ctaLabel: 'Review budget opportunity',
              channels: ['in_app'],
              deliveryPolicy: 'in_app_only',
              deliveryStatus: 'sent',
              dedupeKey: `paid:budget_reallocation:${recommendation.sourceProvider}:${recommendation.destinationProvider}:${evidenceKey}`
            }
          },
          { upsert: true, new: true, setDefaultsOnInsert: true }
        )
      ]);
    }
  }
  const storedRecommendations = await PaidBudgetRecommendation.find({ projectId, status: 'proposed' }).sort({ createdAt: -1 }).limit(10).lean();
  const creativePerformance = currentCreatives
    .slice()
    .sort((a, b) => (b.metrics.roas || 0) - (a.metrics.roas || 0));

  return {
    accounts,
    alerts,
    campaigns: currentCampaigns.sort((a, b) => (b.metrics.spend || 0) - (a.metrics.spend || 0)),
    channels,
    creativePerformance,
    currencies,
    hasMixedCurrencies: currencies.length > 1,
    previousChannels,
    paidOrganicOpportunities: paidOrganic,
    providerCatalog: providerCatalog(),
    recommendations: options.persist
      ? storedRecommendations
      : [...recommendations, ...storedRecommendations].slice(0, 10),
    totals,
    window
  };
}

async function syncPaidAdsProject(projectId, options = {}) {
  const accounts = await PaidAdAccount.find({ projectId, status: { $in: ['active', 'refresh_required'] } });
  const results = [];
  for (const account of accounts) {
    try {
      results.push(await syncPaidAdAccount(account._id, options));
    } catch (error) {
      results.push({ accountId: account._id, error: error.message, classification: error.paidAdsClassification || null });
    }
  }
  return results;
}

module.exports = {
  buildPerformanceMarketingDashboard,
  dateWindow,
  syncPaidAdAccount,
  syncPaidAdsProject
};
