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
  const projectServiceCount = serviceLikePages(projectPages).length;
  const projectBlogCount = blogLikePages(projectPages).length;
  const projectHasFaq = hasAnySchema(projectPages, 'faq');
  const projectHome = projectPages[0] || {};

  competitors.forEach((competitor) => {
    const pages = competitorPages.filter((page) => page.competitorId.toString() === competitor._id.toString());
    const competitorServiceCount = serviceLikePages(pages).length;
    const competitorBlogCount = blogLikePages(pages).length;
    const competitorHasFaq = hasAnySchema(pages, 'faq');
    const competitorHome = pages[0] || {};

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
  });

  if (!insights.length && competitors.length) {
    insights.push({
      competitorId: competitors[0]._id,
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

async function generateCompetitorInsights({ projectId, userId }) {
  const [competitors, competitorPages, projectPages] = await Promise.all([
    Competitor.find({ projectId, userId }).sort({ createdAt: -1 }),
    CompetitorPage.find({ projectId }),
    Page.find({ projectId }).sort({ lastCrawledAt: -1 }).limit(80)
  ]);

  if (!competitors.length) return [];

  const context = competitorContext({ competitors, competitorPages, projectPages });
  let insights = null;

  try {
    insights = await requestAiInsights(context, competitors);
  } catch (error) {
    insights = null;
  }

  if (!insights || !insights.length) {
    insights = systemInsights({ competitors, competitorPages, projectPages });
  }

  await CompetitorInsight.deleteMany({ projectId });
  if (!insights.length) return [];

  return CompetitorInsight.insertMany(insights.map((item) => ({
    ...item,
    projectId
  })));
}

module.exports = {
  generateCompetitorInsights,
  systemInsights,
  sanitizeInsights
};
