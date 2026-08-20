const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const ejs = require('ejs');

const {
  MARKET_STRUGGLES_CATALOG,
  discoverDailyMarketStruggles
} = require('../services/intelloKnowledgeBaseService');
const IntelloArticle = require('../models/IntelloArticle');

test('Intello Knowledge Base System Verification', async (t) => {
  await t.test('MARKET_STRUGGLES_CATALOG contains structured, high-intent problem playbooks', () => {
    assert.ok(MARKET_STRUGGLES_CATALOG.length >= 6);

    for (const struggle of MARKET_STRUGGLES_CATALOG) {
      assert.ok(struggle.slug, 'Must have a slug');
      assert.ok(struggle.title, 'Must have a title');
      assert.ok(struggle.primaryKeyword, 'Must have primary keyword');
      assert.ok(struggle.struggleSummary, 'Must have struggle summary');
      assert.ok(Array.isArray(struggle.struggleSymptoms) && struggle.struggleSymptoms.length > 0, 'Must have symptoms');
      assert.ok(struggle.rootCauseAnalysis, 'Must have root cause analysis');
      assert.ok(struggle.manualSolution, 'Must have step-by-step manual solution');
      assert.ok(struggle.howMoyiSolves, 'Must explain how Moyi automates solution');
      assert.ok(Array.isArray(struggle.faqs) && struggle.faqs.length > 0, 'Must have FAQs');
    }
  });

  await t.test('views/public/intello/hub.ejs renders public Knowledge Base directory', async () => {
    const html = await ejs.renderFile(
      path.join(__dirname, '../views/public/intello/hub.ejs'),
      {
        appName: 'Moyi-CMO',
        title: 'Intello Knowledge Base',
        currentUser: null,
        searchQuery: '',
        activeCategory: 'all',
        categories: {
          all: 6,
          search_console: 1,
          seo_rankings: 1,
          social_distribution: 1,
          conversion_cro: 1,
          competitor_intel: 1,
          marketing_strategy: 1
        },
        articles: MARKET_STRUGGLES_CATALOG.map((s) => ({
          ...s,
          readingTimeMinutes: 5,
          publishedAt: new Date()
        })),
        totalPages: 1,
        currentPage: 1
      }
    );

    assert.match(html, /Intello Knowledge Base/);
    assert.match(html, /Real Marketing Struggles/);
    assert.match(html, /Search marketing struggles/);
    assert.match(html, /How to Mine Striking-Distance Keywords/);
    assert.match(html, /The Closed-Loop Social Attribution Playbook/);
    assert.match(html, /Read Solution &rarr;/);
  });

  await t.test('views/public/intello/show.ejs renders deep-dive solution playbook with schema', async () => {
    const struggle = MARKET_STRUGGLES_CATALOG[0];
    const html = await ejs.renderFile(
      path.join(__dirname, '../views/public/intello/show.ejs'),
      {
        appName: 'Moyi-CMO',
        title: `${struggle.title} | Moyi Intello KB`,
        currentUser: null,
        article: {
          ...struggle,
          readingTimeMinutes: 5,
          publishedAt: new Date(),
          updatedAt: new Date()
        },
        relatedArticles: [
          MARKET_STRUGGLES_CATALOG[1]
        ]
      }
    );

    assert.match(html, /The Searcher's Problem/);
    assert.match(html, /Key Warning Signs You Might Observe/);
    assert.match(html, /Root Cause Analysis: Why This Happens/);
    assert.match(html, /The Step-by-Step Actionable Solution/);
    assert.match(html, /How Moyi Solves This Autonomously/);
    assert.match(html, /"Moyi proposes\. Humans decide\."/);
    assert.match(html, /Frequently Asked Questions/);
    assert.match(html, /@type": "Article/);
    assert.match(html, /@type": "FAQPage/);
  });

  await t.test('discoverDailyMarketStruggles skips already-covered topics and finds new candidates', async () => {
    const originalFind = IntelloArticle.find;
    try {
      // Simulate that the first 2 struggles are already covered in DB
      IntelloArticle.find = () => ({
        select: () => ({
          lean: () => Promise.resolve([
            { slug: MARKET_STRUGGLES_CATALOG[0].slug, primaryKeyword: MARKET_STRUGGLES_CATALOG[0].primaryKeyword },
            { slug: MARKET_STRUGGLES_CATALOG[1].slug, primaryKeyword: MARKET_STRUGGLES_CATALOG[1].primaryKeyword }
          ])
        })
      });

      const result = await discoverDailyMarketStruggles();
      assert.ok(result.found);
      assert.ok(result.candidate);
      assert.notEqual(result.candidate.slug, MARKET_STRUGGLES_CATALOG[0].slug);
      assert.notEqual(result.candidate.slug, MARKET_STRUGGLES_CATALOG[1].slug);
      assert.equal(result.candidate.slug, MARKET_STRUGGLES_CATALOG[2].slug);
    } finally {
      IntelloArticle.find = originalFind;
    }
  });
});
