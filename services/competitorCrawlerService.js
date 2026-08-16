const axios = require('axios');
const env = require('../config/env');
const CompetitorPage = require('../models/CompetitorPage');
const { extractPage } = require('./crawlerService');
const { isCrawlableUrl, normalizeUrl, sameHost } = require('../utils/url');

const USER_AGENT = 'Mozilla/5.0 (compatible; MoyiAI-CMO/2.0; +https://moyi-cmo.com)';
const IMPORTANT_PATH_PATTERN = /(service|services|product|products|solution|solutions|blog|article|articles|insight|insights|case-stud|pricing|about|location|locations)/i;
const MAX_COMPETITOR_PAGES = 12;

function robotUrlFor(siteUrl) {
  const parsed = new URL(siteUrl);
  return `${parsed.origin}/robots.txt`;
}

function parseRobots(text) {
  const groups = [];
  const sitemaps = [];
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
    } else if (field === 'sitemap' && value) {
      sitemaps.push(value);
    }
  });

  return { groups, sitemaps: [...new Set(sitemaps)] };
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

    if (response.status >= 400) return { groups: [], sitemaps: [] };
    return parseRobots(response.data || '');
  } catch (error) {
    return { groups: [], sitemaps: [] };
  }
}

function sitemapLocations(xml) {
  return [...String(xml || '').matchAll(/<loc[^>]*>([\s\S]*?)<\/loc>/gi)]
    .map((match) => match[1].replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim())
    .filter(Boolean);
}

async function fetchSitemapDocument(url) {
  try {
    const response = await axios.get(url, {
      timeout: env.crawlTimeoutMs,
      maxRedirects: 5,
      validateStatus: () => true,
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'application/xml,text/xml,text/plain,*/*'
      }
    });
    if (response.status < 200 || response.status >= 400) return '';
    return String(response.data || '').slice(0, 1000000);
  } catch (error) {
    return '';
  }
}

async function sitemapPageUrls(baseUrl, declaredSitemaps = []) {
  const origin = new URL(baseUrl).origin;
  const sitemapCandidates = [...new Set([...declaredSitemaps, `${origin}/sitemap.xml`])].slice(0, 4);
  const pageUrls = [];

  for (const sitemapUrl of sitemapCandidates) {
    const xml = await fetchSitemapDocument(sitemapUrl);
    if (!xml) continue;
    const locations = sitemapLocations(xml);

    if (/<sitemapindex/i.test(xml)) {
      for (const nestedUrl of locations.slice(0, 3)) {
        const nestedXml = await fetchSitemapDocument(nestedUrl);
        pageUrls.push(...sitemapLocations(nestedXml));
      }
    } else {
      pageUrls.push(...locations);
    }
  }

  const valid = pageUrls.filter((url) => {
    try {
      return sameHost(url, baseUrl) && isCrawlableUrl(url);
    } catch (error) {
      return false;
    }
  });
  const important = valid.filter((url) => IMPORTANT_PATH_PATTERN.test(new URL(url).pathname));
  return [...new Set([...important, ...valid])].slice(0, MAX_COMPETITOR_PAGES - 1);
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

  if (!pathAllowed(baseUrl, robots.groups)) {
    return { pages: [], skippedByRobots: true };
  }

  const homepage = await fetchCompetitorPage(baseUrl);
  pages.push(homepage);
  const sitemapUrls = await sitemapPageUrls(baseUrl, robots.sitemaps);
  urls.push(...new Set([...importantLinksFrom(homepage, baseUrl), ...sitemapUrls]));

  for (const url of urls) {
    if (pages.length >= MAX_COMPETITOR_PAGES) break;
    if (!sameHost(url, baseUrl) || !isCrawlableUrl(url) || !pathAllowed(url, robots.groups)) continue;
    const page = await fetchCompetitorPage(url);
    pages.push(page);

    if (env.crawlDelayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, env.crawlDelayMs));
    }
  }

  const payloads = uniquePagePayloads(pages, { projectId, competitorId: competitor._id });
  const hasUsableEvidence = payloads.some((page) => page.statusCode >= 200 && page.statusCode < 400 && (page.title || page.wordCount));
  if (hasUsableEvidence) {
    await CompetitorPage.deleteMany({ projectId, competitorId: competitor._id });
    await CompetitorPage.insertMany(payloads);
  }

  return {
    pages,
    skippedByRobots: false,
    sitemapUrlsFound: sitemapUrls.length,
    usablePages: pages.filter((page) => page.statusCode >= 200 && page.statusCode < 400 && (page.title || page.wordCount)).length,
    failedPages: pages.filter((page) => page.statusCode < 200 || page.statusCode >= 400).length
  };
}

module.exports = {
  crawlCompetitor,
  parseRobots,
  sitemapLocations
};
