const VARIANT_PROFILES = Object.freeze({
  square: { ratio: '1:1', width: 1080, height: 1080 },
  portrait: { ratio: '4:5', width: 1080, height: 1350 },
  vertical: { ratio: '9:16', width: 1080, height: 1920 },
  landscape: { ratio: '16:9', width: 1920, height: 1080 }
});

const PLATFORM_CAPABILITIES = Object.freeze({
  bluesky: { text: true, images: 4, videos: 0, mixed: false, firstComment: false },
  x: { text: true, images: 4, videos: 0, mixed: false, firstComment: false },
  linkedin: { text: true, images: 20, videos: 1, mixed: false, firstComment: true },
  facebook: { text: true, images: 10, videos: 1, mixed: false, firstComment: true },
  instagram: { text: false, images: 10, videos: 10, mixed: true, firstComment: true },
  threads: { text: true, images: 20, videos: 20, mixed: true, firstComment: false },
  tiktok: { text: false, images: 35, videos: 1, mixed: false, firstComment: false },
  youtube: { text: false, images: 1, videos: 1, mixed: true, firstComment: false }
});

const PLATFORM_MEDIA_LIMITS = Object.freeze({
  bluesky: { imageBytes: 1_000_000 },
  x: { imageBytes: 5 * 1024 * 1024 },
  linkedin: { imageBytes: 10 * 1024 * 1024, videoBytes: 5 * 1024 * 1024 * 1024, videoMinMs: 3000, videoMaxMs: 30 * 60 * 1000 },
  facebook: { imageBytes: 10 * 1024 * 1024, videoBytes: 10 * 1024 * 1024 * 1024, videoMaxMs: 240 * 60 * 1000 },
  instagram: { imageBytes: 8 * 1024 * 1024, videoBytes: 1024 * 1024 * 1024, videoMinMs: 3000, videoMaxMs: 15 * 60 * 1000 },
  threads: { imageBytes: 8 * 1024 * 1024, videoBytes: 1024 * 1024 * 1024, videoMaxMs: 5 * 60 * 1000 },
  tiktok: { imageBytes: 20 * 1024 * 1024, videoBytes: 4 * 1024 * 1024 * 1024, videoMaxMs: 10 * 60 * 1000 },
  youtube: { imageBytes: 2 * 1024 * 1024, videoBytes: 256 * 1024 * 1024 * 1024, videoMaxMs: 12 * 60 * 60 * 1000 }
});

function variantKey(profile, kind) {
  if (!VARIANT_PROFILES[profile]) throw new Error(`Unknown media profile: ${profile}`);
  if (!['image', 'video'].includes(kind)) throw new Error(`Unknown media kind: ${kind}`);
  return `${profile}_${kind}`;
}

function preferredProfile(platform, kind, publishOptions = {}) {
  if (platform === 'youtube') {
    if (kind === 'image') return 'landscape';
    return publishOptions.youtube && publishOptions.youtube.videoType === 'short' ? 'vertical' : 'landscape';
  }
  if (platform === 'instagram') return kind === 'video' ? 'vertical' : 'portrait';
  if (platform === 'tiktok') return 'vertical';
  if (platform === 'threads') return kind === 'video' ? 'vertical' : 'portrait';
  return 'landscape';
}

function selectedVariant(asset, platform, publishOptions = {}) {
  const profile = preferredProfile(platform, asset.kind, publishOptions);
  const key = variantKey(profile, asset.kind);
  const variants = asset.variants || {};
  const variant = variants[key];
  if (variant && variant.status === 'ready' && variant.storageKey) return { key, ...variant };
  if (asset.storageKey && asset.status === 'ready') {
    return {
      key: 'original',
      storageKey: asset.storageKey,
      mimeType: asset.mimeType,
      size: asset.size,
      width: asset.width,
      height: asset.height,
      durationMs: asset.durationMs
    };
  }
  return null;
}

function mediaError(message, code = 'unsupported_media') {
  const error = new Error(message);
  error.code = code;
  error.statusCode = 422;
  return error;
}

