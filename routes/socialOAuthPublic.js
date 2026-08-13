const express = require('express');
const asyncHandler = require('express-async-handler');
const MediaAsset = require('../models/MediaAsset');
const { openMediaDownloadStream } = require('../services/mediaStorageService');
const { verifyPublicMediaSignature } = require('../services/mediaPublicUrlService');
const {
  getBlueskyClientMetadata,
  getBlueskyJwks
} = require('../services/socialProviderService');

const router = express.Router();

router.get('/oauth-client-metadata.json', asyncHandler(async (req, res) => {
  res.set('Cache-Control', 'public, max-age=300');
  res.json(await getBlueskyClientMetadata());
}));

router.get('/.well-known/jwks.json', asyncHandler(async (req, res) => {
  res.set('Cache-Control', 'public, max-age=300');
  res.json(await getBlueskyJwks());
}));

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
