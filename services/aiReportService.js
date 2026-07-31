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
  const issueById = new Map(issues.map((issue) => [issue._id.toString(), issue]));
  const items = Array.isArray(parsed.recommendations) ? parsed.recommendations : [];

  return items.slice(0, 12).map((item) => {
    const targetUrls = (Array.isArray(item.targetUrls) ? item.targetUrls : [])
      .map(String)
      .filter((url) => allowedUrls.has(url));
    const relatedIssueIds = (Array.isArray(item.relatedIssueIds) ? item.relatedIssueIds : [])
      .map(String)
      .filter((id) => allowedIssueIds.has(id));
    relatedIssueIds.forEach((id) => {
      const issue = issueById.get(id);
      if (issue && issue.url && allowedUrls.has(issue.url) && !targetUrls.includes(issue.url)) {
        targetUrls.push(issue.url);
      }
    });

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

function formatEvidence(evidence) {
  if (!evidence) return '';
  if (typeof evidence === 'string') return evidence;
  try {
    return JSON.stringify(evidence);
  } catch (error) {
    return String(evidence);
  }
}

function buildEvidenceRecommendations({ project, pages, issues }) {
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

  const ambiguousIssueTypes = new Set(['noindex', 'missing_canonical', 'thin_content']);
  const crawledUrls = new Set(pages.map((page) => page.url));
  const recommendations = issues
    .filter((issueItem) => issueItem._id && issueItem.url && crawledUrls.has(issueItem.url))
    .slice(0, 12)
    .map((issueItem) => ({
    title: `${ambiguousIssueTypes.has(issueItem.type) ? 'Review' : 'Fix'} ${issueItem.title}`,
    category: categoriesMap[issueItem.type] || 'SEO Improvement',
    priority: severityMap[issueItem.severity] || 3,
    reason: [
      `Observed on ${issueItem.url}: ${issueItem.title}.`,
      issueItem.evidence ? `Evidence: ${formatEvidence(issueItem.evidence)}.` : '',
      issueItem.recommendation ? `Recommended action: ${issueItem.recommendation}` : ''
    ].filter(Boolean).join(' '),
    expectedImpact: `Resolving this verified ${categoriesMap[issueItem.type] || 'SEO'} finding can improve this page's search readiness.`,
    effort: issueItem.severity === 'critical' ? 'medium' : 'low',
    actionType: actionTypesMap[issueItem.type] || 'content',
    relatedIssueIds: [issueItem._id.toString()],
    targetUrls: [issueItem.url]
  }));

  if (recommendations.length) return recommendations;

  return [];
}

function generateFallbackCmoPlan({ project, scan, pages, issues }) {
  const criticalCount = issues.filter(i => i.severity === 'critical').length;
  const warningCount = issues.filter(i => i.severity === 'warning').length;
  const opportunityCount = issues.filter(i => i.severity === 'opportunity').length;
  const hasIssues = issues.length > 0;
  const issueTitles = issues.slice(0, 5).map(issue => `${issue.title} on ${issue.url}`);

  const report = {
    executiveSummary: `Moyi crawled ${pages.length} page${pages.length === 1 ? '' : 's'} for ${project.name} and found ${issues.length} SEO issue${issues.length === 1 ? '' : 's'}.`,
    currentSeoHealth: `The completed crawl found ${criticalCount} critical, ${warningCount} warning, and ${opportunityCount} opportunity-level issue${issues.length === 1 ? '' : 's'}.`,
    mainBusinessRisk: criticalCount > 0
      ? `Moyi found ${criticalCount} critical issue${criticalCount === 1 ? '' : 's'} that should be reviewed before treating the site as search-ready.`
      : (hasIssues
        ? 'Moyi did not find critical issues in this scan, but did find non-critical SEO issues worth reviewing.'
        : 'Moyi did not find SEO issues in this scan. This does not prove there are no business or search opportunities; it only means this crawl did not surface them.'),
    mainGrowthOpportunity: hasIssues
      ? `Address the specific crawl findings first: ${issueTitles.join('; ')}.`
      : 'No evidence-backed growth opportunity was found from this crawl alone. Connect Search Console or run a deeper crawl before prioritizing new work.',
    topPriorities: hasIssues
      ? issueTitles.map(item => `Review ${item}`).slice(0, 5)
      : ['No crawl-backed SEO fixes were found. Add Search Console data or run a deeper crawl before creating priorities.'],
    quickWins: issues
      .filter(issue => ['opportunity', 'warning'].includes(issue.severity))
      .slice(0, 5)
      .map(issue => `Fix ${issue.title} on ${issue.url}`),
    thirtyDayPlan: hasIssues
      ? [
        'Days 1-7: Review and fix critical issues found in the crawl.',
        'Days 8-14: Fix warning-level page structure, title, metadata, and canonical findings.',
        'Days 15-21: Re-scan the affected URLs and compare issue counts.',
        'Days 22-30: Connect Search Console to validate query, CTR, and position opportunities.'
      ]
      : [
        'Days 1-7: Connect Search Console or increase crawl coverage.',
        'Days 8-14: Re-run the scan with broader coverage.',
        'Days 15-30: Prioritize only the issues or search metrics Moyi can verify.'
      ],
    suggestedContentStrategy: 'No content strategy was generated from unsupported assumptions. Use Search Console queries, verified competitor data, or explicit business inputs before creating new content recommendations.',
    pageImprovementPriorities: issues.slice(0, 5).map(issue => `Fix ${issue.title} on ${issue.url}`),
    internalLinkingStrategy: 'No internal-linking recommendation was generated unless a specific crawl issue or page opportunity supports it.',
    measurementPlan: 'Use crawl findings plus Search Console data to verify priorities before execution.',
    warningsLimitations: [
      'This plan was generated using a rule-based fallback system because no OPENAI_API_KEY was configured.',
      'Configure an OpenAI API key in your environment to unlock deep semantic AI audits and custom content drafts.'
    ]
  };

  const recommendations = buildEvidenceRecommendations({ project, pages, issues });

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
  const finalRecommendations = recommendations.length
    ? recommendations
    : buildEvidenceRecommendations({ project, pages, issues });

  return {
    report,
    recommendations: finalRecommendations,
    model: MODEL
  };
}

module.exports = {
  buildEvidenceRecommendations,
  generateAiCmoPlan,
  _private: {
    buildEvidenceRecommendations,
    sanitizeRecommendations
  }
};
