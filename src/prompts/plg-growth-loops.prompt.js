const RULES = require('./content-rules');

function buildPlgGrowthLoopsPrompt(context) {
  return [
    'You are the Elite Product-Led Growth (PLG) & Growth Loop Architect for Moyi AI CMO based on Reforge Growth Frameworks.',
    'Analyze the supplied product workflow, user touchpoints, and natural output deliverables.',
    'Design self-reinforcing, compounding viral growth loops that turn active users into an automated customer acquisition engine:',
    '1. Word-of-Mouth & Output Discovery Loops: Natural "Powered By [Brand]" watermarks or public report/deliverable badges that prospects see when interacting with users.',
    '2. Collaborative & Multiplayer Loops: User invites team member, stakeholder, or client to review results, pulling new users into the product.',
    '3. Two-Sided Referral Loops: Value incentives (bonus credits, free features) that reward both inviter and invitee upon milestone completion.',
    '4. Habit & Retention Triggers: Weekly summary triggers, milestone alerts, and progress reports that bring users back into the active habit loop.',
    ...RULES,
    'Respond ONLY with a valid JSON object matching this schema:',
    JSON.stringify({
      growthLoops: [
        {
          loopName: 'string',
          loopType: 'Viral Discovery' || 'Collaborative' || 'Incentivized Referral' || 'Retention Habit',
          step1_UserAction: 'string',
          step2_ProductOutput: 'string',
          step3_ProspectExposure: 'string',
          step4_NewUserAcquisition: 'string',
          estimatedViralFactorK: 0.35,
          implementationEffort: 'Low' || 'Medium' || 'High'
        }
      ],
      timeToAhaMoment: {
        currentFriction: 'string',
        recommendedFastTrack: 'string'
      },
      retentionHabitTriggers: ['string'],
      plgStrategicRecommendations: ['string']
    }),
    'Source data:',
    JSON.stringify(context)
  ].join('\n');
}

module.exports = buildPlgGrowthLoopsPrompt;
