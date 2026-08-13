const crypto = require('crypto');
const env = require('../config/env');

function signaturePayload(assetId, variantKey, expires) {
  return `${assetId}:${variantKey}:${expires}`;
}

function sign(assetId, variantKey, expires) {
  return crypto
    .createHmac('sha256', env.tokenEncryptionSecret)
    .update(signaturePayload(assetId, variantKey, expires))
    .digest('base64url');
}

function buildPublicMediaUrl(assetId, variantKey, ttlSeconds = env.mediaPublicUrlTtlSeconds) {
  const expires = Math.floor(Date.now() / 1000) + Math.max(300, Number(ttlSeconds || 0));
  const signature = sign(String(assetId), String(variantKey), expires);
  const baseUrl = String(env.appUrl || 'http://localhost:3000').replace(/\/$/, '');
  return `${baseUrl}/social-media/public/${assetId}/${encodeURIComponent(variantKey)}?expires=${expires}&signature=${signature}`;
}

function verifyPublicMediaSignature(assetId, variantKey, expiresValue, signatureValue) {
  const expires = Number(expiresValue);
  if (!Number.isInteger(expires) || expires < Math.floor(Date.now() / 1000)) return false;
  if (expires > Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60) return false;
  const provided = Buffer.from(String(signatureValue || ''));
  const expected = Buffer.from(sign(String(assetId), String(variantKey), expires));
  return provided.length === expected.length && crypto.timingSafeEqual(provided, expected);
}

module.exports = {
  buildPublicMediaUrl,
  verifyPublicMediaSignature
};
