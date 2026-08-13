const mongoose = require('mongoose');

const metricFields = [
  'impressions',
  'reach',
  'views',
  'likes',
  'comments',
  'shares',
  'quotes',
  'saves',
  'clicks',
  'videoViews',
  'watchTimeMs'
];

const metricsDefinition = metricFields.reduce((definition, field) => {
  definition[field] = { type: Number, default: null, min: 0 };
  return definition;
}, {});

const engagementSnapshotSchema = new mongoose.Schema(
  {
    projectId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Project',
      required: true,
      index: true
    },
    sourceProjectId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Project',
      required: true,
      index: true
    },
    publishJobId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'PublishJob',
      required: true,
      index: true
    },
    draftId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'SocialDraft',
      required: true,
      index: true
    },
    accountId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'SocialAccount',
      required: true,
      index: true
    },
    platform: {
      type: String,
      enum: ['bluesky', 'linkedin', 'x', 'facebook', 'instagram', 'threads', 'youtube', 'tiktok'],
      required: true,
      index: true
    },
    platformPostId: {
      type: String,
      required: true,
      trim: true
    },
    metrics: {
      type: new mongoose.Schema(metricsDefinition, { _id: false }),
      default: () => ({})
    },
    availableFields: [{ type: String, enum: metricFields }],
    unavailableFields: [{ type: String, enum: metricFields }],
    engagementTotal: {
      type: Number,
      default: null,
      min: 0
    },
    engagementRate: {
      type: Number,
      default: null,
      min: 0
    },
    providerData: {
      type: mongoose.Schema.Types.Mixed,
      default: () => ({})
    },
    capturedAt: {
      type: Date,
      required: true,
      default: Date.now,
      index: true
    }
  },
  { timestamps: true }
);

engagementSnapshotSchema.index({ publishJobId: 1, capturedAt: -1 });
engagementSnapshotSchema.index({ projectId: 1, capturedAt: -1, platform: 1 });

module.exports = mongoose.model('EngagementSnapshot', engagementSnapshotSchema);
module.exports.METRIC_FIELDS = metricFields;
