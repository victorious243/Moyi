const OpenAI = require('openai');
const env = require('../config/env');
const Competitor = require('../models/Competitor');
const CompetitorInsight = require('../models/CompetitorInsight');
const CompetitorPage = require('../models/CompetitorPage');
const Page = require('../models/Page');
const buildCompetitorPrompt = require('../src/prompts/competitor-opportunity.prompt');

const MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';

function hasAnySchema(pages, schema) {
  return pages.some((page) => (page.schemaTypes || []).some((type) => String(type).toLowerCase().includes(schema)));
}

function serviceLikePages(pages) {
  return pages.filter((page) => /(service|product|solution|location)/i.test(page.url) || (page.headings || []).some((heading) => /(service|product|solution|location)/i.test(heading)));
}

function blogLikePages(pages) {
  return pages.filter((page) => /(blog|article|insight|news)/i.test(page.url));
}

function metadataScore(page) {
  let score = 0;
  if (page.title && page.title.length >= 20 && page.title.length <= 65) score += 1;
  if (page.metaDescription && page.metaDescription.length >= 70 && page.metaDescription.length <= 160) score += 1;
  if ((page.h1 || []).length === 1) score += 1;
  return score;
}

function usableEvidencePages(pages) {
  const seen = new Set();
  return pages.filter((page) => {
    if (!page || !page.url || seen.has(page.url)) return false;
    if (page.statusCode && (page.statusCode < 200 || page.statusCode >= 400)) return false;
    if (!page.title && !page.wordCount && !(page.h1 || []).length) return false;
    seen.add(page.url);
    return true;
  });
}

function averageWordCount(pages) {
  const counts = pages.map((page) => Number(page.wordCount || 0)).filter((count) => count > 0);
  if (!counts.length) return 0;
  return Math.round(counts.reduce((sum, count) => sum + count, 0) / counts.length);
}

function metadataCoverage(pages) {
  if (!pages.length) return 0;
  const complete = pages.filter((page) => metadataScore(page) >= 2).length;
  return Math.round((complete / pages.length) * 100);
}

function schemaTypes(pages) {
  return new Set(pages.flatMap((page) => page.schemaTypes || []).map((type) => String(type).toLowerCase()));
}

function competitorContext({ competitors, competitorPages, projectPages }) {
  return {
    projectPages: projectPages.slice(0, 40).map((page) => ({
      url: page.url,
      title: page.title,
      metaDescription: page.metaDescription,
      h1: page.h1,
      headings: page.headings,
      wordCount: page.wordCount,
      schemaTypes: page.schemaTypes
    })),
    competitors: competitors.map((competitor) => ({
      id: competitor._id.toString(),
      name: competitor.name,
      websiteUrl: competitor.websiteUrl,
      pages: competitorPages
        .filter((page) => page.competitorId.toString() === competitor._id.toString())
        .slice(0, 20)
        .map((page) => ({
          url: page.url,
          title: page.title,
          metaDescription: page.metaDescription,
          h1: page.h1,
          headings: page.headings,
          wordCount: page.wordCount,
          schemaTypes: page.schemaTypes
        }))
    }))
  };
}

function parseJson(content) {
  const trimmed = String(content || '').trim();
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  const json = start >= 0 && end >= start ? trimmed.slice(start, end + 1) : trimmed;
  return JSON.parse(json);
}

function sanitizeInsights(parsed, competitors) {
  const allowedIds = new Set(competitors.map((competitor) => competitor._id.toString()));
  const items = Array.isArray(parsed.insights) ? parsed.insights : [];

  return items.slice(0, 20).map((item) => ({
    competitorId: allowedIds.has(String(item.competitorId)) ? String(item.competitorId) : competitors[0]._id.toString(),
    title: String(item.title || 'Competitor opportunity').slice(0, 160),
    category: String(item.category || 'content_gap').slice(0, 80),
    insight: String(item.insight || ''),
    opportunity: String(item.opportunity || ''),
    evidenceSummary: String(item.evidenceSummary || item.insight || '').slice(0, 260),
    confidenceScore: Math.min(Math.max(Number(item.confidenceScore || item.confidence) || 62, 0), 100),
    generatedBy: 'ai',
    priority: Math.min(Math.max(Number(item.priority) || 3, 1), 5)
  })).filter((item) => item.insight && item.opportunity);
}

async function requestAiInsights(context, competitors) {
  if (!env.openaiApiKey) return null;

  const client = new OpenAI({ apiKey: env.openaiApiKey });
  const response = await client.chat.completions.create({
    model: MODEL,
    temperature: 0.2,
    response_format: { type: 'json_object' },
    messages: [
      {
        role: 'system',
        content: 'You create ethical competitor SEO opportunities from supplied crawled data only. Never invent traffic, rankings, or private data.'
      },
      { role: 'user', content: buildCompetitorPrompt(context) }
    ]
  });

  return sanitizeInsights(parseJson(response.choices[0].message.content), competitors);
}

