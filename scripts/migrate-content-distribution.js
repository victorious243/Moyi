#!/usr/bin/env node

const mongoose = require('mongoose');
const connectDatabase = require('../config/db');

const models = [
  require('../models/SocialAccount'),
  require('../models/SocialDraft'),
  require('../models/MediaAsset'),
  require('../models/PublishBatch'),
  require('../models/PublishJob'),
  require('../models/PublishJobEvent'),
  require('../models/EngagementSnapshot'),
  require('../models/GrowthSignal'),
  require('../models/PublishAction'),
  require('../models/SocialOAuthSession'),
  require('../models/Organization'),
  require('../models/OrganizationMember'),
  require('../models/ApiCredential'),
  require('../models/Project')
];

async function migrate() {
  await connectDatabase();
  const MediaAsset = mongoose.model('MediaAsset');
  const PublishJob = mongoose.model('PublishJob');
  const PublishBatch = mongoose.model('PublishBatch');
  const SocialAccount = mongoose.model('SocialAccount');
  await MediaAsset.collection.updateMany(
    { kind: { $exists: false }, mimeType: /^video\// },
    { $set: { kind: 'video' } }
  );
  await MediaAsset.collection.updateMany(
    { kind: { $exists: false } },
    { $set: { kind: 'image' } }
  );
  await MediaAsset.collection.updateMany(
    { status: { $exists: false } },
    { $set: { status: 'ready', processingError: '', variants: {} } }
  );
  await PublishJob.collection.updateMany(
    { publishOptions: { $exists: false } },
    {
      $set: {
        publishOptions: {},
        providerState: {},
        errorDetails: {},
        firstCommentId: '',
        warningMessage: '',
        'content.firstComment': ''
      }
    }
  );
  await PublishJob.collection.updateMany(
    {
      $or: [
        { destinationProjectId: null },
        { destinationProjectId: { $exists: false } }
      ]
    },
    [{ $set: { destinationProjectId: '$projectId' } }]
  );
  const publishJobDefaults = {
    maxAttempts: 4,
    manualRetryCount: 0,
    nextRetryAt: null,
    lastAttemptAt: null,
    providerDispatchStartedAt: null,
    failureKind: '',
    reconnectRequired: false,
    deadLetteredAt: null,
    deadLetterReason: '',
    metricsStatus: 'pending',
    metricsLatest: {},
    metricsAvailableFields: [],
    metricsCapturedAt: null,
    nextMetricsSyncAt: null,
    metricsSyncLockedUntil: null,
    metricsAttempts: 0,
    metricsErrorCode: '',
    metricsErrorMessage: ''
  };
  for (const [field, defaultValue] of Object.entries(publishJobDefaults)) {
    await PublishJob.collection.updateMany(
      { [field]: { $exists: false } },
      { $set: { [field]: defaultValue } }
    );
  }
  await PublishBatch.collection.updateMany(
    {
      $or: [
        { destinationProjectIds: null },
        { destinationProjectIds: { $exists: false } },
        { destinationProjectIds: { $size: 0 } }
      ]
    },
    [{ $set: { destinationProjectIds: ['$projectId'] } }]
  );
  const socialAccountDefaults = {
    reconnectRequiredAt: null,
    metricsStatus: 'pending',
    metricsStatusMessage: '',
    lastMetricsSyncAt: null
  };
  for (const [field, defaultValue] of Object.entries(socialAccountDefaults)) {
    await SocialAccount.collection.updateMany(
      { [field]: { $exists: false } },
      { $set: { [field]: defaultValue } }
    );
  }
  for (const model of models) {
    await model.createIndexes();
    console.log(`Indexes ready: ${model.modelName}`);
  }
  await mongoose.connection.close(false);
}

migrate().catch(async (error) => {
  console.error(`Content Distribution migration failed: ${error.message}`);
  if (mongoose.connection.readyState !== 0) await mongoose.connection.close(false).catch(() => null);
  process.exit(1);
});
