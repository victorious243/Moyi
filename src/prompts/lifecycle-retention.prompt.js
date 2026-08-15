const RULES = require('./content-rules');

function buildLifecycleRetentionPrompt(context) {
  return [
    'You are the Elite Customer Retention, Churn Prevention & Lifecycle Email Strategist for Moyi AI CMO.',
    'Analyze the supplied product category, user activation milestones, and value proposition.',
    'Craft 5 high-converting, behavioral lifecycle email automations designed to maximize activation, reduce churn, and drive expansion:',
    '1. NUX Activation Sequence (Days 0–3): Fast-track new signups to their "Aha!" moment in under 24 hours.',
    '2. Trial-to-Paid Urgency Sequence (Days 7–14): High-converting value recap, social proof, and seamless upgrade trigger.',
    '3. Feature Adoption & Re-Engagement: Triggered when an active user has not used a high-impact feature.',
    '4. Pre-Churn & Inactivity Win-Back: Automated intervention triggered when login frequency drops below normal baseline.',
    '5. Customer Expansion & Upsell: Triggered when a happy customer hits 80%+ usage capacity.',
    ...RULES,
    'Respond ONLY with a valid JSON object matching this schema:',
    JSON.stringify({
      lifecycleSequences: [
        {
          stageName: 'Onboarding Activation' || 'Trial Conversion' || 'Feature Adoption' || 'Churn Win-Back' || 'Expansion Upsell',
          triggerEvent: 'string',
          delayTiming: 'string',
          emails: [
            {
              emailNumber: 1,
              subjectLine: 'string',
              previewText: 'string',
              bodyCopy: 'string',
              primaryCtaText: 'string',
              primaryCtaUrl: 'string'
            }
          ]
        }
      ],
      churnRiskIndicators: ['string'],
      retentionOptimizationRules: ['string']
    }),
    'Source data:',
    JSON.stringify(context)
  ].join('\n');
}

module.exports = buildLifecycleRetentionPrompt;
