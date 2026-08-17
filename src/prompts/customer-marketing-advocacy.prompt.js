module.exports = function buildCustomerAdvocacyPrompt({
  brandName = 'Moyi-CMO',
  customerName = 'Acme Corp',
  customerIndustry = 'B2B SaaS',
  coreChallenge = 'High agency spend with slow SEO turnarounds',
  resultsAchieved = '3.5x organic search lift and €48,000 saved annually',
  keyQuote = 'Moyi replaced our sluggish agency with 24/7 autonomous marketing intelligence.'
}) {
  return `You are a Senior Customer Marketing Manager. Generate an enterprise-grade Customer Advocacy & Case Study pack for "${brandName}".

CUSTOMER PROFILE:
- Client Name: ${customerName}
- Industry: ${customerIndustry}
- Baseline Challenge: ${coreChallenge}
- Quantified Business Outcomes: ${resultsAchieved}
- Customer Quote / Voice: ${keyQuote}

TASK:
Produce a complete customer marketing and advocacy kit in JSON format with the following exact keys:
{
  "caseStudy": {
    "headline": "Compelling ROI-driven headline",
    "executiveSummary": "Concise 3-sentence summary of the business transformation",
    "theChallenge": "Detailed breakdown of the previous bottleneck, operational drag, and cost",
    "theSolution": "How ${brandName} was deployed, workflows adopted, and team enablement",
    "quantifiedImpact": [
      { "metric": "e.g. 350%", "label": "Organic Traffic Velocity", "context": "Achieved in first 90 days" },
      { "metric": "e.g. €48k", "label": "Annual Overhead Savings", "context": "Replaced external retainer" }
    ],
    "featuredQuote": { "quote": "Polished quote", "attribution": "Name, VP of Marketing, ${customerName}" }
  },
  "advocacyReviewCampaign": {
    "reviewPlatform": "G2 / Trustpilot / Capterra",
    "emailInviteSubject": "Compelling subject line to request customer review",
    "emailInviteBody": "Friendly, high-conversion email asking the customer to leave a review with specific talking prompts",
    "incentiveStrategy": "Ethical and compliant review incentive guidance"
  },
  "customerExpansionNurture": {
    "upsellHook": "Angle for introducing higher tiers or additional workspaces",
    "advocateReferralPrompt": "Copy to ask satisfied customer for peer introductions"
  }
}`;
};
