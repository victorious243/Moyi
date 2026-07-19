const mongoose = require('mongoose');

const competitorPageSchema = new mongoose.Schema(
  {
    projectId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Project',
      required: true,
      index: true
    },
    competitorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Competitor',
      required: true,
      index: true
    },
    url: {
      type: String,
      required: true,
      trim: true,
      index: true
    },
    statusCode: {
      type: Number,
      default: 0
    },
    title: {
      type: String,
      default: ''
    },
    metaDescription: {
      type: String,
      default: ''
    },
    h1: {
      type: [String],
      default: []
    },
    headings: {
      type: [String],
      default: []
    },
    wordCount: {
      type: Number,
      default: 0
    },
    internalLinks: {
      type: [String],
      default: []
    },
    externalLinks: {
      type: [String],
      default: []
    },
    schemaTypes: {
      type: [String],
      default: []
    },
    lastCrawledAt: {
      type: Date,
      default: Date.now
    }
  },
  { timestamps: true }
);

competitorPageSchema.index({ projectId: 1, competitorId: 1, url: 1 }, { unique: true });

module.exports = mongoose.model('CompetitorPage', competitorPageSchema);
