const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

const Project = require('../models/Project');
const User = require('../models/User');
const Recommendation = require('../models/Recommendation');
const SearchMetric = require('../models/SearchMetric');
const Competitor = require('../models/Competitor');
const CompetitorInsight = require('../models/CompetitorInsight');
const ContentDraft = require('../models/ContentDraft');
const SocialDraft = require('../models/SocialDraft');
const Scan = require('../models/Scan');
const GrowthAlert = require('../models/GrowthAlert');
const emailService = require('../services/emailService');
const {
  buildWeeklyBriefingData,
  renderWeeklyBriefingHtml,
  sendWeeklyBriefingEmail,
  sendProactiveGrowthAlert
} = require('../services/cmoBriefingService');

test('Autonomous CMO Briefing & Growth Alert Engine', async (t) => {
  const userId = new mongoose.Types.ObjectId();
  const projectId = new mongoose.Types.ObjectId();

  const mockUser = {
    _id: userId,
    name: 'Alex Rivera',
    email: 'alex@example.com'
  };

  const mockProject = {
    _id: projectId,
    owner: mockUser,
    name: 'GrowthOps AI',
    websiteUrl: 'https://growthops.example.com',
    businessModel: 'saas',
    targetAudience: 'B2B SaaS Founders',
    cmoNotifications: {
      weeklyBriefing: {
        enabled: true,
        deliveryDay: 'monday',
        recipientEmails: ['team@example.com']
      },
      growthAlerts: {
        enabled: true,
        minSeverity: 'high'
      },
      contentApprovalNudges: {
        enabled: true
      }
    },
    save: async () => mockProject
  };

  await t.test('buildWeeklyBriefingData assembles comprehensive executive growth summary', async () => {
    // Stub all required models for isolation
    const origProjectFindById = Project.findById;
    const origSearchMetricFind = SearchMetric.find;
    const origRecommendationFind = Recommendation.find;
    const origCompetitorFind = Competitor.find;
    const origCompetitorInsightFind = CompetitorInsight.find;
    const origContentDraftFind = ContentDraft.find;
    const origSocialDraftFind = SocialDraft.find;
    const origScanFindOne = Scan.findOne;

    Project.findById = () => ({
      populate: async () => mockProject
    });

    SearchMetric.find = async ({ date }) => {
      if (date && date.$gte && date.$gte > new Date(Date.now() - 8 * 24 * 60 * 60 * 1000)) {
        return [
          { query: 'ai cmo automation', clicks: 120, impressions: 2400, position: 4.2 },
          { query: 'b2b marketing strategy', clicks: 85, impressions: 1800, position: 6.8 }
        ];
      }
      return [
        { query: 'ai cmo automation', clicks: 90, impressions: 2000, position: 5.1 }
      ];
    };

    Recommendation.find = () => ({
      sort: () => ({
        limit: async () => [
          {
            _id: new mongoose.Types.ObjectId(),
            title: 'Target high-impression low-CTR queries',
            category: 'Search Performance',
            impact: 'High',
            effort: 'Low'
          }
        ]
      })
    });

    Competitor.find = () => ({
      limit: async () => [{ name: 'Rival HQ' }]
    });

    CompetitorInsight.find = () => ({
      sort: () => ({
        limit: async () => [
          {
            competitorName: 'Rival HQ',
            summary: 'Indexed 4 new comparison pages.'
          }
        ]
      })
    });

    ContentDraft.find = () => ({
      sort: () => ({
        limit: async () => [
          {
            _id: new mongoose.Types.ObjectId(),
            title: 'Why AI CMOs Beat Legacy Agencies',
            targetKeyword: 'ai cmo vs agency'
          }
        ]
      })
    });

    SocialDraft.find = () => ({
      sort: () => ({
        limit: async () => []
      })
    });

    Scan.findOne = () => ({
      sort: async () => ({ score: 92 })
    });

    try {
      const data = await buildWeeklyBriefingData(projectId);

      assert.equal(data.project.name, 'GrowthOps AI');
      assert.equal(data.search.clicks, 205);
      assert.equal(data.search.impressions, 4200);
      assert.equal(data.recommendations.length, 1);
      assert.equal(data.recommendations[0].impact, 'High');
      assert.equal(data.scanScore, 92);
      assert.equal(data.contentPipeline.pendingDraftCount, 1);

      // Test HTML Rendering
      const html = renderWeeklyBriefingHtml(data);
      assert.ok(html.includes('GrowthOps AI Growth Report'));
      assert.ok(html.includes('205'));
      assert.ok(html.includes('4,200'));
      assert.ok(html.includes('Target high-impression low-CTR queries'));
      assert.ok(html.includes('Rival HQ'));
      assert.ok(html.includes('Why AI CMOs Beat Legacy Agencies'));
      assert.ok(html.includes('Open Project Workspace'));
    } finally {
      Project.findById = origProjectFindById;
      SearchMetric.find = origSearchMetricFind;
      Recommendation.find = origRecommendationFind;
      Competitor.find = origCompetitorFind;
      CompetitorInsight.find = origCompetitorInsightFind;
      ContentDraft.find = origContentDraftFind;
      SocialDraft.find = origSocialDraftFind;
      Scan.findOne = origScanFindOne;
    }
  });

  await t.test('sendWeeklyBriefingEmail records GrowthAlert and updates lastSentAt', async () => {
    const origProjectFindById = Project.findById;
    const origSearchMetricFind = SearchMetric.find;
    const origRecommendationFind = Recommendation.find;
    const origCompetitorFind = Competitor.find;
    const origCompetitorInsightFind = CompetitorInsight.find;
    const origContentDraftFind = ContentDraft.find;
    const origSocialDraftFind = SocialDraft.find;
    const origScanFindOne = Scan.findOne;
    const origSendEmail = emailService.sendEmail;
    const origGrowthAlertCreate = GrowthAlert.create;

    let emailSent = null;
    let alertCreated = null;

    Project.findById = () => ({
      populate: async () => mockProject
    });
    SearchMetric.find = async () => [];
    Recommendation.find = () => ({ sort: () => ({ limit: async () => [] }) });
    Competitor.find = () => ({ limit: async () => [] });
    CompetitorInsight.find = () => ({ sort: () => ({ limit: async () => [] }) });
    ContentDraft.find = () => ({ sort: () => ({ limit: async () => [] }) });
    SocialDraft.find = () => ({ sort: () => ({ limit: async () => [] }) });
    Scan.findOne = () => ({ sort: async () => null });

    emailService.sendEmail = async (params) => {
      emailSent = params;
      return { messageId: 'test-123' };
    };

    GrowthAlert.create = async (record) => {
      alertCreated = record;
      return record;
    };

    try {
      const result = await sendWeeklyBriefingEmail({
        project: mockProject,
        recipientEmail: 'alex@example.com',
        force: true
      });

      assert.equal(result.success, true);
      assert.equal(result.recipient, 'alex@example.com');
      assert.ok(emailSent);
      assert.equal(emailSent.to, 'alex@example.com');
      assert.ok(emailSent.subject.includes('Weekly CMO Growth Briefing'));
      assert.ok(alertCreated);
      assert.equal(alertCreated.type, 'weekly_briefing');
      assert.ok(mockProject.cmoNotifications.weeklyBriefing.lastSentAt);
    } finally {
      Project.findById = origProjectFindById;
      SearchMetric.find = origSearchMetricFind;
      Recommendation.find = origRecommendationFind;
      Competitor.find = origCompetitorFind;
      CompetitorInsight.find = origCompetitorInsightFind;
      ContentDraft.find = origContentDraftFind;
      SocialDraft.find = origSocialDraftFind;
      Scan.findOne = origScanFindOne;
      emailService.sendEmail = origSendEmail;
      GrowthAlert.create = origGrowthAlertCreate;
    }
  });

  await t.test('sendProactiveGrowthAlert dispatches critical alerts and stores event log', async () => {
    const origSendEmail = emailService.sendEmail;
    const origGrowthAlertCreate = GrowthAlert.create;

    let alertEmailSent = null;
    let alertLog = null;

    emailService.sendEmail = async (params) => {
      alertEmailSent = params;
      return { messageId: 'alert-123' };
    };

    GrowthAlert.create = async (record) => {
      alertLog = record;
      return record;
    };

    try {
      const result = await sendProactiveGrowthAlert({
        project: mockProject,
        type: 'competitor_move',
        severity: 'growth_opportunity',
        title: 'Competitor launched new enterprise feature',
        summary: 'Rival HQ published 3 new pages targeting Enterprise SLA terms.',
        evidenceData: { pagesAdded: 3 },
        ctaUrl: 'https://example.com/projects/123/competitors',
        ctaLabel: 'Review Counter-Strategy'
      });

      assert.equal(result.success, true);
      assert.ok(alertEmailSent);
      assert.ok(alertEmailSent.subject.includes('Competitor launched new enterprise feature'));
      assert.ok(alertLog);
      assert.equal(alertLog.type, 'competitor_move');
      assert.equal(alertLog.severity, 'growth_opportunity');
    } finally {
      emailService.sendEmail = origSendEmail;
      GrowthAlert.create = origGrowthAlertCreate;
    }
  });

  await t.test('Project cmoNotifications schema fields persist with default values', () => {
    const freshProject = new Project({
      owner: new mongoose.Types.ObjectId(),
      name: 'Test Project',
      websiteUrl: 'https://test.example.com'
    });

    assert.equal(freshProject.cmoNotifications.weeklyBriefing.enabled, true);
    assert.equal(freshProject.cmoNotifications.weeklyBriefing.deliveryDay, 'monday');
    assert.equal(freshProject.cmoNotifications.growthAlerts.enabled, true);
    assert.equal(freshProject.cmoNotifications.contentApprovalNudges.enabled, true);
  });
});
