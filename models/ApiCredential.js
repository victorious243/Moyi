const mongoose = require('mongoose');

const apiCredentialSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true
    },
    organizationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Organization',
      default: null,
      index: true
    },
    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 120
    },
    prefix: {
      type: String,
      required: true,
      unique: true,
      index: true,
      select: false
    },
    secretHash: {
      type: String,
      required: true,
      unique: true,
      select: false
    },
    scopes: [{
      type: String,
      enum: ['accounts:read', 'publish:write', 'jobs:read', 'analytics:read']
    }],
    projectIds: [{
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Project'
    }],
    status: {
      type: String,
      enum: ['active', 'revoked'],
      default: 'active',
      index: true
    },
    expiresAt: {
      type: Date,
      default: null,
      index: true
    },
    lastUsedAt: {
      type: Date,
      default: null
    },
    lastUsedIp: {
      type: String,
      default: ''
    }
  },
  { timestamps: true }
);

apiCredentialSchema.index({ userId: 1, status: 1, createdAt: -1 });

module.exports = mongoose.model('ApiCredential', apiCredentialSchema);
