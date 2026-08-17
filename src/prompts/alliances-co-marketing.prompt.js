module.exports = function buildAlliancesCoMarketingPrompt({
  brandName = 'Moyi-CMO',
  partnerName = 'HubSpot / Webflow',
  partnerCategory = 'CMS / CRM Ecosystem',
  integrationHighlights = 'Automatic 1-click blog drafting and lead-syncing',
  sharedAudience = 'B2B Growth Marketers and Agencies'
}) {
  return `You are a Head of Channel & Alliances Marketing. Create a strategic Co-Marketing & Ecosystem Partnership Kit for "${brandName}" partnering with "${partnerName}".

PARTNERSHIP PROFILE:
- Primary Brand: ${brandName}
- Partner Organization: ${partnerName}
- Partner Ecosystem: ${partnerCategory}
- Integration Value Proposition: ${integrationHighlights}
- Shared Target Persona: ${sharedAudience}

TASK:
Produce a complete joint co-marketing launch kit in JSON format with the following exact keys:
{
  "jointValueProposition": {
    "headline": "Punchy joint value statement showing 1 + 1 = 3",
    "elevatorPitch": "2-sentence value pitch for joint sales and co-marketing teams",
    "threePillars": [
      { "pillar": "Efficiency / Automation", "description": "How the integration saves hours" },
      { "pillar": "Revenue / Growth", "description": "How joint customers win more pipeline" },
      { "pillar": "Seamless Compatibility", "description": "Zero friction setup" }
    ]
  },
  "coBrandedWebinar": {
    "title": "High-intent joint masterclass / webinar title",
    "landingPageHero": "Compelling hero hook and subheadline",
    "keyLearningBulletPoints": ["Bullet 1", "Bullet 2", "Bullet 3"],
    "promoEmailSubject": "Co-marketing invite subject line",
    "promoEmailBody": "High-conversion joint webinar invite copy"
  },
  "partnerSalesBattlecard": {
    "positioning": "When to recommend ${brandName} to partner customers",
    "commonObjectionsAndResponses": [
      { "objection": "Why not use native tools?", "counter": "Clear differentiation" },
      { "objection": "Integration complexity?", "counter": "1-click authentication" }
    ],
    "dealRegistrationPitch": "Short 30-second talk track for partner account executives"
  },
  "jointAnnouncementPR": {
    "headline": "Official press / blog announcement headline",
    "quoteFromPartner": "Ready-to-use executive quote placeholder",
    "callToAction": "Link to start joint integration"
  }
}`;
};
