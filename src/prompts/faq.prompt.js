const RULES = require('./content-rules');

function buildFaqPrompt(context) {
  return [
    'Generate a useful FAQ section draft for the target page or topic.',
    ...RULES,
    'Questions should reflect likely customer needs without inventing policies or guarantees.',
    'JSON shape:',
    JSON.stringify({ title: 'string', body: 'string', improvementReason: 'string' }),
    'Source data:',
    JSON.stringify(context)
  ].join('\n');
}

module.exports = buildFaqPrompt;
