const mongoose = require('mongoose');

const intelloArticleSchema = new mongoose.Schema(
  {
    slug: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      lowercase: true,
      index: true
    },
    title: {
      type: String,
      required: true,
      trim: true
    },
    seoTitle: {
      type: String,
      trim: true,
      default: ''
    },
    seoDescription: {
      type: String,
      trim: true,
      default: ''
    },
    primaryKeyword: {
      type: String,
      required: true,
      trim: true,
      index: true
    },
    secondaryKeywords: {
      type: [String],
      default: []
    },
    category: {
      type: String,
      enum: [
        'seo_rankings',
        'search_console',
        'social_distribution',
        'conversion_cro',
        'competitor_intel',
        'marketing_strategy'
      ],
      default: 'seo_rankings',
      index: true
    },
    struggleSummary: {
      type: String,
      required: true,
      trim: true
    },
    struggleSymptoms: {
      type: [String],
      default: []
    },
    rootCauseAnalysis: {
      type: String,
      default: ''
    },
    manualSolution: {
      type: String,
      default: ''
    },
    howMoyiSolves: {
      type: String,
      default: ''
    },
    articleContent: {
      type: String,
      required: true
    },
    jsonBody: {
      type: mongoose.Schema.Types.Mixed,
      default: {}
    },
    faqs: [
      {
        question: { type: String, required: true },
        answer: { type: String, required: true }
      }
    ],
    sources: {
      type: [String],
      default: []
    },
    internalLinks: [
      {
        targetUrl: { type: String, required: true },
        anchorText: { type: String, required: true },
        reason: { type: String, default: '' }
      }
    ],
    socialDistribution: {
      linkedIn: { type: String, default: '' },
      x: { type: String, default: '' },
      facebook: { type: String, default: '' }
    },
    readingTimeMinutes: {
      type: Number,
      default: 5
    },
    status: {
      type: String,
      enum: ['draft', 'awaiting_review', 'published', 'rejected', 'archived'],
      default: 'awaiting_review',
      index: true
    },
    publishedAt: {
      type: Date,
      default: null,
      index: true
    },
    viewCount: {
      type: Number,
      default: 0
    },
    sourceProjectId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Project',
      default: null
    },
    sourceContentDraftId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'ContentDraft',
      default: null
    },
    approvedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null
    },
    approvedAt: {
      type: Date,
      default: null
    },
    operatorNotes: {
      type: String,
      default: ''
    }
  },
  {
    timestamps: true
  }
);

intelloArticleSchema.index({ status: 1, publishedAt: -1 });
intelloArticleSchema.index({ category: 1, status: 1 });

module.exports = mongoose.model('IntelloArticle', intelloArticleSchema);
