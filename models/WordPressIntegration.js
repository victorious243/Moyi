const mongoose = require('mongoose');

const wordpressIntegrationSchema = new mongoose.Schema(
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
      trim: true
    },
    username: {
      type: String,
      required: true,
      trim: true
    },
    appPassword: {
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

wordpressIntegrationSchema.index({ projectId: 1, userId: 1 }, { unique: true });

module.exports = mongoose.model('WordPressIntegration', wordpressIntegrationSchema);
