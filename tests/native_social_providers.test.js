const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

const MediaAsset = require('../models/MediaAsset');
const PublishJob = require('../models/PublishJob');
const SocialAccount = require('../models/SocialAccount');
const {
  getBlueskyClientMetadata,
  nativeSocialPlatforms,
  publishWithProvider
} = require('../services/socialProviderService');

function credentials(platform) {
  const externalIds = {
    bluesky: 'did:plc:moyitest',
    x: '123456789',
    linkedin: 'urn:li:person:123456789',
    facebook: 'facebook-page-123',
    instagram: 'instagram-account-123',
    threads: 'threads-account-123',
    tiktok: 'tiktok-open-id-123',
    youtube: 'youtube-channel-123'
  };
  return {
    id: new mongoose.Types.ObjectId().toString(),
    projectId: new mongoose.Types.ObjectId().toString(),
    userId: new mongoose.Types.ObjectId().toString(),
    platform,
    accountName: `Moyi ${platform}`,
    externalAccountId: externalIds[platform],
    accessToken: platform === 'bluesky' ? '' : `sandbox_${platform}`,
    refreshToken: '',
    expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    scopes: [],
    metadata: { sandbox: true, handle: 'moyi.test' },
    status: 'connected'
  };
}

test('native provider registry exposes all Phase 2 platforms', async () => {
  assert.deepEqual(await nativeSocialPlatforms(), [
    'bluesky', 'x', 'linkedin', 'facebook', 'instagram', 'threads', 'tiktok', 'youtube'
  ]);
});

