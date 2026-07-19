const mongoose = require('mongoose');

const contentDraftSchema = new mongoose.Schema(
  {
    projectId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Project',
      required: true,
      index: true
    },
    recommendationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Recommendation',
      required: true,
      index: true
    },
    targetUrl: {
      type: String,
      required: true,
      trim: true
    },
    type: {
      type: String,
      enum: [
        'meta_title',
        'meta_description',
        'h1',
        'faq_section',
        'blog_outline',
        'blog_article',
        'vs_comparison_article',
        'alternatives_list',
        'product_led_guide',
        'service_page_section',
        'internal_linking_plan',
        'schema_jsonld'
      ],
      required: true,
      index: true
    },
    keyword: {
      type: String,
      trim: true,
      default: ''
    },
    title: {
      type: String,
      trim: true,
      default: ''
    },
    body: {
      type: String,
      default: ''
    },
    jsonBody: {
      type: mongoose.Schema.Types.Mixed,
      default: null
    },
    currentValue: {
      type: String,
      default: ''
    },
    improvementReason: {
      type: String,
      default: ''
    },
    status: {
      type: String,
      enum: ['draft', 'approved', 'rejected', 'published_manually'],
      default: 'draft',
      index: true
    },
    aiModel: {
      type: String,
      default: ''
    },
    approvedAt: Date,
    publishedAt: Date
  },
  { timestamps: true }
);

module.exports = mongoose.model('ContentDraft', contentDraftSchema);
