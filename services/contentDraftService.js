const OpenAI = require('openai');
const env = require('../config/env');
const Page = require('../models/Page');
const SeoIssue = require('../models/SeoIssue');
const buildMetaTitlePrompt = require('../src/prompts/meta-title.prompt');
const buildMetaDescriptionPrompt = require('../src/prompts/meta-description.prompt');
const buildBlogOutlinePrompt = require('../src/prompts/blog-outline.prompt');
const buildBlogDraftPrompt = require('../src/prompts/blog-draft.prompt');
const buildFaqPrompt = require('../src/prompts/faq.prompt');
const buildSchemaJsonLdPrompt = require('../src/prompts/schema-jsonld.prompt');
const buildInternalLinksPrompt = require('../src/prompts/internal-links.prompt');
const buildServicePageSectionPrompt = require('../src/prompts/service-page-section.prompt');
const buildHighIntentContentPrompt = require('../src/prompts/high-intent-content.prompt');
const buildSeoStrategistPrompt = require('../src/prompts/seo-strategist.prompt');
const buildCopywriterPrompt = require('../src/prompts/copywriter.prompt');
const buildEditorTonePrompt = require('../src/prompts/editor-tone.prompt');
const buildPaidAdCopyPrompt = require('../src/prompts/paid-ad-copy.prompt');
const buildEmailNewsletterPrompt = require('../src/prompts/email-newsletter.prompt');

const MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';

const EXECUTION_ASSET_TYPES = [
  'page_improvement_brief',
  'content_brief',
  'comparison_page_draft',
  'meta_title',
  'meta_description',
  'h1',
  'faq_section',
  'blog_outline',
  'blog_article',
  'vs_comparison_article',
  'alternatives_list',
  'product_led_guide',
  'service_page_section',
  'internal_linking_plan',
  'schema_jsonld',
  'paid_ad_copy',
  'email_newsletter'
];

const ACTION_PIPELINES = {
  fix_metadata: ['page_improvement_brief', 'meta_title', 'meta_description'],
  content: ['content_brief', 'service_page_section', 'faq_section', 'blog_outline', 'blog_article', 'paid_ad_copy', 'email_newsletter'],
  new_page: ['content_brief', 'comparison_page_draft', 'paid_ad_copy', 'email_newsletter'],
  internal_linking: ['internal_linking_plan'],
  schema: ['page_improvement_brief', 'schema_jsonld'],
  technical: ['page_improvement_brief'],
  performance: ['page_improvement_brief']
};

const ASSET_LABELS = {
  page_improvement_brief: 'Page improvement brief',
  content_brief: 'Content brief',
  comparison_page_draft: 'Comparison page draft',
  meta_title: 'Meta title',
  meta_description: 'Meta description',
  h1: 'H1 draft',
  faq_section: 'FAQ section',
  blog_outline: 'Blog outline',
  blog_article: 'Blog draft',
  vs_comparison_article: 'Vs comparison article',
  alternatives_list: 'Alternatives list',
  product_led_guide: 'Product-led guide',
  service_page_section: 'Page section draft',
  internal_linking_plan: 'Internal linking plan',
  schema_jsonld: 'Schema JSON-LD',
  paid_ad_copy: 'Paid ad creative kit',
  email_newsletter: 'Email newsletter & nurture'
};

const ASSET_DESCRIPTIONS = {
  page_improvement_brief: 'A reviewed handoff that explains the goal, page gaps, proof to use, and CTA before copy changes are shipped.',
  content_brief: 'A business-facing content brief tied to one ranked opportunity, including audience, intent, proof points, and CTA.',
  comparison_page_draft: 'A decision-stage comparison draft for high-intent buyers that avoids unverifiable competitor claims.',
  meta_title: 'A targeted metadata revision built from the page and project context.',
  meta_description: 'A targeted description revision built for qualified search clicks.',
  h1: 'A tighter page heading aligned to user need and offer clarity.',
  faq_section: 'A reviewable FAQ block for existing page improvement work.',
  blog_outline: 'A structured article outline grounded in the opportunity brief.',
  blog_article: 'A longer-form article draft grounded in the opportunity brief.',
  vs_comparison_article: 'A legacy comparison article format for existing drafts.',
  alternatives_list: 'A legacy alternatives draft for existing drafts.',
  product_led_guide: 'A legacy product-led article format for existing drafts.',
  service_page_section: 'A page section draft for improving an existing commercial page.',
  internal_linking_plan: 'A manual linking plan tied to a specific opportunity and page.',
  schema_jsonld: 'A safe schema draft that still requires manual review before implementation.',
  paid_ad_copy: 'High-converting multi-platform paid ad creatives for LinkedIn, Meta, and Google Search Ads.',
  email_newsletter: 'A structured email newsletter with subject lines, executive hook, takeaways, and CTA.'
};

