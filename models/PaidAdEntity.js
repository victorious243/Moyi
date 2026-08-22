const mongoose = require('mongoose');

const paidAdEntitySchema = new mongoose.Schema(
  {
    projectId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Project',
      required: true,
      index: true
    },
    accountId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'PaidAdAccount',
      required: true,
      index: true
    },
    provider: {
      type: String,
      enum: ['google_ads', 'meta_ads', 'linkedin_ads', 'tiktok_ads'],
      required: true,
      index: true
    },
    level: {
      type: String,
      enum: ['campaign', 'ad_group', 'ad_set', 'creative', 'audience', 'placement'],
      required: true,
      index: true
    },
    externalId: {
      type: String,
      required: true,
      trim: true
    },
    parentExternalId: {
      type: String,
      trim: true,
      default: ''
    },
    campaignExternalId: {
      type: String,
      trim: true,
      default: '',
      index: true
    },
    name: {
      type: String,
      trim: true,
      default: ''
    },
    status: {
      type: String,
      trim: true,
      default: ''
    },
    objective: {
      type: String,
      trim: true,
      default: ''
    },
    destinationUrl: {
      type: String,
      trim: true,
      default: ''
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {}
    }
  },
  { timestamps: true }
);

paidAdEntitySchema.index(
  { accountId: 1, level: 1, externalId: 1 },
  { unique: true }
);
paidAdEntitySchema.index({ projectId: 1, provider: 1, level: 1, campaignExternalId: 1 });

module.exports = mongoose.model('PaidAdEntity', paidAdEntitySchema);

