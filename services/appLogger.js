const crypto = require('crypto');
const AppLog = require('../models/AppLog');

const SENSITIVE_QUERY_KEYS = new Set([
  '_csrf',
  'access_token',
  'code',
  'client_secret',
  'credential',
  'refresh_token',
  'sig',
  'signature',
  'state',
  'token',
  'x-amz-credential',
  'x-amz-security-token',
  'x-amz-signature'
]);

function sanitizeLogText(value) {
  return String(value || '')
    .replace(/https?:\/\/[^\s"'<>]*\/social-media\/public\/[^\s"'<>]+/gi, '[signed media URL redacted]')
    .replace(/([?&](?:_csrf|access_token|code|client_secret|credential|refresh_token|sig|signature|state|token|x-amz-credential|x-amz-security-token|x-amz-signature)=)[^&#\s]*/gi, '$1[credential redacted]')
    .replace(/(?:access_token|refresh_token|client_secret|authorization|x-amz-signature|x-amz-credential|x-amz-security-token)["'\s:=]+[^\s,"'}&]+/gi, '[credential redacted]')
    .replace(/Bearer\s+[A-Za-z0-9._~+\/-]+=*/gi, 'Bearer [credential redacted]');
}

function sanitizeRequestPath(value) {
  const raw = String(value || '');
  try {
    const parsed = new URL(raw, 'http://moyi.local');
    for (const key of [...parsed.searchParams.keys()]) {
      if (SENSITIVE_QUERY_KEYS.has(key.toLowerCase())) parsed.searchParams.set(key, '[credential redacted]');
    }
    return `${parsed.pathname}${parsed.search}${parsed.hash}`.slice(0, 1000);
  } catch {
    return sanitizeLogText(raw).slice(0, 1000);
  }
}

function sanitizeLogMetadata(value, depth = 0) {
  if (value == null || typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'string') return sanitizeLogText(value).slice(0, 4000);
  if (depth >= 4) return '[metadata truncated]';
  if (Array.isArray(value)) return value.slice(0, 30).map((item) => sanitizeLogMetadata(item, depth + 1));
  if (typeof value !== 'object') return sanitizeLogText(value).slice(0, 1000);
  return Object.fromEntries(Object.entries(value).slice(0, 50).map(([key, item]) => {
    if (/(?:token|secret|authorization|signature|credential|oauth.*code)/i.test(key)) {
      return [key, '[credential redacted]'];
    }
    return [key, sanitizeLogMetadata(item, depth + 1)];
  }));
}

function requestIdMiddleware(req, res, next) {
  req.requestId = req.get('x-request-id') || crypto.randomBytes(12).toString('hex');
  res.setHeader('X-Request-Id', req.requestId);
  next();
}

async function recordAppLog({ level = 'info', message, req = null, statusCode = 0, metadata = {} }) {
  if (!message) return null;

  try {
    return await AppLog.create({
      level,
      message: sanitizeLogText(message).slice(0, 1000),
      requestId: req && req.requestId ? req.requestId : '',
      userId: req && req.user && req.user._id ? req.user._id : null,
      path: req && req.originalUrl ? sanitizeRequestPath(req.originalUrl) : '',
      method: req && req.method ? req.method : '',
      statusCode,
      metadata: sanitizeLogMetadata(metadata)
    });
  } catch (error) {
    console.error('App log write failed:', error.message);
    return null;
  }
}

module.exports = {
  recordAppLog,
  requestIdMiddleware,
  sanitizeLogMetadata,
  sanitizeLogText,
  sanitizeRequestPath
};
