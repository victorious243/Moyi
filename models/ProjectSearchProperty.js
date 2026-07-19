const mongoose = require('mongoose');

const projectSearchPropertySchema = new mongoose.Schema(
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
    permissionLevel: {
      type: String,
      trim: true,
      default: ''
    },
    connectedAt: {
      type: Date,
      default: Date.now
    },
    lastSyncedAt: Date
  },
  { timestamps: true }
);

projectSearchPropertySchema.index({ projectId: 1, userId: 1 }, { unique: true });

module.exports = mongoose.model('ProjectSearchProperty', projectSearchPropertySchema);
