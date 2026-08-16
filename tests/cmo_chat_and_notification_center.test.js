const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

const Project = require('../models/Project');
const Scan = require('../models/Scan');
const SeoIssue = require('../models/SeoIssue');
const SearchMetric = require('../models/SearchMetric');
const Competitor = require('../models/Competitor');
const CompetitorInsight = require('../models/CompetitorInsight');
const Recommendation = require('../models/Recommendation');
const ContentDraft = require('../models/ContentDraft');
const GrowthAlert = require('../models/GrowthAlert');
const {
  askCmoAssistant,
  assembleProjectTelemetryContext,
  generateDeterministicCmoReply
} = require('../services/cmoChatService');

test('Interactive CMO Chat Assistant & In-App Notification Center', async (t) => {
  const userId = new mongoose.Types.ObjectId();
  const projectId = new mongoose.Types.ObjectId();

  const mockProject = {
    _id: projectId,
    owner: userId,
    name: 'GrowthEngine SaaS',
    websiteUrl: 'https://growthengine.example.com',
    businessModel: 'saas',
    targetAudience: 'Product Leaders',
    mainGoal: 'Scale MRR to $100k',
    mainOffer: 'AI Analytics Platform',
    brandTone: 'Confident and strategic'
  };

  await t.test('assembleProjectTelemetryContext aggregates live workspace signals', async () => {
    const origProjectFindById = Project.findById;
    const origScanFindOne = Scan.findOne;
    const origSeoIssueFind = SeoIssue.find;
    const origSearchMetricFind = SearchMetric.find;
    const origCompetitorFind = Competitor.find;
    const origCompetitorInsightFind = CompetitorInsight.find;
    const origRecommendationFind = Recommendation.find;
    const origContentDraftFind = ContentDraft.find;

    Project.findById = () => mockProject;
    Scan.findOne = () => ({ sort: async () => ({ score: 88 }) });
    SeoIssue.find = () => ({ sort: () => ({ limit: async () => [{ title: 'Missing canonical tags on blog' }] }) });
    SearchMetric.find = () => ({
      limit: async () => [
        { query: 'ai analytics platform', clicks: 45, impressions: 1200 },
        { query: 'product analytics tool', clicks: 30, impressions: 900 }
      ]
    });
    Competitor.find = () => ({ limit: async () => [{ name: 'DataHero HQ' }] });
    CompetitorInsight.find = () => ({ sort: () => ({ limit: async () => [{ summary: 'Competitor dropped pricing page revamp' }] }) });
    Recommendation.find = () => ({ sort: () => ({ limit: async () => [{ title: 'Fix broken redirect chains', impact: 'High' }] }) });
    ContentDraft.find = () => ({ sort: () => ({ limit: async () => [{ title: 'How to Scale MRR with AI' }] }) });

    try {
      const context = await assembleProjectTelemetryContext(projectId);

      assert.equal(context.project.name, 'GrowthEngine SaaS');
      assert.equal(context.telemetry.healthScore, 88);
      assert.equal(context.telemetry.gsc7DayClicks, 75);
      assert.equal(context.telemetry.gsc7DayImpressions, 2100);
      assert.equal(context.telemetry.topQueries[0], 'ai analytics platform');
      assert.equal(context.telemetry.competitorsMonitored[0], 'DataHero HQ');

      // Test Deterministic Strategic Replies
      const trafficReply = generateDeterministicCmoReply('Why did my traffic move this week?', context);
      assert.ok(trafficReply.includes('Search & Demand Diagnostics'));
      assert.ok(trafficReply.includes('75 total clicks'));
      assert.ok(trafficReply.includes('ai analytics platform'));

      const competitorReply = generateDeterministicCmoReply('What are our competitors doing?', context);
      assert.ok(competitorReply.includes('Competitor Intelligence Briefing'));
      assert.ok(competitorReply.includes('DataHero HQ'));

      const contentReply = generateDeterministicCmoReply('Draft 3 LinkedIn hooks for me', context);
      assert.ok(contentReply.includes('Content & Distribution'));
      assert.ok(contentReply.includes('Product Leaders'));

      // Test askCmoAssistant response wrapper
      const chatResponse = await askCmoAssistant({
        projectId,
        message: 'Give me our top growth priorities'
      });

      assert.ok(chatResponse.reply);
      assert.ok(chatResponse.timestamp);
    } finally {
      Project.findById = origProjectFindById;
      Scan.findOne = origScanFindOne;
      SeoIssue.find = origSeoIssueFind;
      SearchMetric.find = origSearchMetricFind;
      Competitor.find = origCompetitorFind;
      CompetitorInsight.find = origCompetitorInsightFind;
      Recommendation.find = origRecommendationFind;
      ContentDraft.find = origContentDraftFind;
    }
  });

  await t.test('sanitizePiiAndSecrets strips tokens, API keys, cards, and secrets', () => {
    const { sanitizePiiAndSecrets } = require('../services/cmoChatService');
    const dirty = 'Bearer eyJhbGciOiJIUzI1NiJ9.test.123 sk-1234567890abcdef1234567890 password="mySuperSecretPassword" 4111 2222 3333 4444';
    const clean = sanitizePiiAndSecrets(dirty);

    assert.ok(!clean.includes('eyJhbGciOiJIUzI1NiJ9'));
    assert.ok(!clean.includes('sk-1234567890abcdef1234567890'));
    assert.ok(!clean.includes('mySuperSecretPassword'));
    assert.ok(!clean.includes('4111 2222 3333 4444'));
    assert.ok(clean.includes('[REDACTED_TOKEN]'));
    assert.ok(clean.includes('[REDACTED_KEY]'));
    assert.ok(clean.includes('[REDACTED_SECRET]'));
    assert.ok(clean.includes('[REDACTED_CARD]'));
  });

  await t.test('GrowthAlert data schema supports unread querying and project population', () => {
    const alert = new GrowthAlert({
      projectId,
      userId,
      type: 'weekly_briefing',
      severity: 'info',
      title: 'Weekly Executive Briefing ready',
      summary: 'Search impressions up 18% WoW.',
      ctaUrl: `/projects/${projectId}`,
      ctaLabel: 'View Report'
    });

    assert.equal(alert.type, 'weekly_briefing');
    assert.equal(alert.severity, 'info');
    assert.equal(alert.readAt, null);
    assert.equal(alert.deliveryStatus, 'sent');
  });
});
