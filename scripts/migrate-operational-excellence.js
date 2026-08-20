#!/usr/bin/env node

const mongoose = require('mongoose');
const connectDatabase = require('../config/db');

const GrowthAlert = require('../models/GrowthAlert');
const MarketingGoal = require('../models/MarketingGoal');
const NotificationDelivery = require('../models/NotificationDelivery');
const NotificationEndpoint = require('../models/NotificationEndpoint');
const NotificationRoute = require('../models/NotificationRoute');
const Project = require('../models/Project');

const projectDefaults = {
  timezone: 'UTC',
  'cmoNotifications.dailyGrowthIntelligence.deliveryTime': '07:00',
  'cmoNotifications.dailyContentIntelligence.enabled': false,
  'cmoNotifications.dailyContentIntelligence.deliveryTime': '09:00',
  'cmoNotifications.weeklyBriefing.deliveryTime': '08:00',
  'cmoNotifications.monthlyStrategyReview.enabled': false,
  'cmoNotifications.monthlyStrategyReview.deliveryDate': 1,
  'cmoNotifications.monthlyStrategyReview.deliveryTime': '08:00',
  'cmoNotifications.channels.inApp': true,
  'cmoNotifications.channels.email': true,
  'cmoNotifications.channels.slack': false,
  'cmoNotifications.channels.teams': false,
  'cmoNotifications.channels.discord': false,
  'cmoNotifications.channels.webhook': false
};

async function migrate() {
  await connectDatabase();
  for (const [field, value] of Object.entries(projectDefaults)) {
    await Project.collection.updateMany({ [field]: { $exists: false } }, { $set: { [field]: value } });
  }
  await GrowthAlert.collection.updateMany({ channels: { $exists: false } }, { $set: { channels: ['in_app'] } });
  for (const model of [Project, GrowthAlert, MarketingGoal, NotificationDelivery, NotificationEndpoint, NotificationRoute]) {
    await model.createIndexes();
    console.log(`Indexes ready: ${model.modelName}`);
  }
  await mongoose.connection.close(false);
}

migrate().catch(async (error) => {
  console.error(`Operational Excellence migration failed: ${error.message}`);
  if (mongoose.connection.readyState !== 0) await mongoose.connection.close(false).catch(() => null);
  process.exit(1);
});
