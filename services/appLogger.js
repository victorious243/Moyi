const crypto = require('crypto');
const AppLog = require('../models/AppLog');

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
      message: String(message).slice(0, 1000),
      requestId: req && req.requestId ? req.requestId : '',
      userId: req && req.user && req.user._id ? req.user._id : null,
      path: req && req.originalUrl ? req.originalUrl : '',
      method: req && req.method ? req.method : '',
      statusCode,
      metadata
    });
  } catch (error) {
    console.error('App log write failed:', error.message);
    return null;
  }
}

module.exports = {
  recordAppLog,
  requestIdMiddleware
};
