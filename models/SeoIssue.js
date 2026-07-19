const mongoose = require('mongoose');

const seoIssueSchema = new mongoose.Schema(
  {
    project: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Project',
      required: true,
      index: true
    },
    scan: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Scan',
      required: true,
      index: true
    },
    url: {
      type: String,
      required: true
    },
    type: {
      type: String,
      required: true
    },
    severity: {
      type: String,
      enum: ['critical', 'warning', 'opportunity'],
      required: true
    },
    title: {
      type: String,
      required: true
    },
    evidence: {
      type: mongoose.Schema.Types.Mixed,
      default: {}
    },
    recommendation: {
      type: String,
      required: true
    },
    status: {
      type: String,
      enum: ['open', 'planned', 'in_review', 'resolved', 'ignored'],
      default: 'open'
    }
  },
  { timestamps: true }
);

module.exports = mongoose.model('SeoIssue', seoIssueSchema);
