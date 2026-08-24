const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

const DailySocialSnapshot = require('../models/DailySocialSnapshot');
const DailyGrowthIntelligence = require('../models/DailyGrowthIntelligence');
const EngagementSnapshot = require('../models/EngagementSnapshot');
const MetricObservation = require('../models/MetricObservation');
const ProviderSyncRun = require('../models/ProviderSyncRun');
const { isVerifiedMetric, metricValue } = require('../services/analytics/metricStatus');
const {
  SUPPORTED_PLATFORMS,
  calculateDelta,
  detectContentFormat,
  detectContentCategory,
  analyzePlatformChampions,
  runDailyDiagnosisEngine,
  detectGrowthOpportunities,
  calculateGrowthScoreBreakdown
} = require('../services/dailyGrowthIntelligenceService');

test('Daily Growth Intelligence: Platform Support & Data Normalization', async (t) => {
  await t.test('supports all 6 required core platforms plus modern channels', () => {
    const required = ['linkedin', 'facebook', 'instagram', 'x', 'tiktok', 'youtube'];
    required.forEach((p) => {
      assert.ok(SUPPORTED_PLATFORMS.includes(p), `Missing platform: ${p}`);
    });
  });

  await t.test('calculates raw and percentage deltas correctly', () => {
    const upDelta = calculateDelta(1500, 1000);
    assert.equal(upDelta.rawCurrent, 1500);
    assert.equal(upDelta.rawPrevious, 1000);
    assert.equal(upDelta.diff, 500);
    assert.equal(upDelta.percentage, 50);
    assert.equal(upDelta.direction, 'up');

    const downDelta = calculateDelta(800, 1000);
    assert.equal(downDelta.diff, -200);
    assert.equal(downDelta.percentage, -20);
    assert.equal(downDelta.direction, 'down');
  });

  await t.test('correctly categorizes content format and topic angles', () => {
    assert.equal(detectContentFormat({ mediaIds: [{}, {}] }), 'carousel');
    assert.equal(detectContentFormat({ platform: 'tiktok' }), 'video');
    assert.equal(detectContentFormat({ content: { imageUrl: 'https://example.com/pic.png' } }), 'image');
    assert.equal(detectContentFormat({}), 'text');

    assert.equal(detectContentCategory('Here is the founder journey of building our SaaS'), 'founder_story');
    assert.equal(detectContentCategory('Step by step tutorial to configure Search Console'), 'tutorial');
    assert.equal(detectContentCategory('New feature update: v2 AI model released today'), 'product_update');
    assert.equal(detectContentCategory('Case study: How client grew organic pipeline by 3.2x'), 'case_study');
    assert.equal(detectContentCategory('Special 50% discount on annual plans this week'), 'promotional');
  });
});

