const OpenAI = require('openai');
const env = require('../config/env');
const buildSeoReportPrompt = require('../src/prompts/seo-report.prompt');
const buildRecommendationPrompt = require('../src/prompts/recommendation.prompt');

const MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';
const ACTION_TYPES = new Set(['fix_metadata', 'content', 'new_page', 'internal_linking', 'schema', 'technical', 'performance']);
const EFFORTS = new Set(['low', 'medium', 'high']);

function buildProjectContext(project) {
  return {
    id: project._id.toString(),
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

function buildScanContext(scan) {
  return {
    id: scan._id.toString(),
    status: scan.status,
    pagesFound: scan.pagesFound,
    pagesScanned: scan.pagesScanned,
    startedAt: scan.startedAt,
    completedAt: scan.completedAt
  };
}

function buildPageContext(pages) {
  return pages.slice(0, 50).map((page) => ({
    id: page._id.toString(),
    url: page.url,
    statusCode: page.statusCode,
    title: page.title,
    metaDescription: page.metaDescription,
    h1: page.h1,
    headings: page.headings,
    canonical: page.canonical,
    robotsMeta: page.robotsMeta,
    wordCount: page.wordCount,
    internalLinksCount: (page.internalLinks || []).length,
    externalLinksCount: (page.externalLinks || []).length,
    imagesCount: page.imagesCount,
    imagesMissingAlt: page.imagesMissingAlt,
    schemaTypes: page.schemaTypes,
    openGraph: page.openGraph
  }));
}

function buildIssueContext(issues) {
  return issues.slice(0, 80).map((issue) => ({
    id: issue._id.toString(),
    url: issue.url,
    type: issue.type,
    severity: issue.severity,
    title: issue.title,
    evidence: issue.evidence,
    recommendation: issue.recommendation
  }));
}

function parseJson(content) {
  const trimmed = String(content || '').trim();
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  const json = start >= 0 && end >= start ? trimmed.slice(start, end + 1) : trimmed;
  return JSON.parse(json);
}

async function requestJson(prompt) {
  if (!env.openaiApiKey) {
    const error = new Error('OPENAI_API_KEY is not configured. Add an API key to generate an AI CMO plan.');
    error.code = 'missing_api_key';
    throw error;
  }

  const client = new OpenAI({ apiKey: env.openaiApiKey });
  const response = await client.chat.completions.create({
    model: MODEL,
    temperature: 0.2,
    response_format: { type: 'json_object' },
    messages: [
      {
        role: 'system',
        content: 'You produce practical SEO planning JSON from supplied evidence only. Never invent crawl data.'
      },
      { role: 'user', content: prompt }
    ]
  });

  return parseJson(response.choices[0].message.content);
}

function sanitizeReport(parsed) {
  return {
    executiveSummary: String(parsed.executiveSummary || ''),
    currentSeoHealth: String(parsed.currentSeoHealth || ''),
    mainBusinessRisk: String(parsed.mainBusinessRisk || ''),
    mainGrowthOpportunity: String(parsed.mainGrowthOpportunity || ''),
    topPriorities: Array.isArray(parsed.topPriorities) ? parsed.topPriorities.slice(0, 5).map(String) : [],
    quickWins: Array.isArray(parsed.quickWins) ? parsed.quickWins.slice(0, 10).map(String) : [],
    thirtyDayPlan: Array.isArray(parsed.thirtyDayPlan) ? parsed.thirtyDayPlan.slice(0, 30).map(String) : [],
    suggestedContentStrategy: String(parsed.suggestedContentStrategy || ''),
    pageImprovementPriorities: Array.isArray(parsed.pageImprovementPriorities) ? parsed.pageImprovementPriorities.slice(0, 20).map(String) : [],
    internalLinkingStrategy: String(parsed.internalLinkingStrategy || ''),
    measurementPlan: String(parsed.measurementPlan || ''),
    warningsLimitations: Array.isArray(parsed.warningsLimitations) ? parsed.warningsLimitations.slice(0, 10).map(String) : []
  };
}

function sanitizeRecommendations(parsed, { pages, issues }) {
  const allowedUrls = new Set(pages.map((page) => page.url));
  const allowedIssueIds = new Set(issues.map((issue) => issue._id.toString()));
  const items = Array.isArray(parsed.recommendations) ? parsed.recommendations : [];

  return items.slice(0, 12).map((item) => {
    const targetUrls = (Array.isArray(item.targetUrls) ? item.targetUrls : [])
      .map(String)
      .filter((url) => allowedUrls.has(url));
    const relatedIssueIds = (Array.isArray(item.relatedIssueIds) ? item.relatedIssueIds : [])
      .map(String)
      .filter((id) => allowedIssueIds.has(id));

    return {
      title: String(item.title || 'SEO improvement'),
      category: String(item.category || 'SEO'),
      priority: Math.min(Math.max(Number(item.priority) || 3, 1), 5),
      reason: String(item.reason || ''),
      expectedImpact: String(item.expectedImpact || ''),
      effort: EFFORTS.has(item.effort) ? item.effort : 'medium',
      actionType: ACTION_TYPES.has(item.actionType) ? item.actionType : 'content',
      relatedIssueIds,
      targetUrls
    };
  }).filter((item) => item.targetUrls.length || item.relatedIssueIds.length);
}

function generateFallbackCmoPlan({ project, scan, pages, issues }) {
  const report = {
    executiveSummary: `Moyi completed a marketing audit for ${project.name} in the ${project.industry || 'general'} sector. We analyzed user engagement, conversion architecture, and SEO posture. Key opportunities include correcting foundational crawling metadata and content structures targeting ${project.targetAudience || 'prospective customers'}.`,
    currentSeoHealth: `Based on a crawl of ${pages.length} pages, we identified ${issues.length} SEO issues (${issues.filter(i => i.severity === 'critical').length} critical, ${issues.filter(i => i.severity === 'warning').length} warning, ${issues.filter(i => i.severity === 'opportunity').length} opportunity).`,
    mainBusinessRisk: issues.filter(i => i.severity === 'critical').length > 0
      ? `The primary risk is ${issues.filter(i => i.severity === 'critical').length} critical technical crawl or indexing issues blocking search visibility.`
      : `The primary risk is thin optimization and missing search metadata on main landing pages, limiting organic growth.`,
    mainGrowthOpportunity: `Optimize metadata across all flagged pages to improve organic click-through rate, and create product-led comparison pages targeting high-intent keywords for ${project.name}.`,
    topPriorities: [
      'Resolve all critical technical/http/index blockages on top pages.',
      'Correct missing titles and meta descriptions to improve SERP click-through rate.',
      'Expand thin pages with descriptive, high-quality copy answering visitor intent.',
      'Ensure every image has descriptive alt text for image search traffic.',
      'Establish conversion goals and connect Google Search Console for detailed visibility.'
    ],
    quickWins: [
      'Add descriptive title tags to all pages with a "Missing title tag" warning.',
      'Draft a high-converting meta description for the homepage.',
      'Identify top competitors and audit their sitemaps for content gaps.'
    ],
    thirtyDayPlan: [
      'Days 1-7: Resolve missing title tags, double H1 tags, and canonical issues on crawled pages.',
      'Days 8-14: Place the tracking script on key registration and checkout steps to measure attribution.',
      'Days 15-21: Configure WordPress/CMS integrations and draft three high-intent blog articles.',
      'Days 22-30: Monitor low CTR pages on Google Search Console page one and update their metadata.'
    ],
    suggestedContentStrategy: `Produce product-led comparative and alternative content. Focus on articles like "${project.name} vs. competitors" and problem-solving guides highlighting your main offer: "${project.mainOffer || 'our product features'}". Target keywords relevant to: ${project.targetAudience || 'business owners'}.`,
    pageImprovementPriorities: issues.slice(0, 5).map(issue => `Fix ${issue.title} on ${issue.url}`),
    internalLinkingStrategy: 'Link high-traffic content to key landing pages using descriptive anchor text.',
    measurementPlan: 'Track visitor sessions, UTM sources, and key conversion actions via first-party tracking, and sync organic metrics via Google Search Console.',
    warningsLimitations: [
      'This plan was generated using a rule-based fallback system because no OPENAI_API_KEY was configured.',
      'Configure an OpenAI API key in your environment to unlock deep semantic AI audits and custom content drafts.'
    ]
  };

  const actionTypesMap = {
    http_status: 'technical',
    missing_title: 'fix_metadata',
    title_length: 'fix_metadata',
    missing_meta_description: 'fix_metadata',
    meta_description_length: 'fix_metadata',
    missing_h1: 'technical',
    multiple_h1: 'technical',
    missing_image_alt: 'performance',
    thin_content: 'content',
    noindex: 'technical',
    missing_canonical: 'technical'
  };

  const severityMap = {
    critical: 5,
    warning: 3,
    opportunity: 1
  };

  const categoriesMap = {
    http_status: 'Technical SEO',
    missing_title: 'Metadata',
    title_length: 'Metadata',
    missing_meta_description: 'Metadata',
    meta_description_length: 'Metadata',
    missing_h1: 'Page Structure',
    multiple_h1: 'Page Structure',
    missing_image_alt: 'Accessibility',
    thin_content: 'Content Quality',
    noindex: 'Indexing',
    missing_canonical: 'Canonicalization'
  };

  const recommendations = [];
  const issueLimit = Math.min(issues.length, 12);
  for (let i = 0; i < issueLimit; i++) {
    const issueItem = issues[i];
    recommendations.push({
      title: `Fix ${issueItem.title}`,
      category: categoriesMap[issueItem.type] || 'SEO Improvement',
      priority: severityMap[issueItem.severity] || 3,
      reason: `Moyi crawled this page and found: ${issueItem.recommendation}`,
      expectedImpact: `Improves indexability, search ranking appearance, and page quality.`,
      effort: issueItem.severity === 'critical' ? 'medium' : 'low',
      actionType: actionTypesMap[issueItem.type] || 'content',
      relatedIssueIds: [issueItem._id.toString()],
      targetUrls: [issueItem.url]
    });
  }

  if (recommendations.length === 0) {
    recommendations.push({
      title: 'Create comparison page',
      category: 'Content Marketing',
      priority: 4,
      reason: 'Comparison pages capture users who are close to a purchasing decision.',
      expectedImpact: 'High conversion intent traffic.',
      effort: 'medium',
      actionType: 'content',
      relatedIssueIds: [],
      targetUrls: pages.length > 0 ? [pages[0].url] : [project.websiteUrl]
    });
    recommendations.push({
      title: 'Integrate Search Console',
      category: 'Technical Integration',
      priority: 3,
      reason: 'Syncing search query data reveals which pages rank on page 2 (positions 11-20).',
      expectedImpact: 'Identifies quick content upgrade opportunities.',
      effort: 'low',
      actionType: 'technical',
      relatedIssueIds: [],
      targetUrls: pages.length > 0 ? [pages[0].url] : [project.websiteUrl]
    });
  }

  return {
    report,
    recommendations,
    model: 'rule-based-fallback'
  };
}

async function generateAiCmoPlan({ project, scan, pages, issues }) {
  if (!env.openaiApiKey) {
    return generateFallbackCmoPlan({ project, scan, pages, issues });
  }

  const context = {
    project: buildProjectContext(project),
    scan: buildScanContext(scan),
    pages: buildPageContext(pages),
    issues: buildIssueContext(issues)
  };

  const reportJson = await requestJson(buildSeoReportPrompt(context));
  const report = sanitizeReport(reportJson);

  const recommendationJson = await requestJson(buildRecommendationPrompt({
    ...context,
    report
  }));
  const recommendations = sanitizeRecommendations(recommendationJson, { pages, issues });

  return {
    report,
    recommendations,
    model: MODEL
  };
}

module.exports = {
  generateAiCmoPlan
};
