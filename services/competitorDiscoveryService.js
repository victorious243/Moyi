const Competitor = require('../models/Competitor');
const CompetitorPage = require('../models/CompetitorPage');
const { inferCompetitorsFromPagesDetailed } = require('./discoveryService');
const { normalizeUrl } = require('../utils/url');

function competitorSummary(competitor) {
  return {
    name: competitor.name,
    websiteUrl: competitor.websiteUrl,
    confidence: competitor.confidence,
    rationale: competitor.rationale,
    evidence: competitor.evidence
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

  for (const candidate of competitors.slice(0, 5)) {
    if (!candidate.websiteUrl) continue;

    let competitor = await Competitor.findOne({ projectId: project._id, userId, websiteUrl: candidate.websiteUrl });
    if (!competitor) {
      competitor = await Competitor.create({
        projectId: project._id,
        userId,
        name: candidate.name || candidate.websiteUrl || 'Competitor',
        websiteUrl: candidate.websiteUrl,
        notes: candidate.rationale || 'Auto-discovered from website scan.',
        source: 'discovered',
        confidence: Number(candidate.confidence || 0),
        rationale: candidate.rationale || '',
        discoveryEvidence: candidate.evidence || {},
        lastDiscoveredAt: new Date()
      });
    } else {
      competitor.confidence = Math.max(Number(competitor.confidence || 0), Number(candidate.confidence || 0));
      competitor.rationale = candidate.rationale || competitor.rationale;
      competitor.discoveryEvidence = candidate.evidence || competitor.discoveryEvidence;
      competitor.lastDiscoveredAt = new Date();
      if (competitor.source === 'discovered') {
        competitor.name = candidate.name || competitor.name;
        competitor.notes = candidate.rationale || competitor.notes;
      }
      await competitor.save();
    }
    created.push(competitor);

    const pages = ((candidate.crawl && candidate.crawl.pages) || []).filter((page) => page && page.url);
    if (!pages.length) continue;

    const pagePayloads = uniqueCompetitorPagePayloads(pages, {
      projectId: project._id,
      competitorId: competitor._id
    });

    if (pagePayloads.length) {
      await CompetitorPage.bulkWrite(pagePayloads.map((payload) => ({
        updateOne: {
          filter: { projectId: payload.projectId, competitorId: payload.competitorId, url: payload.url },
          update: { $set: payload },
          upsert: true
        }
      })));
    }
  }

  return created;
}

function configuredCompetitorCandidates(project) {
  const configured = Array.isArray(project.competitors) ? project.competitors : [];
  const seen = new Set();

  return configured.map((candidate) => {
    const value = typeof candidate === 'string' ? { name: candidate, websiteUrl: candidate } : (candidate || {});
    let websiteUrl = '';
    try {
      websiteUrl = normalizeUrl(value.websiteUrl || value.url || value.name || '');
    } catch (error) {
      return null;
    }

    if (!websiteUrl || seen.has(websiteUrl)) return null;
    seen.add(websiteUrl);
    return {
      name: value.name || websiteUrl,
      websiteUrl,
      confidence: value.confidence,
      rationale: value.rationale || 'Configured during project calibration.'
    };
  }).filter(Boolean);
}

async function persistConfiguredCompetitors({ project, userId }) {
  const candidates = configuredCompetitorCandidates(project);
  const created = [];

  for (const candidate of candidates) {
    const existing = await Competitor.findOne({
      projectId: project._id,
      userId,
      websiteUrl: candidate.websiteUrl
    });
    if (existing) {
      created.push(existing);
      continue;
    }

    const competitor = await Competitor.create({
      projectId: project._id,
      userId,
      name: candidate.name,
      websiteUrl: candidate.websiteUrl,
      notes: candidate.rationale,
      source: 'configured',
      confidence: Number(candidate.confidence || 0),
      rationale: candidate.rationale || '',
      lastDiscoveredAt: new Date()
    });
    created.push(competitor);
  }

  return created;
}

function competitorDiscoveryBrandProfile(project) {
  const profile = project.brand_profile || {};
  return {
    ...profile,
    title: profile.title || project.name,
    metaDescription: profile.metaDescription || project.mainOffer || '',
    industry: project.industry || '',
    mainOffer: project.mainOffer || '',
    targetAudience: project.targetAudience || '',
    valueProps: Array.isArray(profile.valueProps) && profile.valueProps.length
      ? profile.valueProps
      : [project.mainOffer].filter(Boolean),
    personas: Array.isArray(profile.personas) && profile.personas.length
      ? profile.personas
      : [project.targetAudience].filter(Boolean)
  };
}

async function discoverCompetitorsForProject({ project, userId, projectPages, force = false }) {
  const existingCompetitors = await Competitor.find({ projectId: project._id, userId }).sort({ createdAt: -1 });
  if (existingCompetitors.length && !force) return existingCompetitors;

  const configuredCompetitors = await persistConfiguredCompetitors({ project, userId });
  if (configuredCompetitors.length && !force) return configuredCompetitors;

  const discovery = await inferCompetitorsFromPagesDetailed(
    projectPages,
    project.websiteUrl,
    competitorDiscoveryBrandProfile(project)
  );
  const discoveredCompetitors = discovery.competitors;

  project.competitorDiscovery = {
    ...discovery.diagnostics,
    completedAt: new Date()
  };

  if (discoveredCompetitors.length) {
    await persistDiscoveredCompetitors({
      project,
      userId,
      competitors: discoveredCompetitors
    });

    project.competitors = discoveredCompetitors.map(competitorSummary);
  }
  await project.save();

  return Competitor.find({ projectId: project._id, userId }).sort({ confidence: -1, createdAt: -1 });
}

module.exports = {
  competitorSummary,
  configuredCompetitorCandidates,
  discoverCompetitorsForProject,
  persistConfiguredCompetitors,
  persistDiscoveredCompetitors
};