const PROMPTS = {
  meta_title: buildMetaTitlePrompt,
  meta_description: buildMetaDescriptionPrompt,
  h1: buildServicePageSectionPrompt,
  faq_section: buildFaqPrompt,
  blog_outline: buildBlogOutlinePrompt,
  blog_article: buildBlogDraftPrompt,
  vs_comparison_article: buildHighIntentContentPrompt,
  alternatives_list: buildHighIntentContentPrompt,
  product_led_guide: buildHighIntentContentPrompt,
  comparison_page_draft: buildHighIntentContentPrompt,
  service_page_section: buildServicePageSectionPrompt,
  internal_linking_plan: buildInternalLinksPrompt,
  schema_jsonld: buildSchemaJsonLdPrompt,
  paid_ad_copy: buildPaidAdCopyPrompt,
  email_newsletter: buildEmailNewsletterPrompt
};

const HIGH_INTENT_TYPES = new Set([
  'comparison_page_draft',
  'vs_comparison_article',
  'alternatives_list',
  'product_led_guide'
]);

const MULTI_AGENT_TYPES = new Set([
  'comparison_page_draft',
  'faq_section',
  'blog_outline',
  'blog_article',
  'vs_comparison_article',
  'alternatives_list',
  'product_led_guide',
  'service_page_section'
]);

function formatPaidAdCopyBody(data) {
  if (data.body && typeof data.body === 'string' && data.body.includes('LinkedIn Sponsored Ads')) return data.body;
  const sections = [];
  if (Array.isArray(data.linkedinAds) && data.linkedinAds.length) {
    sections.push(`## LinkedIn Sponsored Ads\n${data.linkedinAds.map((ad) => `**Hook:** ${ad.hook || ''}\n**Primary Text:** ${ad.primaryText || ''}\n**Headline:** ${ad.headline || ''}\n**CTA:** ${ad.ctaButton || 'Get Started'}\n**Visual Concept:** ${ad.visualCreativeConcept || ''}`).join('\n\n')}`);
  }
  if (Array.isArray(data.metaAds) && data.metaAds.length) {
    sections.push(`## Meta & Instagram Feed Ads\n${data.metaAds.map((ad) => `**Headline:** ${ad.headline || ''}\n**Primary Text:** ${ad.primaryText || ''}\n**Description:** ${ad.description || ''}\n**CTA:** ${ad.ctaButton || 'Sign Up'}\n**Story Overlay:** ${ad.storyOverlayText || ''}`).join('\n\n')}`);
  }
  if (data.googleSearchAds) {
    const g = data.googleSearchAds;
    sections.push(`## Google Search Responsive Ads\n${(g.headlines || []).map((h, i) => `- Headline ${i + 1}: ${h}`).join('\n')}\n${(g.descriptions || []).map((d, i) => `- Description ${i + 1}: ${d}`).join('\n')}`);
  }
  return sections.join('\n\n') || data.body || 'Paid ad creatives generated and ready for review.';
}

function formatEmailNewsletterBody(data) {
  if (data.body && typeof data.body === 'string' && data.body.includes('Subject Line Options')) return data.body;
  const sections = [];
  if (Array.isArray(data.subjectLineOptions)) {
    sections.push(`## Subject Line Options\n${data.subjectLineOptions.map((s) => `- **${s.type || 'Option'}:** ${s.subject || ''}`).join('\n')}`);
  }
  if (data.previewText) {
    sections.push(`**Preview Text:** ${data.previewText}`);
  }
  if (data.newsletterContent) {
    const c = data.newsletterContent;
    sections.push(`---\n\n${c.headerHook || ''}\n\n${c.coreInsight || ''}\n\n${(c.keyTakeaways || []).map((t) => `- ${t}`).join('\n')}\n\n👉 [${c.primaryCta?.buttonText || 'Learn More'}](${c.primaryCta?.targetUrl || '#'})\n\n${c.postscript || ''}`);
  }
  return sections.join('\n\n') || data.body || 'Email newsletter generated and ready for review.';
}

function parseJson(content) {
  const trimmed = String(content || '').trim();
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  const json = start >= 0 && end >= start ? trimmed.slice(start, end + 1) : trimmed;
  return JSON.parse(json);
}

function competitorLabel(competitor) {
  if (!competitor) return '';
  if (typeof competitor === 'string') return competitor;
  return competitor.name || competitor.websiteUrl || '';
}

