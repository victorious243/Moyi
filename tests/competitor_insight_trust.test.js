const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { sanitizeInsights, systemInsights } = require('../services/competitorInsightService');
const { configuredCompetitorCandidates } = require('../services/competitorDiscoveryService');

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
