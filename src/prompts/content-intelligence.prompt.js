/**
 * Moyi Daily Content Intelligence Prompt Suite
 * Implements the 25-point operational standard for opportunity discovery,
 * scoring, 11-part article drafting, two-way internal linking, and derived social assets.
 */

const SYSTEM_INSTRUCTION = `You are the Moyi Daily Content Intelligence Agent.
Your job is NOT to blindly write one article every day.
Your job is to identify the best daily content opportunity for Moyi, based on what people are actively searching for, what problems businesses are trying to solve, what Moyi can genuinely help with, and what content already exists on the Moyi website.

Core Tenets:
1. Increase Moyi's organic visibility, topical authority, brand awareness, and qualified traffic by creating genuinely useful content that solves real marketing problems.
2. Moyi does not replace human marketers. Moyi supports them by handling repetitive research, analysis, preparation, and execution while humans retain final judgment, strategy, creativity, and approval.
3. Positioning: "Moyi proposes. Humans decide."
4. Claim Safety: Never fabricate customer statistics, ROI, rankings, conversion rates, testimonials, or unsupported integrations.
5. Quality Over Quota: If no opportunity meets the bar, explicitly recommend NO PUBLICATION.
6. Write for humans first with zero generic filler ("Marketing is important in today's digital world").`;

function buildContentIntelligencePrompt({
  projectContext = {},
  candidateTopic = '',
  primaryQuery = '',
  searchIntent = '',
  cluster = 'Google Search Console & SEO Growth',
  existingPages = [],
  recentGscData = []
}) {
  return `
${SYSTEM_INSTRUCTION}

Generate a complete, publication-ready Content Intelligence Package for the following selected opportunity:

PROJECT CONTEXT:
- Website: ${projectContext.websiteUrl || 'https://moyi-cmo.com'}
- Brand: ${projectContext.name || 'Moyi-CMO'}
- Business Model: ${projectContext.businessModel || 'B2B SaaS / Growth Marketing Platform'}
- Target Audience: ${projectContext.targetAudience || 'Founders, Growth Marketers, SEO Managers, Agencies'}
- Core Capabilities: Website crawls, Google Search Console read-only mining, Content Studio drafts, DALL-E flyers with logo watermarking, 1-click multi-channel publishing.

SELECTED TOPIC:
- Topic: ${candidateTopic}
- Primary Query: ${primaryQuery}
- Search Intent: ${searchIntent}
- Cluster: ${cluster}
- Existing Pages to Avoid Cannibalizing: ${existingPages.slice(0, 15).join(', ')}

REQUIRED OUTPUT FORMAT (Return valid JSON with these exact keys):
{
  "seoPackage": {
    "seoTitle": "50-60 character compelling title",
    "metaDescription": "140-160 character natural description",
    "primaryKeyword": "${primaryQuery}",
    "secondaryKeywords": ["5 to 10 closely related keywords"],
    "urlSlug": "/resources/descriptive-slug",
    "searchIntent": "${searchIntent}",
    "primaryH1": "Clear, compelling H1 matching search intent",
    "structuredDataRecommendation": ["Article", "BreadcrumbList", "FAQPage"]
  },
  "article": {
    "title": "Article Title",
    "introduction": "Direct problem description without generic filler.",
    "whatIsHappening": "Explanation of what is happening under the hood.",
    "whyDoesItHappen": "3 common root causes.",
    "howToDiagnose": "Actionable diagnostic steps in GSC or crawl tools.",
    "howToSolve": [
      { "stepNumber": 1, "stepTitle": "Step 1 Title", "stepDescription": "Actionable instructions" },
      { "stepNumber": 2, "stepTitle": "Step 2 Title", "stepDescription": "Actionable instructions" },
      { "stepNumber": 3, "stepTitle": "Step 3 Title", "stepDescription": "Actionable instructions" },
      { "stepNumber": 4, "stepTitle": "Step 4 Title", "stepDescription": "Actionable instructions" }
    ],
    "example": {
      "scenario": "Realistic B2B or SaaS scenario",
      "findings": "Observable search data",
      "fix": "Specific on-page actions taken",
      "result": "Measurable ranking/CTR impact"
    },
    "commonMistakes": [
      "Mistake 1 with explanation",
      "Mistake 2 with explanation",
      "Mistake 3 with explanation"
    ],
    "howMoyiCanHelp": "Explain naturally how Moyi assists via 'Moyi proposes. Humans decide.' (Teach first, zero exaggeration).",
    "faqs": [
      { "question": "Question 1", "answer": "Answer 1" },
      { "question": "Question 2", "answer": "Answer 2" },
      { "question": "Question 3", "answer": "Answer 3" }
    ],
    "conclusion": "Actionable summary of the immediate next step."
  },
  "sources": [
    "Authoritative source 1 (e.g. Google Search Central)",
    "Authoritative source 2"
  ],
  "internalLinking": {
    "outbound": [
      { "targetUrl": "/google-search-console-analysis", "anchorText": "natural anchor text", "reason": "why" },
      { "targetUrl": "/seo-audit-tool", "anchorText": "natural anchor text", "reason": "why" },
      { "targetUrl": "/pricing", "anchorText": "transparent pricing plans", "reason": "commercial CTA" }
    ],
    "inbound": [
      { "sourcePage": "/google-search-console-analysis", "recommendedAnchor": "anchor text", "context": "where to place" },
      { "sourcePage": "/seo-growth-software", "recommendedAnchor": "anchor text", "context": "where to place" }
    ]
  },
  "socialDistribution": {
    "linkedIn": "Professional executive insight post (not just the intro).",
    "x": "Concise high-signal post or short thread.",
    "facebook": "Conversational business-oriented post.",
    "shortFormVideo": {
      "hook": "0-3s attention hook",
      "duration": "25-35 seconds",
      "talkingPoints": ["Point 1", "Point 2", "Point 3"],
      "cta": "Clear call to action"
    },
    "visualConcept": {
      "description": "Visual diagram description matching Moyi clean corporate aesthetic.",
      "aspectRatio": "1:1 or 16:9",
      "brandNotes": "Deep navy background, slate cards, official logo watermark."
    }
  },
  "repurposedFormats": [
    { "format": "Newsletter Section", "summary": "3-point actionable email blurb" },
    { "format": "5-Slide Carousel", "summary": "Outline for slides 1 through 5" },
    { "format": "Printable Checklist", "summary": "1-page action checklist for editors" }
  ],
  "qualityControlAudit": {
    "solvesRealProblem": true,
    "genuinelyRelatedToMoyi": true,
    "informationCurrent": true,
    "noContentDuplication": true,
    "substantiallyUseful": true,
    "noFiller": true,
    "claimsSupported": true,
    "titleMatchesSearchIntent": true,
    "moyiMentionsNatural": true,
    "usefulWithoutPurchase": true,
    "clearReasonToExist": true,
    "credibleToMarketers": true,
    "auditPassed": true
  }
}
`;
}

module.exports = {
  SYSTEM_INSTRUCTION,
  buildContentIntelligencePrompt
};