function primaryCompetitor(project, keyword) {
  const competitors = (project.competitors || []).map(competitorLabel).filter(Boolean);
  if (keyword && !/^\s*$/.test(keyword)) return keyword;
  return competitors[0] || '[Competitor]';
}

function pipelineTypesForAction(actionType) {
  return ACTION_PIPELINES[actionType] || ['page_improvement_brief'];
}

function selectDraftTypes(recommendation, requestedType) {
  const allowedTypes = pipelineTypesForAction(recommendation.actionType);

  if (requestedType) {
    if (!allowedTypes.includes(requestedType)) {
      const error = new Error('That asset type does not match this recommendation pipeline.');
      error.statusCode = 422;
      throw error;
    }
    return [requestedType];
  }

  return allowedTypes;
}

function pipelineAssetOptions(recommendation) {
  return pipelineTypesForAction(recommendation.actionType).map((type) => ({
    type,
    label: ASSET_LABELS[type] || type.replace(/_/g, ' '),
    description: ASSET_DESCRIPTIONS[type] || 'Execution asset'
  }));
}

function buildProjectContext(project) {
  return {
    name: project.name,
    websiteUrl: project.websiteUrl,
    industry: project.industry,
    targetAudience: project.targetAudience,
    targetCountry: project.targetCountry,
    mainGoal: project.mainGoal,
    mainOffer: project.mainOffer,
    brandTone: project.brandTone,
    competitors: project.competitors || []
  };
}

function buildPageContext(page) {
  if (!page) return null;
  return {
    url: page.url,
    statusCode: page.statusCode,
    title: page.title,
    metaDescription: page.metaDescription,
    h1: page.h1,
    headings: page.headings,
    wordCount: page.wordCount,
    internalLinks: page.internalLinks,
    externalLinks: page.externalLinks,
    schemaTypes: page.schemaTypes,
    openGraph: page.openGraph
  };
}

function cleanList(values, limit = 6) {
  return Array.from(new Set((values || [])
    .map((value) => String(value || '').trim())
    .filter(Boolean)))
    .slice(0, limit);
}

function currentValueForType(type, page) {
  if (!page) return '';
  if (type === 'meta_title') return page.title || '';
  if (type === 'meta_description') return page.metaDescription || '';
  if (type === 'h1') return (page.h1 || []).join(' | ');
  return '';
}

function guessSearchIntent(recommendation, type, keyword) {
  const query = String(keyword || '').trim();
  if (type === 'comparison_page_draft' || type === 'vs_comparison_article' || type === 'alternatives_list') {
    return query ? `Decision-stage comparison intent around "${query}".` : 'Decision-stage comparison intent from buyers evaluating alternatives.';
  }
  if (type === 'meta_title' || type === 'meta_description') {
    return query ? `High-visibility click intent around "${query}".` : 'Search snippet intent where clearer messaging should improve qualified clicks.';
  }
  if (type === 'internal_linking_plan') {
    return 'Navigation and discovery intent for visitors who need clearer paths to the right page.';
  }
  if (recommendation.actionType === 'new_page') {
    return query ? `Commercial discovery intent around "${query}".` : 'Commercial discovery intent from visitors actively evaluating solutions.';
  }
  if (recommendation.actionType === 'content') {
    return query ? `Problem-aware search intent around "${query}".` : 'Mid-funnel information intent from visitors trying to solve a real problem.';
  }
  return 'Commercial page improvement intent tied to a ranked opportunity.';
}

function projectPrimaryCta(project) {
  const brandProfile = project.brand_profile || {};
  const ctas = cleanList(brandProfile.callsToAction || brandProfile.calls_to_action || [], 3);
  if (ctas.length) return ctas[0];
  if (project.mainOffer) return `Review ${project.mainOffer}`;
  return `Learn more about ${project.name}`;
}

function proofPoints({ project, page, recommendation, issues }) {
  const points = [];

  if (project.mainOffer) points.push(`Primary offer: ${project.mainOffer}`);
  if (project.mainGoal) points.push(`Business goal: ${project.mainGoal}`);
  if (page && page.title) points.push(`Current page title: ${page.title}`);
  if (page && page.h1 && page.h1.length) points.push(`Current H1: ${page.h1[0]}`);
  if (page && page.wordCount) points.push(`Current page depth: about ${page.wordCount} words`);
  if (page && Array.isArray(page.schemaTypes) && page.schemaTypes.length) points.push(`Existing schema types: ${page.schemaTypes.join(', ')}`);
  if (page && Array.isArray(page.internalLinks)) points.push(`Known internal links on page: ${page.internalLinks.length}`);
  if (recommendation.expectedImpact) points.push(`Expected outcome: ${recommendation.expectedImpact}`);
  if (issues.length) {
    issues.slice(0, 3).forEach((issue) => {
      points.push(`Issue to address: ${issue.title || issue.type}`);
    });
  }

  return cleanList(points, 6);
}

