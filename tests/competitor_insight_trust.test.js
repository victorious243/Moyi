const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { sanitizeInsights, systemInsights } = require('../services/competitorInsightService');
const { configuredCompetitorCandidates } = require('../services/competitorDiscoveryService');
const { parseRobots, sitemapLocations } = require('../services/competitorCrawlerService');

test('configured competitors from calibration become crawlable website candidates', () => {
  const candidates = configuredCompetitorCandidates({
    competitors: [
      { name: 'Rival One', websiteUrl: 'https://rival.example/' },
      { name: 'Rival One duplicate', websiteUrl: 'https://rival.example' },
      { name: 'Rival Two', websiteUrl: 'rival-two.example' },
      { name: 'Not a URL', websiteUrl: 'not a url' }
    ]
  });

  assert.deepEqual(candidates.map((candidate) => candidate.websiteUrl), [
    'https://rival.example',
    'https://rival-two.example'
  ]);
});

test('competitor insight sanitization stamps provenance and bounded confidence', () => {
  const competitorId = new mongoose.Types.ObjectId();
  const insights = sanitizeInsights({
    insights: [
      {
        competitorId: competitorId.toString(),
        title: 'More product pages',
        category: 'content_gap',
        insight: 'Competitor has more product pages in the crawl.',
        opportunity: 'Create clearer product pages.',
        confidence: 91,
        evidenceSummary: 'Crawl compared page counts.'
      }
    ]
  }, [{ _id: competitorId }]);

  assert.equal(insights.length, 1);
  assert.equal(insights[0].generatedBy, 'ai');
  assert.equal(insights[0].confidenceScore, 91);
  assert.equal(insights[0].evidenceSummary, 'Crawl compared page counts.');
});

test('system competitor insights include evidence summaries and system provenance', () => {
  const competitorId = new mongoose.Types.ObjectId();
  const insights = systemInsights({
    competitors: [{ _id: competitorId, name: 'Rival', websiteUrl: 'https://rival.example' }],
    competitorPages: [
      {
        competitorId,
        url: 'https://rival.example/service-a',
        title: 'Service A',
        metaDescription: 'Helpful metadata for a service page',
        h1: ['Service A'],
        headings: ['Service'],
        wordCount: 700,
        schemaTypes: ['FAQPage']
      },
      {
        competitorId,
        url: 'https://rival.example/blog/guide',
        title: 'Guide',
        metaDescription: 'Helpful guide metadata with enough length',
        h1: ['Guide'],
        headings: ['Article'],
        wordCount: 800,
        schemaTypes: []
      }
    ],
    projectPages: [
      {
        url: 'https://moyi.example',
        title: '',
        metaDescription: '',
        h1: [],
        headings: [],
        wordCount: 120,
        schemaTypes: []
      }
    ]
  });

  assert.ok(insights.length >= 1);
  insights.forEach((insight) => {
    assert.equal(insight.generatedBy, 'system');
    assert.ok(typeof insight.evidenceSummary === 'string' && insight.evidenceSummary.length > 0);
    assert.ok(insight.confidenceScore >= 0 && insight.confidenceScore <= 100);
  });
});

test('competitor robots parsing retains sitemap declarations', () => {
  const parsed = parseRobots(`
    User-agent: *
    Disallow: /private
    Sitemap: https://rival.example/sitemap.xml
  `);

  assert.deepEqual(parsed.sitemaps, ['https://rival.example/sitemap.xml']);
  assert.deepEqual(parsed.groups[0].disallow, ['/private']);
});

test('competitor sitemap parsing extracts page and nested sitemap URLs', () => {
  assert.deepEqual(sitemapLocations(`
    <urlset>
      <url><loc>https://rival.example/solutions</loc></url>
      <url><loc>https://rival.example/pricing?one=1&amp;two=2</loc></url>
    </urlset>
  `), [
    'https://rival.example/solutions',
    'https://rival.example/pricing?one=1&two=2'
  ]);
});

test('competitor comparisons ignore duplicate project URLs from older scans', () => {
  const competitorId = new mongoose.Types.ObjectId();
  const insights = systemInsights({
    competitors: [{ _id: competitorId, name: 'Rival' }],
    competitorPages: [
      { competitorId, url: 'https://rival.example/product', statusCode: 200, title: 'Product', h1: ['Product'], wordCount: 700 },
      { competitorId, url: 'https://rival.example/pricing', statusCode: 200, title: 'Pricing', h1: ['Pricing'], wordCount: 600 },
      { competitorId, url: 'https://rival.example/blog/guide', statusCode: 200, title: 'Guide', h1: ['Guide'], wordCount: 900 }
    ],
    projectPages: [
      { url: 'https://moyi.example', statusCode: 200, title: 'Moyi', h1: ['Moyi'], wordCount: 150 },
      { url: 'https://moyi.example', statusCode: 200, title: 'Moyi old scan', h1: ['Moyi'], wordCount: 150 }
    ]
  });

  assert.ok(insights.some((insight) => insight.title === 'Competitor exposes broader crawlable topic coverage'));
  assert.ok(insights.some((insight) => insight.title === 'Competitor pages provide more on-page depth'));
});
