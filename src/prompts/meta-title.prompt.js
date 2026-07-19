const RULES = require('./content-rules');

function buildMetaTitlePrompt(context) {
  return [
    'Generate an improved SEO meta title draft.',
    ...RULES,
    'Keep the title concise, specific, and natural. Prefer 45-60 characters when possible.',
    'Explain why the new title is better than the current one.',
    'JSON shape:',
    JSON.stringify({ title: 'string', body: 'string', improvementReason: 'string' }),
    'Source data:',
    JSON.stringify(context)
  ].join('\n');
}

module.exports = buildMetaTitlePrompt;
