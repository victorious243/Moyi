const axios = require('axios');
const env = require('../config/env');
const CompetitorPage = require('../models/CompetitorPage');
const { extractPage } = require('./crawlerService');
const { isCrawlableUrl, normalizeUrl, sameHost } = require('../utils/url');

const USER_AGENT = 'MoyiAICMO/1.0 (+manual competitor crawl)';
const IMPORTANT_PATH_PATTERN = /(service|services|product|products|solution|solutions|blog|article|articles|insight|insights|case-stud|pricing|about|location|locations)/i;
const MAX_COMPETITOR_PAGES = 12;

function robotUrlFor(siteUrl) {
  const parsed = new URL(siteUrl);
  return `${parsed.origin}/robots.txt`;
}

function parseRobots(text) {
  const groups = [];
  let activeAgents = [];

  String(text || '').split(/\r?\n/).forEach((line) => {
    const clean = line.split('#')[0].trim();
    if (!clean) return;

    const [rawField, ...rest] = clean.split(':');
    const field = String(rawField || '').trim().toLowerCase();
    const value = rest.join(':').trim();

    if (field === 'user-agent') {
      activeAgents = [value.toLowerCase()];
      groups.push({ agents: activeAgents, disallow: [] });
    } else if (field === 'disallow' && groups.length) {
      groups[groups.length - 1].disallow.push(value);
    }
  });

  return groups;
}

function pathAllowed(url, groups) {
  const path = new URL(url).pathname || '/';
  const relevant = groups.filter((group) => group.agents.includes('*') || group.agents.some((agent) => USER_AGENT.toLowerCase().includes(agent)));

  return relevant.every((group) => group.disallow.every((rule) => {
    if (!rule) return true;
    const escaped = rule
      .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
      .replace(/\*/g, '.*')
      .replace(/\\\$$/, '$');
    return !new RegExp(`^${escaped}`).test(path);
  }));
}

async function fetchRobots(siteUrl) {
  try {
    const response = await axios.get(robotUrlFor(siteUrl), {
      timeout: env.crawlTimeoutMs,
      validateStatus: () => true,
      headers: { 'User-Agent': USER_AGENT }
    });

    if (response.status >= 400) return [];
    return parseRobots(response.data || '');
  } catch (error) {
    return [];
  }
}

async function fetchCompetitorPage(url) {
  try {
    const response = await axios.get(url, {
      timeout: env.crawlTimeoutMs,
      maxRedirects: 5,
      validateStatus: () => true,
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'text/html,application/xhtml+xml'
      }
    });

    const finalUrl = normalizeUrl(response.request && response.request.res && response.request.res.responseUrl ? response.request.res.responseUrl : url);
    return extractPage(response.data || '', finalUrl, response.status);
  } catch (error) {
    return extractPage('', url, 0, error.message);
  }
}

function importantLinksFrom(homepage, baseUrl) {
  const links = (homepage.internalLinks || [])
    .filter((link) => sameHost(link, baseUrl))
    .filter(isCrawlableUrl);

  const important = links.filter((link) => IMPORTANT_PATH_PATTERN.test(new URL(link).pathname));
  return [...new Set([...important, ...links])].slice(0, MAX_COMPETITOR_PAGES - 1);
}

function pagePayload({ projectId, competitorId, page }) {
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
    lastCrawledAt: new Date()
  };
}

function uniquePagePayloads(pages, { projectId, competitorId }) {
  const seenUrls = new Set();
  const payloads = [];

  pages.forEach((page) => {
    if (!page || !page.url || seenUrls.has(page.url)) return;
    seenUrls.add(page.url);
    payloads.push(pagePayload({ projectId, competitorId, page }));
  });

  return payloads;
}

async function crawlCompetitor({ projectId, competitor }) {
  const baseUrl = normalizeUrl(competitor.websiteUrl);
  const robots = await fetchRobots(baseUrl);
  const urls = [];
  const pages = [];

  if (!pathAllowed(baseUrl, robots)) {
    await CompetitorPage.deleteMany({ projectId, competitorId: competitor._id });
    return { pages: [], skippedByRobots: true };
  }

  const homepage = await fetchCompetitorPage(baseUrl);
  pages.push(homepage);
  urls.push(...importantLinksFrom(homepage, baseUrl));

  for (const url of urls) {
    if (pages.length >= MAX_COMPETITOR_PAGES) break;
    if (!sameHost(url, baseUrl) || !isCrawlableUrl(url) || !pathAllowed(url, robots)) continue;
    const page = await fetchCompetitorPage(url);
    pages.push(page);

    if (env.crawlDelayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, env.crawlDelayMs));
    }
  }

  await CompetitorPage.deleteMany({ projectId, competitorId: competitor._id });
  if (pages.length) {
    const payloads = uniquePagePayloads(pages, { projectId, competitorId: competitor._id });
    if (payloads.length) {
      await CompetitorPage.insertMany(payloads);
    }
  }

  return {
    pages,
    skippedByRobots: false
  };
}

module.exports = {
  crawlCompetitor
};
