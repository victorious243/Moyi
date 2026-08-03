const axios = require('axios');
const cheerio = require('cheerio');
const OpenAI = require('openai');
const env = require('../config/env');
const { isCrawlableUrl, normalizeUrl, sameHost } = require('../utils/url');

const USER_AGENT = 'MoyiAICMO/2.0 (+factual website crawler)';
const MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';

// AI-CMO SPEC COMPLIANCE: Subsystem A - supports onboarding auto-discovery
// from observable homepage content without requiring manual questionnaires.

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function safeNormalizeLink(href, baseUrl) {
  const value = String(href || '').trim();
  if (!value || value.startsWith('#')) return '';
  if (/^(mailto|tel|javascript):/i.test(value)) return '';

  try {
    const absolute = new URL(value, baseUrl);
    absolute.hash = '';
    return normalizeUrl(absolute.toString());
  } catch (error) {
    return '';
  }
}

function extractSchemaTypes($) {
  const types = new Set();

  $('script[type="application/ld+json"]').each((_, element) => {
    const raw = $(element).contents().text().trim();
    if (!raw) return;

    try {
      const json = JSON.parse(raw);
      const items = Array.isArray(json) ? json : [json];
      items.forEach((item) => {
        const graph = Array.isArray(item['@graph']) ? item['@graph'] : [item];
        graph.forEach((entry) => {
          const type = entry && entry['@type'];
          if (Array.isArray(type)) type.forEach((value) => value && types.add(String(value)));
          else if (type) types.add(String(type));
        });
      });
    } catch (error) {
      // Invalid JSON-LD is ignored; the crawler only records observable valid schema types.
    }
  });

  return [...types];
}

