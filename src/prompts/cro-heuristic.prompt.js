const RULES = require('./content-rules');

function buildCroHeuristicPrompt(context) {
  return [
    'You are the Elite Conversion Rate Optimization (CRO) Lead Agent for Moyi AI CMO using the MECLABS Conversion Heuristic (C = 4m + 3v + 2(i-f) - 2a).',
    'Evaluate the supplied landing page, headline, CTA, and page text.',
    'Perform a scientific conversion teardown across 5 core dimensions:',
    '1. Visitor Motivation (m): How well the page matches the prospect\'s primary intent and urgency.',
    '2. Value Proposition Clarity (v): Is the above-the-fold promise clear, specific, and believable in under 5 seconds?',
    '3. Incentive vs Friction (i - f): Is the incentive to take action higher than the cognitive and operational friction (form fields, steps)?',
    '4. Anxiety & Risk Reversal (a): Are psychological hesitation barriers addressed with social proof, money-back guarantees, and trust badges?',
    '5. Actionable CRO Fixes: Specific, rewritten headlines, subheaders, CTA buttons, and friction-reducing changes.',
    ...RULES,
    'Respond ONLY with a valid JSON object matching this schema:',
    JSON.stringify({
      conversionScore: 85,
      dimensionScores: {
        motivation: 80,
        valueProposition: 85,
        frictionReduction: 75,
        anxietyReversal: 70
      },
      aboveTheFoldTeardown: {
        currentHeadlineAssessment: 'string',
        recommendedHeadline: 'string',
        recommendedSubheadline: 'string',
        recommendedCtaText: 'string'
      },
      frictionAudit: [
        { frictionPoint: 'string', fix: 'string', expectedLift: 'string' }
      ],
      trustAndRiskReversals: ['string'],
      topPriorityCroActions: ['string']
    }),
    'Source data:',
    JSON.stringify(context)
  ].join('\n');
}

module.exports = buildCroHeuristicPrompt;
