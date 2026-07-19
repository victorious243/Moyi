const Competitor = require('../models/Competitor');
const CompetitorPage = require('../models/CompetitorPage');
const { inferCompetitorsFromPages } = require('./discoveryService');

function competitorSummary(competitor) {
  return {
    name: competitor.name,
    websiteUrl: competitor.websiteUrl,
    confidence: competitor.confidence,
    rationale: competitor.rationale
  };
}

function competitorPagePayload({ projectId, competitorId, page }) {
  return {
    projectId,
    competitorId,
    url: page.url,
    statusCode: page.statusCode || 0,
    title: page.title || '',
    metaDescription: page.metaDescription || '',
    h1: page.h1 || [],
    headings: page.headings || [],
    wordCount: page.wordCount || 0,
    internalLinks: (page.internalLinks || []).slice(0, 100),
    externalLinks: (page.externalLinks || []).slice(0, 100),
    schemaTypes: page.schemaTypes || [],
    lastCrawledAt: page.lastCrawledAt || new Date()
  };
}

function uniqueCompetitorPagePayloads(pages, { projectId, competitorId }) {
  const seenUrls = new Set();
  const payloads = [];

  pages.forEach((page) => {
    if (!page || !page.url || seenUrls.has(page.url)) return;
    seenUrls.add(page.url);
    payloads.push(competitorPagePayload({ projectId, competitorId, page }));
  });

  return payloads;
}

async function persistDiscoveredCompetitors({ project, userId, competitors }) {
  const created = [];

  for (const candidate of competitors.slice(0, 3)) {
    if (!candidate.websiteUrl) continue;

    const competitor = await Competitor.create({
      projectId: project._id,
      userId,
      name: candidate.name || candidate.websiteUrl || 'Competitor',
      websiteUrl: candidate.websiteUrl,
      notes: candidate.rationale || 'Auto-discovered from website scan.'
    });
    created.push(competitor);

    const pages = ((candidate.crawl && candidate.crawl.pages) || []).filter((page) => page && page.url);
    if (!pages.length) continue;

    const pagePayloads = uniqueCompetitorPagePayloads(pages, {
      projectId: project._id,
      competitorId: competitor._id
    });

    if (pagePayloads.length) {
      await CompetitorPage.insertMany(pagePayloads);
    }
  }

  return created;
}

function competitorDiscoveryBrandProfile(project) {
  const profile = project.brand_profile || {};
  return {
    ...profile,
    title: profile.title || project.name,
    metaDescription: profile.metaDescription || project.mainOffer || '',
    valueProps: Array.isArray(profile.valueProps) && profile.valueProps.length
      ? profile.valueProps
      : [project.mainOffer].filter(Boolean),
    personas: Array.isArray(profile.personas) && profile.personas.length
      ? profile.personas
      : [project.targetAudience].filter(Boolean)
  };
}

async function discoverCompetitorsForProject({ project, userId, projectPages }) {
  const existingCompetitors = await Competitor.countDocuments({ projectId: project._id, userId });
  if (existingCompetitors) return [];

  const discoveredCompetitors = await inferCompetitorsFromPages(
    projectPages,
    project.websiteUrl,
    competitorDiscoveryBrandProfile(project)
  );

  if (!discoveredCompetitors.length) return [];

  await persistDiscoveredCompetitors({
    project,
    userId,
    competitors: discoveredCompetitors
  });

  project.competitors = discoveredCompetitors.map(competitorSummary);
  await project.save();

  return discoveredCompetitors;
}

module.exports = {
  competitorSummary,
  discoverCompetitorsForProject,
  persistDiscoveredCompetitors
};
