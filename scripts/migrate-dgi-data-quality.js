require('dotenv').config();
const mongoose = require('mongoose');
const env = require('../config/env');
const DailyGrowthIntelligence = require('../models/DailyGrowthIntelligence');
const DailySocialSnapshot = require('../models/DailySocialSnapshot');
const EngagementSnapshot = require('../models/EngagementSnapshot');
const MetricObservation = require('../models/MetricObservation');
const ProjectGrowthBaseline = require('../models/ProjectGrowthBaseline');
const ProviderSyncRun = require('../models/ProviderSyncRun');

async function run() {
  await mongoose.connect(env.mongoUri);
  await DailyGrowthIntelligence.collection.updateMany(
    { schemaVersion: { $exists: false } },
    { $set: { schemaVersion: 1 } }
  );
  const legacyStringIssues = await DailyGrowthIntelligence.collection.updateMany(
    { 'dataQuality.issues.0': { $type: 'string' } },
    {
      $set: {
        schemaVersion: 1,
        'dataQuality.issues': []
      }
    }
  );
  await Promise.all([
    DailyGrowthIntelligence.syncIndexes(),
    DailySocialSnapshot.syncIndexes(),
    EngagementSnapshot.syncIndexes(),
    MetricObservation.syncIndexes(),
    ProjectGrowthBaseline.syncIndexes(),
    ProviderSyncRun.syncIndexes()
  ]);
  console.log(`DGI data-quality collections and indexes are ready. Cleared ${legacyStringIssues.modifiedCount} legacy string-based issue payload(s); legacy reports will regenerate on first read.`);
  await mongoose.disconnect();
}

run().catch(async (error) => {
  console.error(error);
  await mongoose.disconnect().catch(() => null);
  process.exitCode = 1;
});