function systemInsights({ competitors, competitorPages, projectPages }) {
  const insights = [];
  projectPages = usableEvidencePages(projectPages);
  competitorPages = usableEvidencePages(competitorPages);
  const projectServiceCount = serviceLikePages(projectPages).length;
  const projectBlogCount = blogLikePages(projectPages).length;
  const projectHasFaq = hasAnySchema(projectPages, 'faq');
  const projectHome = projectPages[0] || {};
  const projectAverageWords = averageWordCount(projectPages);
  const projectMetadataCoverage = metadataCoverage(projectPages);
  const projectSchemaTypes = schemaTypes(projectPages);
  const evidenceCompetitors = [];

  competitors.forEach((competitor) => {
    const pages = competitorPages.filter((page) => page.competitorId.toString() === competitor._id.toString());
    if (!pages.length) return;
    evidenceCompetitors.push(competitor);
    const competitorServiceCount = serviceLikePages(pages).length;
    const competitorBlogCount = blogLikePages(pages).length;
    const competitorHasFaq = hasAnySchema(pages, 'faq');
    const competitorHome = pages[0] || {};
    const competitorAverageWords = averageWordCount(pages);
    const competitorMetadataCoverage = metadataCoverage(pages);
    const competitorSchemaTypes = schemaTypes(pages);

    if (competitorServiceCount > projectServiceCount) {
      insights.push({
        competitorId: competitor._id,
        title: 'Competitor has more dedicated service/product pages',
        category: 'content_gap',
        insight: `${competitor.name} has ${competitorServiceCount} crawled service/product-style pages versus ${projectServiceCount} found for this project.`,
        opportunity: 'Create useful, original service or product pages that answer buyer questions instead of copying competitor wording.',
        evidenceSummary: `Public crawl found ${competitorServiceCount} competitor service/product pages and ${projectServiceCount} project service/product pages.`,
        confidenceScore: 78,
        generatedBy: 'system',
        priority: 1
      });
    }

    if (competitorBlogCount > projectBlogCount) {
      insights.push({
        competitorId: competitor._id,
        title: 'Competitor has more discoverable article content',
        category: 'content_gap',
        insight: `${competitor.name} has ${competitorBlogCount} crawled blog/article-style pages versus ${projectBlogCount} found for this project.`,
        opportunity: 'Plan practical educational articles around customer questions, comparisons, and use cases.',
        evidenceSummary: `Public crawl found ${competitorBlogCount} competitor article pages and ${projectBlogCount} project article pages.`,
        confidenceScore: 74,
        generatedBy: 'system',
        priority: 2
      });
    }

    if (competitorHasFaq && !projectHasFaq) {
      insights.push({
        competitorId: competitor._id,
        title: 'Competitor uses FAQ schema',
        category: 'schema_gap',
        insight: `${competitor.name} has FAQ-style structured data in the crawled pages, while this project does not.`,
        opportunity: 'Add accurate FAQ sections and JSON-LD only where the page genuinely answers those questions.',
        evidenceSummary: `Shallow crawl detected FAQ-style schema on competitor pages and none on the project pages sampled here.`,
        confidenceScore: 71,
        generatedBy: 'system',
        priority: 3
      });
    }

    if (metadataScore(competitorHome) > metadataScore(projectHome)) {
      insights.push({
        competitorId: competitor._id,
        title: 'Competitor homepage metadata is more complete',
        category: 'metadata_gap',
        insight: `${competitor.name}'s homepage has a stronger combination of title, meta description, and H1 structure in the crawled data.`,
        opportunity: 'Rewrite the project homepage title, meta description, and H1 so the offer, audience, and location or market are clearer.',
        evidenceSummary: `Homepage metadata score favored the competitor in the sampled crawl.`,
        confidenceScore: 68,
        generatedBy: 'system',
        priority: 2
      });
    }

    if (pages.length >= projectPages.length + 2 && pages.length >= Math.ceil(projectPages.length * 1.35)) {
      insights.push({
        competitorId: competitor._id,
        title: 'Competitor exposes broader crawlable topic coverage',
        category: 'page_structure_gap',
        insight: `${competitor.name} has ${pages.length} unique readable pages in this sample versus ${projectPages.length} for the project.`,
        opportunity: 'Review the missing buyer journeys and create only the product, use-case, comparison, or educational pages that answer a real customer need.',
        evidenceSummary: `The same bounded crawl retained ${pages.length} unique competitor pages and ${projectPages.length} unique project pages.`,
        confidenceScore: 76,
        generatedBy: 'system',
        priority: 2
      });
    }

    if (competitorAverageWords >= 350 && competitorAverageWords >= projectAverageWords * 1.3) {
      insights.push({
        competitorId: competitor._id,
        title: 'Competitor pages provide more on-page depth',
        category: 'content_gap',
        insight: `${competitor.name}'s readable pages average about ${competitorAverageWords} words versus ${projectAverageWords} words on the project pages sampled.`,
        opportunity: 'Strengthen thin priority pages with original proof, use cases, objections, process details, and answers customers actually need.',
        evidenceSummary: `Average visible body-text word count was ${competitorAverageWords} for ${competitor.name} and ${projectAverageWords} for this project.`,
        confidenceScore: 72,
        generatedBy: 'system',
        priority: 2
      });
    }

    if (competitorMetadataCoverage >= projectMetadataCoverage + 20 && competitorMetadataCoverage >= 60) {
      insights.push({
        competitorId: competitor._id,
        title: 'Competitor has stronger metadata coverage',
        category: 'metadata_gap',
        insight: `${competitor.name} has complete title/meta/H1 combinations on ${competitorMetadataCoverage}% of sampled pages versus ${projectMetadataCoverage}% for this project.`,
        opportunity: 'Prioritize missing or weak titles, descriptions, and H1s on commercially important pages before expanding content volume.',
        evidenceSummary: `Metadata completeness was measured on ${pages.length} competitor pages and ${projectPages.length} project pages.`,
        confidenceScore: 79,
        generatedBy: 'system',
        priority: 1
      });
    }

    const missingSchemaTypes = [...competitorSchemaTypes].filter((type) => !projectSchemaTypes.has(type));
    if (missingSchemaTypes.length) {
      insights.push({
        competitorId: competitor._id,
        title: 'Competitor uses additional structured-data types',
        category: 'schema_gap',
        insight: `${competitor.name} exposes ${missingSchemaTypes.slice(0, 4).join(', ')} structured data that was not found in the project sample.`,
        opportunity: 'Review whether those schema types accurately fit existing project content; add them only when the visible page supports every field.',
        evidenceSummary: `Public HTML contained additional schema types: ${missingSchemaTypes.slice(0, 6).join(', ')}.`,
        confidenceScore: 70,
        generatedBy: 'system',
        priority: 3
      });
    }
  });

  if (!insights.length && evidenceCompetitors.length && projectPages.length) {
    insights.push({
      competitorId: evidenceCompetitors[0]._id,
      title: 'No obvious gap found from the shallow crawl',
      category: 'page_structure_gap',
      insight: 'The available competitor crawl did not reveal a clear structural advantage.',
      opportunity: 'Scan the project site again, add more direct competitors, and review page titles/headings for clarity.',
      evidenceSummary: 'Current public crawl sample was too shallow to support a stronger comparison claim.',
      confidenceScore: 40,
      generatedBy: 'system',
      priority: 4
    });
  }

  return insights.slice(0, 20);
}

