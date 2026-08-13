const mongoose = require('mongoose');

const mediaAssetSchema = new mongoose.Schema(
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
    draftId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'SocialDraft',
      default: null,
      index: true
    },
    sourceContentImageId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'ContentImage',
      default: null,
      index: true
    },
    originalUrl: {
      type: String,
      default: '',
      trim: true
    },
    storageProvider: {
      type: String,
      enum: ['machine', 's3', 'remote'],
      default: 'machine'
    },
    storageKey: {
      type: String,
      default: ''
    },
    temporaryPath: {
      type: String,
      default: '',
      select: false
    },
    filename: {
      type: String,
      trim: true,
      default: ''
    },
    kind: {
      type: String,
      enum: ['image', 'video'],
      default: 'image',
      index: true
    },
    mimeType: {
      type: String,
      enum: ['image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/quicktime', 'video/webm'],
      required: true
    },
    size: {
      type: Number,
      min: 1,
      required: true
    },
    altText: {
      type: String,
      trim: true,
      default: ''
    },
    width: {
      type: Number,
      min: 1,
      default: null
    },
    height: {
      type: Number,
      min: 1,
      default: null
    },
    durationMs: {
      type: Number,
      min: 0,
      default: null
    },
    status: {
      type: String,
      enum: ['queued', 'processing', 'ready', 'failed'],
      default: 'ready',
      index: true
    },
    processingError: {
      type: String,
      default: ''
    },
    variants: {
      type: mongoose.Schema.Types.Mixed,
      default: () => ({})
    }
  },
  { timestamps: true }
);

mediaAssetSchema.index(
  { projectId: 1, sourceContentImageId: 1 },
  {
    unique: true,
    partialFilterExpression: { sourceContentImageId: { $type: 'objectId' } },
    name: 'one_media_asset_per_content_image'
  }
);
mediaAssetSchema.index({ draftId: 1, status: 1, createdAt: -1 });

module.exports = mongoose.model('MediaAsset', mediaAssetSchema);