function extractAnalyticsTools($, html) {
  const markup = String(html || '');
  const tools = new Set();

  if (/googletagmanager\.com\/gtag\/js|google-analytics\.com|G-[A-Z0-9]+|UA-\d+/i.test(markup)) tools.add('Google Analytics');
  if (/googletagmanager\.com\/gtm\.js|GTM-[A-Z0-9]+/i.test(markup)) tools.add('Google Tag Manager');
  if (/connect\.facebook\.net|fbq\(/i.test(markup)) tools.add('Meta Pixel');
  if (/plausible\.io/i.test(markup)) tools.add('Plausible');
  if (/cdn\.usefathom\.com|fathom/i.test(markup)) tools.add('Fathom');
  if (/static\.hotjar\.com|hotjar/i.test(markup)) tools.add('Hotjar');
  if (/clarity\.ms|clarity\(/i.test(markup)) tools.add('Microsoft Clarity');
  if (/segment\.com|analytics\.js/i.test(markup)) tools.add('Segment');

  $('script[src]').each((_, element) => {
    const src = String($(element).attr('src') || '');
    if (/googletagmanager|google-analytics|gtag/i.test(src)) tools.add('Google Analytics');
    if (/connect\.facebook\.net/i.test(src)) tools.add('Meta Pixel');
  });

  return [...tools];
}

function extractSocialProfiles(links) {
  const joined = links.join(' ');
  return {
    linkedin: /linkedin\.com\/(company|in)\//i.test(joined),
    instagram: /instagram\.com\//i.test(joined),
    facebook: /facebook\.com\//i.test(joined),
    x: /(?:twitter\.com|x\.com)\//i.test(joined),
    youtube: /youtube\.com\/|youtu\.be\//i.test(joined)
  };
}

function extractPage(html, pageUrl, statusCode, errorMessage = '', metadata = {}) {
  const $ = cheerio.load(html || '');
  const title = $('title').first().text().replace(/\s+/g, ' ').trim();
  const metaDescription = ($('meta[name="description"]').attr('content') || '').trim();
  const canonical = safeNormalizeLink($('link[rel="canonical"]').attr('href'), pageUrl);
  const robotsMeta = ($('meta[name="robots"]').attr('content') || '').trim();
  const lang = ($('html').attr('lang') || '').trim();
  const viewport = ($('meta[name="viewport"]').attr('content') || '').trim();
  const h1 = $('h1').map((_, element) => $(element).text().replace(/\s+/g, ' ').trim()).get().filter(Boolean);
  const headings = $('h2').map((_, element) => $(element).text().replace(/\s+/g, ' ').trim()).get().filter(Boolean);
  const text = $('body').text().replace(/\s+/g, ' ').trim();
  const internalLinks = new Set();
  const externalLinks = new Set();
  let nofollowLinksCount = 0;

  $('a[href]').each((_, element) => {
    const link = safeNormalizeLink($(element).attr('href'), pageUrl);
    const rel = String($(element).attr('rel') || '');
    if (/\bnofollow\b/i.test(rel)) nofollowLinksCount += 1;
    if (!link) return;
    if (sameHost(link, pageUrl)) internalLinks.add(link);
    else externalLinks.add(link);
  });

  const images = $('img');
  const schemaTypes = extractSchemaTypes($);
  const externalLinkList = [...externalLinks];

  return {
    url: pageUrl,
    statusCode,
    title,
    metaDescription,
    h1,
    headings,
    canonical,
    robotsMeta,
    lang,
    viewport,
    hreflangCount: $('link[rel="alternate"][hreflang]').length,
    wordCount: text ? text.split(/\s+/).length : 0,
    internalLinks: [...internalLinks],
    externalLinks: externalLinkList,
    imagesCount: images.length,
    imagesMissingAlt: images.filter((_, element) => !($(element).attr('alt') || '').trim()).length,
    schemaTypes,
    analyticsTools: extractAnalyticsTools($, html),
    socialProfiles: extractSocialProfiles(externalLinkList),
    inlineStyleCount: $('[style]').length,
    nofollowLinksCount,
    redirectCount: Number(metadata.redirectCount || 0),
    httpVersion: cleanText(metadata.httpVersion, 20),
    openGraph: {
      title: ($('meta[property="og:title"]').attr('content') || '').trim(),
      description: ($('meta[property="og:description"]').attr('content') || '').trim(),
      image: safeNormalizeLink($('meta[property="og:image"]').attr('content'), pageUrl)
    },
    twitterCard: {
      card: ($('meta[name="twitter:card"]').attr('content') || '').trim(),
      title: ($('meta[name="twitter:title"]').attr('content') || '').trim(),
      description: ($('meta[name="twitter:description"]').attr('content') || '').trim(),
      image: safeNormalizeLink($('meta[name="twitter:image"]').attr('content'), pageUrl)
    },
    errorMessage,
    lastCrawledAt: new Date()
  };
}

async function fetchText(url) {
  try {
    const response = await axios.get(url, {
      timeout: env.crawlTimeoutMs,
      maxRedirects: 5,
      validateStatus: () => true,
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'text/plain,application/xml,text/xml,*/*'
      }
    });
    return {
      ok: response.status >= 200 && response.status < 400,
      statusCode: response.status,
      body: String(response.data || '').slice(0, 200000)
    };
  } catch (error) {
    return {
      ok: false,
      statusCode: 0,
      body: '',
      errorMessage: error.message
    };
  }
}

async function fetchSiteSignals(baseUrl) {
  const parsed = new URL(baseUrl);
  const origin = parsed.origin;
  const [robots, sitemap, llms] = await Promise.all([
    fetchText(`${origin}/robots.txt`),
    fetchText(`${origin}/sitemap.xml`),
    fetchText(`${origin}/llms.txt`)
  ]);

  return {
    robotsTxt: {
      exists: robots.ok,
      statusCode: robots.statusCode,
      blocksMajorSearch: /User-agent:\s*\*\s*[\s\S]*?Disallow:\s*\/(?:\s|$)/i.test(robots.body),
      blocksAiCrawlers: /(GPTBot|ClaudeBot|PerplexityBot|Google-Extended)[\s\S]*?Disallow:\s*\/(?:\s|$)/i.test(robots.body)
    },
    sitemap: {
      exists: sitemap.ok && /<urlset|<sitemapindex/i.test(sitemap.body),
      statusCode: sitemap.statusCode
    },
    llmsTxt: {
      exists: llms.ok && cleanText(llms.body, 200).length > 0,
      statusCode: llms.statusCode
    }
  };
}

function uniqueValues(values, limit = 8) {
  return [...new Set(values.map((value) => String(value || '').replace(/\s+/g, ' ').trim()).filter(Boolean))].slice(0, limit);
}

function cleanText(value, max = 500) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function objectToSentence(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return cleanText(value, 180);
  return Object.entries(value)
    .map(([key, item]) => `${key.replace(/([A-Z])/g, ' $1')}: ${cleanText(item, 80)}`)
    .filter((entry) => !entry.endsWith(':'))
    .join(', ');
}

function parseJson(content) {
  const trimmed = String(content || '').trim();
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  const json = start >= 0 && end >= start ? trimmed.slice(start, end + 1) : trimmed;
  return JSON.parse(json);
}

function hostnameName(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '').split('.')[0].replace(/[-_]+/g, ' ');
  } catch (error) {
    return '';
  }
}