function evidenceHighlights({ page, issues }) {
  const highlights = [];

  if (page && page.url) highlights.push(`Target page: ${page.url}`);
  if (page && page.metaDescription) highlights.push(`Current meta description exists and can be improved instead of rewritten blindly.`);
  if (page && page.headings && page.headings.length) highlights.push(`Page includes ${page.headings.length} headings worth preserving where they support intent.`);
  if (page && typeof page.statusCode === 'number') highlights.push(`Latest crawl status: HTTP ${page.statusCode}.`);
  if (issues.length) {
    issues.slice(0, 3).forEach((issue) => {
      if (issue.evidence) {
        highlights.push(`${issue.title || issue.type}: ${String(issue.evidence).slice(0, 160)}`);
      }
    });
  }

  return cleanList(highlights, 5);
}

function businessGoalFor(project, recommendation) {
  return recommendation.expectedImpact || recommendation.reason || project.mainGoal || 'Move a ranked growth opportunity into a reviewed execution asset.';
}

function buildExecutionContext({ project, recommendation, page, issues, type, keyword }) {
  return {
    pipelineKey: recommendation.actionType,
    sourceRecommendation: {
      title: recommendation.title,
      priority: recommendation.priority,
      actionType: recommendation.actionType,
      expectedImpact: recommendation.expectedImpact || '',
      reason: recommendation.reason || ''
    },
    opportunitySummary: recommendation.reason || recommendation.title,
    businessGoal: businessGoalFor(project, recommendation),
    targetPersona: project.targetAudience || 'Target audience still needs manual definition.',
    searchIntent: guessSearchIntent(recommendation, type, keyword),
    proofPoints: proofPoints({ project, page, recommendation, issues }),
    primaryCta: projectPrimaryCta(project),
    evidenceHighlights: evidenceHighlights({ page, issues })
  };
}

