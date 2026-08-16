const assert = require('node:assert/strict');
const test = require('node:test');
const mongoose = require('mongoose');
const axios = require('axios');
const { enrichDraftBrandProfile, extractDraftBrandProfile } = require('../services/crawlerService');
const {
  googleLoginRedirectUri,
  googleLoginRedirectUriFromEnv,
  googleOAuthErrorMessage
} = require('../services/googleAuthService');
const {
  buildDiscoveryQueries,
  classifyCompetitor,
  competitorSummaryFallback,
  detectSemanticConcepts,
  extractDuckDuckGoTarget,
  fallbackSearchTerms,
  filteredHost,
  inferBusinessModel,
  parseSearchResults,
  sanitizeSearchCandidates,
  selectCompetitorMix
} = require('../services/discoveryService');
const { crawlWebsite } = require('../services/crawlerService');
const { scoreChecks } = require('../services/telemetryAuditor');
const { attributePayment } = require('../services/attributionService');
const { normalizeCookieDomain } = require('../config/env');
const Campaign = require('../models/Campaign');
const Competitor = require('../models/Competitor');
const Project = require('../models/Project');
const TrackingEvent = require('../models/TrackingEvent');
const { sameHost } = require('../utils/url');

test('AI-CMO SPEC COMPLIANCE Subsystem A: extracts draft brand profile from homepage HTML', () => {
  const html = `
    <html>
      <head>
        <title>Moyi AI CMO - Growth for SaaS Teams</title>
        <meta name="description" content="Moyi helps founders turn SEO data into revenue-focused marketing execution.">
        <meta property="og:site_name" content="Moyi">
      </head>
      <body>
        <h1>AI CMO for founders and marketing teams</h1>
        <h2>Simple weekly growth plans for SaaS teams</h2>
        <a href="/demo">Book a demo</a>
      </body>
    </html>
  `;

  const profile = extractDraftBrandProfile(html, 'https://moyi.example');
  assert.equal(profile.brandName, 'Moyi');
  assert.ok(profile.valueProps.some((value) => value.includes('revenue-focused')));
  assert.ok(profile.personas.some((persona) => persona.includes('founders')));
  assert.ok(profile.callsToAction.includes('Book a demo'));
});

test('AI-CMO SPEC COMPLIANCE Requirement 2: generated brand profile includes 3 personas with objections and hooks', async () => {
  const profile = await enrichDraftBrandProfile({
    brandName: 'VicPods',
    title: 'VicPods AI podcast planning workspace',
    metaDescription: 'Plan, script, and launch podcast episodes with one AI-backed workflow.',
    toneAdjectives: ['clear', 'helpful'],
    valueProps: ['Plan and launch episodes faster', 'Keep the workflow in one place'],
    personas: ['Podcast founders', 'Marketing teams'],
    evidence: {
      h1: ['AI workspace for podcast launch prep'],
      headings: ['For podcast teams that want less setup work']
    }
  });

  assert.equal(profile.targetPersonas.length, 3);
  profile.targetPersonas.forEach((persona) => {
    assert.ok(persona.name);
    assert.equal(persona.objections.length, 3);
    assert.equal(persona.copyHooks.length, 3);
  });
});

test('AI-CMO SPEC COMPLIANCE Subsystem B: computes weighted telemetry score', () => {
  const score = scoreChecks([
    { passed: true, weight: 20 },
    { passed: true, weight: 30 },
    { passed: false, weight: 50 }
  ]);

  assert.equal(score, 50);
});

test('AI-CMO SPEC COMPLIANCE Subsystem C: calculates first, last, linear, W-shaped credits and high ACS', () => {
  const touches = [
    { utmSource: 'google', utmMedium: 'cpc', utmCampaign: 'launch', stripeCustomerId: 'cus_123', createdAt: new Date('2026-01-01') },
    { utmSource: 'linkedin', utmMedium: 'organic', utmCampaign: 'founder', createdAt: new Date('2026-01-02') },
    { utmSource: 'direct', utmMedium: '', utmCampaign: '', createdAt: new Date('2026-01-03') }
  ];
  const result = attributePayment({ id: 'pi_1', amount: 300, stripeCustomerId: 'cus_123' }, touches);

  assert.equal(result.credits.firstTouch['google / cpc / launch'], 300);
  assert.equal(result.credits.lastTouch['direct / none / uncategorized'], 300);
  assert.equal(result.credits.linear['linkedin / organic / founder'], 100);
  assert.equal(result.credits.wShaped['google / cpc / launch'], 90);
  assert.equal(result.confidence.band, 'High');
});

