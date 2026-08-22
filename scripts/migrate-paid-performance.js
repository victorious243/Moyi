#!/usr/bin/env node

const mongoose = require('mongoose');
const connectDatabase = require('../config/db');
const ConversionGoal = require('../models/ConversionGoal');
const GrowthAlert = require('../models/GrowthAlert');
const PaidAdAccount = require('../models/PaidAdAccount');
const PaidAdEntity = require('../models/PaidAdEntity');
const PaidAttribution = require('../models/PaidAttribution');
const PaidBudgetRecommendation = require('../models/PaidBudgetRecommendation');
const PaidMetricSnapshot = require('../models/PaidMetricSnapshot');
const ProjectJob = require('../models/ProjectJob');
const TrackingEvent = require('../models/TrackingEvent');

async function migrate() {
  await connectDatabase();
  await ConversionGoal.collection.updateMany(
    { funnelStage: { $exists: false } },
    { $set: { funnelStage: 'lead', defaultValue: 0, currency: '' } }
  );
  for (const model of [
    PaidAdAccount,
    PaidAdEntity,
    PaidMetricSnapshot,
    PaidAttribution,
    PaidBudgetRecommendation,
    TrackingEvent,
    ConversionGoal,
    GrowthAlert,
    ProjectJob
  ]) {
    await model.createIndexes();
    console.log(`Indexes ready: ${model.modelName}`);
  }
  await mongoose.connection.close(false);
}

migrate().catch(async (error) => {
  console.error(`Paid Performance migration failed: ${error.message}`);
  if (mongoose.connection.readyState !== 0) await mongoose.connection.close(false).catch(() => null);
  process.exit(1);
});