function fallbackDraft({ type, project, recommendation, page, keyword, executionContext }) {
  const audience = project.targetAudience || 'your audience';
  const goal = project.mainGoal || 'support business growth';
  const pageTitle = page && page.title ? page.title : project.name;
  const targetUrl = page && page.url ? page.url : (recommendation.targetUrls[0] || project.websiteUrl);
  const offer = project.mainOffer || project.industry || 'the primary offer';
  const competitor = primaryCompetitor(project, keyword);
  const proofList = executionContext.proofPoints.length
    ? executionContext.proofPoints.map((item) => `- ${item}`).join('\n')
    : '- Use only proof already verified in the project data.';
  const evidenceList = executionContext.evidenceHighlights.length
    ? executionContext.evidenceHighlights.map((item) => `- ${item}`).join('\n')
    : '- No extra page evidence was captured for this recommendation yet.';

  if (type === 'page_improvement_brief') {
    return {
      title: `Page improvement brief for ${pageTitle}`,
      body: `# Page improvement brief\n\n## Ranked opportunity\n${recommendation.title} (Priority ${recommendation.priority})\n\n## Business goal\n${executionContext.businessGoal}\n\n## Target persona\n${executionContext.targetPersona}\n\n## Search intent\n${executionContext.searchIntent}\n\n## What should improve on the page\n- Clarify the page promise earlier.\n- Make the proof points easier to scan.\n- Tighten the CTA so visitors know the next step.\n- Keep all claims grounded in verified site evidence.\n\n## Proof points to use\n${proofList}\n\n## Existing evidence to preserve or verify\n${evidenceList}\n\n## CTA to reinforce\n${executionContext.primaryCta}\n\n## Review guardrails\n- Do not publish unsupported claims.\n- Do not rewrite the page around keywords alone.\n- Re-scan after implementation to confirm the change landed.`,
      improvementReason: 'Creates a business-facing handoff before page edits are made.'
    };
  }

  if (type === 'content_brief') {
    return {
      title: `Content brief for ${recommendation.title}`,
      body: `# Content brief\n\n## Ranked opportunity\n${recommendation.title} (Priority ${recommendation.priority})\n\n## Business goal\n${executionContext.businessGoal}\n\n## Target persona\n${executionContext.targetPersona}\n\n## Search intent\n${executionContext.searchIntent}\n\n## Core angle\nExplain how ${project.name} helps ${audience} move toward ${goal} without relying on hype or vague AI language.\n\n## Proof points to include\n${proofList}\n\n## CTA\n${executionContext.primaryCta}\n\n## Quality bar\n- Make the draft specific to this opportunity, not a generic SEO article.\n- Use proof already found in the site or manually verified sources.\n- End with a CTA that matches the business goal.`,
      improvementReason: 'Frames execution around the business goal, persona, intent, proof, and CTA before content gets written.'
    };
  }

  if (type === 'comparison_page_draft') {
    return {
      title: `${project.name} vs ${competitor}: decision guide for ${audience}`,
      body: `# ${project.name} vs ${competitor}\n\nPeople comparing these options are usually near a decision. This draft is designed to help ${audience} evaluate fit without inventing competitor claims.\n\n## Who this page is for\n${audience}\n\n## Best fit for ${project.name}\nChoose ${project.name} when your team cares most about ${offer} and needs a clearer path to ${goal}.\n\n## What buyers should compare\n- Primary use case fit\n- Setup effort and implementation risk\n- Support model and team involvement\n- Total cost and time to value\n- What proof each vendor actually shows\n\n## What this page can say confidently today\n${proofList}\n\n## What must be manually verified before publishing\n- Current competitor features\n- Current pricing and packaging\n- Independent customer proof or case studies\n\n## CTA\n${executionContext.primaryCta}`,
      improvementReason: 'Creates a decision-stage comparison draft tied to a ranked opportunity while keeping competitor claims reviewable.'
    };
  }

  if (type === 'meta_title') {
    const title = `${project.name} | ${project.mainOffer || project.industry || 'Official Website'}`.slice(0, 60);
    return {
      title: 'Improved meta title',
      body: title,
      improvementReason: `Uses the project name and offer clearly for ${audience}.`
    };
  }

  if (type === 'meta_description') {
    return {
      title: 'Improved meta description',
      body: `Discover ${project.name}${project.mainOffer ? ` for ${project.mainOffer}` : ''}. Helpful information for ${audience}, focused on ${goal}.`.slice(0, 155),
      improvementReason: 'Adds a clear audience, offer, and purpose without keyword stuffing.'
    };
  }

  if (type === 'internal_linking_plan') {
    return {
      title: 'Internal linking plan',
      body: `# Internal linking plan\n\n## Ranked opportunity\n${recommendation.title} (Priority ${recommendation.priority})\n\n## Target page\n${targetUrl}\n\n## Business goal\n${executionContext.businessGoal}\n\n## Suggested approach\n1. Link from relevant high-level pages to this page using descriptive anchor text.\n2. Use anchors that explain the user benefit, not repeated exact-match keywords.\n3. Add links only where they help visitors continue their journey.\n4. Re-scan after manual updates to confirm internal links are crawlable.\n\n## Proof points to reinforce with anchors\n${proofList}\n\n## CTA on the destination page\n${executionContext.primaryCta}`,
      improvementReason: 'Creates a practical linking plan tied to the ranked opportunity and target page.'
    };
  }

  if (type === 'schema_jsonld') {
    return {
      title: 'Safe JSON-LD draft',
      body: 'Review this JSON-LD before adding it to the page. Do not publish if important business details are missing.',
      jsonBody: {
        '@context': 'https://schema.org',
        '@type': 'Organization',
        name: project.name,
        url: project.websiteUrl
      },
      improvementReason: 'Uses only supplied organization name and website URL.'
    };
  }

  if (type === 'faq_section') {
    return {
      title: `FAQ section for ${pageTitle}`,
      body: `## Frequently Asked Questions\n\n### Who is ${project.name} for?\n${project.name} is designed for ${audience}.\n\n### What can visitors learn on this page?\nThey can learn how ${project.name} helps with ${goal}.\n\n### What proof should this page include?\nUse verified details such as ${executionContext.proofPoints[0] || 'the current offer and page purpose'}.\n\n### What should someone do next?\n${executionContext.primaryCta}`,
      improvementReason: 'Adds helpful people-first answers without unsupported claims.'
    };
  }

  if (type === 'blog_outline') {
    return {
      title: `${project.name}: useful guide for ${audience}`,
      body: `# Blog outline\n\n1. Introduction: the problem ${audience} is trying to solve\n2. What to know before choosing a solution\n3. Practical steps related to ${goal}\n4. Proof points or examples to include\n5. How ${project.name} can help\n6. CTA: ${executionContext.primaryCta}`,
      improvementReason: 'Creates an educational structure aligned to the project goal.'
    };
  }

  if (type === 'blog_article') {
    return {
      title: `${project.name}: practical guide for ${audience}`,
      body: `# ${project.name}: practical guide for ${audience}\n\n${audience} often need clear, trustworthy information before taking action. This draft focuses on ${goal} using the details currently available in the project profile.\n\n## Why this matters now\n${executionContext.businessGoal}\n\n## What matters most\nStart with the visitor's real need. Explain the offer clearly, avoid exaggerated claims, and make the next step easy to understand.\n\n## Proof points to include\n${proofList}\n\n## Practical next steps\n- Clarify the page purpose.\n- Add helpful answers to common questions.\n- Link to related pages where they help the reader.\n- Review the content manually before publishing.\n\n## CTA\n${executionContext.primaryCta}`,
      improvementReason: 'Provides a people-first draft grounded in the project profile and ranked opportunity.'
    };
  }

  if (type === 'vs_comparison_article') {
    return {
      title: `${project.name} vs ${competitor}: which is right for ${audience}?`,
      body: `# ${project.name} vs ${competitor}: which is right for ${audience}?\n\nBuyers comparing ${project.name} with ${competitor} usually need a practical way to understand fit, tradeoffs, and next steps. Review and verify competitor-specific details before publishing.\n\n## Quick recommendation\nChoose ${project.name} when your priority is ${offer} and your goal is to ${goal}.\n\n## Feature comparison\n| Area | ${project.name} | ${competitor} |\n| --- | --- | --- |\n| Primary fit | ${audience} | Verify before publishing |\n| Core value | ${offer} | Verify before publishing |\n| Best next step | ${executionContext.primaryCta} | Confirm directly from competitor sources |\n\n## What to verify before deciding\n- Current competitor feature set.\n- Current pricing and contract terms.\n- Integration, support, and migration requirements.`,
      improvementReason: 'Creates a high-intent comparison structure while avoiding unverified competitor claims.'
    };
  }

  if (type === 'alternatives_list') {
    return {
      title: `Top alternatives to ${competitor} for ${audience}`,
      body: `# Top alternatives to ${competitor} for ${audience}\n\nIf ${competitor} is not the right fit, the best alternative depends on your goals, budget, and implementation needs. This draft positions ${project.name} as a modern option while leaving competitor details for manual verification.\n\n## What to look for in an alternative\n- Clear fit for ${audience}\n- A practical path to ${goal}\n- Strong alignment with ${offer}\n- Transparent implementation requirements\n\n## Alternative 1: ${project.name}\n${project.name} is worth considering if you want ${offer} and a plan focused on ${goal}.\n\n## CTA\n${executionContext.primaryCta}`,
      improvementReason: 'Provides an alternatives article designed for commercial search intent without inventing a competitor list.'
    };
  }

  if (type === 'paid_ad_copy') {
    return {
      title: `Paid ad creative kit: ${project.name}`,
      body: `## LinkedIn Sponsored Ads\n**Hook:** Are sluggish agency retainers slowing down your marketing pipeline?\n**Primary Text:** Traditional agencies charge €5,000/month with zero live visibility. ${project.name} delivers 24/7 autonomous marketing intelligence, live site crawls, and 1-click publishing.\n**Headline:** ${project.name} - Autonomous AI CMO for Growth Teams\n**CTA:** Start 14-Day Free Trial\n\n## Meta & Instagram Feed Ads\n**Headline:** Replace Agency Retainers with Live Telemetry\n**Primary Text:** Crawl your website, uncover high-intent search queries, and publish on-brand multi-channel campaigns in minutes.\n**Description:** 14-day free trial • Zero card required • Set up in 60s\n**CTA:** Sign Up\n\n## Google Search Responsive Ads\n- Headline 1: ${project.name} | Autonomous AI CMO\n- Headline 2: Scale Organic Pipeline 3.5x\n- Headline 3: Replace Your €5k/Mo Agency\n- Description 1: Turn live website audits and Search Console queries into published campaigns automatically.\n- Description 2: Eliminate agency overhead with 24/7 AI CMO intelligence and 4-stage governance.`,
      improvementReason: 'Generates high-converting multi-platform paid ad creatives for LinkedIn, Meta, and Google Search Ads.'
    };
  }

  if (type === 'email_newsletter') {
    return {
      title: `Email newsletter & lifecycle campaign: ${project.name}`,
      body: `## Subject Line Options\n- Benefit-Driven: How to 3x your organic search traffic without agency retainers\n- Curiosity: The #1 reason traditional SEO agencies are being replaced\n- Action: [Blueprint] Your 30-day evidence-led growth roadmap\n\n**Preview Text:** Turn live website telemetry into high-converting campaigns.\n\n---\n\nHi {{first_name}},\n\nMost growth teams struggle with the same bottleneck: spending thousands on agency retainers while high-intent search queries sit unranked.\n\nHere is how modern operators are shifting to evidence-led marketing:\n\n1. **Empirical Crawl Telemetry:** Fix technical SEO blockers before publishing new content.\n2. **Search Console Query Mining:** Identify keywords on positions 5–15 that can leap to page one.\n3. **4-Stage Governance:** Write → Visual → Review → Distribute with human sign-off.\n\n👉 [Read the Full Blueprint / Try ${project.name}](${targetUrl})\n\nP.S. Set up your workspace in under 60 seconds with 1-click Google OAuth.`,
      improvementReason: 'Produces an executive newsletter with subject lines, strategic insights, and clear CTA.'
    };
  }

  return {
    title: `Service page section for ${pageTitle}`,
    body: `## Helpful section draft\n\n${project.name} helps ${audience} with ${goal}. Use this section to explain the offer clearly, answer practical questions, and guide visitors to the next useful step.\n\n### Proof points to reinforce\n${proofList}\n\n### CTA\n${executionContext.primaryCta}\n\nReview and adapt this copy before publishing.`,
    improvementReason: 'Adds useful explanatory copy without inventing facts.'
  };
}

