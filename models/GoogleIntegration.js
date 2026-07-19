const mongoose = require('mongoose');

const googleIntegrationSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true
    },
    provider: {
      type: String,
      enum: ['google'],
      default: 'google',
      index: true
    },
    accessToken: {
      type: String,
      required: true
    },
    refreshToken: {
      type: String,
      default: ''
    },
    scopes: {
      type: [String],
      default: []
    },
    expiresAt: Date,
    connectedAt: {
      type: Date,
      default: Date.now
    }
  },
  { timestamps: true }
);

googleIntegrationSchema.index({ userId: 1, provider: 1 }, { unique: true });

module.exports = mongoose.model('GoogleIntegration', googleIntegrationSchema);