test('image-capable adapters publish through their sandbox contract', async () => {
  const image = {
    id: new mongoose.Types.ObjectId().toString(),
    kind: 'image',
    buffer: Buffer.from('sandbox-image'),
    mimeType: 'image/png',
    size: 1024,
    altText: 'Moyi publishing dashboard'
  };

  for (const platform of ['bluesky', 'x', 'linkedin', 'facebook', 'instagram', 'threads']) {
    const result = await publishWithProvider(platform, credentials(platform), {
      text: 'A human-approved Moyi post.',
      title: 'Approved update',
      body: 'A human-approved Moyi post.',
      media: image,
      mediaItems: [image],
      firstComment: 'A useful follow-up.'
    });
    assert.ok(result.platformPostId);
    assert.match(result.platformUrl, /^https:\/\//);
  }
});

test('TikTok and YouTube enforce richer options while honoring sandbox publishing', async () => {
  const image = {
    id: new mongoose.Types.ObjectId().toString(),
    kind: 'image',
    buffer: Buffer.from('sandbox-image'),
    mimeType: 'image/jpeg',
    size: 1024,
    altText: 'Moyi campaign graphic'
  };
  const video = {
    id: new mongoose.Types.ObjectId().toString(),
    kind: 'video',
    localPath: '/tmp/moyi-sandbox-video.mp4',
    mimeType: 'video/mp4',
    size: 2048,
    durationMs: 45000,
    altText: 'Moyi launch video'
  };
  const tiktok = await publishWithProvider('tiktok', credentials('tiktok'), {
    text: 'A human-approved Moyi post.',
    mediaItems: [image],
    options: {
      tiktok: {
        privacyLevel: 'SELF_ONLY',
        allowComment: true,
        musicUsageConsent: true
      }
    }
  });
  const youtube = await publishWithProvider('youtube', credentials('youtube'), {
    text: 'A human-approved Moyi video.',
    title: 'Approved video',
    mediaItems: [video],
    options: { youtube: { privacyStatus: 'private', videoType: 'short' } }
  });

  assert.match(tiktok.platformPostId, /^tiktok_sandbox_/);
  assert.match(youtube.platformPostId, /^youtube_sandbox_/);
});

test('TikTok requires explicit privacy and music consent', async () => {
  const image = {
    id: new mongoose.Types.ObjectId().toString(),
    kind: 'image',
    buffer: Buffer.from('sandbox-image'),
    mimeType: 'image/jpeg',
    size: 1024,
    altText: ''
  };
  await assert.rejects(
    () => publishWithProvider('tiktok', credentials('tiktok'), { text: 'Post', mediaItems: [image], options: { tiktok: {} } }),
    /Choose a TikTok visibility/
  );
  await assert.rejects(
    () => publishWithProvider('tiktok', credentials('tiktok'), {
      text: 'Post', mediaItems: [image], options: { tiktok: { privacyLevel: 'SELF_ONLY' } }
    }),
    /Music Usage/
  );
});

test('Bluesky adapter enforces its 300-grapheme post limit before dispatch', async () => {
  await assert.rejects(
    () => publishWithProvider('bluesky', credentials('bluesky'), { text: 'x'.repeat(301), media: null }),
    /at most 300 characters/
  );
});

test('X image publishing requires the media.write OAuth scope', async () => {
  const image = {
    id: new mongoose.Types.ObjectId().toString(),
    kind: 'image',
    buffer: Buffer.from('not-dispatched'),
    mimeType: 'image/png',
    size: 1024,
    altText: 'Moyi publishing dashboard'
  };
  const account = {
    ...credentials('x'),
    accessToken: 'live_x_token_without_media_scope',
    scopes: ['tweet.read', 'tweet.write', 'users.read', 'offline.access'],
    metadata: {}
  };

  await assert.rejects(
    () => publishWithProvider('x', account, { text: 'Post with image', media: image, mediaItems: [image] }),
    /Reconnect X to allow media uploads/
  );
});

test('X adapter rejects copy above the standard-account weighted limit before dispatch', async () => {
  await assert.rejects(
    () => publishWithProvider('x', credentials('x'), { text: 'x'.repeat(281), mediaItems: [] }),
    /must be 280 weighted characters or fewer.*281/
  );
});

test('X text publishing requires the tweet.write OAuth scope', async () => {
  const account = {
    ...credentials('x'),
    accessToken: 'live_x_token_without_write_scope',
    scopes: ['tweet.read', 'users.read', 'offline.access'],
    metadata: {}
  };

  await assert.rejects(
    () => publishWithProvider('x', account, { text: 'Approved post', mediaItems: [] }),
    /Reconnect X to grant posting permission/
  );
});

test('X account write restrictions return actionable verification guidance', async () => {
  const { providerError } = await import('../dist/distribution/provider-error.mjs');
  const error = {
    isAxiosError: true,
    message: 'Request failed with status code 403',
    response: {
      status: 403,
      data: {
        title: 'Forbidden',
        detail: 'You are not permitted to perform this action.'
      }
    }
  };

  const mapped = providerError('X', error);

  assert.equal(mapped.code, 'x_account_write_restricted');
  assert.equal(mapped.statusCode, 403);
  assert.equal(mapped.retryable, false);
  assert.match(mapped.message, /complete any email, phone, CAPTCHA/);
});

test('Bluesky publishes standards-compliant client metadata without secrets', async () => {
  const metadata = await getBlueskyClientMetadata();
  assert.equal(metadata.dpop_bound_access_tokens, true);
  assert.ok(Array.isArray(metadata.redirect_uris));
  assert.doesNotMatch(JSON.stringify(metadata), /privateJwk|accessToken|refreshToken/i);
});

test('distribution models accept rich media and provider-processing jobs', () => {
  const projectId = new mongoose.Types.ObjectId();
  const userId = new mongoose.Types.ObjectId();
  const imageId = new mongoose.Types.ObjectId();
  const account = new SocialAccount({
    projectId,
    userId,
    platform: 'bluesky',
    accountName: '@moyi.test',
    externalAccountId: 'did:plc:moyitest',
    scopes: ['atproto'],
    metadata: { oauthSessionKey: 'did:plc:moyitest' }
  });
  const media = new MediaAsset({
    projectId,
    userId,
    sourceContentImageId: imageId,
    originalUrl: 'https://moyi.example/social-drafts/draft/images/image/file',
    storageProvider: 'machine',
    storageKey: '00000000-0000-4000-8000-000000000000.png',
    mimeType: 'image/png',
    size: 1024,
    variants: {
      portrait_image: {
        status: 'ready',
        storageKey: `social-media/${imageId}/portrait_image.jpg`,
        mimeType: 'image/jpeg',
        size: 900
      }
    }
  });
  const job = new PublishJob({
    batchId: new mongoose.Types.ObjectId(),
    projectId,
    userId,
    draftId: new mongoose.Types.ObjectId(),
    accountId: new mongoose.Types.ObjectId(),
    platform: 'tiktok',
    content: { body: 'Approved copy', firstComment: 'Follow-up' },
    mediaIds: [media._id],
    status: 'provider_processing',
    publishOptions: { tiktok: { privacyLevel: 'SELF_ONLY', musicUsageConsent: true } },
    providerState: { publishId: 'publish-123' }
  });

  assert.equal(account.validateSync(), undefined);
  assert.equal(media.validateSync(), undefined);
  assert.equal(job.validateSync(), undefined);
});
