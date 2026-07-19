module.exports = function buildMonthlyCmoReportPrompt(context) {
  return `
You are generating a monthly executive AI Chief Marketing Officer report for a small business owner.

Rules:
- Use only the project, audit, recommendation, content draft, and Search Console metrics provided below.
- Do not invent rankings, conversions, revenue, leads, traffic sources, or page URLs.
- If Search Console data is missing, say performance data is missing and explain what can still be reviewed.
- Be honest about limitations.
- Explain changes in simple business language.
- Focus on what the owner should do next.
- Do not guarantee ranking improvements.
- Return only structured JSON.

JSON shape:
{
  "summary": "Executive summary",
  "organicSearchPerformance": "Plain-language search performance explanation",
  "wins": ["win"],
  "losses": ["loss"],
  "opportunities": ["opportunity"],
  "nextActions": ["action"],
  "nextSevenDaysActionPlan": ["action"],
  "nextThirtyDaysActionPlan": ["action"],
  "warningsLimitations": ["warning"]
}

Context:
${JSON.stringify(context, null, 2)}
`;
};