function mergeInsights(aiInsights, deterministicInsights) {
  const merged = [];
  const seen = new Set();
  const deterministic = (aiInsights || []).length
    ? deterministicInsights.filter((item) => item.title !== 'No obvious gap found from the shallow crawl')
    : deterministicInsights;

  [...(aiInsights || []), ...deterministic].forEach((item) => {
    const key = `${item.competitorId}:${item.category}:${String(item.title || '').toLowerCase()}`;
    if (seen.has(key)) return;
    seen.add(key);
    merged.push(item);
  });

  return merged.sort((left, right) => Number(left.priority || 3) - Number(right.priority || 3)).slice(0, 20);
}

async function generateCompetitorInsights({ projectId, userId }) {
  const [competitors, competitorPages, latestProjectPage] = await Promise.all([
    Competitor.find({ projectId, userId }).sort({ createdAt: -1 }),
    CompetitorPage.find({ projectId }),
    Page.findOne({ projectId }).sort({ lastCrawledAt: -1, createdAt: -1 }).select('scanId')
  ]);

  if (!competitors.length) return [];
  const projectPages = latestProjectPage
    ? await Page.find({ projectId, scanId: latestProjectPage.scanId }).sort({ createdAt: 1 }).limit(80)
    : [];
  const usableCompetitorPages = usableEvidencePages(competitorPages);
  const usableProjectPages = usableEvidencePages(projectPages);
  const evidenceCompetitors = competitors.filter((competitor) => usableCompetitorPages.some((page) => page.competitorId.toString() === competitor._id.toString()));
  if (!evidenceCompetitors.length || !usableProjectPages.length) return [];

  const context = competitorContext({ competitors: evidenceCompetitors, competitorPages: usableCompetitorPages, projectPages: usableProjectPages });
  let aiInsights = null;

  try {
    aiInsights = await requestAiInsights(context, evidenceCompetitors);
  } catch (error) {
    aiInsights = null;
  }

  const deterministicInsights = systemInsights({
    competitors: evidenceCompetitors,
    competitorPages: usableCompetitorPages,
    projectPages: usableProjectPages
  });
  const insights = mergeInsights(aiInsights, deterministicInsights);

  await CompetitorInsight.deleteMany({ projectId });
  if (!insights.length) return [];

  return CompetitorInsight.insertMany(insights.map((item) => ({
    ...item,
    projectId
  })));
}

module.exports = {
  generateCompetitorInsights,
  mergeInsights,
  systemInsights,
  sanitizeInsights,
  usableEvidencePages
};
