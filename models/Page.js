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
    lang: {
      type: String,
      default: ''
    },
    viewport: {
      type: String,
      default: ''
    },
    hreflangCount: {
      type: Number,
      default: 0
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
    analyticsTools: {
      type: [String],
      default: []
    },
    socialProfiles: {
      linkedin: { type: Boolean, default: false },
      instagram: { type: Boolean, default: false },
      facebook: { type: Boolean, default: false },
      x: { type: Boolean, default: false },
      youtube: { type: Boolean, default: false }
    },
    inlineStyleCount: {
      type: Number,
      default: 0
    },
    nofollowLinksCount: {
      type: Number,
      default: 0
    },
    redirectCount: {
      type: Number,
      default: 0
    },
    httpVersion: {
      type: String,
      default: ''
    },
    openGraph: {
      title: { type: String, default: '' },
      description: { type: String, default: '' },
      image: { type: String, default: '' }
    },
    twitterCard: {
      card: { type: String, default: '' },
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
