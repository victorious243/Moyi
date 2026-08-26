#!/usr/bin/env node

const mongoose = require('mongoose');
const connectDatabase = require('../config/db');
const CalendarSavedView = require('../models/CalendarSavedView');
const SocialDraft = require('../models/SocialDraft');
const SocialDraftActivity = require('../models/SocialDraftActivity');
const SocialDraftComment = require('../models/SocialDraftComment');

async function migrate() {
  await connectDatabase();
  const legacyState = { $or: [{ reviewStatus: { $exists: false } }, { reviewStatus: 'draft' }] };

  await SocialDraft.collection.updateMany(
    { ...legacyState, publishStatus: 'pending_approval' },
    { $set: { reviewStatus: 'ready_for_review' } }
  );
  await SocialDraft.collection.updateMany(
    { ...legacyState, status: 'approved', scheduledFor: { $gt: new Date() } },
    { $set: { reviewStatus: 'scheduled' } }
  );
  await SocialDraft.collection.updateMany(
    { ...legacyState, status: 'approved' },
    { $set: { reviewStatus: 'approved' } }
  );

  for (const model of [SocialDraft, SocialDraftActivity, SocialDraftComment, CalendarSavedView]) {
    await model.createIndexes();
    console.log(`Indexes ready: ${model.modelName}`);
  }
  await mongoose.connection.close(false);
}

migrate().catch(async (error) => {
  console.error(`Calendar collaboration migration failed: ${error.message}`);
  if (mongoose.connection.readyState !== 0) await mongoose.connection.close(false).catch(() => null);
  process.exit(1);
});
