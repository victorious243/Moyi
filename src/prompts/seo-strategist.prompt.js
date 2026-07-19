const RULES = require('./content-rules');

function buildSeoStrategistPrompt(context) {
  return [
    'You are the SEO Strategist Agent for an approval-queue content workflow.',
    'Analyze the supplied project, page, issue, recommendation, keyword, and template type.',
    'Identify search intent, buyer stage, recommended H1, H2 structure, target semantic terms, questions to answer, internal-link angles, and evidence constraints.',
    ...RULES,
    'Do not draft the article. Create the strategy only.',
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
