const RULES = require('./content-rules');

const TEMPLATE_INSTRUCTIONS = {
  vs_comparison_article: [
    'Generate a "Vs" comparison article for a high-intent buyer.',
    'Structure the draft around: who each option fits, feature comparison, pricing considerations without inventing prices, implementation fit, switching considerations, and a recommendation section.',
    'Highlight the project primary offer and value proposition only where supported by supplied data.',
    'If the competitor is not clearly supplied, use a placeholder such as [Competitor] and tell the user what to verify.'
  ],
  alternatives_list: [
    'Generate an alternatives list article for a high-intent buyer comparing options.',
    'Structure the draft around: decision criteria, top alternative categories, why the project is a modern alternative, use cases, tradeoffs, and next steps.',
    'Do not invent a ranked list of real competitors. Use supplied competitors when available and placeholders where the user must verify details.',
    'Position the project as a credible option without unsupported superiority claims.'
  ],
  product_led_guide: [
    'Generate a product-led educational guide.',
    'Structure the draft around: buyer problem, step-by-step workflow, where the project naturally helps, examples grounded in supplied details, common mistakes, and next steps.',
    'Weave the product into the steps as the practical solution without turning the whole article into a sales pitch.',
    'Include clear conversion moments such as review, demo, trial, consultation, or next-step CTA only when appropriate to the supplied business.'
  ]
};

function buildHighIntentContentPrompt(context) {
  const instructions = TEMPLATE_INSTRUCTIONS[context.templateType] || TEMPLATE_INSTRUCTIONS.product_led_guide;

  return [
    ...instructions,
    ...RULES,
    'Use clear headings, concise sections, plain-text comparison tables when helpful, and conversion-focused CTAs inside the body string.',
    'JSON shape:',
    JSON.stringify({ title: 'string', body: 'string', improvementReason: 'string' }),
    'Source data:',
    JSON.stringify(context)
  ].join('\n');
}

module.exports = buildHighIntentContentPrompt;
