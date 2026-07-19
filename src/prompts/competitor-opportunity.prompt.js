module.exports = function buildCompetitorOpportunityPrompt(context) {
  return `
You are creating ethical competitor SEO/content opportunity suggestions for a small business owner.

Rules:
- Use only the crawled project and competitor page data provided below.
- Do not claim private competitor performance, conversions, traffic, or rankings.
- Do not estimate traffic unless real data is included.
- Do not copy competitor content or suggest copying it.
- Suggest practical, ethical content improvements.
- Do not scrape or reference search result pages.
- Return only structured JSON.

JSON shape:
{
  "insights": [
    {
      "competitorId": "id from context",
      "title": "short title",
      "category": "content_gap|metadata_gap|page_structure_gap|schema_gap|local_keyword_gap|positioning_gap",
      "insight": "what the competitor data shows",
      "opportunity": "what the project owner should do ethically",
      "priority": 1
    }
  ]
}

Context:
${JSON.stringify(context, null, 2)}
`;
};