async function requestJson(prompt, systemContent, temperature = 0.3) {
  if (!env.openaiApiKey) return null;

  const client = new OpenAI({
    apiKey: env.openaiApiKey,
    maxRetries: 1,
    timeout: env.contentAiTimeoutMs
  });
  const response = await client.chat.completions.create({
    model: MODEL,
    temperature,
    response_format: { type: 'json_object' },
    messages: [
      {
        role: 'system',
        content: systemContent
      },
      { role: 'user', content: prompt }
    ]
  });

  return parseJson(response.choices[0].message.content);
}

async function mapWithConcurrency(items, concurrency, mapper) {
  const results = new Array(items.length);
  let cursor = 0;

  async function worker() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await mapper(items[index], index);
    }
  }

  const workerCount = Math.min(Math.max(1, concurrency), items.length);
  await Promise.all(Array.from({ length: workerCount }, worker));
  return results;
}

async function requestAiDraft(prompt) {
  return requestJson(
    prompt,
    'You generate approval-queue SEO content drafts from supplied evidence only. Never invent facts.',
    0.35
  );
}

async function requestMultiAgentDraft(context) {
  if (!env.openaiApiKey) return null;

  const strategy = await requestJson(
    buildSeoStrategistPrompt(context),
    'You are a careful SEO strategist. Use supplied evidence only and return compact JSON.',
    0.2
  );
  if (!strategy) return null;

  const writerDraft = await requestJson(
    buildCopywriterPrompt({
      ...context,
      strategy
    }),
    'You are a human-sounding copywriter. Use supplied evidence only and return JSON.',
    0.45
  );
  if (!writerDraft) return null;

  const edited = await requestJson(
    buildEditorTonePrompt({
      ...context,
      strategy,
      writerDraft
    }),
    'You are a strict editor and tone guardian. Use supplied evidence only and return JSON.',
    0.2
  );
  if (!edited) return null;

  return {
    title: String(edited.title || writerDraft.title || ''),
    body: String(edited.body || writerDraft.body || ''),
    jsonBody: edited.jsonBody || null,
    improvementReason: String(edited.improvementReason || writerDraft.improvementReason || 'Generated through SEO strategist, copywriter, and editor agents.')
  };
}

