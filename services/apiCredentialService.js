const crypto = require('crypto');
const env = require('../config/env');
const ApiCredential = require('../models/ApiCredential');

const API_KEY_PREFIX = 'moyi_live';
const API_SCOPES = ['accounts:read', 'publish:write', 'jobs:read', 'analytics:read'];

function credentialHash(apiKey) {
  return crypto
    .createHmac('sha256', env.tokenEncryptionSecret)
    .update(String(apiKey))
    .digest('hex');
}

function parseApiKey(value) {
  const match = String(value || '').trim().match(/^moyi_live_([a-f0-9]{12})_([A-Za-z0-9_-]{43})$/);
  return match ? { prefix: match[1], secret: match[2] } : null;
}

function safeEqual(left, right) {
  const leftBuffer = Buffer.from(String(left || ''));
  const rightBuffer = Buffer.from(String(right || ''));
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

async function createApiCredential({ userId, name, scopes, projectIds, organizationId = null, expiresAt = null }) {
  const normalizedScopes = [...new Set((scopes || []).filter((scope) => API_SCOPES.includes(scope)))];
  const normalizedProjects = [...new Set((projectIds || []).map(String).filter(Boolean))];
  if (!normalizedScopes.length || !normalizedProjects.length) {
    const error = new Error('Choose at least one API scope and one project.');
    error.statusCode = 422;
    throw error;
  }

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const prefix = crypto.randomBytes(6).toString('hex');
    const secret = crypto.randomBytes(32).toString('base64url');
    const apiKey = `${API_KEY_PREFIX}_${prefix}_${secret}`;
    try {
      const credential = await ApiCredential.create({
        userId,
        organizationId,
        name: String(name || 'API key').trim().slice(0, 120),
        prefix,
        secretHash: credentialHash(apiKey),
        scopes: normalizedScopes,
        projectIds: normalizedProjects,
        expiresAt
      });
      return { credential, apiKey };
    } catch (error) {
      if (error && error.code === 11000) continue;
      throw error;
    }
  }
  const error = new Error('Moyi could not generate a unique API key. Try again.');
  error.statusCode = 503;
  throw error;
}

async function authenticateApiKey(apiKey, { ipAddress = '' } = {}) {
  const parsed = parseApiKey(apiKey);
  if (!parsed) return null;
  const credential = await ApiCredential.findOne({
    prefix: parsed.prefix,
    status: 'active',
    $or: [{ expiresAt: null }, { expiresAt: { $gt: new Date() } }]
  }).select('+prefix +secretHash').lean();
  if (!credential || !safeEqual(credential.secretHash, credentialHash(apiKey))) return null;

  await ApiCredential.updateOne(
    { _id: credential._id, status: 'active' },
    { $set: { lastUsedAt: new Date(), lastUsedIp: String(ipAddress || '').slice(0, 120) } }
  );
  return {
    id: credential._id,
    userId: credential.userId,
    organizationId: credential.organizationId || null,
    name: credential.name,
    scopes: credential.scopes || [],
    projectIds: (credential.projectIds || []).map(String)
  };
}

function bearerToken(req) {
  const match = String(req.get('authorization') || '').match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : '';
}

async function requireApiCredential(req, res, next) {
  try {
    const credential = await authenticateApiKey(bearerToken(req), { ipAddress: req.ip });
    if (!credential) {
      return res.status(401).json({
        error: { code: 'invalid_api_key', message: 'Provide a valid Moyi API key as a Bearer token.' }
      });
    }
    req.apiCredential = credential;
    return next();
  } catch (error) {
    return next(error);
  }
}

function requireApiScope(scope) {
  return function apiScopeMiddleware(req, res, next) {
    if (!(req.apiCredential && req.apiCredential.scopes.includes(scope))) {
      return res.status(403).json({
        error: { code: 'insufficient_scope', message: `This API key requires the ${scope} scope.` }
      });
    }
    return next();
  };
}

module.exports = {
  API_KEY_PREFIX,
  API_SCOPES,
  authenticateApiKey,
  bearerToken,
  createApiCredential,
  credentialHash,
  parseApiKey,
  requireApiCredential,
  requireApiScope
};