function extractDraftBrandProfile(html, pageUrl) {
  const page = extractPage(html, pageUrl, 200);
  const $ = cheerio.load(html || '');
  const ogSiteName = ($('meta[property="og:site_name"]').attr('content') || '').trim();
  const brandName = ogSiteName || (page.title || '').split(/[|–-]/)[0].trim() || hostnameName(pageUrl);
  const ctaTexts = uniqueValues($('a,button').map((_, element) => $(element).text()).get(), 10)
    .filter((text) => /(start|get|book|demo|contact|try|buy|learn|talk|quote|sign)/i.test(text));
  const headings = uniqueValues([...(page.h1 || []), ...(page.headings || [])], 12);
  const bodyText = $('body').text().replace(/\s+/g, ' ').trim();
  const valueProps = uniqueValues([
    page.metaDescription,
    ...headings.filter((heading) => heading.length > 12 && heading.length < 140)
  ], 6);
  const toneAdjectives = [];

  if (/(simple|easy|effortless|fast|quick)/i.test(bodyText)) toneAdjectives.push('simple');
  if (/(trusted|secure|reliable|compliance|privacy)/i.test(bodyText)) toneAdjectives.push('trusted');
  if (/(premium|luxury|bespoke|expert)/i.test(bodyText)) toneAdjectives.push('premium');
  if (/(growth|scale|revenue|performance)/i.test(bodyText)) toneAdjectives.push('growth-focused');
  if (/(friendly|human|support|team)/i.test(bodyText)) toneAdjectives.push('human');

  return {
    brandName,
    websiteUrl: pageUrl,
    title: page.title,
    metaDescription: page.metaDescription,
    toneAdjectives: uniqueValues(toneAdjectives.length ? toneAdjectives : ['clear', 'helpful'], 6),
    valueProps,
    personas: uniqueValues(headings.filter((heading) => /(for|teams|founders|marketers|owners|agencies|customers)/i.test(heading)), 5),
    callsToAction: ctaTexts,
    schemaTypes: page.schemaTypes,
    evidence: {
      h1: page.h1,
      headings: page.headings.slice(0, 12),
      openGraph: page.openGraph
    }
  };
}

function personaName(seed, fallbackLabel) {
  const words = cleanText(seed, 120).split(/[^a-zA-Z0-9]+/).filter(Boolean);
  if (words.length >= 2) return `${words[0]} ${words[1]}`.replace(/\b\w/g, (char) => char.toUpperCase());
  return fallbackLabel;
}

