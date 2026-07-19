const assert = require('node:assert/strict');
const test = require('node:test');
const mongoose = require('mongoose');
const axios = require('axios');
const { enrichDraftBrandProfile, extractDraftBrandProfile } = require('../services/crawlerService');
const { googleLoginRedirectUri } = require('../services/googleAuthService');
const {
  extractDuckDuckGoTarget,
  filteredHost,
  parseSearchResults
} = require('../services/discoveryService');
const { crawlWebsite } = require('../services/crawlerService');
const { scoreChecks } = require('../services/telemetryAuditor');
const { attributePayment } = require('../services/attributionService');
const Campaign = require('../models/Campaign');
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
