const mongoose = require('mongoose');

const searchMetricSchema = new mongoose.Schema(
  {
    projectId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Project',
      required: true,
      index: true
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true
    },
    siteUrl: {
      type: String,
      required: true,
      index: true
    },
    date: {
      type: String,
      required: true,
      index: true
    },
    query: {
      type: String,
      default: ''
    },
    page: {
      type: String,
      default: ''
    },
    country: {
      type: String,
      default: ''
    },
    device: {
      type: String,
      default: ''
    },
    clicks: {
      type: Number,
      default: 0
    },
    impressions: {
      type: Number,
      default: 0
    },
    ctr: {
      type: Number,
      default: 0
    },
    position: {
      type: Number,
      default: 0
    }
  },
  { timestamps: true }
);

searchMetricSchema.index(
  { projectId: 1, userId: 1, siteUrl: 1, date: 1, query: 1, page: 1, country: 1, device: 1 },
  { unique: true }
);

module.exports = mongoose.model('SearchMetric', searchMetricSchema);
