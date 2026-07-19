const RULES = require('./content-rules');

function buildServicePageSectionPrompt(context) {
  return [
    'Generate a service page section draft that can improve usefulness for the target audience.',
    ...RULES,
    'Keep claims grounded in supplied project details and page facts.',
    'JSON shape:',
    JSON.stringify({ title: 'string', body: 'string', improvementReason: 'string' }),
    'Source data:',
    JSON.stringify(context)
  ].join('\n');
}

module.exports = buildServicePageSectionPrompt;
