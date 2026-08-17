module.exports = function buildEventLifecyclePrompt({
  brandName = 'Moyi-CMO',
  eventName = 'Global Growth & AI Marketing Summit 2026',
  eventDate = 'October 15, 2026',
  eventLocation = 'London & Virtual Livestream',
  keySpeakers = ['Sarah Jenkins (VP Growth)', 'Marcus Vance (Ex-Google)'],
  targetAudience = 'CMOs, VPs of Marketing, Agency Founders'
}) {
  return `You are a Senior Events Marketing Manager. Create a comprehensive 4-Phase Event Lifecycle Marketing Campaign for "${eventName}" hosted by "${brandName}".

EVENT PROFILE:
- Event Title: ${eventName}
- Date & Location: ${eventDate} | ${eventLocation}
- Featured Keynotes / Speakers: ${keySpeakers.join(', ')}
- Target Attendees: ${targetAudience}

TASK:
Produce a complete 4-phase event promotional and operational blueprint in JSON format with the following exact keys:
{
  "phase1PreEventLaunch": {
    "earlyBirdHeadline": "Compelling early registration hero hook",
    "socialTeaserPosts": [
      { "platform": "LinkedIn", "copy": "Authoritative executive teaser with urgency", "suggestedVisual": "Speaker silhouette flyer" },
      { "platform": "Twitter / X", "copy": "Snappy announcement with event hashtag" }
    ],
    "emailInvite": { "subject": "Exclusive Invitation", "body": "Executive invitation copy" }
  },
  "phase2CountdownAndSpeakers": {
    "speakerSpotlightHooks": [
      { "speaker": "${keySpeakers[0] || 'Keynote Speaker'}", "hook": "Talk track teaser and key takeaways" }
    ],
    "agendaTeaserPost": "Detailed breakdown of the 3 most anticipated panels",
    "finalCountdownEmail": { "subject": "Last Chance: Tickets Closing", "body": "High-urgency final call copy" }
  },
  "phase3LiveEventCoverage": {
    "realTimeQuoteTemplates": [
      { "template": "🔥 Mindset shift from [Speaker]: '[Quote]'", "channel": "Twitter & LinkedIn" }
    ],
    "backstageLivePrompt": "Prompt to engage virtual and in-person attendees live"
  },
  "phase4PostEventRepurposing": {
    "onDemandRecordingPage": {
      "headline": "Watch the Full Replay: Key takeaways and slide decks",
      "gatedLeadMagnetCopy": "Access keynote recordings and executive frameworks"
    },
    "attendeeNurtureEmail": {
      "subject": "Thank you for joining + Keynote slides & bonus access",
      "body": "Nurture sequence bridging event excitement to product trial / consultation"
    },
    "seoArticleAngle": "Turn keynote themes into a long-form search-optimized article"
  }
}`;
};
