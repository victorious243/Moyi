const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

const Page = require('../models/Page');
const SeoIssue = require('../models/SeoIssue');
const Project = require('../models/Project');
const Recommendation = require('../models/Recommendation');
const ContentDraft = require('../models/ContentDraft');
const {
  generateDraftsForRecommendation,
  generateInstantGrowthPack,
  EXECUTION_ASSET_TYPES,
  ASSET_LABELS
} = require('../services/contentDraftService');

test('Instant 30-Day Growth Pack, Paid Ads Studio, & Email Newsletter Engine', async (t) => {
  const userId = new mongoose.Types.ObjectId();
  const projectId = new mongoose.Types.ObjectId();
  const recommendationId = new mongoose.Types.ObjectId();

  const mockProject = {
    _id: projectId,
    owner: userId,
    name: 'GrowthScale AI',
    websiteUrl: 'https://growthscale.example.com',
    industry: 'B2B SaaS',
    targetAudience: 'Growth Marketers & CMOs',
    mainGoal: 'Scale MRR to €100k',
    mainOffer: 'Autonomous AI CMO Suite',
    brandTone: 'Direct, authoritative, and evidence-driven',
    competitors: [{ name: 'Legacy Agency Inc' }]
  };

  const mockRecommendation = {
    _id: recommendationId,
    projectId,
    title: 'Target High-Intent Comparison Queries Against Legacy Agencies',
    category: 'content',
    priority: 1,
    impact: 'High',
    effort: 'Low',
    actionType: 'content',
    status: 'accepted',
    targetUrls: ['https://growthscale.example.com/vs-agency'],
    relatedIssueIds: []
  };

  const origPageFindOne = Page.findOne;
  const origSeoIssueFind = SeoIssue.find;

  Page.findOne = () => ({ sort: async () => null });
  SeoIssue.find = async () => [];

  try {
    await t.test('asset registry includes paid_ad_copy and email_newsletter', () => {
      assert.ok(EXECUTION_ASSET_TYPES.includes('paid_ad_copy'));
      assert.ok(EXECUTION_ASSET_TYPES.includes('email_newsletter'));
      assert.equal(ASSET_LABELS.paid_ad_copy, 'Paid ad creative kit');
      assert.equal(ASSET_LABELS.email_newsletter, 'Email newsletter & nurture');
    });

    await t.test('generateDraftsForRecommendation generates paid_ad_copy with LinkedIn, Meta, and Google Search formats', async () => {
      const drafts = await generateDraftsForRecommendation({
        project: mockProject,
        recommendation: mockRecommendation,
        requestedTypes: ['paid_ad_copy'],
        keyword: 'Autonomous Marketing'
      });

      assert.equal(drafts.length, 1);
      const paidDraft = drafts[0];
      assert.equal(paidDraft.type, 'paid_ad_copy');
      assert.ok(paidDraft.body.includes('LinkedIn Sponsored Ads'));
      assert.ok(paidDraft.body.includes('Meta & Instagram Feed Ads'));
      assert.ok(paidDraft.body.includes('Google Search Responsive Ads'));
    });

    await t.test('generateDraftsForRecommendation generates email_newsletter with subject lines and takeaways', async () => {
      const drafts = await generateDraftsForRecommendation({
        project: mockProject,
        recommendation: mockRecommendation,
        requestedTypes: ['email_newsletter'],
        keyword: 'Evidence-Led Growth'
      });

      assert.equal(drafts.length, 1);
      const emailDraft = drafts[0];
      assert.equal(emailDraft.type, 'email_newsletter');
      assert.ok(emailDraft.body.includes('Subject Line Options'));
      assert.ok(emailDraft.body.includes('Preview Text'));
      assert.ok(emailDraft.body.length > 50);
    });

    await t.test('generateInstantGrowthPack creates a complete 5-asset omnichannel bundle', async () => {
      const origProjectFindById = Project.findById;
      const origRecFindById = Recommendation.findById;
      const origRecFindOne = Recommendation.findOne;
      const origDraftCreate = ContentDraft.create;

      Project.findById = () => mockProject;
      Recommendation.findById = () => mockRecommendation;
      Recommendation.findOne = () => mockRecommendation;

      const savedDrafts = [];
      ContentDraft.create = async (data) => {
        const saved = { _id: new mongoose.Types.ObjectId(), ...data };
        savedDrafts.push(saved);
        return saved;
      };

      try {
        const result = await generateInstantGrowthPack({
          projectId,
          recommendationId,
          targetUrl: 'https://growthscale.example.com',
          keyword: 'Autonomous CMO'
        });

        assert.equal(result.success, true);
        assert.equal(result.bundleCount, 5);
        assert.equal(savedDrafts.length, 5);

        const types = savedDrafts.map((d) => d.type);
        assert.ok(types.includes('comparison_page_draft'));
        assert.ok(types.includes('paid_ad_copy'));
        assert.ok(types.includes('email_newsletter'));
        assert.ok(types.includes('page_improvement_brief'));
        assert.ok(types.includes('faq_section'));
      } finally {
        Project.findById = origProjectFindById;
        Recommendation.findById = origRecFindById;
        Recommendation.findOne = origRecFindOne;
        ContentDraft.create = origDraftCreate;
      }
    });
  } finally {
    Page.findOne = origPageFindOne;
    SeoIssue.find = origSeoIssueFind;
  }
});
