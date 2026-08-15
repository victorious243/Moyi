const RULES = require('./content-rules');

function buildAbmOutboundPrompt(context) {
  return [
    'You are the Elite Account-Based Marketing (ABM) & Enterprise Growth CMO Agent for Moyi AI CMO.',
    'Analyze the target enterprise company, target executive persona (VP/C-Level), industry pain points, and client value proposition.',
    'Design a hyper-personalized, 1-to-1 Account-Based Outbound Campaign:',
    '1. Target Account Dossier: Strategic hypotheses regarding the prospect\'s top operational bottlenecks, strategic priorities, and revenue gaps.',
    '2. Executive Value Narrative: Tailored messaging linking the client\'s solution directly to the target\'s board-level goals (Cost reduction, Efficiency, Risk mitigation).',
    '3. Multi-Touch Outbound Cadence: 4-step sequence (Direct C-Level Email, Personalized LinkedIn Connection Note, Tailored Teardown Video/Loom Script, Follow-up Value Bump).',
    '4. Custom Offer Anchor: A low-friction, high-value exploratory offer (e.g. Free 15-min Custom Audit, Tailored Benchmark Report).',
    ...RULES,
    'Respond ONLY with a valid JSON object matching this schema:',
    JSON.stringify({
      targetAccountDossier: {
        companyName: 'string',
        strategicPriorities: ['string'],
        likelyOperationalBottlenecks: ['string'],
        customValueHook: 'string'
      },
      outboundCadence: [
        {
          stepNumber: 1,
          channel: 'Email' || 'LinkedIn' || 'Video Loom' || 'Executive Brief',
          touchTiming: 'Day 1' || 'Day 4' || 'Day 8' || 'Day 14',
          subjectOrHeadline: 'string',
          messageBody: 'string',
          callToAction: 'string'
        }
      ],
      customExploratoryOffer: 'string',
      executiveObjectionPreemptions: [
        { objection: 'string', response: 'string' }
      ]
    }),
    'Source data:',
    JSON.stringify(context)
  ].join('\n');
}

module.exports = buildAbmOutboundPrompt;
