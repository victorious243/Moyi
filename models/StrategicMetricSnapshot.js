const mongoose = require('mongoose');

const strategicMetricSnapshotSchema = new mongoose.Schema({
  projectId: { type: mongoose.Schema.Types.ObjectId, ref: 'Project', required: true, index: true },
  date: { type: Date, required: true, index: true },
  metric: {
    type: String,
    enum: ['revenue', 'leads', 'qualified_leads', 'signups', 'conversions', 'conversion_rate', 'traffic', 'organic_traffic', 'paid_traffic', 'cac', 'cpa', 'roas', 'spend', 'search_impressions', 'search_clicks'],
    required: true,
    index: true
  },
  source: { type: String, enum: ['tracking', 'search_console', 'paid_ads'], required: true, index: true },
  value: { type: Number, required: true },
  numerator: { type: Number, default: null },
  denominator: { type: Number, default: null },
  unit: { type: String, default: '' },
  dimensions: { type: mongoose.Schema.Types.Mixed, default: () => ({}) },
  dimensionsKey: { type: String, default: 'all' },
  quality: {
    sampleSize: { type: Number, min: 0, default: 0 },
    completeness: { type: Number, min: 0, max: 100, default: 0 },
    confidence: { type: Number, min: 0, max: 100, default: 0 },
    caveats: { type: [String], default: [] }
  }
}, { timestamps: true });

strategicMetricSnapshotSchema.index(
  { projectId: 1, date: 1, metric: 1, source: 1, dimensionsKey: 1 },
  { unique: true }
);
strategicMetricSnapshotSchema.index({ projectId: 1, metric: 1, date: -1 });

module.exports = mongoose.model('StrategicMetricSnapshot', strategicMetricSnapshotSchema);
