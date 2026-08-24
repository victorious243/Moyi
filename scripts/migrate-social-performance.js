require('dotenv').config();
const mongoose = require('mongoose');
const env = require('../config/env');
const EngagementSnapshot = require('../models/EngagementSnapshot');
const GrowthSignal = require('../models/GrowthSignal');
const MetricObservation = require('../models/MetricObservation');
const PublishJob = require('../models/PublishJob');
const SocialPostPerformance = require('../models/SocialPostPerformance');
const { rebuildCanonicalPostPerformance } = require('../services/socialPostPerformanceService');

async function run() {
  await mongoose.connect(env.mongoUri);
  await Promise.all([
    EngagementSnapshot.createIndexes(),
    GrowthSignal.createIndexes(),
    MetricObservation.createIndexes(),
    SocialPostPerformance.createIndexes()
  ]);
  const jobs = await PublishJob.find({
    status: 'published',
    platformPostId: { $ne: '' }
  }).sort({ publishedAt: 1 }).select('_id').lean();
  let rebuilt = 0;
  let skipped = 0;
  let failed = 0;
  for (const job of jobs) {
    try {
      const performance = await rebuildCanonicalPostPerformance(job._id);
      if (performance) rebuilt += 1;
      else skipped += 1;
    } catch (error) {
      failed += 1;
      console.error(JSON.stringify({ event: 'social_performance_backfill_failed', publishJobId: String(job._id), error: error.message }));
    }
  }
  console.log(`Canonical social performance backfill complete: ${rebuilt} rebuilt, ${skipped} skipped, ${failed} failed.`);
  await mongoose.disconnect();
}

run().catch(async (error) => {
  console.error(error);
  await mongoose.disconnect().catch(() => null);
  process.exitCode = 1;
});
