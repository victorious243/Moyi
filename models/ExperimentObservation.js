const mongoose = require('mongoose');

const experimentObservationSchema = new mongoose.Schema({
  projectId: { type: mongoose.Schema.Types.ObjectId, ref: 'Project', required: true, index: true },
  experimentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Experiment', required: true, index: true },
  variantKey: { type: String, required: true, trim: true },
  metric: { type: String, required: true, trim: true },
  metricKind: { type: String, enum: ['rate', 'continuous'], required: true },
  source: { type: String, enum: ['tracking', 'social', 'paid'], required: true },
  sourceKey: { type: String, required: true, trim: true },
  sampleSize: { type: Number, min: 0, required: true },
  successes: { type: Number, min: 0, default: null },
  sum: { type: Number, default: null },
  sumSquares: { type: Number, min: 0, default: null },
  observedFrom: { type: Date, required: true },
  observedTo: { type: Date, required: true },
  sourceRecordCount: { type: Number, min: 0, default: 0 },
  metadata: { type: mongoose.Schema.Types.Mixed, default: () => ({}) }
}, { timestamps: true });

experimentObservationSchema.index(
  { experimentId: 1, variantKey: 1, metric: 1, sourceKey: 1 },
  { unique: true }
);

module.exports = mongoose.model('ExperimentObservation', experimentObservationSchema);
