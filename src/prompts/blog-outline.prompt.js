const RULES = require('./content-rules');

function buildBlogOutlinePrompt(context) {
  return [
    'Generate a practical blog outline for the target audience.',
    ...RULES,
    'Focus on helpful education, not sales pressure.',
    'JSON shape:',
    JSON.stringify({ title: 'string', body: 'string', improvementReason: 'string' }),
    'Source data:',
    JSON.stringify(context)
  ].join('\n');
}

module.exports = buildBlogOutlinePrompt;