test('AI-CMO SPEC COMPLIANCE Subsystem D: enforces campaign spend constraints', () => {
  const campaign = new Campaign({
    projectId: new mongoose.Types.ObjectId(),
    name: 'Launch',
    startDate: new Date('2026-01-01'),
    endDate: new Date('2026-01-31'),
    dailySpendLimit: 200,
    monthlySpendLimit: 100
  });

  const error = campaign.validateSync();
  assert.ok(error.errors.dailySpendLimit);
});

test('AI-CMO SPEC COMPLIANCE model fields: project and tracking resolution fields are available', () => {
  const project = new Project({
    owner: new mongoose.Types.ObjectId(),
    name: 'Moyi',
    websiteUrl: 'https://moyi.example',
    status: 'draft',
    targetCountry: 'Ireland',
    targetCity: 'Dublin',
    businessModel: 'agency',
    brand_profile: { toneAdjectives: ['clear'] },
    competitors: [{ name: 'Competitor', websiteUrl: 'https://competitor.example' }]
  });
  const event = new TrackingEvent({
    projectId: new mongoose.Types.ObjectId(),
    publicProjectKey: 'public',
    eventType: 'page_view',
    sessionId: 'session',
    visitorId: 'visitor',
    resolvedEmail: 'buyer@example.com',
    stripeCustomerId: 'cus_123',
    url: 'https://moyi.example'
  });

  assert.equal(project.validateSync(), undefined);
  assert.equal(event.validateSync(), undefined);
});

test('competitor records support market classification and location relevance', () => {
  const competitor = new Competitor({
    projectId: new mongoose.Types.ObjectId(),
    userId: new mongoose.Types.ObjectId(),
    name: 'Rival Agency',
    websiteUrl: 'https://rival.example',
    classification: 'direct',
    businessModel: 'agency',
    locationRelevance: 'local',
    classificationReason: 'Same buyer and market'
  });

  assert.equal(competitor.validateSync(), undefined);
});

test('AI-CMO SPEC COMPLIANCE Requirement 2: competitor search parsing filters social/news junk', () => {
  const html = `
    <a href="https://html.duckduckgo.com/l/?uddg=https%3A%2F%2Fcompetitor-one.com">Competitor One</a>
    <a href="https://html.duckduckgo.com/l/?uddg=https%3A%2F%2Fwww.facebook.com%2Fbrand">Facebook</a>
    <a href="https://html.duckduckgo.com/l/?uddg=https%3A%2F%2Ftechcrunch.com%2Fstory">TechCrunch</a>
    <a href="https://html.duckduckgo.com/l/?uddg=https%3A%2F%2Fcompetitor-two.com">Competitor Two</a>
  `;

  const results = parseSearchResults(html, 'https://vicpods.com');
  assert.equal(results.length, 2);
  assert.equal(results[0].domain, 'competitor-one.com');
  assert.equal(results[1].domain, 'competitor-two.com');
});

test('competitor discovery creates product-category searches instead of audience-only searches', () => {
  const terms = fallbackSearchTerms({
    title: 'Moyi-CMO AI Chief Marketing Officer for SEO growth teams',
    metaDescription: 'AI CMO software for startups and marketing teams.',
    valueProps: ['Content planning and social media publishing'],
    personas: ['Startup founders', 'Marketing directors']
  }, [], 'https://moyi-cmo.com');

  assert.ok(terms.includes('AI Chief Marketing Officer'));
  assert.ok(terms.includes('AI CMO software'));
  assert.equal(terms.some((term) => /^startup founders$/i.test(term)), false);
});

test('competitor discovery adds city and country to local market searches', () => {
  const queries = buildDiscoveryQueries(['employment solicitor', 'business law firm'], {
    targetCity: 'Dublin',
    targetCountry: 'Ireland'
  });

  assert.equal(queries[0], 'employment solicitor Dublin, Ireland');
  assert.ok(queries.includes('business law firm'));
});

