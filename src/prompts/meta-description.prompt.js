const RULES = require('./content-rules');

function buildMetaDescriptionPrompt(context) {
  return [
    'Generate an improved SEO meta description draft.',
    ...RULES,
    'Keep the description useful and natural. Prefer 120-155 characters when possible.',
    'Explain why the new description is better than the current one.',
    'JSON shape:',
    JSON.stringify({ title: 'string', body: 'string', improvementReason: 'string' }),
    'Source data:',
    JSON.stringify(context)
  ].join('\n');
}

module.exports = buildMetaDescriptionPrompt;