async function generateDraftsForRecommendation({
  project,
  recommendation,
  requestedType = '',
  requestedTypes = null,
  keyword = ''
}) {
  const allowedStatuses = new Set(['accepted', 'in_progress', 'done']);
  if (!allowedStatuses.has(recommendation.status)) {
    const error = new Error('Accept the recommendation before generating content drafts.');
    error.statusCode = 422;
    throw error;
  }

  const types = Array.isArray(requestedTypes) && requestedTypes.length
    ? requestedTypes
    : selectDraftTypes(recommendation, requestedType);
  if (!types.length) return [];
  const targetUrl = recommendation.targetUrls[0] || project.websiteUrl;
  const page = await Page.findOne({ projectId: project._id, url: targetUrl }).sort({ lastCrawledAt: -1 });
  const issues = recommendation.relatedIssueIds.length
    ? await SeoIssue.find({ _id: { $in: recommendation.relatedIssueIds } })
    : [];

  const baseContext = {
    project: buildProjectContext(project),
    recommendation: {
      title: recommendation.title,
      category: recommendation.category,
      priority: recommendation.priority,
      reason: recommendation.reason,
      expectedImpact: recommendation.expectedImpact,
      actionType: recommendation.actionType,
      targetUrls: recommendation.targetUrls
    },
    page: buildPageContext(page),
    issues: issues.map((issue) => ({
      id: issue._id.toString(),
      url: issue.url,
      type: issue.type,
      severity: issue.severity,
      title: issue.title,
      evidence: issue.evidence
    })),
    keyword
  };

  const drafts = await mapWithConcurrency(types, env.contentPipelineConcurrency, async (type) => {
    const executionContext = buildExecutionContext({
      project,
      recommendation,
      page,
      issues,
      type,
      keyword
    });

    const context = {
      ...baseContext,
      templateType: type,
      executionContext
    };

    if (HIGH_INTENT_TYPES.has(type)) {
      context.highIntent = {
        competitor: primaryCompetitor(project, keyword),
        suppliedCompetitors: (project.competitors || []).map(competitorLabel).filter(Boolean),
        primaryOffer: project.mainOffer || project.industry || '',
        conversionGoal: project.mainGoal || ''
      };
    }

    const promptBuilder = PROMPTS[type];
    const generated = promptBuilder
      ? (MULTI_AGENT_TYPES.has(type)
        ? await requestMultiAgentDraft(context)
        : await requestAiDraft(promptBuilder(context)))
      : null;
    const output = generated || fallbackDraft({ type, project, recommendation, page, keyword, executionContext });

    let body = String(output.body || '');
    if (type === 'paid_ad_copy') {
      body = formatPaidAdCopyBody(output);
    } else if (type === 'email_newsletter') {
      body = formatEmailNewsletterBody(output);
    }

    return {
      projectId: project._id,
      recommendationId: recommendation._id,
      targetUrl,
      type,
      keyword,
      title: String(output.title || ''),
      body,
      jsonBody: output.jsonBody || null,
      currentValue: currentValueForType(type, page),
      improvementReason: String(output.improvementReason || ''),
      executionContext,
      status: 'awaiting_review',
      aiModel: generated ? `${MODEL}${MULTI_AGENT_TYPES.has(type) ? ':multi-agent' : ''}` : 'local-template-no-api-key'
    };
  });

  return drafts;
}

