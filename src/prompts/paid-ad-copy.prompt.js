module.exports = function buildPaidAdCopyPrompt({
  project,
  targetUrl,
  keyword,
  recommendation,
  executionContext
}) {
  const brandName = project.name || 'Moyi-CMO';
  const mainOffer = project.mainOffer || 'AI Marketing Intelligence & Autonomous Growth';
  const targetAudience = project.targetAudience || 'B2B Growth Leaders & Marketing Operators';
  const brandTone = project.brandTone || 'Direct, authoritative, and evidence-driven';

  return `You are a Principal Performance Marketing & Paid Advertising Specialist. Generate a high-converting Paid Social & Search Ad Creative Kit for "${brandName}" promoting "${targetUrl}".

CAMPAIGN PARAMETERS:
- Brand Name: ${brandName}
- Target URL: ${targetUrl}
- Target Audience: ${targetAudience}
- Core Offer: ${mainOffer}
- Focus Keyword / Angle: ${keyword || 'Autonomous Marketing Operations'}
- Brand Tone: ${brandTone}
- Business Goal: ${executionContext?.businessGoal || 'Drive qualified trial signups and demo requests'}

TASK:
Produce an evidence-backed paid advertising creative kit in JSON format with the following exact keys:
{
  "title": "Paid Ad Creative Kit: ${brandName} Multi-Platform Campaign",
  "linkedinAds": [
    {
      "format": "Single Image / Sponsored Post",
      "hook": "Strong curiosity/pain-point opening line",
      "primaryText": "Full compelling B2B copy highlighting the bottleneck and how ${brandName} eliminates it",
      "headline": "Punchy 50-character link headline",
      "ctaButton": "Get Started / Try Free",
      "visualCreativeConcept": "Description of the visual flyer and transparent logo placement"
    }
  ],
  "metaAds": [
    {
      "format": "Facebook & Instagram Feed Ad",
      "primaryText": "High-converting social ad copy with bulleted proof points",
      "headline": "Benefit-driven headline",
      "description": "Risk-reversal microcopy (e.g. 14-day free trial, no card needed)",
      "ctaButton": "Sign Up",
      "storyOverlayText": "Short 10-word punchline for 9:16 Instagram Stories"
    }
  ],
  "googleSearchAds": {
    "headlines": [
      "${brandName} - Autonomous AI CMO",
      "Scale Organic Pipeline 3.5x",
      "Replace Your €5k/Mo Agency",
      "1-Click SEO & Social Publishing",
      "Start Free 14-Day Growth Trial"
    ],
    "descriptions": [
      "Turn live website audits and Search Console queries into published campaigns automatically.",
      "Eliminate agency overhead with 24/7 AI CMO intelligence and 4-stage governance."
    ],
    "calloutExtensions": ["No Credit Card Required", "1-Click Google Sign-In", "AES-256 Encrypted", "Human Review Gate"]
  }
}`;
};