function fallbackTargetPersonas(profile) {
  const evidence = [
    ...(profile.personas || []),
    ...(profile.valueProps || []),
    ...((profile.evidence && profile.evidence.headings) || []),
    ...((profile.evidence && profile.evidence.h1) || [])
  ].filter(Boolean);

  const seeds = uniqueValues(evidence, 6);
  const base = [
    {
      name: personaName(seeds[0] || profile.brandName, 'Growth-Focused Founder'),
      role: 'Founder / decision-maker',
      demographics: 'Small team operator, early-stage or owner-led business, evaluates tools personally.',
      summary: 'Needs a clear path from idea to launch without adding operational drag.',
      objections: ['Setup is too slow', 'Pricing may outpace early traction', 'The workflow could feel too manual'],
      copyHooks: ['Launch faster with fewer moving parts', 'Turn strategy into one visible workflow', 'Get value before hiring a bigger team']
    },
    {
      name: personaName(seeds[1] || seeds[0] || profile.brandName, 'Hands-On Marketing Lead'),
      role: 'Marketing or growth lead',
      demographics: 'Execution-oriented operator responsible for content, campaigns, and reporting.',
      summary: 'Wants better positioning, clearer customer signals, and tools that reduce repetitive setup work.',
      objections: ['Integration work could take too long', 'The team may not trust the recommendations', 'It might create another dashboard without action'],
      copyHooks: ['Walk into every week with clearer priorities', 'Replace setup chores with approved next actions', 'Keep brand voice and execution aligned']
    },
    {
      name: personaName(seeds[2] || seeds[1] || profile.brandName, 'Budget-Conscious Team Builder'),
      role: 'Operations or content owner',
      demographics: 'Cost-aware buyer balancing output quality against time, headcount, and tooling spend.',
      summary: 'Needs a dependable system that improves output without requiring agency-level overhead.',
      objections: ['The ROI is still unclear', 'Team adoption may be uneven', 'Existing tools may already cover part of the job'],
      copyHooks: ['Improve output before expanding headcount', 'Give the team a shared positioning backbone', 'Reduce rework across planning, content, and reporting']
    }
  ];

  return base.slice(0, 3);
}

async function enrichDraftBrandProfile(profile) {
  const seedProfile = {
    ...profile,
    toneAdjectives: uniqueValues(profile.toneAdjectives || ['clear', 'helpful'], 6),
    valueProps: uniqueValues(profile.valueProps || [], 6),
    personas: uniqueValues(profile.personas || [], 5)
  };
  const evidence = cleanText([
    seedProfile.title,
    seedProfile.metaDescription,
    ...(seedProfile.valueProps || []),
    ...((seedProfile.evidence && seedProfile.evidence.h1) || []),
    ...((seedProfile.evidence && seedProfile.evidence.headings) || [])
  ].join(' '), 2400);

  const fallback = {
    ...seedProfile,
    positioningStatement: cleanText(seedProfile.metaDescription || `${seedProfile.brandName} helps teams move from planning to execution with less friction.`, 220),
    objectionThemes: ['Setup time', 'Pricing confidence', 'Integration effort'],
    targetPersonas: fallbackTargetPersonas(seedProfile)
  };

  if (!env.openaiApiKey) {
    return fallback;
  }

  try {
    const client = new OpenAI({ apiKey: env.openaiApiKey });
    const response = await client.chat.completions.create({
      model: MODEL,
      temperature: 0.2,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: 'You create concise brand positioning profiles from supplied website evidence only. Return JSON only.'
        },
        {
          role: 'user',
          content: [
            'Create a complete onboarding positioning profile.',
            'Return JSON with keys: toneAdjectives, valueProps, positioningStatement, objectionThemes, targetPersonas.',
            'targetPersonas must contain exactly 3 personas.',
            'Each persona must include: name, role, demographics, summary, objections (3), copyHooks (3).',
            `Brand name: ${seedProfile.brandName}`,
            `Observed evidence: ${evidence}`
          ].join('\n')
        }
      ]
    });

    const parsed = parseJson(response.choices[0].message.content);
    const targetPersonas = Array.isArray(parsed.targetPersonas) ? parsed.targetPersonas.slice(0, 3).map((persona, index) => ({
      name: cleanText(persona.name, 80) || fallback.targetPersonas[index].name,
      role: cleanText(persona.role, 80) || fallback.targetPersonas[index].role,
      demographics: objectToSentence(persona.demographics) || fallback.targetPersonas[index].demographics,
      summary: cleanText(persona.summary, 220) || fallback.targetPersonas[index].summary,
      objections: uniqueValues((persona.objections || []).map((item) => cleanText(item, 120)), 3),
      copyHooks: uniqueValues((persona.copyHooks || persona.hooks || []).map((item) => cleanText(item, 120)), 3)
    })) : fallback.targetPersonas;

    return {
      ...seedProfile,
      toneAdjectives: uniqueValues((parsed.toneAdjectives || []).map((item) => cleanText(item, 40)).filter(Boolean), 6) || fallback.toneAdjectives,
      valueProps: uniqueValues((parsed.valueProps || []).map((item) => cleanText(item, 180)).filter(Boolean), 6) || fallback.valueProps,
      positioningStatement: cleanText(parsed.positioningStatement, 220) || fallback.positioningStatement,
      objectionThemes: uniqueValues((parsed.objectionThemes || []).map((item) => cleanText(item, 80)).filter(Boolean), 5),
      targetPersonas: targetPersonas.map((persona, index) => ({
        ...fallback.targetPersonas[index],
        ...persona,
        objections: persona.objections.length ? persona.objections : fallback.targetPersonas[index].objections,
        copyHooks: persona.copyHooks.length ? persona.copyHooks : fallback.targetPersonas[index].copyHooks
      }))
    };
  } catch (error) {
    return fallback;
  }
}

