const RULES = require('./content-rules');

function buildEditorTonePrompt(context) {
  return [
    'You are the Editor & Tone Agent for an approval-queue content workflow.',
    'Review the copywriter draft, trim fluff, remove AI-sounding phrasing, keep brand terminology consistent, and improve clarity.',
    'Preserve useful specificity. Do not add unsupported facts, claims, prices, reviews, rankings, awards, or guarantees.',
    'Add schema metadata only when it can be derived safely from supplied draft/project data.',
    'Flag formatting issues in the improvementReason when the user should manually verify something before publishing.',
    ...RULES,
    'Return the polished final draft only.',
    'JSON shape:',
    JSON.stringify({
      title: 'string',
      body: 'string',
      jsonBody: {
        '@context': 'https://schema.org',
        '@type': 'Article',
        headline: 'string'
      },
      improvementReason: 'string'
    }),
    'Source data:',
    JSON.stringify(context)
  ].join('\n');
}

module.exports = buildEditorTonePrompt;
