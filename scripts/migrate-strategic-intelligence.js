require('dotenv').config();
const mongoose = require('mongoose');
const env = require('../config/env');
const StrategicMetricSnapshot = require('../models/StrategicMetricSnapshot');
const StrategicForecast = require('../models/StrategicForecast');
const StrategicOpportunity = require('../models/StrategicOpportunity');
const StrategicDecision = require('../models/StrategicDecision');
const CompetitorSnapshot = require('../models/CompetitorSnapshot');
const StrategicReview = require('../models/StrategicReview');
const MarketingGoal = require('../models/MarketingGoal');
const GrowthAlert = require('../models/GrowthAlert');

async function run() {
  await mongoose.connect(env.mongoUri);
  await Promise.all([
    StrategicMetricSnapshot.syncIndexes(),
    StrategicForecast.syncIndexes(),
    StrategicOpportunity.syncIndexes(),
    StrategicDecision.syncIndexes(),
    CompetitorSnapshot.syncIndexes(),
    StrategicReview.syncIndexes(),
    MarketingGoal.syncIndexes(),
    GrowthAlert.syncIndexes()
  ]);
  console.log('Phase 7 strategic intelligence indexes are ready.');
  await mongoose.disconnect();
}

run().catch(async (error) => {
  console.error(error);
  await mongoose.disconnect().catch(() => null);
  process.exitCode = 1;
});
