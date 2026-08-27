const mongoose = require('mongoose');

const variantSchema = new mongoose.Schema({
  key: { type: String, required: true, trim: true },
  name: { type: String, required: true, trim: true },
  description: { type: String, default: '' },
  isControl: { type: Boolean, default: false },
  allocationPercent: { type: Number, min: 0, max: 100, default: 50 },
  sourceRefs: { type: mongoose.Schema.Types.Mixed, default: () => ({}) },
  outcome: {
    sampleSize: { type: Number, min: 0, default: 0 },
    successes: { type: Number, min: 0, default: null },
    metricValue: { type: Number, default: null },
    upliftVsControl: { type: Number, default: null },
    confidenceVsControl: { type: Number, min: 0, max: 100, default: null }
  }
}, { _id: false });

const experimentSchema = new mongoose.Schema({
  projectId: { type: mongoose.Schema.Types.ObjectId, ref: 'Project', required: true, index: true },
  ownerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  sourceRecommendationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Recommendation', default: null, index: true },
  sourceOpportunityId: { type: mongoose.Schema.Types.ObjectId, ref: 'StrategicOpportunity', default: null, index: true },
  name: { type: String, required: true, trim: true },
  hypothesis: { type: String, required: true, trim: true },
  type: {
    type: String,
    enum: ['social_caption', 'cta', 'hook', 'creative', 'posting_time', 'email_subject', 'landing_page', 'campaign_audience', 'paid_creative', 'offer', 'messaging_angle', 'custom'],
    required: true,
    index: true
  },
  variants: {
    type: [variantSchema],
    validate: {
      validator: (variants) => Array.isArray(variants) && variants.length >= 2 && variants.filter((variant) => variant.isControl).length === 1,
      message: 'An experiment requires at least two variants and exactly one control.'
    }
  },
  primaryMetric: { type: String, required: true, trim: true },
  secondaryMetrics: { type: [String], default: [] },
  metricKind: { type: String, enum: ['rate', 'continuous'], default: 'rate' },
  measurementSource: { type: String, enum: ['tracking', 'social', 'paid'], required: true },
  measurementConfig: { type: mongoose.Schema.Types.Mixed, default: () => ({}) },
  startDate: { type: Date, default: null, index: true },
  endDate: { type: Date, default: null, index: true },
  minimumDurationDays: { type: Number, min: 1, max: 180, default: 7 },
  minimumSamplePerVariant: { type: Number, min: 2, default: 100 },
  requiredConfidence: { type: Number, min: 80, max: 99.9, default: 95 },
  audience: { type: String, default: '' },
  channel: { type: String, default: '' },
  status: {
    type: String,
    enum: ['draft', 'running', 'paused', 'winner_found', 'inconclusive', 'stopped'],
    default: 'draft',
    index: true
  },
  confidence: { type: Number, min: 0, max: 100, default: null },
  result: { type: String, default: '' },
  decision: { type: String, default: '' },
  winningVariantKey: { type: String, default: '' },
  lastEvaluatedAt: { type: Date, default: null },
  completedAt: { type: Date, default: null }
}, { timestamps: true });

experimentSchema.index({ projectId: 1, status: 1, updatedAt: -1 });
experimentSchema.index({ projectId: 1, type: 1, completedAt: -1 });

module.exports = mongoose.model('Experiment', experimentSchema);
