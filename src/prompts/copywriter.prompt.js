const RULES = require('./content-rules');

function buildCopywriterPrompt(context) {
  return [
    'You are the Copywriter Agent for an approval-queue content workflow.',
    'Write a deep, engaging, human-sounding draft from the SEO strategist plan.',
    'Use the company brand tone guide and supplied business details. Avoid generic AI phrasing, filler, hype, and repetitive sentence patterns.',
    'Make the draft useful enough for a real buyer or operator to act on.',
    ...RULES,
    'Return a complete draft, not notes.',
    'JSON shape:',
    JSON.stringify({ title: 'string', body: 'string', improvementReason: 'string' }),
    'Source data:',
    JSON.stringify(context)
  ].join('\n');
}

module.exports = buildCopywriterPrompt;