test('business model inference distinguishes agencies and marketplaces', () => {
  assert.equal(inferBusinessModel({ mainOffer: 'A growth marketing agency for B2B companies' }), 'agency');
  assert.equal(inferBusinessModel({ mainOffer: 'A marketplace connecting homeowners with local plumbers' }), 'marketplace');
});

test('semantic concepts recognize equivalent legal service language', () => {
  assert.ok(detectSemanticConcepts('Employment solicitors for Irish companies').includes('legal'));
  assert.ok(detectSemanticConcepts('Attorneys helping employers with workplace law').includes('legal'));
});

test('marketplace projects can treat major directories as competitors', () => {
  assert.equal(filteredHost('g2.com', 'https://new-reviews.example', { businessModel: 'marketplace' }), false);
  assert.equal(filteredHost('g2.com', 'https://agency.example', { businessModel: 'agency' }), true);
});

test('competitor classification respects business model compatibility', () => {
  const fallback = {
    isDirectCompetitor: true,
    isRelatedCompetitor: true,
    sharedConcepts: ['marketing'],
    sharedTerms: ['marketing']
  };
  const homepage = {
    title: 'Growth partner',
    metaDescription: 'Demand generation and content marketing',
    h1: ['Marketing growth partner'],
    headings: []
  };
  const target = {
    businessModel: 'agency',
    mainOffer: 'Growth marketing agency',
    targetCity: 'Dublin',
    targetCountry: 'Ireland'
  };

  const direct = classifyCompetitor({
    candidate: { businessModel: 'agency', locationRelevance: 'local' },
    homepage,
    brandProfile: target,
    fallback
  });
  const indirect = classifyCompetitor({
    candidate: { businessModel: 'saas', locationRelevance: 'local' },
    homepage,
    brandProfile: target,
    fallback
  });

  assert.equal(direct.classification, 'direct');
  assert.equal(indirect.classification, 'indirect');

  const synonymDirect = classifyCompetitor({
    candidate: { businessModel: 'professional_services', locationRelevance: 'local' },
    homepage: { title: 'Employment attorneys', metaDescription: 'Workplace law', h1: [], headings: [] },
    brandProfile: { businessModel: 'professional_services', mainOffer: 'Employment solicitors' },
    fallback: {
      isDirectCompetitor: false,
      isRelatedCompetitor: true,
      sharedConcepts: ['legal'],
      sharedTerms: ['legal']
    }
  });
  assert.equal(synonymDirect.classification, 'direct');
});

test('competitor selection retains direct, indirect, and aspirational candidates', () => {
  const candidates = [
    { name: 'Direct A', classification: 'direct', confidence: 90 },
    { name: 'Direct B', classification: 'direct', confidence: 88 },
    { name: 'Direct C', classification: 'direct', confidence: 86 },
    { name: 'Direct D', classification: 'direct', confidence: 84 },
    { name: 'Indirect', classification: 'indirect', confidence: 70 },
    { name: 'Aspirational', classification: 'aspirational', confidence: 75 }
  ];
  const selected = selectCompetitorMix(candidates, 5);

  assert.equal(selected.filter((candidate) => candidate.classification === 'direct').length, 3);
  assert.ok(selected.some((candidate) => candidate.classification === 'indirect'));
  assert.ok(selected.some((candidate) => candidate.classification === 'aspirational'));
});

test('competitor search challenge pages are not mistaken for competitors', () => {
  const html = '<html><title>DuckDuckGo</title><a href="/html/?q=test">DuckDuckGo</a></html>';
  assert.deepEqual(parseSearchResults(html, 'https://moyi-cmo.com'), []);
});

test('web-search candidates are normalized and exclude the project and directory hosts', () => {
  const candidates = sanitizeSearchCandidates({
    results: [
      { name: 'Moyi', websiteUrl: 'https://moyi-cmo.com' },
      { name: 'G2', websiteUrl: 'https://www.g2.com/categories/marketing' },
      { name: 'Direct Rival', websiteUrl: 'https://rival.example/product', rationale: 'AI marketing operations software', confidence: 82 }
    ]
  }, 'https://moyi-cmo.com');

  assert.deepEqual(candidates.map((candidate) => candidate.websiteUrl), ['https://rival.example']);
  assert.equal(candidates[0].searchConfidence, 82);
});

