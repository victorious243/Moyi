const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

const ContentDraft = require('../models/ContentDraft');
const SocialDraft = require('../models/SocialDraft');
const User = require('../models/User');

const { sendIntelloDailyOperatorEmail } = require('../services/dailyContentIntelligenceService');

test('Intello Daily Operator Queue & Admin Notification Suite', async (t) => {
  const mockProjectId = new mongoose.Types.ObjectId();
  const mockAdminId = new mongoose.Types.ObjectId();

  await t.test('sendIntelloDailyOperatorEmail formats email with target keyword and operator dashboard link', async () => {
    let sentPayload = null;
    const emailService = require('../services/emailService');
    const originalSendEmail = emailService.sendEmail;
    const originalUserFind = User.find;

    emailService.sendEmail = async (payload) => {
      sentPayload = payload;
      return { messageId: 'test-123' };
    };

    User.find = (query) => {
      return Promise.resolve([{ email: 'admin@moyi.ie', role: 'admin' }]);
    };

    try {
      const mockProject = {
        _id: mockProjectId,
        name: 'Moyi SaaS',
        owner: mockAdminId
      };

      const mockContentPackage = {
        seoPackage: {
          primaryKeyword: 'striking distance keywords google search console',
          seoTitle: 'How to Mine Striking-Distance Keywords for Instant SEO Wins'
        },
        article: {
          introduction: 'Most growth teams ignore positions 8 through 20 in Google Search Console...'
        }
      };

      await sendIntelloDailyOperatorEmail({
        project: mockProject,
        contentPackage: mockContentPackage,
        savedDraft: { _id: new mongoose.Types.ObjectId() },
        socialDraftCount: 3
      });

      assert.ok(sentPayload);
      assert.equal(sentPayload.to, 'admin@moyi.ie');
      assert.match(sentPayload.subject, /Intello Daily.*Moyi SaaS/);
      assert.match(sentPayload.text, /admin#intello-daily/);
      assert.match(sentPayload.text, /striking distance keywords/);
    } finally {
      emailService.sendEmail = originalSendEmail;
      User.find = originalUserFind;
    }
  });

  await t.test('ContentDraft model supports daily_content_intelligence type and awaiting_review status', () => {
    const draft = new ContentDraft({
      projectId: mockProjectId,
      type: 'daily_content_intelligence',
      title: 'Striking Distance Keyword Playbook',
      keyword: 'striking distance keywords',
      status: 'awaiting_review'
    });

    assert.equal(draft.type, 'daily_content_intelligence');
    assert.equal(draft.status, 'awaiting_review');
  });
});
