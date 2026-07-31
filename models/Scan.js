const mongoose = require('mongoose');

const scanSchema = new mongoose.Schema(
  {
    projectId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Project',
      required: true,
      index: true
    },
    status: {
      type: String,
      enum: ['pending', 'running', 'completed', 'failed', 'cancelled'],
      default: 'pending',
      index: true
    },
    startedAt: Date,
    completedAt: Date,
    pagesFound: {
      type: Number,
      default: 0
    },
    pagesScanned: {
      type: Number,
      default: 0
    },
    currentStep: {
      type: String,
      default: ''
    },
    currentUrl: {
      type: String,
      default: ''
    },
    errorMessage: {
      type: String,
      default: ''
    }
  },
  { timestamps: true }
);

module.exports = mongoose.model('Scan', scanSchema);
