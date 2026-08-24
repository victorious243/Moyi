const mongoose = require('mongoose');
const { FRESHNESS_STATES, METRIC_STATUSES } = require('../services/analytics/metricStatus');

const metricObservationSchema = new mongoose.Schema(
  {
    projectId: { type: mongoose.Schema.Types.ObjectId, ref: 'Project', required: true, index: true },
    accountId: { type: mongoose.Schema.Types.ObjectId, ref: 'SocialAccount', default: null, index: true },
    publishJobId: { type: mongoose.Schema.Types.ObjectId, ref: 'PublishJob', default: null, index: true },
    metric: { type: String, required: true, trim: true, index: true },
    normalizedFamily: {
      type: String,
      enum: ['exposure', 'unique_reach', 'engagement', 'video_consumption', 'traffic', 'lead', 'conversion', 'revenue', 'audience'],
      required: true,
      index: true
    },
    value: { type: Number, default: null, min: 0 },
    status: { type: String, enum: METRIC_STATUSES, required: true, index: true },
    source: { type: String, required: true, trim: true },
    providerMetric: { type: String, default: '', trim: true },
    platform: {
      type: String,
      enum: ['bluesky', 'linkedin', 'x', 'facebook', 'instagram', 'threads', 'youtube', 'tiktok', 'website', 'search_console'],
      required: true,
      index: true
    },
    entityType: { type: String, enum: ['post', 'account', 'session', 'conversion', 'search_property'], required: true },
    entityId: { type: String, required: true, trim: true },
    windowStart: { type: Date, default: null },
    windowEnd: { type: Date, default: null },
    observedAt: { type: Date, required: true, index: true },
    fetchedAt: { type: Date, required: true, default: Date.now },
    freshness: { type: String, enum: FRESHNESS_STATES, default: 'unknown', index: true },
    syncRunId: { type: String, default: '', index: true },
    rawValue: { type: mongoose.Schema.Types.Mixed, default: null }
  },
  { timestamps: true }
);

metricObservationSchema.index({ projectId: 1, platform: 1, metric: 1, observedAt: -1 });
metricObservationSchema.index({ projectId: 1, publishJobId: 1, metric: 1, observedAt: -1 });
metricObservationSchema.index(
  { projectId: 1, publishJobId: 1, metric: 1, syncRunId: 1 },
  { unique: true, partialFilterExpression: { syncRunId: { $type: 'string', $gt: '' } } }
);

module.exports = mongoose.model('MetricObservation', metricObservationSchema);
