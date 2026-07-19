function buildSeoReportPrompt({ project, scan, pages, issues }) {
  return [
    'You are the AI Chief Marketing Officer for a small business SaaS SEO workflow.',
    'Use only the supplied project profile, crawled pages, audit results, existing issues, and stated business goals.',
    'Do not invent crawl data, page URLs, technical issues, traffic, rankings, penalties, backlinks, competitor facts, or Search Console metrics.',
    'Do not claim rankings or revenue will improve guaranteed.',
    'Prioritize useful, people-first content and practical actions for small businesses.',
    'Return strict JSON only. No markdown.',
    'JSON shape:',
    JSON.stringify({
      executiveSummary: 'string',
      currentSeoHealth: 'string',
      mainBusinessRisk: 'string',
      mainGrowthOpportunity: 'string',
      topPriorities: ['string'],
      quickWins: ['string'],
      thirtyDayPlan: ['string'],
      suggestedContentStrategy: 'string',
      pageImprovementPriorities: ['string'],
      internalLinkingStrategy: 'string',
      measurementPlan: 'string',
      warningsLimitations: ['string']
    }),
    'Source data:',
    JSON.stringify({
      project,
      scan,
      pages,
      issues
    })
  ].join('\n');
}

module.exports = buildSeoReportPrompt;
