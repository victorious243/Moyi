const mongoose = require('mongoose');

const analyticsSnapshotSchema = new mongoose.Schema(
  {
    project: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Project',
      required: true,
      index: true
    },
    source: {
      type: String,
      enum: ['manual', 'search_console'],
      default: 'manual'
    },
    date: {
      type: Date,
      required: true
    },
    clicks: {
      type: Number,
      default: 0
    },
    impressions: {
      type: Number,
      default: 0
    },
    averagePosition: Number,
    ctr: Number,
    notes: String
  },
  { timestamps: true }
);

module.exports = mongoose.model('AnalyticsSnapshot', analyticsSnapshotSchema);
