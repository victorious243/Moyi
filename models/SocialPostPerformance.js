const mongoose = require('mongoose');

const metricStateSchema = new mongoose.Schema({
  metric: { type: String, required: true },
  value: { type: Number, default: null, min: 0 },
  status: { type: String, required: true },
  source: { type: String, default: '' },
  providerMetric: { type: String, default: '' },
  observedAt: { type: Date, default: null },
  fetchedAt: { type: Date, default: null }
}, { _id: false });

const normalizedMetricSchema = new mongoose.Schema({
  family: { type: String, required: true },
  value: { type: Number, default: null, min: 0 },
  status: { type: String, required: true },
  sourceMetric: { type: String, default: '' },
  provider: { type: String, required: true },
  comparableAcrossPlatforms: { type: Boolean, default: false }
}, { _id: false });

const lifecycleWindowSchema = new mongoose.Schema({
  key: { type: String, required: true },
  targetAgeMs: { type: Number, required: true, min: 0 },
  observedAgeMs: { type: Number, default: null, min: 0 },
  complete: { type: Boolean, default: false },
  snapshotId: { type: mongoose.Schema.Types.ObjectId, ref: 'EngagementSnapshot', default: null },
  capturedAt: { type: Date, default: null },
  nativeMetrics: { type: mongoose.Schema.Types.Mixed, default: () => ({}) },
  normalizedMetrics: { type: [normalizedMetricSchema], default: [] }
}, { _id: false });

const socialPostPerformanceSchema = new mongoose.Schema({
  projectId: { type: mongoose.Schema.Types.ObjectId, ref: 'Project', required: true, index: true },
  sourceProjectId: { type: mongoose.Schema.Types.ObjectId, ref: 'Project', required: true, index: true },
  publishJobId: { type: mongoose.Schema.Types.ObjectId, ref: 'PublishJob', required: true, unique: true, index: true },
  draftId: { type: mongoose.Schema.Types.ObjectId, ref: 'SocialDraft', required: true, index: true },
  socialAccountId: { type: mongoose.Schema.Types.ObjectId, ref: 'SocialAccount', required: true, index: true },
  platform: { type: String, required: true, index: true },
  remotePostId: { type: String, required: true, trim: true },
  publishedAt: { type: Date, required: true, index: true },
  contentType: { type: String, enum: ['text', 'image', 'video', 'carousel', 'unknown'], default: 'unknown', index: true },
  campaignId: { type: mongoose.Schema.Types.ObjectId, ref: 'Campaign', default: null, index: true },
  objective: { type: String, default: '', index: true },
  promoted: { type: Boolean, default: false, index: true },
  paidStatus: { type: String, enum: ['organic', 'promoted', 'unknown'], default: 'unknown' },
  latestSnapshotId: { type: mongoose.Schema.Types.ObjectId, ref: 'EngagementSnapshot', default: null },
  latestNativeMetrics: { type: mongoose.Schema.Types.Mixed, default: () => ({}) },
  latestMetricStates: { type: [metricStateSchema], default: [] },
  latestNormalizedMetrics: { type: [normalizedMetricSchema], default: [] },
  lifecycle: { type: [lifecycleWindowSchema], default: [] },
  lifecycleCompleteness: { type: Number, min: 0, max: 1, default: 0 },
  velocity: { type: mongoose.Schema.Types.Mixed, default: () => ({}) },
  baselineComparison: { type: mongoose.Schema.Types.Mixed, default: () => ({}) },
  attribution: { type: mongoose.Schema.Types.Mixed, default: () => ({}) },
  confidence: { type: mongoose.Schema.Types.Mixed, default: () => ({ score: 0, label: 'insufficient' }) },
  performanceScore: { type: Number, min: 0, max: 100, default: null },
  scoreStatus: { type: String, enum: ['unavailable', 'provisional', 'comparable'], default: 'unavailable' },
  anomalies: { type: [mongoose.Schema.Types.Mixed], default: [] },
  counterRegressions: { type: [mongoose.Schema.Types.Mixed], default: [] },
  lastObservedAt: { type: Date, default: null, index: true },
  lastUpdatedAt: { type: Date, default: Date.now }
}, { timestamps: true });

socialPostPerformanceSchema.index({ projectId: 1, platform: 1, publishedAt: -1 });
socialPostPerformanceSchema.index({ projectId: 1, platform: 1, contentType: 1, publishedAt: -1 });
socialPostPerformanceSchema.index({ projectId: 1, campaignId: 1, publishedAt: -1 });
socialPostPerformanceSchema.index(
  { projectId: 1, platform: 1, remotePostId: 1, socialAccountId: 1 },
  { unique: true, name: 'one_canonical_social_post_per_account' }
);

module.exports = mongoose.model('SocialPostPerformance', socialPostPerformanceSchema);