async function fetchPage(url) {
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
    const redirectCount = response.request && response.request._redirectable
      ? response.request._redirectable._redirectCount
      : 0;
    const httpVersion = response.request && response.request.res ? response.request.res.httpVersion : '';
    return extractPage(response.data || '', finalUrl, response.status, '', { redirectCount, httpVersion });
  } catch (error) {
    return extractPage('', url, 0, error.message);
  }
}

async function crawlWebsite(startUrl, options = {}) {
  const baseUrl = normalizeUrl(startUrl);
  const requestedMaxPages = Number(options.maxPages || env.maxPagesPerScan || 50);
  const maxPages = Math.min(Math.max(requestedMaxPages, 1), 500);
  const delayMs = Number(options.delayMs || env.crawlDelayMs || 150);
  const visited = new Set();
  const queued = new Set([baseUrl]);
  const queue = [baseUrl];
  const pages = [];
  const siteSignals = await fetchSiteSignals(baseUrl);

  while (queue.length && pages.length < maxPages) {
    if (typeof options.shouldStop === 'function' && await options.shouldStop()) break;

    const nextUrl = queue.shift();
    queued.delete(nextUrl);

    if (visited.has(nextUrl) || !sameHost(nextUrl, baseUrl) || !isCrawlableUrl(nextUrl)) continue;
    visited.add(nextUrl);

    const page = await fetchPage(nextUrl);
    if (typeof options.shouldStop === 'function' && await options.shouldStop()) break;

    if (!sameHost(page.url, baseUrl)) {
      continue;
    }
    pages.push(page);

    page.internalLinks.forEach((link) => {
      if (pages.length + queue.length >= maxPages) return;
      if (!sameHost(link, baseUrl) || visited.has(link) || queued.has(link) || !isCrawlableUrl(link)) return;
      queued.add(link);
      queue.push(link);
    });

    if (typeof options.onPage === 'function') {
      await options.onPage({
        page,
        pages,
        pagesFound: visited.size + queue.length
      });
    }

    if (queue.length && pages.length < maxPages && delayMs > 0) {
      await sleep(delayMs);
      if (typeof options.shouldStop === 'function' && await options.shouldStop()) break;
    }
  }

  return {
    pages,
    pagesFound: visited.size + queue.length,
    siteSignals
  };
}

module.exports = {
  enrichDraftBrandProfile,
  crawlWebsite,
  extractDraftBrandProfile,
  extractPage,
  fetchSiteSignals
};
