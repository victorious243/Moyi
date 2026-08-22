const mongoose = require('mongoose');

const nullableMetric = { type: Number, default: null, min: 0 };

const paidMetricSnapshotSchema = new mongoose.Schema(
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
    entityId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'PaidAdEntity',
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
    externalEntityId: {
      type: String,
      required: true,
      trim: true
    },
    campaignExternalId: {
      type: String,
      trim: true,
      default: '',
      index: true
    },
    date: {
      type: Date,
      required: true,
      index: true
    },
    currency: {
      type: String,
      trim: true,
      uppercase: true,
      default: ''
    },
    metrics: {
      spend: nullableMetric,
      budget: nullableMetric,
      impressions: nullableMetric,
      reach: nullableMetric,
      clicks: nullableMetric,
      ctr: nullableMetric,
      cpc: nullableMetric,
      cpm: nullableMetric,
      conversions: nullableMetric,
      conversionValue: nullableMetric,
      cpa: nullableMetric,
      cac: nullableMetric,
      roas: nullableMetric,
      frequency: nullableMetric,
      leads: nullableMetric,
      qualifiedLeads: nullableMetric,
      costPerLead: nullableMetric,
      websiteSessions: nullableMetric,
      signups: nullableMetric,
      purchases: nullableMetric,
      attributedRevenue: nullableMetric
    },
    availableMetrics: {
      type: [String],
      default: []
    },
    attributionConfidence: {
      score: { type: Number, min: 0, max: 100, default: null },
      band: { type: String, enum: ['', 'low', 'medium', 'high'], default: '' },
      reason: { type: String, default: '' }
    },
    providerData: {
      type: mongoose.Schema.Types.Mixed,
      default: {}
    }
  },
  { timestamps: true }
);

paidMetricSnapshotSchema.index(
  { accountId: 1, level: 1, externalEntityId: 1, date: 1 },
  { unique: true }
);
paidMetricSnapshotSchema.index({ projectId: 1, date: -1, provider: 1, level: 1 });

module.exports = mongoose.model('PaidMetricSnapshot', paidMetricSnapshotSchema);

