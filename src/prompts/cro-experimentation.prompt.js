module.exports = function buildCroExperimentationPrompt({
  brandName = 'Moyi-CMO',
  pageUrl = 'https://moyi-cmo.com/pricing',
  currentConversionRate = '2.4%',
  targetGoal = 'Increase Free Trial Signups by 35%',
  observedFriction = 'Vague feature comparisons and lack of clear proof on pricing cards'
}) {
  return `You are a Principal Digital Marketing & Conversion Rate Optimization (CRO) Specialist. Design a scientific A/B testing and experimentation plan for "${pageUrl}" under brand "${brandName}".

PAGE & FUNNEL DIAGNOSTICS:
- Page URL: ${pageUrl}
- Baseline Conversion Rate: ${currentConversionRate}
- Target Outcome: ${targetGoal}
- Observed User Friction / Hesitation: ${observedFriction}

TASK:
Produce an evidence-backed A/B testing hypothesis, copy variant matrix, and micro-friction mitigation blueprint in JSON format with the following exact keys:
{
  "meclabsHeuristicAnalysis": {
    "motivation": "What primary driver brings the visitor to this step?",
    "valuePropositionClarity": "Where the current page is losing clarity or failing to convey ROI",
    "incentiveVsFriction": "Friction points identified (form fields, confusing terms, risk)",
    "anxietyReduction": "Trust signals needed (guarantees, social proof, zero-risk trial)"
  },
  "experimentHypothesis": {
    "ifThenStatement": "If we replace generic CTA with an outcome-specific value prompt and add proof badges, then signup conversion will lift by 25-40% because visitor anxiety is reduced.",
    "primaryMetric": "Trial Signup Conversion Rate (Goal Completions / Unique Visitors)",
    "secondaryMetrics": ["Scroll depth past pricing grid", "Time on page", "Checkout drop-off rate"],
    "minimumSampleSize": "Minimum 1,500 visitors per variant to achieve 95% statistical significance"
  },
  "copyTestingVariants": [
    {
      "variantName": "Control (A)",
      "heroHeadline": "Current baseline headline",
      "ctaCopy": "Get Started",
      "supportingMicroCopy": "Standard pricing terms"
    },
    {
      "variantName": "Outcome-Led (B)",
      "heroHeadline": "High-converting, benefit-specific headline",
      "ctaCopy": "Start 14-Day Growth Trial — No Card Needed",
      "supportingMicroCopy": "Full access to scans, AI drafts & social publishing. Cancel in 1 click."
    }
  ],
  "microFrictionFixes": [
    { "frictionPoint": "High cognitive load on pricing tiers", "fix": "Add recommended badge and clear 'Who is this for' bullet point" },
    { "frictionPoint": "Fear of complex setup", "fix": "Add 'Set up in 60 seconds with 1-click Google OAuth' reassurance" }
  ]
}`;
};
