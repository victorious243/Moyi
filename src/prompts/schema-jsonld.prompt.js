const RULES = require('./content-rules');

function buildSchemaJsonLdPrompt(context) {
  return [
    'Generate a JSON-LD draft only if suitable from supplied facts.',
    ...RULES,
    'Do not invent business details not provided. If required schema fields are missing, explain the limitation and produce the safest minimal JSON-LD draft.',
    'JSON shape:',
    JSON.stringify({ title: 'string', body: 'string', jsonBody: {}, improvementReason: 'string' }),
    'Source data:',
    JSON.stringify(context)
  ].join('\n');
}

module.exports = buildSchemaJsonLdPrompt;
