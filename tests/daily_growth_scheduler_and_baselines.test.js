const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

const ProjectGrowthBaseline = require('../models/ProjectGrowthBaseline');
const DailyGrowthIntelligence = require('../models/DailyGrowthIntelligence');
const SocialDraft = require('../models/SocialDraft');
const { getProjectLocalTime, processProjectDailyGrowthRun } = require('../services/dailyGrowthScheduler');
const { projectLocalDateKey, projectReportingContext } = require('../services/dailyGrowthIntelligenceService');
const {
  detectCtaType,
  comparePostAgainstBaseline,
  MIN_SAMPLE_THRESHOLD
} = require('../services/growthBaselineLearningService');

test('Daily Growth Scheduler: Timezone-Aware Local Time Calculations', async (t) => {
  await t.test('calculates correct local hour for different project timezones', () => {
    const fixedUtcTime = new Date('2026-08-19T12:00:00Z'); // 12:00 UTC

    const utcTime = getProjectLocalTime('UTC', fixedUtcTime);
    assert.equal(utcTime.hour, 12);
    assert.equal(utcTime.dateString, '2026-08-19');
    assert.equal(utcTime.valid, true);

    const nyTime = getProjectLocalTime('America/New_York', fixedUtcTime); // EDT is UTC-4 -> 08:00
    assert.equal(nyTime.hour, 8);
    assert.equal(nyTime.dateString, '2026-08-19');

    const tokyoTime = getProjectLocalTime('Asia/Tokyo', fixedUtcTime); // JST is UTC+9 -> 21:00
    assert.equal(tokyoTime.hour, 21);
    assert.equal(tokyoTime.dateString, '2026-08-19');
  });

  await t.test('gracefully handles invalid timezone with UTC fallback', () => {
    const fixedTime = new Date('2026-08-19T14:30:00Z');
    const res = getProjectLocalTime('Invalid/Unknown_Timezone_123', fixedTime);
    assert.equal(res.hour, 14);
    assert.equal(res.dateString, '2026-08-19');
    assert.equal(res.valid, false);
  });

  await t.test('uses the project-local calendar day and UTC boundaries for reporting', () => {
    const now = new Date('2026-08-19T22:30:00Z');
    assert.equal(projectLocalDateKey(now, 'Asia/Tokyo').toISOString(), '2026-08-20T00:00:00.000Z');
    assert.equal(projectLocalDateKey(now, 'America/New_York').toISOString(), '2026-08-19T00:00:00.000Z');

    const tokyo = projectReportingContext(now, 'Asia/Tokyo');
    assert.equal(tokyo.reportingDate.toISOString(), '2026-08-19T00:00:00.000Z');
    assert.equal(tokyo.reportingWindow.start.toISOString(), '2026-08-18T15:00:00.000Z');
    assert.equal(tokyo.reportingWindow.end.toISOString(), '2026-08-19T15:00:00.000Z');
  });
});

test('Historical Baselines: CTA Detection & Post Comparison Guardrails', async (t) => {
  await t.test('categorizes CTA types accurately', () => {
    assert.equal(detectCtaType('What do you think? Drop a comment below!'), 'question');
    assert.equal(detectCtaType('Download our free SEO checklist template (PDF)'), 'lead_magnet');
    assert.equal(detectCtaType('Start your 14-day free trial or book a demo today'), 'product_trial');
    assert.equal(detectCtaType('Read more on our website: https://moyi-cmo.com/post'), 'direct_link');
    assert.equal(detectCtaType('Exciting developments coming next quarter.'), 'general');
  });

  await t.test('enforces minimum sample threshold before declaring a breakout multiplier', () => {
    const mockBaselines = {
      overall: { avgPostEngagements: 50 },
      topicBaselines: [
        { topic: 'tutorial', sampleSize: 2, avgEngagements: 40 }, // < MIN_SAMPLE_THRESHOLD
        { topic: 'founder_story', sampleSize: 6, avgEngagements: 60 } // >= MIN_SAMPLE_THRESHOLD
      ],
      formatBaselines: [
        { format: 'video', sampleSize: 5, avgEngagements: 80 }
      ]
    };

    // Tutorial has only 2 sample posts -> sampleSufficient should be false
    const tutorialPost = { category: 'tutorial', contentType: 'text', engagements: 120 };
    const res1 = comparePostAgainstBaseline(tutorialPost, mockBaselines);
    assert.equal(res1.sampleSufficient, false);

    // Founder story has 6 sample posts -> sampleSufficient should be true and multiplier calculated
    const founderPost = { category: 'founder_story', contentType: 'text', engagements: 150 };
    const res2 = comparePostAgainstBaseline(founderPost, mockBaselines);
    assert.equal(res2.sampleSufficient, true);
    assert.equal(res2.multiplierVsTopic, 2.5);
    assert.equal(res2.isBreakout, true);
  });
});

test('Daily Growth Scheduler: Duplicate Prevention (Idempotency)', async (t) => {
  await t.test('skips daily execution if a report already exists for the project on target date', async () => {
    const dummyProjectId = new mongoose.Types.ObjectId();
    const targetDate = new Date('2026-08-19T00:00:00Z');

    // Mock DailyGrowthIntelligence.findOne to return an existing document
    const origFindOne = DailyGrowthIntelligence.findOne;
    DailyGrowthIntelligence.findOne = function() {
      return {
        select: function() {
          return {
            lean: async function() {
              return { _id: new mongoose.Types.ObjectId(), status: 'generated' };
            }
          };
        }
      };
    };

    try {
      const mockProject = { _id: dummyProjectId, name: 'Test Project', timezone: 'UTC' };
      const result = await processProjectDailyGrowthRun(mockProject, { targetDate, force: false });

      assert.equal(result.skipped, true);
      assert.ok(result.reason.includes('already exists'));
    } finally {
      DailyGrowthIntelligence.findOne = origFindOne;
    }
  });
});
