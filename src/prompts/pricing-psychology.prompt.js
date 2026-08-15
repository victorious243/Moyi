const RULES = require('./content-rules');

function buildPricingPsychologyPrompt(context) {
  return [
    'You are the Elite Pricing Strategist & Behavioral Economics CMO Agent for Moyi AI CMO.',
    'Analyze the supplied product tiering, current prices, target customer segment, and value metrics.',
    'Deliver a behavioral pricing and willingness-to-pay (WTP) optimization plan covering:',
    '1. Value Metric Diagnosis: Determine whether the product is charging by the right value metric (e.g. per active project, per order, per seat, per revenue generated).',
    '2. Behavioral Tier Architecture: Design the 3-tier structure using Decoy Pricing, Anchoring, and the Center-Stage Effect (making the middle tier the irresistible choice).',
    '3. Price Elasticity & Van Westendorp Evaluation: Assess whether prices are too cheap (harming perceived quality) or over-priced.',
    '4. Conversion Psychology Triggers: Annual discount framing, free-to-paid friction reduction, guarantee framing, and ROI justification proof.',
    ...RULES,
    'Respond ONLY with a valid JSON object matching this schema:',
    JSON.stringify({
      valueMetricRecommendation: {
        recommendedMetric: 'string',
        rationale: 'string'
      },
      tierOptimization: [
        {
          tierName: 'string',
          recommendedPrice: 'string',
          billingFrequency: 'string',
          psychologicalRole: 'string', // 'Anchor', 'Decoy', 'Target Core', 'Enterprise'
          targetPersona: 'string',
          keyFeatures: ['string']
        }
      ],
      conversionTriggers: {
        annualDiscountFraming: 'string',
        guaranteeHook: 'string',
        roiJustificationSentence: 'string'
      },
      strategicPricingAdvice: ['string']
    }),
    'Source data:',
    JSON.stringify(context)
  ].join('\n');
}

module.exports = buildPricingPsychologyPrompt;
