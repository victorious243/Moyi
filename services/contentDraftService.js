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

const MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';

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
  service_page_section: buildServicePageSectionPrompt,
  internal_linking_plan: buildInternalLinksPrompt,
  schema_jsonld: buildSchemaJsonLdPrompt
};

const HIGH_INTENT_TYPES = new Set(['vs_comparison_article', 'alternatives_list', 'product_led_guide']);
const MULTI_AGENT_TYPES = new Set([
  'faq_section',
  'blog_outline',
  'blog_article',
  'vs_comparison_article',
  'alternatives_list',
  'product_led_guide',
  'service_page_section'
]);

function parseJson(content) {
  const trimmed = String(content || '').trim();
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  const json = start >= 0 && end >= start ? trimmed.slice(start, end + 1) : trimmed;
  return JSON.parse(json);
}

function selectDraftTypes(recommendation, requestedType) {
  if (requestedType && PROMPTS[requestedType]) return [requestedType];

  if (recommendation.actionType === 'fix_metadata') return ['meta_title', 'meta_description'];
  if (recommendation.actionType === 'internal_linking') return ['internal_linking_plan'];
  if (recommendation.actionType === 'schema') return ['schema_jsonld'];
  if (recommendation.actionType === 'content') return ['blog_outline', 'blog_article', 'product_led_guide', 'faq_section'];
  if (recommendation.actionType === 'new_page') return ['blog_outline', 'blog_article', 'vs_comparison_article', 'alternatives_list', 'service_page_section'];
  return ['service_page_section'];
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

function currentValueForType(type, page) {
  if (!page) return '';
  if (type === 'meta_title') return page.title || '';
  if (type === 'meta_description') return page.metaDescription || '';
  if (type === 'h1') return (page.h1 || []).join(' | ');
  return '';
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

function fallbackDraft({ type, project, recommendation, page, keyword }) {
  const audience = project.targetAudience || 'your audience';
  const goal = project.mainGoal || 'support business growth';
  const pageTitle = page && page.title ? page.title : project.name;
  const targetUrl = page && page.url ? page.url : (recommendation.targetUrls[0] || project.websiteUrl);
  const offer = project.mainOffer || project.industry || 'the primary offer';
  const competitor = primaryCompetitor(project, keyword);

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
      body: `Target page: ${targetUrl}\n\nSuggested approach:\n1. Link from relevant high-level pages to this page using descriptive anchor text.\n2. Use anchors that describe the user benefit, not repeated exact-match keywords.\n3. Add links only where they help visitors continue their journey.\n4. Re-scan after manual updates to confirm internal links are crawlable.`,
      improvementReason: 'Creates a practical plan using existing pages only.'
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
      body: `## Frequently Asked Questions\n\n### Who is ${project.name} for?\n${project.name} is designed for ${audience}.\n\n### What can visitors learn on this page?\nThey can learn how ${project.name} helps with ${goal}.\n\n### What should someone do next?\nReview the page information and choose the next step that fits their needs.`,
      improvementReason: 'Adds helpful people-first answers without unsupported claims.'
    };
  }

  if (type === 'blog_outline') {
    return {
      title: `${project.name}: useful guide for ${audience}`,
      body: `# Blog outline\n\n1. Introduction: the problem ${audience} is trying to solve\n2. What to know before choosing a solution\n3. Practical steps related to ${goal}\n4. Common mistakes to avoid\n5. How ${project.name} can help\n6. Next steps`,
      improvementReason: 'Creates an educational structure aligned to the project goal.'
    };
  }

  if (type === 'blog_article') {
    return {
      title: `${project.name}: practical guide for ${audience}`,
      body: `# ${project.name}: practical guide for ${audience}\n\n${audience} often need clear, trustworthy information before taking action. This draft focuses on ${goal} using the details currently available in the project profile.\n\n## What matters most\nStart with the visitor's real need. Explain the offer clearly, avoid exaggerated claims, and make the next step easy to understand.\n\n## Practical next steps\n- Clarify the page purpose.\n- Add helpful answers to common questions.\n- Link to related pages where they help the reader.\n- Review the content manually before publishing.\n\n## Summary\nUseful content should help people make a confident decision without relying on keyword stuffing or unsupported claims.`,
      improvementReason: 'Provides a people-first draft grounded in the project profile.'
    };
  }

  if (type === 'vs_comparison_article') {
    return {
      title: `${project.name} vs ${competitor}: which is right for ${audience}?`,
      body: `# ${project.name} vs ${competitor}: which is right for ${audience}?\n\nBuyers comparing ${project.name} with ${competitor} usually need a practical way to understand fit, tradeoffs, and next steps. Review and verify competitor-specific details before publishing.\n\n## Quick recommendation\nChoose ${project.name} when your priority is ${offer} and your goal is to ${goal}.\n\n## Feature comparison\n| Area | ${project.name} | ${competitor} |\n| --- | --- | --- |\n| Primary fit | ${audience} | Verify before publishing |\n| Core value | ${offer} | Verify before publishing |\n| Best next step | Review the offer and speak with the team | Confirm directly from competitor sources |\n\n## Pricing considerations\nDo not compare exact pricing unless verified from current public sources. Instead, explain how buyers should evaluate total cost, setup effort, support, and time to value.\n\n## When ${project.name} is a strong fit\n- You want a solution aligned with ${goal}.\n- You care about clear implementation and practical next steps.\n- You need content, workflows, or support that match ${audience}.\n\n## What to verify before deciding\n- Current competitor feature set.\n- Current pricing and contract terms.\n- Integration, support, and migration requirements.\n\n## Next step\nReview ${project.name}'s offer, compare it against your must-have criteria, and choose the option that best supports your growth plan.`,
      improvementReason: 'Creates a high-intent comparison structure while avoiding unverified competitor claims.'
    };
  }

  if (type === 'alternatives_list') {
    return {
      title: `Top alternatives to ${competitor} for ${audience}`,
      body: `# Top alternatives to ${competitor} for ${audience}\n\nIf ${competitor} is not the right fit, the best alternative depends on your goals, budget, and implementation needs. This draft positions ${project.name} as a modern option while leaving competitor details for manual verification.\n\n## What to look for in an alternative\n- Clear fit for ${audience}.\n- A practical path to ${goal}.\n- Strong alignment with ${offer}.\n- Transparent implementation requirements.\n\n## Alternative 1: ${project.name}\n${project.name} is worth considering if you want ${offer} and a plan focused on ${goal}.\n\n### Why buyers choose it\n- It is aligned with ${audience}.\n- It supports a clear next step instead of generic information.\n- It can be evaluated against your actual business goals.\n\n## Other alternatives to evaluate\nUse verified public information to add competitor-specific alternatives here. For each option, compare fit, pricing model, setup effort, support, and limitations.\n\n## How to choose\nStart with the outcome you need most, then compare each tool against the real work required to reach that outcome.\n\n## Next step\nShortlist the options that match your use case, then review ${project.name} against your must-have criteria.`,
      improvementReason: 'Provides an alternatives article designed for commercial search intent without inventing a competitor list.'
    };
  }

  if (type === 'product_led_guide') {
    return {
      title: `How ${audience} can ${goal} with ${project.name}`,
      body: `# How ${audience} can ${goal} with ${project.name}\n\nThis guide explains a practical workflow for moving from problem to action, with ${project.name} included where it naturally supports the job.\n\n## Step 1: Clarify the goal\nDefine what ${goal} means for your team, your customers, and your current website or campaign.\n\n## Step 2: Identify the highest-friction part of the workflow\nLook for the point where decisions stall, content becomes generic, or execution loses momentum.\n\n## Step 3: Use ${project.name} to support the workflow\n${project.name} helps ${audience} by focusing on ${offer}. Use it to turn strategy into clearer next actions.\n\n## Step 4: Review before publishing or launching\nCheck claims, examples, and calls to action before anything goes live.\n\n## Step 5: Measure what changed\nTrack whether the work improves qualified traffic, conversion actions, or the business signal that matters most.\n\n## Next step\nReview your current workflow and identify the first place where ${project.name} can reduce friction.`,
      improvementReason: 'Turns the recommendation into an educational guide with natural product-led conversion moments.'
    };
  }

  return {
    title: `Service page section for ${pageTitle}`,
    body: `## Helpful section draft\n\n${project.name} helps ${audience} with ${goal}. Use this section to explain the offer clearly, answer practical questions, and guide visitors to the next useful step.\n\nReview and adapt this copy before publishing.`,
    improvementReason: 'Adds useful explanatory copy without inventing facts.'
  };
}

