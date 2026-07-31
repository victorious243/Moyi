function buildRecommendationPrompt({ project, scan, pages, issues, report }) {
  return [
    'Create prioritized SEO recommendations for an AI Chief Marketing Officer workflow.',
    'Use only the supplied factual crawl pages and existing audit issues.',
    'Do not invent page URLs or technical problems.',
    'Every target URL must come from the supplied pages or issues.',
    'Every relatedIssueId must come from the supplied issues.',
    'Return recommendations only when they are directly supported by supplied pages or issues.',
    'If there are supplied issues, return 5 to 8 issue-backed recommendations when possible.',
    'If no issue IDs are relevant for a recommendation, attach at least one supplied target URL and explain the crawl evidence behind it.',
    'If the supplied evidence does not support a recommendation, return an empty recommendations array.',
    'Do not guarantee ranking improvements.',
    'Prioritize useful, people-first content and practical small-business execution.',
    'Return strict JSON only. No markdown.',
    'JSON shape:',
    JSON.stringify({
      recommendations: [{
        title: 'string',
        category: 'string',
        priority: 1,
        reason: 'string',
        expectedImpact: 'string',
        effort: 'low',
        actionType: 'fix_metadata',
        relatedIssueIds: ['string'],
        targetUrls: ['string']
      }]
    }),
    'Allowed actionType values: fix_metadata, content, new_page, internal_linking, schema, technical, performance.',
    'Allowed effort values: low, medium, high.',
    'Source data:',
    JSON.stringify({
      project,
      scan,
      pages,
      issues,
      report
    })
  ].join('\n');
}

module.exports = buildRecommendationPrompt;