test('deterministic competitor evidence accepts a directly overlapping SaaS product', () => {
  const result = competitorSummaryFallback({
    title: 'Okara AI CMO',
    snippet: 'AI marketing, SEO and content automation for growth teams'
  }, {
    pages: [{
      statusCode: 200,
      title: 'Okara - AI Chief Marketing Officer',
      metaDescription: 'Automate SEO, content marketing and campaign planning with an AI CMO.',
      h1: ['AI CMO for marketing teams'],
      headings: ['Product', 'Blog', 'For agencies']
    }]
  }, {
    title: 'Moyi AI Chief Marketing Officer',
    metaDescription: 'AI CMO software for SEO, content marketing and social publishing',
    valueProps: ['Marketing automation and campaign planning']
  }, ['AI CMO software', 'content marketing automation']);

  assert.equal(result.isDirectCompetitor, true);
  assert.ok(result.confidence >= 56);
  assert.ok(result.sharedTerms.includes('cmo'));
});

test('AI-CMO SPEC COMPLIANCE Requirement 2: redirect URLs and false-positive domains are recognized', () => {
  assert.equal(
    extractDuckDuckGoTarget('https://html.duckduckgo.com/l/?uddg=https%3A%2F%2Fcompetitor.com'),
    'https://competitor.com'
  );
  assert.equal(filteredHost('youtube.com', 'https://vicpods.com'), true);
  assert.equal(filteredHost('vicpods.com', 'https://vicpods.com'), true);
  assert.equal(filteredHost('competitor.com', 'https://vicpods.com'), false);
});

test('Google auth uses the app auth callback path for sign-in', () => {
  assert.ok(googleLoginRedirectUri().includes('/auth/google/callback'));
});

test('Google auth prefers explicit auth redirect URI over app URL fallback', () => {
  assert.equal(
    googleLoginRedirectUriFromEnv({
      appUrl: 'http://localhost:3000',
      googleRedirectUri: 'https://moyi-cmo.com/auth/google/callback'
    }),
    'https://moyi-cmo.com/auth/google/callback'
  );
});

test('Google auth explains invalid OAuth client credentials clearly', () => {
  const message = googleOAuthErrorMessage({
    response: {
      status: 401,
      data: { error: 'invalid_client' }
    }
  }, 'fallback');

  assert.match(message, /GOOGLE_CLIENT_ID/);
  assert.match(message, /GOOGLE_CLIENT_SECRET/);
});

test('production cookie domain is normalized from accidental URL values', () => {
  assert.equal(normalizeCookieDomain('https://moyi-cmo.com'), 'moyi-cmo.com');
  assert.equal(normalizeCookieDomain('moyi-cmo.com'), 'moyi-cmo.com');
});

test('Phase 2 crawler treats www and root host as the same site', () => {
  assert.equal(sameHost('https://www.example.com/page', 'https://example.com'), true);
  assert.equal(sameHost('https://example.com/page', 'https://www.example.com'), true);
  assert.equal(sameHost('https://docs.example.com', 'https://example.com'), false);
});

test('Phase 2 crawler respects higher page limits above 50', async () => {
  const originalGet = axios.get;
  const totalPages = 75;

  axios.get = async (url) => {
    const parsed = new URL(url);
    const index = parsed.pathname === '/' ? 1 : Number(parsed.pathname.replace('/page-', ''));
    const next = index < totalPages ? `<a href="/page-${index + 1}">Next</a>` : '';
    return {
      status: 200,
      data: `<html><head><title>Page ${index}</title></head><body><h1>Page ${index}</h1>${next}</body></html>`,
      request: {
        res: {
          responseUrl: index === 1 ? 'https://www.example.com' : `https://www.example.com/page-${index}`
        }
      }
    };
  };

  try {
    const result = await crawlWebsite('https://example.com', { maxPages: 60, delayMs: 0 });
    assert.equal(result.pages.length, 60);
    assert.equal(result.pages[0].url, 'https://www.example.com');
  } finally {
    axios.get = originalGet;
  }
});

test('AI-CMO SPEC COMPLIANCE Crawler: normalizeUrl strips query parameters and hashes', () => {
  const { normalizeUrl } = require('../utils/url');
  assert.equal(normalizeUrl('https://vicpods.com/?idea=A%20better%20question'), 'https://vicpods.com');
  assert.equal(normalizeUrl('https://vicpods.com/about#section-1'), 'https://vicpods.com/about');
});