function validatePlatformMedia(platform, assets, publishOptions = {}, validationOptions = {}) {
  const capabilities = PLATFORM_CAPABILITIES[platform];
  if (!capabilities) throw mediaError(`Moyi does not know the media rules for ${platform}.`);
  const media = Array.isArray(assets) ? assets : [];
  const images = media.filter((asset) => asset.kind === 'image');
  const videos = media.filter((asset) => asset.kind === 'video');

  if (!validationOptions.allowProcessing && media.some((asset) => asset.status !== 'ready')) {
    throw mediaError('One or more selected media files are still processing.', 'media_not_ready');
  }
  if (images.length > capabilities.images) {
    throw mediaError(`${platform} accepts at most ${capabilities.images} image${capabilities.images === 1 ? '' : 's'} in this publishing flow.`, 'too_many_media_items');
  }
  if (videos.length > capabilities.videos) {
    throw mediaError(`${platform} accepts at most ${capabilities.videos} video${capabilities.videos === 1 ? '' : 's'} in this publishing flow.`, 'too_many_media_items');
  }
  if (!capabilities.mixed && images.length && videos.length) {
    throw mediaError(`${platform} does not support mixed image and video posts in this publishing flow.`, 'mixed_media_not_supported');
  }
  if (platform === 'instagram' && media.length === 0) {
    throw mediaError('Instagram requires at least one image or video.', 'media_required');
  }
  if (platform === 'tiktok' && media.length === 0) {
    throw mediaError('TikTok requires a video or one or more images.', 'media_required');
  }
  if (platform === 'youtube') {
    if (videos.length !== 1) throw mediaError('YouTube publishing requires exactly one video.', 'video_required');
    if (images.length > 1) throw mediaError('YouTube accepts at most one custom thumbnail.', 'too_many_media_items');
    const isShort = publishOptions.youtube && publishOptions.youtube.videoType === 'short';
    if (isShort && videos[0].durationMs && videos[0].durationMs > 180000) {
      throw mediaError('YouTube Shorts must be three minutes or shorter.', 'video_too_long');
    }
  }
  if (platform === 'facebook' && videos.length && media.length > 1) {
    throw mediaError('Facebook video posts currently accept one video without additional carousel items.', 'mixed_media_not_supported');
  }
  if (platform === 'linkedin' && videos.length && media.length > 1) {
    throw mediaError('LinkedIn video posts currently accept one video without additional images.', 'mixed_media_not_supported');
  }
  const limits = PLATFORM_MEDIA_LIMITS[platform] || {};
  for (const video of videos) {
    if (video.durationMs && limits.videoMinMs && video.durationMs < limits.videoMinMs) {
      throw mediaError(`${platform} videos must be at least ${Math.ceil(limits.videoMinMs / 1000)} seconds long.`, 'video_too_short');
    }
    if (video.durationMs && limits.videoMaxMs && video.durationMs > limits.videoMaxMs) {
      throw mediaError(`${platform} videos must be ${Math.floor(limits.videoMaxMs / 60000)} minutes or shorter.`, 'video_too_long');
    }
  }
  return capabilities;
}

function validatePreparedMedia(platform, media) {
  const limits = PLATFORM_MEDIA_LIMITS[platform];
  if (!limits) throw mediaError(`Moyi does not know the media limits for ${platform}.`);
  if (media.kind === 'image' && limits.imageBytes && media.size > limits.imageBytes) {
    throw mediaError(`The processed image exceeds ${Math.round(limits.imageBytes / 1024 / 1024)} MB for ${platform}.`, 'image_too_large');
  }
  if (media.kind === 'video' && limits.videoBytes && media.size > limits.videoBytes) {
    throw mediaError(`The processed video exceeds ${Math.round(limits.videoBytes / 1024 / 1024)} MB for ${platform}.`, 'video_too_large');
  }
  if (media.kind === 'video' && media.durationMs && limits.videoMinMs && media.durationMs < limits.videoMinMs) {
    throw mediaError(`${platform} videos must be at least ${Math.ceil(limits.videoMinMs / 1000)} seconds long.`, 'video_too_short');
  }
  if (media.kind === 'video' && media.durationMs && limits.videoMaxMs && media.durationMs > limits.videoMaxMs) {
    throw mediaError(`${platform} videos must be ${Math.floor(limits.videoMaxMs / 60000)} minutes or shorter.`, 'video_too_long');
  }
  return media;
}

module.exports = {
  PLATFORM_CAPABILITIES,
  PLATFORM_MEDIA_LIMITS,
  VARIANT_PROFILES,
  preferredProfile,
  selectedVariant,
  validatePlatformMedia,
  validatePreparedMedia,
  variantKey
};
