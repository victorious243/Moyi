module.exports = function buildEmailNewsletterPrompt({
  project,
  targetUrl,
  keyword,
  recommendation,
  executionContext
}) {
  const brandName = project.name || 'Moyi-CMO';
  const mainOffer = project.mainOffer || 'AI Marketing Intelligence & Autonomous Growth';
  const targetAudience = project.targetAudience || 'B2B Growth Leaders & Marketing Operators';
  const brandTone = project.brandTone || 'Direct, authoritative, and value-packed';

  return `You are a Principal Email Marketing & Lifecycle Retention Strategist. Generate a high-converting B2B Email & Executive Newsletter Kit for "${brandName}".

NEWSLETTER PARAMETERS:
- Brand Name: ${brandName}
- Target Destination: ${targetUrl}
- Target Audience: ${targetAudience}
- Core Topic / Theme: ${keyword || 'Evidence-Led Growth & Automated Marketing Operations'}
- Brand Tone: ${brandTone}
- Business Goal: ${executionContext?.businessGoal || 'Drive reader engagement, product adoption, and conversion'}

TASK:
Produce an actionable email newsletter kit in JSON format with the following exact keys:
{
  "title": "Email Newsletter & Lifecycle Campaign: ${brandName}",
  "subjectLineOptions": [
    { "type": "Benefit-Driven", "subject": "How to 3x your organic search traffic without agency retainers" },
    { "type": "Curiosity / Contrarian", "subject": "The #1 reason traditional SEO agencies are being replaced" },
    { "type": "Urgency / Action", "subject": "[Blueprint] Your 30-day evidence-led growth roadmap" }
  ],
  "previewText": "Teaser summary text (under 90 characters) to maximize open rates",
  "newsletterContent": {
    "headerHook": "Personalized opening hooking the subscriber with a relevant industry challenge",
    "coreInsight": "2-3 paragraphs explaining the contrarian insight, data evidence, or strategic framework",
    "keyTakeaways": [
      "Takeaway 1: Why empirical crawl telemetry beats keyword assumptions",
      "Takeaway 2: How 4-stage governance prevents AI hallucinations",
      "Takeaway 3: 1-click multi-channel distribution setup"
    ],
    "primaryCta": {
      "buttonText": "Read Full Blueprint / Try ${brandName}",
      "targetUrl": "${targetUrl}"
    },
    "postscript": "P.S. Short closing note emphasizing zero risk / free trial reassurance"
  },
  "lifecycleContext": {
    "recommendedSegment": "Active Trial Users, Newsletter Subscribers, or Dormant Leads",
    "sendingFrequency": "Weekly Tuesday / Thursday Morning Send"
  }
}`;
};
