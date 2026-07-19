const crypto = require('crypto');
const env = require('../config/env');

const ALGORITHM = 'aes-256-gcm';

function key() {
  return crypto.createHash('sha256').update(env.tokenEncryptionSecret || env.jwtSecret).digest();
}

function encrypt(value) {
  const text = String(value || '');
  if (!text) return '';

  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITHM, key(), iv);
  const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  return [iv.toString('base64'), tag.toString('base64'), encrypted.toString('base64')].join('.');
}

function decrypt(payload) {
  if (!payload) return '';

  const [ivRaw, tagRaw, encryptedRaw] = String(payload).split('.');
  if (!ivRaw || !tagRaw || !encryptedRaw) return '';

  const decipher = crypto.createDecipheriv(ALGORITHM, key(), Buffer.from(ivRaw, 'base64'));
  decipher.setAuthTag(Buffer.from(tagRaw, 'base64'));

  return Buffer.concat([
    decipher.update(Buffer.from(encryptedRaw, 'base64')),
    decipher.final()
  ]).toString('utf8');
}

module.exports = {
  decrypt,
  encrypt
};