test('Daily Growth Intelligence: Objective-Based Platform Performance', async (t) => {
  await t.test('determines platform champions based on distinct business goals rather than likes alone', () => {
    const mockSnapshots = [
      {
        platform: 'tiktok',
        impressions: 50000,
        engagements: 2500,
        followersGained: 120,
        websiteTraffic: { referralSessions: 5, leadsGenerated: 0, conversions: 0, attributedRevenue: 0 }
      },
      {
        platform: 'linkedin',
        impressions: 8000,
        engagements: 640,
        followersGained: 45,
        websiteTraffic: { referralSessions: 180, leadsGenerated: 12, conversions: 4, attributedRevenue: 1980 }
      },
      {
        platform: 'instagram',
        impressions: 12000,
        engagements: 1200,
        followersGained: 30,
        websiteTraffic: { referralSessions: 25, leadsGenerated: 1, conversions: 0, attributedRevenue: 0 }
      }
    ];

    const champions = analyzePlatformChampions(mockSnapshots);

    // TikTok should win reach
    assert.equal(champions.bestForReach.platform, 'tiktok');
    assert.equal(champions.bestForReach.value, 50000);
    assert.ok(champions.bestForReach.sharePercentage > 50);

    // Instagram should win engagement rate (1200 / 12000 = 10%)
    assert.equal(champions.bestForEngagement.platform, 'instagram');
    assert.equal(champions.bestForEngagement.rate, 10);

    // LinkedIn should win website traffic, leads, conversions, and revenue
    assert.equal(champions.bestForWebsiteTraffic.platform, 'linkedin');
    assert.equal(champions.bestForWebsiteTraffic.sessions, 180);
    assert.equal(champions.bestForLeads.platform, 'linkedin');
    assert.equal(champions.bestForLeads.leads, 12);
    assert.equal(champions.bestForConversions.platform, 'linkedin');
    assert.equal(champions.bestForConversions.conversions, 4);
    assert.equal(champions.bestForRevenue.platform, 'linkedin');
    assert.equal(champions.bestForRevenue.revenue, 1980);
  });

  await t.test('does not invent LinkedIn as a champion when all platform rows are placeholders', () => {
    const mockSnapshots = [
      {
        platform: 'linkedin',
        impressions: 0,
        engagements: 0,
        followersGained: 0,
        websiteTraffic: { referralSessions: 0, leadsGenerated: 0, conversions: 0, attributedRevenue: 0 }
      },
      {
        platform: 'x',
        impressions: 0,
        engagements: 0,
        followersGained: 0,
        websiteTraffic: { referralSessions: 0, leadsGenerated: 0, conversions: 0, attributedRevenue: 0 }
      }
    ];

    const champions = analyzePlatformChampions(mockSnapshots);

    assert.equal(champions.bestForReach.platform, '');
    assert.equal(champions.bestForReach.noData, true);
    assert.match(champions.bestForReach.rationale, /No verified impression metrics/);
    assert.equal(champions.bestForEngagement.platform, '');
    assert.equal(champions.bestForWebsiteTraffic.platform, '');
    assert.equal(champions.bestForRevenue.platform, '');
  });

  await t.test('shows X as the reach champion when X has the real collected metrics', () => {
    const champions = analyzePlatformChampions([
      {
        platform: 'linkedin',
        impressions: 0,
        engagements: 0,
        websiteTraffic: { referralSessions: 0, leadsGenerated: 0, conversions: 0, attributedRevenue: 0 }
      },
      {
        platform: 'x',
        impressions: 2400,
        engagements: 96,
        websiteTraffic: { referralSessions: 0, leadsGenerated: 0, conversions: 0, attributedRevenue: 0 }
      }
    ]);

    assert.equal(champions.bestForReach.platform, 'x');
    assert.equal(champions.bestForReach.value, 2400);
    assert.equal(champions.bestForEngagement.platform, 'x');
    assert.equal(champions.bestForWebsiteTraffic.platform, '');
  });

  await t.test('excludes stale provider metrics from platform champions', () => {
    const champions = analyzePlatformChampions([
      {
        platform: 'x',
        impressions: 9000,
        metricStates: {
          impressions: { value: 9000, status: 'verified', freshness: 'stale' }
        },
        websiteTraffic: { measurementStatus: 'pending' }
      },
      {
        platform: 'linkedin',
        impressions: 120,
        metricStates: {
          impressions: { value: 120, status: 'verified', freshness: 'fresh' }
        },
        websiteTraffic: { measurementStatus: 'pending' }
      }
    ]);

    assert.equal(champions.bestForReach.platform, 'linkedin');
    assert.equal(champions.bestForReach.value, 120);
  });
});

