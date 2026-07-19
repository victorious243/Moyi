const mongoose = require('mongoose');

const competitorSchema = new mongoose.Schema(
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
    name: {
      type: String,
      required: true,
      trim: true
    },
    websiteUrl: {
      type: String,
      required: true,
      trim: true
    },
    notes: {
      type: String,
      default: ''
    }
  },
  { timestamps: true }
);

competitorSchema.index({ projectId: 1, userId: 1, websiteUrl: 1 }, { unique: true });

module.exports = mongoose.model('Competitor', competitorSchema);