async function requestJson(prompt, systemContent, temperature = 0.3) {
  if (!env.openaiApiKey) return null;

  const client = new OpenAI({ apiKey: env.openaiApiKey });
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

async function generateDraftsForRecommendation({ project, recommendation, requestedType = '', keyword = '' }) {
  const allowedStatuses = new Set(['accepted', 'in_progress', 'done']);
  if (!allowedStatuses.has(recommendation.status)) {
    const error = new Error('Accept the recommendation before generating content drafts.');
    error.statusCode = 422;
    throw error;
  }

  const types = selectDraftTypes(recommendation, requestedType);
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

  const drafts = [];
  for (const type of types) {
    const context = {
      ...baseContext,
      templateType: type
    };

    if (HIGH_INTENT_TYPES.has(type)) {
      context.highIntent = {
        competitor: primaryCompetitor(project, keyword),
        suppliedCompetitors: (project.competitors || []).map(competitorLabel).filter(Boolean),
        primaryOffer: project.mainOffer || project.industry || '',
        conversionGoal: project.mainGoal || ''
      };
    }

    const generated = MULTI_AGENT_TYPES.has(type)
      ? await requestMultiAgentDraft(context)
      : await requestAiDraft(PROMPTS[type](context));
    const output = generated || fallbackDraft({ type, project, recommendation, page, keyword });

    drafts.push({
      projectId: project._id,
      recommendationId: recommendation._id,
      targetUrl,
      type,
      keyword,
      title: String(output.title || ''),
      body: String(output.body || ''),
      jsonBody: output.jsonBody || null,
      currentValue: currentValueForType(type, page),
      improvementReason: String(output.improvementReason || ''),
      aiModel: generated ? `${MODEL}${MULTI_AGENT_TYPES.has(type) ? ':multi-agent' : ''}` : 'local-template-no-api-key'
    });
  }

  return drafts;
}

module.exports = {
  generateDraftsForRecommendation,
  selectDraftTypes
};
