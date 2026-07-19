const mongoose = require('mongoose');

const shopifyIntegrationSchema = new mongoose.Schema(
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
    shopDomain: {
      type: String,
      required: true,
      trim: true,
      lowercase: true
    },
    blogId: {
      type: String,
      required: true,
      trim: true
    },
    accessToken: {
      type: String,
      required: true
    },
    apiVersion: {
      type: String,
      default: '2025-01',
      trim: true
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

shopifyIntegrationSchema.index({ projectId: 1, userId: 1 }, { unique: true });

module.exports = mongoose.model('ShopifyIntegration', shopifyIntegrationSchema);
