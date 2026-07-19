const mongoose = require('mongoose');

const recommendationSchema = new mongoose.Schema(
  {
    projectId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Project',
      required: true,
      index: true
    },
    auditId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Scan',
      required: true,
      index: true
    },
    title: {
      type: String,
      required: true,
      trim: true
    },
    category: {
      type: String,
      trim: true,
      default: ''
    },
    priority: {
      type: Number,
      min: 1,
      max: 5,
      required: true
    },
    reason: {
      type: String,
      default: ''
    },
    expectedImpact: {
      type: String,
      default: ''
    },
    effort: {
      type: String,
      enum: ['low', 'medium', 'high'],
      default: 'medium'
    },
    actionType: {
      type: String,
      enum: ['fix_metadata', 'content', 'new_page', 'internal_linking', 'schema', 'technical', 'performance'],
      required: true
    },
    relatedIssueIds: [{
      type: mongoose.Schema.Types.ObjectId,
      ref: 'SeoIssue'
    }],
    targetUrls: {
      type: [String],
      default: []
    },
    status: {
      type: String,
      enum: ['pending', 'accepted', 'rejected', 'in_progress', 'done'],
      default: 'pending',
      index: true
    }
  },
  { timestamps: true }
);

module.exports = mongoose.model('Recommendation', recommendationSchema);
