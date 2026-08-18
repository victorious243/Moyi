const express = require('express');
const asyncHandler = require('express-async-handler');
const env = require('../config/env');
const MediaAsset = require('../models/MediaAsset');
const { openMediaDownloadStream } = require('../services/mediaStorageService');
const { verifyPublicMediaSignature } = require('../services/mediaPublicUrlService');
const {
  getBlueskyClientMetadata,
  getBlueskyJwks
} = require('../services/socialProviderService');
const { recordAppLog } = require('../services/appLogger');

const router = express.Router();

function verifyMetaWebhookRequest(query, verifyToken) {
  const mode = String(query && query['hub.mode'] || '');
  const token = String(query && query['hub.verify_token'] || '');
  const challenge = String(query && query['hub.challenge'] || '');
  if (mode === 'subscribe' && verifyToken && token === verifyToken) {
    return { ok: true, challenge };
  }
  return { ok: false, challenge: '' };
}

router.get('/oauth-client-metadata.json', asyncHandler(async (req, res) => {
  res.set('Cache-Control', 'public, max-age=300');
  res.json(await getBlueskyClientMetadata());
}));

router.get('/.well-known/jwks.json', asyncHandler(async (req, res) => {
  res.set('Cache-Control', 'public, max-age=300');
  res.json(await getBlueskyJwks());
}));

router.get('/webhooks/meta', (req, res) => {
  const verification = verifyMetaWebhookRequest(req.query, env.metaWebhookVerifyToken);
  if (verification.ok) {
    return res.status(200).type('text/plain').send(verification.challenge);
  }
  return res.status(403).type('text/plain').send('Meta webhook verification failed.');
});

router.post('/webhooks/meta', express.json({ type: '*/*' }), (req, res) => {
  res.status(200).json({ received: true });
});

function handleTikTokWebhookGet(req, res) {
  const challenge = req.query.challenge || req.query['hub.challenge'] || req.query.tiktok_challenge;
  if (challenge) {
    return res.status(200).type('text/plain').send(String(challenge));
  }
  return res.status(200).json({ ok: true, service: 'moyi-tiktok-webhook' });
}

function handleTikTokWebhookPost(req, res) {
  const body = req.body || {};
  if (body.challenge || (body.event === 'verify_webhook' && body.challenge)) {
    return res.status(200).json({
      challenge: body.challenge,
      code: 0,
      message: 'success'
    });
  }
  recordAppLog({
    level: 'info',
    message: `[TikTokWebhook] Received event: ${body.event || 'notification'}`,
    metadata: body
  }).catch(() => null);

  return res.status(200).json({
    code: 0,
    message: 'success',
    received: true
  });
}

function handleTikTokDeauthPost(req, res) {
  const body = req.body || {};
  recordAppLog({
    level: 'info',
    message: '[TikTokDeauth] User deauthorization received',
    metadata: body
  }).catch(() => null);

  return res.status(200).json({
    code: 0,
    success: true,
    message: 'Deauthorization processed successfully'
  });
}

router.get('/webhooks/tiktok', handleTikTokWebhookGet);
router.get('/api/webhooks/tiktok', handleTikTokWebhookGet);
router.post('/webhooks/tiktok', express.json({ type: '*/*' }), handleTikTokWebhookPost);
router.post('/api/webhooks/tiktok', express.json({ type: '*/*' }), handleTikTokWebhookPost);

router.post('/api/webhooks/tiktok/deauth', express.json({ type: '*/*' }), handleTikTokDeauthPost);
router.post('/webhooks/tiktok/deauth', express.json({ type: '*/*' }), handleTikTokDeauthPost);
router.post('/auth/tiktok/deauth', express.json({ type: '*/*' }), handleTikTokDeauthPost);

router.get('/social-media/public/:assetId/:variantKey', asyncHandler(async (req, res, next) => {
  const { assetId, variantKey } = req.params;
  if (!/^[a-f\d]{24}$/i.test(assetId) || !/^(?:original|[a-z0-9_-]+)$/i.test(variantKey)) {
    return res.status(404).end();
  }
  if (!verifyPublicMediaSignature(assetId, variantKey, req.query.expires, req.query.signature)) {
    return res.status(403).end();
  }

  const asset = await MediaAsset.findOne({ _id: assetId, status: 'ready' });
  if (!asset) return res.status(404).end();
  const media = variantKey === 'original'
    ? {
        storageKey: asset.storageKey,
        mimeType: asset.mimeType,
        size: asset.size
      }
    : asset.variants && asset.variants[variantKey];
  if (!media || media.status === 'failed' || !media.storageKey) return res.status(404).end();

  const totalSize = Number(media.size || 0);
  const rangeMatch = String(req.headers.range || '').match(/^bytes=(\d+)-(\d*)$/);
  let start;
  let end;
  if (rangeMatch && totalSize > 0) {
    start = Number(rangeMatch[1]);
    end = rangeMatch[2] ? Number(rangeMatch[2]) : totalSize - 1;
    if (start >= totalSize || end < start || end >= totalSize) {
      res.set('Content-Range', `bytes */${totalSize}`);
      return res.status(416).end();
    }
    res.status(206);
    res.set('Content-Range', `bytes ${start}-${end}/${totalSize}`);
    res.set('Content-Length', String(end - start + 1));
  } else if (totalSize > 0) {
    res.set('Content-Length', String(totalSize));
  }
  res.set('Content-Type', media.mimeType || 'application/octet-stream');
  res.set('Accept-Ranges', 'bytes');
  res.set('Cache-Control', 'private, max-age=3600');
  const stream = await openMediaDownloadStream(media.storageKey, {
    ...(Number.isInteger(start) ? { start, end, range: `bytes=${start}-${end}` } : {})
  });
  stream.on('error', next);
  stream.pipe(res);
}));

module.exports = router;
module.exports.verifyMetaWebhookRequest = verifyMetaWebhookRequest;
module.exports.handleTikTokWebhookGet = handleTikTokWebhookGet;
module.exports.handleTikTokWebhookPost = handleTikTokWebhookPost;
module.exports.handleTikTokDeauthPost = handleTikTokDeauthPost;
