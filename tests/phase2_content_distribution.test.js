const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const mongoose = require('mongoose');
const sharp = require('sharp');

const {
  PLATFORM_CAPABILITIES,
  PLATFORM_MEDIA_LIMITS,
  preferredProfile,
  selectedVariant,
  validatePlatformMedia,
  variantKey
} = require('../services/mediaProfileService');
const {
  buildPublicMediaUrl,
  verifyPublicMediaSignature
} = require('../services/mediaPublicUrlService');
const { generatedStorageKeys, runProcess } = require('../services/mediaProcessingService');
const { managedTemporaryPath } = require('../services/mediaAssetCleanupService');
const { safeErrorDetails, safeErrorMessage } = require('../services/contentDistributionEngineService');
const { defaultMediaAssetsForPlatform } = require('../services/contentDistributionEngineService');
const { sanitizeLogMetadata, sanitizeRequestPath } = require('../services/appLogger');
const env = require('../config/env');
const { getTikTokCreatorInfo } = require('../services/socialProviderService');

function asset(kind, overrides = {}) {
  const id = new mongoose.Types.ObjectId();
  return {
    _id: id,
    id: String(id),
    kind,
    status: 'ready',
    mimeType: kind === 'image' ? 'image/jpeg' : 'video/mp4',
    size: 1024,
    storageKey: `social-media/${id}/original.${kind === 'image' ? 'jpg' : 'mp4'}`,
    variants: {},
    durationMs: kind === 'video' ? 60000 : null,
    ...overrides
  };
}

test('platform capability map covers every native provider', () => {
  assert.deepEqual(Object.keys(PLATFORM_CAPABILITIES), [
    'bluesky', 'x', 'linkedin', 'facebook', 'instagram', 'threads', 'tiktok', 'youtube'
  ]);
  assert.equal(PLATFORM_CAPABILITIES.instagram.mixed, true);
  assert.equal(PLATFORM_CAPABILITIES.threads.images, 20);
  assert.equal(PLATFORM_CAPABILITIES.tiktok.images, 35);
  assert.equal(PLATFORM_MEDIA_LIMITS.tiktok.videoBytes, 4 * 1024 * 1024 * 1024);
  assert.equal(PLATFORM_MEDIA_LIMITS.youtube.imageBytes, 2 * 1024 * 1024);
});

test('variant selection follows platform shape and YouTube video mode', () => {
  assert.equal(preferredProfile('instagram', 'image'), 'portrait');
  assert.equal(preferredProfile('instagram', 'video'), 'vertical');
  assert.equal(preferredProfile('tiktok', 'video'), 'vertical');
  assert.equal(preferredProfile('youtube', 'video', { youtube: { videoType: 'short' } }), 'vertical');
  assert.equal(preferredProfile('youtube', 'video', { youtube: { videoType: 'regular' } }), 'landscape');
  assert.equal(preferredProfile('youtube', 'image', { youtube: { videoType: 'short' } }), 'landscape');
  assert.equal(variantKey('portrait', 'image'), 'portrait_image');

  const image = asset('image');
  image.variants.portrait_image = {
    status: 'ready', storageKey: `social-media/${image._id}/portrait_image.jpg`, mimeType: 'image/jpeg', size: 900
  };
  const selected = selectedVariant(image, 'instagram');
  assert.equal(selected.key, 'portrait_image');
});

test('TikTok chunk planning keeps uploads within its final-chunk rules', async () => {
  const { chunkPlan } = await import('../dist/distribution/providers/tiktok.mjs');
  assert.deepEqual(chunkPlan(4 * 1024 * 1024), { chunkSize: 4 * 1024 * 1024, totalChunkCount: 1 });
  const plan = chunkPlan(65 * 1024 * 1024);
  assert.equal(plan.totalChunkCount, 2);
  assert.ok(plan.chunkSize >= 5 * 1024 * 1024);
  assert.ok(65 * 1024 * 1024 - plan.chunkSize <= 128 * 1024 * 1024);
  assert.throws(() => chunkPlan(4 * 1024 * 1024 * 1024 + 1), /no larger than 4 GB/);
});

test('media validation enforces required media, mixed-media rules, and Shorts duration', () => {
  const image = asset('image');
  const video = asset('video');
  assert.throws(() => validatePlatformMedia('instagram', []), /requires at least one image or video/);
  assert.throws(() => validatePlatformMedia('facebook', [image, video]), /does not support mixed image and video/);
  assert.throws(() => validatePlatformMedia('linkedin', [image, video]), /does not support mixed image and video/);
  assert.throws(() => validatePlatformMedia('youtube', [image]), /exactly one video/);
  assert.throws(
    () => validatePlatformMedia('youtube', [asset('video', { durationMs: 180001 })], { youtube: { videoType: 'short' } }),
    /three minutes or shorter/
  );
  assert.doesNotThrow(() => validatePlatformMedia('threads', [image, video]));
  assert.doesNotThrow(() => validatePlatformMedia('youtube', [video, image], { youtube: { videoType: 'regular' } }));
});

