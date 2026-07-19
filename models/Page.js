const mongoose = require('mongoose');

const pageSchema = new mongoose.Schema(
  {
    projectId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Project',
      required: true,
      index: true
    },
    scanId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Scan',
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
    canonical: {
      type: String,
      default: ''
    },
    robotsMeta: {
      type: String,
      default: ''
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
    imagesCount: {
      type: Number,
      default: 0
    },
    imagesMissingAlt: {
      type: Number,
      default: 0
    },
    schemaTypes: {
      type: [String],
      default: []
    },
    openGraph: {
      title: { type: String, default: '' },
      description: { type: String, default: '' },
      image: { type: String, default: '' }
    },
    errorMessage: {
      type: String,
      default: ''
    },
    lastCrawledAt: {
      type: Date,
      default: Date.now
    }
  },
  { timestamps: true }
);

pageSchema.index({ projectId: 1, scanId: 1, url: 1 }, { unique: true });

module.exports = mongoose.model('Page', pageSchema);
