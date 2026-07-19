// AI-CMO SPEC COMPLIANCE: Requirement 2 / 7 - low-friction onboarding must
// discover likely competitors from the target URL and crawl them before the
// user lands in the project workspace.
const axios = require('axios');
const OpenAI = require('openai');
const env = require('../config/env');
const { crawlWebsite, enrichDraftBrandProfile, extractDraftBrandProfile } = require('./crawlerService');
const { normalizeUrl, sameHost } = require('../utils/url');

const MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';
const MAX_COMPETITORS = 3;
const SEARCH_RESULT_LIMIT = 6;
const SEARCH_SNIPPET_LIMIT = 1400;
const FALSE_POSITIVE_HOST_PATTERN = /(facebook|instagram|linkedin|twitter|x\.com|youtube|tiktok|reddit|wikipedia|wiktionary|medium|substack|wordpress|blogspot|github|gitlab|crunchbase|g2|capterra|trustpilot|producthunt|ycombinator|angel\.co|news|forbes|techcrunch|venturebeat|hubspot|shopify|amazon|apple|google|docs\.|support\.|help\.|directory|indeed|glassdoor)/i;
const FALSE_POSITIVE_CONTENT_PATTERN = /(directory|listing|compare tools|tool directory|marketplace|top ai tools|best ai tools|blog|newsletter|media company|news site|agency|consultancy|training course|community)/i;
const COMPETITOR_CATEGORY_PATTERNS = {
  mobile: /\b(mobile|sim only|sim-only|phone plans?|bill pay|pay as you go|prepay|pre-paid|5g|4g)\b/i,
  broadband: /\b(broadband|fibre|fiber|wifi|wi-fi|internet)\b/i,
  tv: /\b(tv|television|streaming|channels?)\b/i,
  business: /\b(business|enterprise|sme|small business)\b/i,
  security: /\b(security|cybersecurity|secure|protection)\b/i,
  roaming: /\b(roaming|esim|travel sim|travel eSIM|international data)\b/i
};

function cleanText(value, max = 500) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function safeHostname(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '').toLowerCase();
  } catch (error) {
    return '';
  }
}

function hostnameLabel(url) {
  const host = safeHostname(url);
  return host ? host.split('.')[0].replace(/[-_]+/g, ' ') : '';
}

function distinct(values, limit = values.length) {
  return [...new Set(values.filter(Boolean))].slice(0, limit);
}