test('Daily Growth Intelligence: Daily Diagnosis & Opportunity Engine', async (t) => {
  await t.test('generates actionable root-cause diagnoses when metrics shift', () => {
    const windowComparisons = {
      yesterdayVsPrev: {
        deltas: {
          impressions: { rawCurrent: 14000, rawPrevious: 9000, diff: 5000, percentage: 55.6 },
          referralSessions: { rawCurrent: 45, rawPrevious: 20, diff: 25, percentage: 125 }
        }
      }
    };
    const platformChampions = {
      bestForReach: { platform: 'linkedin', sharePercentage: 65 },
      bestForWebsiteTraffic: { platform: 'linkedin', sessions: 45 }
    };
    const contentIntel = {
      topPerformingPosts: [
        { title: 'Search Console Striking Distance Playbook', platform: 'linkedin', impressions: 9500, engagements: 480 }
      ],
      detectedPatterns: [
        {
          patternName: 'Tutorial Content Advantage',
          observation: 'Tutorial posts outperform baseline by 2.3x.',
          evidence: 'Analyzed 5 tutorials averaging 480 engagements.',
          confidence: 'high',
          recommendation: 'Increase tutorial frequency in weekly calendar.'
        }
      ]
    };

    const diagnoses = runDailyDiagnosisEngine(windowComparisons, platformChampions, contentIntel);
    assert.ok(diagnoses.length >= 2);

    const reachDiag = diagnoses.find((d) => d.id === 'diag-reach-movement');
    assert.ok(reachDiag);
    assert.ok(reachDiag.observation.includes('surged by 55.6%'));
    assert.equal(reachDiag.businessImpact, 'reach');
    assert.equal(reachDiag.confidence, 'medium');

    const trafficDiag = diagnoses.find((d) => d.id === 'diag-traffic-contribution');
    assert.ok(trafficDiag);
    assert.ok(trafficDiag.observation.includes('45 direct referral visits'));
    assert.equal(trafficDiag.businessImpact, 'traffic');
  });

  await t.test('detects viral breakout and high-converting topic opportunities', () => {
    const contentIntel = {
      topPerformingPosts: [
        {
          postId: 'post-123',
          platform: 'x',
          contentType: 'text',
          title: 'The 4-step SEO audit checklist that unlocked $50k pipeline',
          impressions: 25000,
          engagements: 620,
          engagementRate: 2.5
        }
      ],
      detectedPatterns: [
        {
          patternName: 'Founder Story Advantage',
          multiplier: 2.4,
          evidence: '4 founder posts averaged 520 engagements.',
          sampleSize: 4,
          confidence: 'medium',
          signalStatus: 'emerging_signal'
        }
      ],
      optimalTiming: [
        {
          platform: 'linkedin',
          bestDay: 'Tuesday',
          bestHourWindow: '08:00 - 12:00 UTC',
          performanceMultiplier: 1.8,
          sampleSize: 6
        }
      ]
    };

    const opps = detectGrowthOpportunities(contentIntel);
    assert.ok(opps.length >= 3);

    const viralOpp = opps.find((o) => o.type === 'viral_breakout');
    assert.ok(viralOpp);
    assert.equal(viralOpp.actionType, 'repurpose_post');

    const topicOpp = opps.find((o) => o.type === 'high_converting_topic');
    assert.ok(topicOpp);
    assert.equal(topicOpp.actionType, 'create_article');
    assert.ok(topicOpp.evidence);
    assert.ok(topicOpp.evidenceIds.length > 0);
    assert.match(topicOpp.description, /controlled follow-up/i);

    const timingOpp = opps.find((o) => o.type === 'optimal_timing');
    assert.ok(timingOpp);
    assert.equal(timingOpp.actionType, 'schedule_slot');
  });

  await t.test('generates first-party UTM tracking URLs correctly', () => {
    const { generateSocialUtmLink } = require('../services/dailyGrowthIntelligenceService');
    const link = generateSocialUtmLink({
      baseUrl: 'https://moyi-cmo.com/pricing',
      platform: 'linkedin',
      campaignName: 'Q3 Enterprise Growth',
      postId: 'job-987',
      contentId: 'draft-123'
    });
    assert.ok(link.includes('utm_source=linkedin'));
    assert.ok(link.includes('utm_medium=social'));
    assert.ok(link.includes('utm_campaign=q3-enterprise-growth'));
    assert.ok(link.includes('utm_content=job-987'));
    assert.ok(link.includes('moyi_post_id=job-987'));
    assert.ok(link.includes('moyi_content_id=draft-123'));
  });

  await t.test('computes 6-dimensional growth score and score movement explanation', () => {
    const states = (data) => Object.fromEntries(Object.entries(data).map(([metric, value]) => [metric, {
      value,
      status: 'verified',
      freshness: 'fresh'
    }]));
    const current = { impressions: 5000, engagements: 220, engagementRate: 4.4, referralSessions: 18, leadsGenerated: 3, conversions: 1, followersGained: 12 };
    const previous = { impressions: 3000, engagements: 150, engagementRate: 3, referralSessions: 12, leadsGenerated: 2, conversions: 1, followersGained: 8 };
    const breakdown = calculateGrowthScoreBreakdown(
      { ...current, metricStates: states(current) },
      { ...previous, metricStates: states(previous) },
      { hasHistoricalBaseline: true, dataQuality: { confidence: 91 } }
    );

    assert.ok(breakdown.overallScore > 50 && breakdown.overallScore <= 100);
    assert.equal(breakdown.status, 'scored');
    assert.equal(breakdown.dataConfidence, 91);
    assert.ok(breakdown.audienceGrowth > 50);
    assert.ok(breakdown.contentPerformance > 50);
    assert.ok(breakdown.engagement > 50);
    assert.ok(breakdown.websiteAcquisition > 50);
    assert.equal(breakdown.conversion, 50);
    assert.ok(breakdown.brandVisibility > 50);
    assert.ok(breakdown.movementExplanation.length > 10);
    assert.equal(breakdown.dataQuality.hasVerifiedData, true);
    assert.ok(breakdown.dataQuality.observedMetrics.includes('impressions'));
  });

  await t.test('does not assign a growth score when no verified metrics are available', () => {
    const breakdown = calculateGrowthScoreBreakdown(
      { impressions: 0, engagements: 0, engagementRate: 0, referralSessions: 0, leadsGenerated: 0, conversions: 0 },
      { impressions: 0 }
    );

    assert.equal(breakdown.overallScore, null);
    assert.equal(breakdown.scoreDelta, null);
    assert.equal(breakdown.audienceGrowth, null);
    assert.equal(breakdown.contentPerformance, null);
    assert.equal(breakdown.engagement, null);
    assert.equal(breakdown.websiteAcquisition, null);
    assert.equal(breakdown.conversion, null);
    assert.equal(breakdown.brandVisibility, null);
    assert.equal(breakdown.dataQuality.hasVerifiedData, false);
    assert.match(breakdown.movementExplanation, /not collected enough comparable verified metrics/i);
  });

  await t.test('treats verified zero as real data but does not score without a baseline', () => {
    const zeroState = { value: 0, status: 'verified', freshness: 'fresh' };
    assert.equal(isVerifiedMetric(zeroState), true);
    assert.equal(metricValue(0), 0);
    const breakdown = calculateGrowthScoreBreakdown(
      { impressions: 0, engagements: 0, referralSessions: 0, metricStates: { impressions: zeroState, engagements: zeroState, referralSessions: zeroState } },
      {},
      { hasHistoricalBaseline: false, dataQuality: { confidence: 70, baselineDays: 1 } }
    );
    assert.equal(breakdown.overallScore, null);
    assert.equal(breakdown.status, 'building_baseline');
    assert.equal(breakdown.dataQuality.hasVerifiedData, true);
  });

  await t.test('rejects stale or failed observations as verified evidence', () => {
    assert.equal(isVerifiedMetric({ value: 12, status: 'verified', freshness: 'stale' }), false);
    assert.equal(isVerifiedMetric({ value: 12, status: 'provider_error', freshness: 'fresh' }), false);
  });

  await t.test('stores unknown metric defaults as null rather than artificial zero', () => {
    const social = new DailySocialSnapshot({ projectId: new mongoose.Types.ObjectId(), platform: 'x', date: new Date() });
    const engagement = new EngagementSnapshot({
      projectId: new mongoose.Types.ObjectId(),
      publishJobId: new mongoose.Types.ObjectId(),
      socialAccountId: new mongoose.Types.ObjectId(),
      platform: 'x',
      platformPostId: 'post-1'
    });
    assert.equal(social.impressions, null);
    assert.equal(social.websiteTraffic.attributedRevenue, null);
    assert.deepEqual(engagement.metricStates, []);
  });

  await t.test('stores provider synchronization and normalized observation provenance', () => {
    const projectId = new mongoose.Types.ObjectId();
    const accountId = new mongoose.Types.ObjectId();
    const publishJobId = new mongoose.Types.ObjectId();
    const run = new ProviderSyncRun({
      syncRunId: 'sync-test-1',
      projectId,
      accountId,
      publishJobId,
      platform: 'x',
      status: 'success',
      permissionStatus: 'ok',
      tokenStatus: 'valid'
    });
    const observation = new MetricObservation({
      projectId,
      accountId,
      publishJobId,
      metric: 'impressions',
      normalizedFamily: 'exposure',
      value: 0,
      status: 'verified',
      source: 'x_api',
      providerMetric: 'impression_count',
      platform: 'x',
      entityType: 'post',
      entityId: 'x-post-1',
      observedAt: new Date(),
      syncRunId: run.syncRunId
    });

    assert.equal(run.validateSync(), undefined);
    assert.equal(observation.validateSync(), undefined);
    assert.equal(observation.value, 0);
    assert.equal(observation.status, 'verified');
    assert.equal(observation.syncRunId, run.syncRunId);
  });

  await t.test('detects negative risk patterns and reach contractions', () => {
    const { detectRisksAndProblems } = require('../services/dailyGrowthIntelligenceService');
    const risks = detectRisksAndProblems({
      last7dVsPrev7d: {
        deltas: {
          impressions: { rawCurrent: 8000, rawPrevious: 12000, diff: -4000, percentage: -33.3 }
        }
      },
      yesterdayVsPrev: {
        deltas: {
          impressions: { rawCurrent: 800 },
          linkClicks: { rawCurrent: 0 }
        }
      }
    });

    assert.ok(risks.length >= 2);
    const reachRisk = risks.find((r) => r.id === 'risk-sustained-reach-drop');
    assert.ok(reachRisk);
    assert.equal(reachRisk.severity, 'critical');

    const clickRisk = risks.find((r) => r.id === 'risk-click-friction');
    assert.ok(clickRisk);
    assert.equal(clickRisk.severity, 'warning');
  });
});