test('image variants preserve the full creative instead of cropping text edges', async () => {
  const workingDirectory = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'moyi-variant-test-'));
  try {
    const sourcePath = path.join(workingDirectory, 'wide.png');
    await sharp({
      create: {
        width: 2000,
        height: 1000,
        channels: 3,
        background: '#ffffff'
      }
    })
      .composite([
        { input: await sharp({ create: { width: 80, height: 1000, channels: 3, background: '#ff0000' } }).png().toBuffer(), left: 0, top: 0 },
        { input: await sharp({ create: { width: 80, height: 1000, channels: 3, background: '#0000ff' } }).png().toBuffer(), left: 1920, top: 0 }
      ])
      .png()
      .toFile(sourcePath);

    const { renderImageVariant } = require('../services/mediaProcessingService');
    const square = await renderImageVariant(sourcePath, { width: 1080, height: 1080 });
    const leftPixel = await sharp(square).extract({ left: 4, top: 540, width: 1, height: 1 }).raw().toBuffer();
    const rightPixel = await sharp(square).extract({ left: 1075, top: 540, width: 1, height: 1 }).raw().toBuffer();
    assert.ok(leftPixel[0] > 180 && leftPixel[1] < 80 && leftPixel[2] < 80);
    assert.ok(rightPixel[2] > 180 && rightPixel[0] < 80 && rightPixel[1] < 80);
  } finally {
    await fs.promises.rm(workingDirectory, { recursive: true, force: true });
  }
});

test('signed public media URLs reject tampering and expired signatures', () => {
  const assetId = new mongoose.Types.ObjectId().toString();
  const url = new URL(buildPublicMediaUrl(assetId, 'vertical_video', 600));
  const expires = url.searchParams.get('expires');
  const signature = url.searchParams.get('signature');

  assert.equal(verifyPublicMediaSignature(assetId, 'vertical_video', expires, signature), true);
  assert.equal(verifyPublicMediaSignature(assetId, 'portrait_video', expires, signature), false);
  assert.equal(verifyPublicMediaSignature(new mongoose.Types.ObjectId(), 'vertical_video', expires, signature), false);
  assert.equal(verifyPublicMediaSignature(assetId, 'vertical_video', 1, signature), false);
});

test('TikTok creator-info sandbox exposes only private visibility before audit', async () => {
  const creator = await getTikTokCreatorInfo({
    id: new mongoose.Types.ObjectId().toString(),
    projectId: new mongoose.Types.ObjectId().toString(),
    userId: new mongoose.Types.ObjectId().toString(),
    platform: 'tiktok',
    accountName: '@moyi-test',
    externalAccountId: 'open-id',
    accessToken: 'sandbox_tiktok',
    refreshToken: 'sandbox_refresh',
    expiresAt: null,
    scopes: ['video.publish'],
    metadata: { sandbox: true },
    status: 'connected'
  });
  assert.deepEqual(creator.privacyLevelOptions, ['SELF_ONLY']);
  assert.equal(creator.maxVideoPostDurationSeconds, 600);
});

test('media command failures produce a stable missing-FFmpeg error code', async () => {
  await assert.rejects(
    () => runProcess('/definitely-not-installed/moyi-ffmpeg', ['-version'], { timeoutMs: 1000 }),
    (error) => error.code === 'ffmpeg_not_installed' && /not installed/.test(error.message)
  );
});

test('publishing and request logs redact OAuth credentials and signed media URLs', () => {
  const signedUrl = 'https://moyi.example/social-media/public/507f1f77bcf86cd799439011/vertical_video?expires=2000000000&signature=super-secret';
  const message = safeErrorMessage(new Error(`Provider could not fetch ${signedUrl} with access_token=token-value`));
  const details = safeErrorDetails({ mediaUrl: signedUrl, authorization: 'Bearer token-value' });
  const requestPath = sanitizeRequestPath('/integrations/social/meta/callback?code=oauth-code&state=oauth-state&next=%2Fprojects');
  const metadata = sanitizeLogMetadata({ stack: `Request failed at ${signedUrl}`, refreshToken: 'refresh-value' });

  assert.doesNotMatch(message, /super-secret|token-value|social-media\/public/);
  assert.doesNotMatch(JSON.stringify(details), /super-secret|token-value|social-media\/public/);
  assert.doesNotMatch(requestPath, /oauth-code|oauth-state/);
  assert.doesNotMatch(JSON.stringify(metadata), /super-secret|refresh-value|social-media\/public/);
});

test('temporary media cleanup only accepts files inside the configured upload directory', () => {
  assert.equal(
    managedTemporaryPath(`${env.mediaUploadTempPath}/upload-123`),
    `${env.mediaUploadTempPath}/upload-123`
  );
  assert.equal(managedTemporaryPath(`${env.mediaUploadTempPath}-other/upload-123`), '');
  assert.equal(managedTemporaryPath('/etc/passwd'), '');
});

test('final media cleanup covers every deterministic object from earlier retries', () => {
  const id = new mongoose.Types.ObjectId();
  const keys = generatedStorageKeys({
    _id: id,
    kind: 'video',
    mimeType: 'video/quicktime',
    storageKey: '',
    variants: {}
  });

  assert.equal(keys.length, 5);
  assert.ok(keys.includes(`social-media/${id}/original.mov`));
  assert.ok(keys.includes(`social-media/${id}/square_video.mp4`));
  assert.ok(keys.includes(`social-media/${id}/landscape_video.mp4`));
});

test('bulk publishing chooses platform-safe media defaults without an aggregator', () => {
  const images = [asset('image'), asset('image')];
  const video = asset('video');
  const media = [...images, video];

  assert.deepEqual(defaultMediaAssetsForPlatform('youtube', media), [video, images[0]]);
  assert.deepEqual(defaultMediaAssetsForPlatform('tiktok', media), [video]);
  assert.deepEqual(defaultMediaAssetsForPlatform('facebook', media), [video]);
  assert.deepEqual(defaultMediaAssetsForPlatform('x', media), images);
  assert.deepEqual(defaultMediaAssetsForPlatform('instagram', media), media);
});
