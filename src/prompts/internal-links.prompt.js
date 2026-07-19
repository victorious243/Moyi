const RULES = require('./content-rules');

function buildInternalLinksPrompt(context) {
  return [
    'Generate an internal linking plan using only supplied existing page URLs.',
    ...RULES,
    'Do not invent URLs. Suggest natural anchor text and explain why each link helps users.',
    'JSON shape:',
    JSON.stringify({ title: 'string', body: 'string', improvementReason: 'string' }),
    'Source data:',
    JSON.stringify(context)
  ].join('\n');
}

module.exports = buildInternalLinksPrompt;
