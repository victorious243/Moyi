const METRIC_DEFINITIONS = Object.freeze({
  sessions: definition('Sessions', 'count', 'sum', 'day', 'Website visits grouped by first-party session.', ['tracking'], { minimumObservations: 28, directionality: 'higher' }),
  users: definition('Users', 'count', 'distinct', 'day', 'Distinct first-party visitors.', ['tracking'], { minimumObservations: 28, directionality: 'higher' }),
  page_views: definition('Page views', 'count', 'sum', 'day', 'Measured first-party page views.', ['tracking'], { minimumObservations: 28, directionality: 'context' }),
  traffic: definition('Traffic', 'count', 'sum', 'day', 'Measured website sessions from all tracked sources.', ['tracking'], { minimumObservations: 28, directionality: 'higher' }),
  organic_traffic: definition('Organic traffic', 'count', 'sum', 'day', 'Clicks reported by Google Search Console.', ['search_console'], { minimumObservations: 28, directionality: 'higher' }),
  paid_traffic: definition('Paid traffic', 'count', 'sum', 'day', 'Paid website sessions, or provider clicks when sessions are unavailable.', ['paid_ads'], { minimumObservations: 28, directionality: 'context' }),
  leads: definition('Leads', 'count', 'sum', 'day', 'Sessions reaching a configured lead event.', ['tracking', 'paid_ads', 'crm'], { minimumObservations: 28, directionality: 'higher' }),
  qualified_leads: definition('Qualified leads', 'count', 'sum', 'day', 'Leads reaching the configured qualified-lead stage.', ['tracking', 'paid_ads', 'crm'], { minimumObservations: 28, directionality: 'higher' }),
  mqls: definition('Marketing-qualified leads', 'count', 'sum', 'day', 'Leads classified as marketing qualified by an integrated source.', ['crm'], { minimumObservations: 28, directionality: 'higher' }),
  sqls: definition('Sales-qualified leads', 'count', 'sum', 'day', 'Leads classified as sales qualified by an integrated source.', ['crm'], { minimumObservations: 28, directionality: 'higher' }),
  signups: definition('Signups', 'count', 'sum', 'day', 'Sessions reaching a configured signup event.', ['tracking'], { minimumObservations: 28, directionality: 'higher' }),
  conversions: definition('Conversions', 'count', 'sum', 'day', 'Distinct sessions reaching a configured conversion.', ['tracking', 'paid_ads'], { minimumObservations: 28, directionality: 'higher' }),
  purchases: definition('Purchases', 'count', 'sum', 'day', 'Verified purchase events.', ['tracking', 'commerce'], { minimumObservations: 28, directionality: 'higher' }),
  revenue: definition('Revenue', 'currency', 'sum', 'day', 'Revenue received through verified first-party or attributed events.', ['tracking', 'paid_ads', 'commerce', 'crm'], { minimumObservations: 28, directionality: 'higher', maximumBacktestError: 0.4 }),
  conversion_rate: definition('Conversion rate', 'percent', 'ratio', 'day', 'Conversions divided by eligible sessions.', ['tracking'], { requiredInputs: ['conversions', 'traffic'], minimumObservations: 28, directionality: 'higher' }),
  aov: definition('Average order value', 'currency', 'ratio', 'day', 'Revenue divided by verified purchases.', ['tracking', 'commerce'], { requiredInputs: ['revenue', 'purchases'], minimumObservations: 28, directionality: 'higher' }),
  cac: definition('Customer acquisition cost', 'currency', 'ratio', 'day', 'Acquisition spend divided by verified new customers or the configured acquisition stage.', ['paid_ads', 'crm'], { requiredInputs: ['spend', 'customers'], minimumObservations: 42, directionality: 'lower', maximumBacktestError: 0.35 }),
  cpa: definition('Cost per acquisition', 'currency', 'ratio', 'day', 'Spend divided by verified conversions.', ['paid_ads'], { requiredInputs: ['spend', 'conversions'], minimumObservations: 28, directionality: 'lower' }),
  cpl: definition('Cost per lead', 'currency', 'ratio', 'day', 'Spend divided by verified leads.', ['paid_ads'], { requiredInputs: ['spend', 'leads'], minimumObservations: 28, directionality: 'lower' }),
  roas: definition('Return on ad spend', 'ratio', 'ratio', 'day', 'Attributed revenue divided by ad spend.', ['paid_ads', 'tracking'], { requiredInputs: ['revenue', 'spend'], minimumObservations: 42, directionality: 'higher', maximumBacktestError: 0.35 }),
  spend: definition('Campaign spend', 'currency', 'sum', 'day', 'Provider-reported advertising spend.', ['paid_ads'], { minimumObservations: 28, directionality: 'context' }),
  impressions: definition('Impressions', 'count', 'sum', 'day', 'Provider-reported content or campaign impressions.', ['social', 'paid_ads'], { minimumObservations: 28, directionality: 'context' }),
  clicks: definition('Clicks', 'count', 'sum', 'day', 'Provider-reported clicks.', ['paid_ads', 'social'], { minimumObservations: 28, directionality: 'higher' }),
  ctr: definition('Click-through rate', 'percent', 'ratio', 'day', 'Clicks divided by impressions.', ['paid_ads', 'search_console'], { requiredInputs: ['clicks', 'impressions'], minimumObservations: 28, directionality: 'higher' }),
  search_clicks: definition('Organic clicks', 'count', 'sum', 'day', 'Clicks reported by Google Search Console.', ['search_console'], { minimumObservations: 28, directionality: 'higher' }),
  search_impressions: definition('Organic impressions', 'count', 'sum', 'day', 'Impressions reported by Google Search Console.', ['search_console'], { minimumObservations: 28, directionality: 'context' }),
  ranking_position: definition('Ranking position', 'position', 'weighted_average', 'day', 'Impression-weighted average Search Console position.', ['search_console'], { minimumObservations: 28, directionality: 'lower' }),
  social_engagement: definition('Social engagement', 'count', 'sum', 'day', 'Verified provider likes, comments, shares, saves, and related actions.', ['social'], { minimumObservations: 28, directionality: 'higher' }),
  followers: definition('Followers', 'count', 'latest', 'day', 'Provider-reported account audience size.', ['social'], { minimumObservations: 28, directionality: 'higher' }),
  reach: definition('Reach', 'count', 'sum', 'day', 'Provider-reported unique reach where available.', ['social', 'paid_ads'], { minimumObservations: 28, directionality: 'context' }),
  video_views: definition('Video views', 'count', 'sum', 'day', 'Provider-reported qualifying video views.', ['social', 'paid_ads'], { minimumObservations: 28, directionality: 'context' }),
  email_opens: definition('Email opens', 'count', 'sum', 'day', 'Provider-reported email opens, subject to privacy limitations.', ['email'], { minimumObservations: 28, directionality: 'context' }),
  email_clicks: definition('Email clicks', 'count', 'sum', 'day', 'Provider-reported email link clicks.', ['email'], { minimumObservations: 28, directionality: 'higher' })
});

function definition(displayName, unit, aggregationMethod, grain, businessMeaning, sources, options = {}) {
  return Object.freeze({
    displayName,
    unit,
    aggregationMethod,
    grain,
    businessMeaning,
    sources,
    requiredInputs: options.requiredInputs || [],
    reliabilityRequirements: { minimumQualityScore: 70, minimumDensity: 0.8, maximumStalenessDays: 3, ...(options.reliabilityRequirements || {}) },
    minimumObservations: options.minimumObservations || 28,
    establishedObservations: options.establishedObservations || 56,
    maximumBacktestError: options.maximumBacktestError || 0.45,
    anomalyRules: options.anomalyRules || { minimumMagnitudePct: 15, minimumPersistenceDays: 2 },
    directionality: options.directionality || 'context',
    supportedComparisons: options.supportedComparisons || ['period_over_period', 'rolling_trend', 'goal_pacing']
  });
}

function metricDefinition(metric) {
  return METRIC_DEFINITIONS[metric] || null;
}

function isForecastEligibleMetric(metric) {
  return Boolean(metricDefinition(metric));
}

module.exports = { METRIC_DEFINITIONS, isForecastEligibleMetric, metricDefinition };
