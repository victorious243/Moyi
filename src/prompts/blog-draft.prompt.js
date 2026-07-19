const RULES = require('./content-rules');

function buildBlogDraftPrompt(context) {
  return [
    'Generate a full blog article draft.',
    ...RULES,
    'Use clear headings, short sections, and practical examples grounded only in supplied business details.',
    'JSON shape:',
    JSON.stringify({ title: 'string', body: 'string', improvementReason: 'string' }),
    'Source data:',
    JSON.stringify(context)
  ].join('\n');
}

module.exports = buildBlogDraftPrompt;
