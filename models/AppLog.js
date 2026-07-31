const mongoose = require('mongoose');

const appLogSchema = new mongoose.Schema(
  {
    level: {
      type: String,
      enum: ['info', 'warning', 'error'],
      default: 'info',
      index: true
    },
    message: {
      type: String,
      required: true
    },
    requestId: {
      type: String,
      default: '',
      index: true
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
      index: true
    },
    path: {
      type: String,
      default: ''
    },
    method: {
      type: String,
      default: ''
    },
    statusCode: {
      type: Number,
      default: 0,
      index: true
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {}
    }
  },
  { timestamps: true }
);

appLogSchema.index({ level: 1, createdAt: -1 });

module.exports = mongoose.model('AppLog', appLogSchema);
