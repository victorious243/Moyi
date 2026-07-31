const mongoose = require('mongoose');

const contentImageSchema = new mongoose.Schema(
  {
    projectId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Project',
      required: true,
      index: true
    },
    draftId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'ContentDraft',
      required: true,
      index: true
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true
    },
    storageProvider: {
      type: String,
      enum: ['machine'],
      default: 'machine',
      required: true
    },
    storageKey: {
      type: String,
      required: true
    },
    source: {
      type: String,
      enum: ['uploaded', 'generated'],
      required: true
    },
    status: {
      type: String,
      enum: ['candidate', 'selected', 'rejected'],
      default: 'candidate',
      index: true
    },
    referenceImageId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'ContentImage',
      default: null
    },
    filename: {
      type: String,
      required: true,
      trim: true
    },
    mimeType: {
      type: String,
      enum: ['image/jpeg', 'image/png', 'image/webp'],
      required: true
    },
    byteLength: {
      type: Number,
      min: 1,
      required: true
    },
    prompt: {
      type: String,
      default: ''
    },
    guidance: {
      type: String,
      default: ''
    },
    altText: {
      type: String,
      trim: true,
      default: ''
    },
    caption: {
      type: String,
      trim: true,
      default: ''
    },
    model: {
      type: String,
      default: ''
    },
    selectedAt: {
      type: Date,
      default: null
    }
  },
  { timestamps: true }
);

contentImageSchema.index({ draftId: 1, status: 1, createdAt: -1 });
contentImageSchema.index(
  { draftId: 1, status: 1 },
  {
    unique: true,
    partialFilterExpression: { status: 'selected' },
    name: 'one_selected_image_per_draft'
  }
);

module.exports = mongoose.model('ContentImage', contentImageSchema);
