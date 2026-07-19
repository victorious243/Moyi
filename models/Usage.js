const mongoose = require('mongoose');

const usageSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true
    },
    periodStart: {
      type: Date,
      required: true,
      index: true
    },
    periodEnd: {
      type: Date,
      required: true,
      index: true
    },
    scansUsed: {
      type: Number,
      default: 0
    },
    aiReportsUsed: {
      type: Number,
      default: 0
    },
    contentDraftsUsed: {
      type: Number,
      default: 0
    },
    searchConsoleSyncsUsed: {
      type: Number,
      default: 0
    }
  },
  { timestamps: true }
);

usageSchema.index({ userId: 1, periodStart: 1, periodEnd: 1 }, { unique: true });

module.exports = mongoose.model('Usage', usageSchema);