function homepageCorpus(pages) {
  return pages
    .slice(0, 3)
    .map((page) => [
      page.title,
      page.metaDescription,
      ...(page.h1 || []),
      ...(page.headings || [])
    ].filter(Boolean).join(' '))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseJson(content) {
  const trimmed = cleanText(content, 8000);
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  const json = start >= 0 && end >= start ? trimmed.slice(start, end + 1) : trimmed;
  return JSON.parse(json);
}

function textTokens(value) {
  return distinct(
    cleanText(value, 1200)
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((word) => word.length > 3 && !/^(with|from|your|their|this|that|into|more|best|platform|software|tools|tool|site|page|about|launch|create|using)$/.test(word))
  );
}

function detectCategories(value) {
  const text = cleanText(value, 4000);
  return Object.entries(COMPETITOR_CATEGORY_PATTERNS)
    .filter(([, pattern]) => pattern.test(text))
    .map(([category]) => category);
}

async function llmJson(prompt) {
  if (!env.openaiApiKey) return null;

  const client = new OpenAI({ apiKey: env.openaiApiKey });
  const response = await client.chat.completions.create({
    model: MODEL,
    temperature: 0.1,
    response_format: { type: 'json_object' },
    messages: [
      {
        role: 'system',
        content: 'Return compact JSON only. Use only the supplied webpage evidence. Never invent company facts.'
      },
      { role: 'user', content: prompt }
    ]
  });

  return parseJson(response.choices[0].message.content);
}

function fallbackSearchTerms(brandProfile, pages, websiteUrl) {
  const phrases = distinct([
    ...(brandProfile.personas || []),
    ...(brandProfile.valueProps || []),
    ...(brandProfile.evidence && brandProfile.evidence.h1 ? brandProfile.evidence.h1 : []),
    ...(brandProfile.evidence && brandProfile.evidence.headings ? brandProfile.evidence.headings : []),
    brandProfile.title,
    brandProfile.metaDescription,
    hostnameLabel(websiteUrl)
  ], 12);

  const terms = [];
  phrases.forEach((phrase) => {
    const words = cleanText(phrase, 120)
      .split(/[^a-zA-Z0-9]+/)
      .filter((word) => word.length > 2 && !/^(the|and|with|from|your|their|this|that|into|more|best|home|page|contact|about|blog)$/.test(word.toLowerCase()));
    if (words.length >= 2) terms.push(words.slice(0, 4).join(' '));
  });

  if (!terms.length) {
    const corpus = homepageCorpus(pages);
    const words = corpus
      .split(/[^a-zA-Z0-9]+/)
      .filter((word) => word.length > 4)
      .slice(0, 20);
    for (let index = 0; index < words.length; index += 2) {
      terms.push(words.slice(index, index + 2).join(' '));
    }
  }

  return distinct(terms.map((term) => cleanText(term, 60)), 5);
}

async function extractSearchTerms({ websiteUrl, brandProfile, pages }) {
  const corpus = homepageCorpus(pages).slice(0, 3000);
  const prompt = [
    'Extract 3 to 5 short search terms that a buyer would use to find direct alternatives to this business.',
    'Return JSON with {"searchTerms":["term one","term two"]}.',
    `Website: ${websiteUrl}`,
    `Title: ${brandProfile.title || ''}`,
    `Meta description: ${brandProfile.metaDescription || ''}`,
    `Observed homepage text: ${corpus}`
  ].join('\n');

  try {
    const parsed = await llmJson(prompt);
    const terms = distinct((parsed && parsed.searchTerms) || [], 5)
      .map((term) => cleanText(term, 60))
      .filter((term) => term.split(/\s+/).length >= 2);
    if (terms.length) return terms;
  } catch (error) {
    // Falls back to deterministic extraction below.
  }

  return fallbackSearchTerms(brandProfile, pages, websiteUrl);
}

function searchQueryForTerm(term) {
  return cleanText(term, 80);
}

function extractDuckDuckGoTarget(href) {
  try {
    const absolute = new URL(href, 'https://html.duckduckgo.com');
    const redirect = absolute.searchParams.get('uddg');
    if (redirect) return decodeURIComponent(redirect);
    if (/^https?:/i.test(absolute.toString())) return absolute.toString();
  } catch (error) {
    if (/^https?:/i.test(String(href || ''))) return String(href);
  }

  return '';
}

function filteredHost(host, projectUrl) {
  return !host || FALSE_POSITIVE_HOST_PATTERN.test(host) || sameHost(`https://${host}`, projectUrl);
}

function projectCountryTld(projectUrl) {
  const host = safeHostname(projectUrl);
  const parts = host.split('.');
  return parts.length > 1 ? parts[parts.length - 1] : '';
}

function candidatePriority(candidate, projectUrl) {
  const domain = String(candidate.domain || '').toLowerCase();
  const title = cleanText(candidate.title, 160);
  const countryTld = projectCountryTld(projectUrl);
  let score = 0;

  if (countryTld && domain.endsWith(`.${countryTld}`)) score += 3;
  if (domain.split('.').length <= 2) score += 1;
  if (/(compare|comparison|alternatives?|guide|all networks|coverage|providers?\b|vs\b)/i.test(title)) score -= 2;
  if (/(mobile|broadband|tv|business|network)/i.test(title)) score += 1;

  return score;
}

function parseSearchResults(html, projectUrl, limit = SEARCH_RESULT_LIMIT) {
  const anchors = [...String(html || '').matchAll(/<a[^>]+href="([^"]+)"[^>]*>(.*?)<\/a>/gi)];
  const results = [];
  const seen = new Set();

  anchors.forEach((match) => {
    if (results.length >= limit) return;
    const targetUrl = extractDuckDuckGoTarget(match[1]);
    const host = safeHostname(targetUrl);
    if (filteredHost(host, projectUrl) || seen.has(host)) return;

    const title = cleanText(match[2].replace(/<[^>]+>/g, ' '), 160);
    if (!title) return;

    seen.add(host);
    results.push({
      domain: host,
      websiteUrl: `https://${host}`,
      title
    });
  });

  return results;
}

async function duckDuckGoSearch(query, projectUrl) {
  const response = await axios.get('https://html.duckduckgo.com/html/', {
    timeout: env.crawlTimeoutMs,
    params: { q: query },
    headers: {
      'User-Agent': 'MoyiAICMO/2.0 (+competitor discovery)',
      Accept: 'text/html'
    }
  });

  return parseSearchResults(response.data || '', projectUrl);
}

function competitorSummaryFallback(candidate, crawl, brandProfile = {}, searchTerms = []) {
  const homepage = crawl.pages[0] || {};
  const combinedTarget = [
    brandProfile.title,
    brandProfile.metaDescription,
    ...(brandProfile.valueProps || []),
    ...searchTerms
  ].join(' ');
  const combinedCandidate = [
    candidate.title,
    homepage.title,
    homepage.metaDescription,
    ...(homepage.h1 || []),
    ...(homepage.headings || [])
  ].join(' ');
  const targetTokens = new Set(textTokens(combinedTarget));
  const candidateTokens = textTokens(combinedCandidate);
  const shared = candidateTokens.filter((token) => targetTokens.has(token));
  const valueProposition = cleanText(
    homepage.metaDescription ||
    homepage.h1[0] ||
    homepage.headings[0] ||
    candidate.title,
    220
  );

  return {
    valueProposition,
    isDirectCompetitor: shared.length >= 2 && !FALSE_POSITIVE_CONTENT_PATTERN.test(combinedCandidate),
    confidence: homepage.statusCode >= 200 && homepage.statusCode < 400 ? Math.min(80, 35 + shared.length * 12) : 35
  };
}

async function enrichCompetitorCandidate(candidate, projectUrl, brandProfile = {}, searchTerms = []) {
  const crawl = await crawlWebsite(candidate.websiteUrl, { maxPages: 2, delayMs: 0 });
  const homepage = crawl.pages[0] || {};
  const snippet = cleanText([
    homepage.title,
    homepage.metaDescription,
    ...(homepage.h1 || []),
    ...(homepage.headings || [])
  ].join(' '), SEARCH_SNIPPET_LIMIT);

  if (!snippet || FALSE_POSITIVE_CONTENT_PATTERN.test(snippet)) {
    return null;
  }

  let extracted = null;
  try {
    extracted = await llmJson([
      'Evaluate whether this site is a direct business competitor to the target company.',
      'A direct competitor sells a substitute solution to the same buyer problem.',
      'Directories, comparison sites, agencies, media companies, newsletters, communities, and broad adjacent creative tools are NOT direct competitors.',
      'Return JSON as {"isDirectCompetitor": true|false, "valueProposition":"...", "confidence": 0-100}.',
      `Target company URL: ${projectUrl}`,
      `Target company summary: ${cleanText([brandProfile.title, brandProfile.metaDescription, ...(brandProfile.valueProps || []), ...searchTerms].join(' '), 600)}`,
      `Candidate URL: ${candidate.websiteUrl}`,
      `Observed candidate homepage text: ${snippet}`
    ].join('\n'));
  } catch (error) {
    extracted = null;
  }

  const targetCategories = new Set(detectCategories([
    brandProfile.title,
    brandProfile.metaDescription,
    ...(brandProfile.valueProps || []),
    ...searchTerms
  ].join(' ')));
  const candidateCategories = new Set(detectCategories([
    candidate.title,
    homepage.title,
    homepage.metaDescription,
    ...(homepage.h1 || []),
    ...(homepage.headings || [])
  ].join(' ')));
  const sharedCategories = [...candidateCategories].filter((category) => targetCategories.has(category));

  const fallback = competitorSummaryFallback(candidate, crawl, brandProfile, searchTerms);
  const isDirectCompetitor = typeof extracted?.isDirectCompetitor === 'boolean'
    ? extracted.isDirectCompetitor
    : fallback.isDirectCompetitor;
  const confidence = Math.min(Math.max(Number(extracted && extracted.confidence) || fallback.confidence, 0), 100);

  if (targetCategories.size >= 2 && sharedCategories.length < 2) {
    return null;
  }

  if (!isDirectCompetitor || confidence < 60) {
    return null;
  }

  return {
    name: hostnameLabel(candidate.websiteUrl) || candidate.domain,
    domain: candidate.domain,
    websiteUrl: candidate.websiteUrl,
    rationale: cleanText((extracted && extracted.valueProposition) || fallback.valueProposition, 260),
    confidence,
    crawl
  };
}

function scoreCandidate(candidate) {
  return Number(candidate.confidence || 0);
}

async function inferCompetitorsFromPages(pages, websiteUrl, brandProfile = {}) {
  const searchTerms = await extractSearchTerms({ websiteUrl, brandProfile, pages });
  const resultPool = [];

  for (const term of searchTerms) {
    try {
      const searchResults = await duckDuckGoSearch(searchQueryForTerm(term), websiteUrl);
      searchResults.forEach((result) => resultPool.push(result));
    } catch (error) {
      // Keep going so one failed search does not break onboarding.
    }
  }

  const deduped = [];
  const seenDomains = new Set();
  resultPool.forEach((candidate) => {
    if (!candidate.domain || seenDomains.has(candidate.domain)) return;
    seenDomains.add(candidate.domain);
    deduped.push(candidate);
  });
  deduped.sort((left, right) => candidatePriority(right, websiteUrl) - candidatePriority(left, websiteUrl));

  const enriched = [];
  for (const candidate of deduped.slice(0, SEARCH_RESULT_LIMIT)) {
    try {
      const item = await enrichCompetitorCandidate(candidate, websiteUrl, brandProfile, searchTerms);
      if (item) enriched.push(item);
    } catch (error) {
      // Skip candidates that fail to crawl or parse.
    }
    if (enriched.length >= MAX_COMPETITORS) break;
  }

  return enriched.sort((left, right) => scoreCandidate(right) - scoreCandidate(left)).slice(0, MAX_COMPETITORS);
}

async function scanProjectForDiscovery(websiteUrl, options = {}) {
  const normalizedWebsiteUrl = normalizeUrl(websiteUrl);
  const result = await crawlWebsite(normalizedWebsiteUrl, {
    maxPages: options.maxPages || 3,
    delayMs: options.delayMs || 0
  });
  const homepage = result.pages[0] || {};
  const baseBrandProfile = options.homepageHtml
    ? extractDraftBrandProfile(options.homepageHtml || '', homepage.url || normalizedWebsiteUrl)
    : {
        brandName: hostnameLabel(normalizedWebsiteUrl),
        websiteUrl: homepage.url || normalizedWebsiteUrl,
        title: homepage.title || '',
        metaDescription: homepage.metaDescription || '',
        toneAdjectives: ['clear', 'helpful'],
        valueProps: distinct([
          homepage.metaDescription,
          ...(homepage.h1 || []),
          ...(homepage.headings || [])
        ].filter(Boolean), 6),
        personas: distinct((homepage.headings || []).filter((heading) => /(for|teams|founders|marketers|owners|agencies|customers)/i.test(heading)), 5),
        callsToAction: [],
        schemaTypes: homepage.schemaTypes || [],
        evidence: {
          h1: homepage.h1 || [],
          headings: (homepage.headings || []).slice(0, 12),
          openGraph: homepage.openGraph || {}
        }
      };
  const brandProfile = await enrichDraftBrandProfile(baseBrandProfile);

  const searchTerms = await extractSearchTerms({ websiteUrl: normalizedWebsiteUrl, brandProfile, pages: result.pages });
  const competitors = await inferCompetitorsFromPages(result.pages, normalizedWebsiteUrl, brandProfile);

  return {
    brandProfile,
    competitors,
    diagnostics: {
      pagesScanned: result.pages.length,
      pagesFound: result.pagesFound,
      searchTerms,
      errors: result.pages.filter((page) => page.errorMessage).map((page) => ({
        url: page.url,
        message: page.errorMessage
      }))
    }
  };
}

module.exports = {
  duckDuckGoSearch,
  extractDuckDuckGoTarget,
  extractSearchTerms,
  filteredHost,
  inferCompetitorsFromPages,
  parseSearchResults,
  scanProjectForDiscovery
};
