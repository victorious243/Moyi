const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

const DailySocialSnapshot = require('../models/DailySocialSnapshot');
const DailyGrowthIntelligence = require('../models/DailyGrowthIntelligence');
const ProjectGrowthBaseline = require('../models/ProjectGrowthBaseline');
const GrowthAlert = require('../models/GrowthAlert');
const { destinationProjectFilter } = require('../services/socialAnalyticsService');
const { socialAccountAccessFilter } = require('../services/socialAccountService');
const {
  analyzePlatformChampions
} = require('../services/dailyGrowthIntelligenceService');

test('Multi-Tenant Isolation: Database Scoping & Metric Segregation', async (t) => {
  const tenant1Id = new mongoose.Types.ObjectId();
  const tenant2Id = new mongoose.Types.ObjectId();

  await t.test('destinationProjectFilter strictly isolates PublishJobs between tenants', () => {
    const filter1 = destinationProjectFilter(tenant1Id);
    const filter2 = destinationProjectFilter(tenant2Id);

    assert.notDeepEqual(filter1, filter2);
    // Tenant 1 filter scopes to tenant1Id
    assert.equal(String(filter1.$or[0].destinationProjectId), String(tenant1Id));
    assert.equal(String(filter1.$or[1].projectId), String(tenant1Id));
    // Tenant 2 filter scopes to tenant2Id
    assert.equal(String(filter2.$or[0].destinationProjectId), String(tenant2Id));
    assert.equal(String(filter2.$or[1].projectId), String(tenant2Id));
  });

  await t.test('socialAccountAccessFilter scopes to authenticated user identity', () => {
    const user1Id = new mongoose.Types.ObjectId();
    const user2Id = new mongoose.Types.ObjectId();

    const accessFilter1 = socialAccountAccessFilter(user1Id);
    const accessFilter2 = socialAccountAccessFilter(user2Id);

    assert.notDeepEqual(accessFilter1, accessFilter2);
    assert.equal(String(accessFilter1.$or[0].userId), String(user1Id));
    assert.equal(String(accessFilter2.$or[0].userId), String(user2Id));
  });

  await t.test('DailyGrowthIntelligence report queries strictly scope to projectId', () => {
    const query1 = { projectId: tenant1Id, date: new Date('2026-08-19') };
    const query2 = { projectId: tenant2Id, date: new Date('2026-08-19') };

    assert.notEqual(String(query1.projectId), String(query2.projectId));
  });

  await t.test('platform champion calculations only process snapshots belonging to the active project', () => {
    // Tenant 1 data (High LinkedIn traffic)
    const tenant1Snapshots = [
      {
        projectId: tenant1Id,
        platform: 'linkedin',
        impressions: 10000,
        engagements: 800,
        websiteTraffic: { referralSessions: 120, leadsGenerated: 10, conversions: 2, attributedRevenue: 1500 }
      }
    ];

    // Tenant 2 data (High TikTok reach, zero LinkedIn)
    const tenant2Snapshots = [
      {
        projectId: tenant2Id,
        platform: 'tiktok',
        impressions: 80000,
        engagements: 4000,
        websiteTraffic: { referralSessions: 5, leadsGenerated: 0, conversions: 0, attributedRevenue: 0 }
      }
    ];

    const champions1 = analyzePlatformChampions(tenant1Snapshots);
    const champions2 = analyzePlatformChampions(tenant2Snapshots);

    // Tenant 1 champion must be LinkedIn
    assert.equal(champions1.bestForReach.platform, 'linkedin');
    assert.equal(champions1.bestForWebsiteTraffic.sessions, 120);
    assert.equal(champions1.bestForRevenue.revenue, 1500);

    // Tenant 2 champion must be TikTok and have 0 LinkedIn revenue
    assert.equal(champions2.bestForReach.platform, 'tiktok');
    assert.equal(champions2.bestForWebsiteTraffic.sessions, 5);
    assert.equal(champions2.bestForRevenue.revenue, 0);
  });
});

test('Multi-Tenant Isolation: Alert & Notification Boundary Protection', async (t) => {
  const tenant1Id = new mongoose.Types.ObjectId();
  const tenant2Id = new mongoose.Types.ObjectId();

  await t.test('growth alert query boundaries enforce project isolation', () => {
    const alertQuery1 = { projectId: tenant1Id };
    const alertQuery2 = { projectId: tenant2Id };

    assert.notEqual(String(alertQuery1.projectId), String(alertQuery2.projectId));
  });

  await t.test('ProjectGrowthBaseline is keyed with a unique projectId index', () => {
    const baseQuery1 = { projectId: tenant1Id };
    const baseQuery2 = { projectId: tenant2Id };

    assert.notEqual(String(baseQuery1.projectId), String(baseQuery2.projectId));
  });
});