async function generateInstantGrowthPack({ projectId, recommendationId, targetUrl, keyword }) {
  const Project = require('../models/Project');
  const Recommendation = require('../models/Recommendation');
  const ContentDraft = require('../models/ContentDraft');

  const project = await Project.findById(projectId);
  if (!project) throw new Error('Project not found for Instant Growth Pack.');

  let recommendation = null;
  if (recommendationId) {
    recommendation = await Recommendation.findById(recommendationId);
  }

  if (!recommendation) {
    recommendation = await Recommendation.findOne({ projectId: project._id, status: { $in: ['accepted', 'open', 'pending'] } });
  }

  if (!recommendation) {
    recommendation = await Recommendation.create({
      projectId: project._id,
      title: 'Accelerate High-Intent Organic Pipeline & Multi-Channel Distribution',
      category: 'content',
      priority: 1,
      impact: 'High',
      effort: 'Low',
      actionType: 'content',
      status: 'accepted',
      targetUrls: [targetUrl || project.websiteUrl],
      expectedImpact: 'High-impact 30-day omnichannel growth bundle',
      reason: 'Auto-created for Instant 30-Day Growth Pack Studio'
    });
  } else if (recommendation.status !== 'accepted' && recommendation.status !== 'in_progress' && recommendation.status !== 'done') {
    recommendation.status = 'accepted';
    await recommendation.save();
  }

  const effectiveUrl = targetUrl || (recommendation.targetUrls && recommendation.targetUrls[0]) || project.websiteUrl;
  const effectiveKeyword = keyword || project.mainOffer || 'Autonomous Marketing';

  const packTypes = [
    'comparison_page_draft',
    'paid_ad_copy',
    'email_newsletter',
    'page_improvement_brief',
    'faq_section'
  ];

  const generatedDrafts = await generateDraftsForRecommendation({
    project,
    recommendation,
    requestedTypes: packTypes,
    keyword: effectiveKeyword
  });

  const savedDrafts = [];
  for (const draftData of generatedDrafts) {
    const saved = await ContentDraft.create(draftData);
    savedDrafts.push(saved);
  }

  return {
    success: true,
    bundleCount: savedDrafts.length,
    drafts: savedDrafts,
    message: `Successfully generated Instant 30-Day Growth Pack (${savedDrafts.length} assets ready for review).`
  };
}

module.exports = {
  ASSET_LABELS,
  EXECUTION_ASSET_TYPES,
  buildExecutionContext,
  generateDraftsForRecommendation,
  generateInstantGrowthPack,
  mapWithConcurrency,
  pipelineAssetOptions,
  pipelineTypesForAction,
  selectDraftTypes
};
