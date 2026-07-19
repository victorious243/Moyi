const mongoose = require('mongoose');

const webflowIntegrationSchema = new mongoose.Schema(
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
    siteId: {
      type: String,
      trim: true,
      default: ''
    },
    collectionId: {
      type: String,
      required: true,
      trim: true
    },
    titleField: {
      type: String,
      default: 'name',
      trim: true
    },
    slugField: {
      type: String,
      default: 'slug',
      trim: true
    },
    bodyField: {
      type: String,
      default: 'post-body',
      trim: true
    },
    apiToken: {
      type: String,
      required: true
    },
    status: {
      type: String,
      enum: ['connected', 'disconnected', 'error'],
      default: 'disconnected',
      index: true
    },
    lastTestedAt: Date
  },
  { timestamps: true }
);

webflowIntegrationSchema.index({ projectId: 1, userId: 1 }, { unique: true });

module.exports = mongoose.model('WebflowIntegration', webflowIntegrationSchema);
