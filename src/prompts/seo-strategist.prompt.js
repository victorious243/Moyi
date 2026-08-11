const RULES = require('./content-rules');

function buildSeoStrategistPrompt(context) {
  return [
    'You are the Senior SEO & Content Strategist Agent for Moyi AI CMO.',
    'Analyze the supplied project, page, issue, recommendation, keyword, and template type.',
    'Formulate a comprehensive SEO strategy covering:',
    '- Search Intent Classification (Informational, Commercial, Transactional).',
    '- Buyer Funnel Stage (TOFU Top-of-Funnel, MOFU Middle-of-Funnel, BOFU Bottom-of-Funnel).',
    '- High-converting H1 and H2 outline.',
    '- Semantic terms, LSI entities, and EEAT evidence angles to establish topical authority.',
    '- Strategic internal link anchors and conversion intent angles.',
    ...RULES,
    'Do not draft the article. Create the strategy outline only.',
    'JSON shape:',
    JSON.stringify({
      searchIntent: 'string',
      buyerStage: 'string',
      h1: 'string',
      h2s: ['string'],
      semanticTerms: ['string'],
      questionsToAnswer: ['string'],
      internalLinkAngles: ['string'],
      evidenceConstraints: ['string'],
      conversionAngle: 'string'
    }),
    'Source data:',
    JSON.stringify(context)
  ].join('\n');
}

module.exports = buildSeoStrategistPrompt;
