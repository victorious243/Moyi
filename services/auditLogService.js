const AuditLog = require('../models/AuditLog');

function requestContext(req = {}) {
  return {
    ipAddress: req.ip || (req.headers && (req.headers['x-forwarded-for'] || req.headers['x-real-ip'])) || '',
    userAgent: req.get ? req.get('user-agent') || '' : (req.headers && req.headers['user-agent']) || ''
  };
}

async function recordAuditEvent({
  user,
  projectId = null,
  eventType,
  severity = 'info',
  status = 'success',
  metadata = {},
  req = null
}) {
  if (!eventType) return null;

  try {
    return await AuditLog.create({
      actorUserId: user && user._id ? user._id : null,
      actorEmailSnapshot: user && user.email ? user.email : '',
      projectId,
      eventType,
      severity,
      status,
      metadata,
      ...(req ? requestContext(req) : {})
    });
  } catch (error) {
    console.error(`Audit log write failed for ${eventType}:`, error.message);
    return null;
  }
}

module.exports = {
  recordAuditEvent,
  requestContext
};
