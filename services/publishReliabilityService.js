const PublishJobEvent = require('../models/PublishJobEvent');

const PLATFORM_POLICIES = {
  bluesky: { maxAttempts: 4, baseDelayMs: 30 * 1000, maxDelayMs: 30 * 60 * 1000 },
  x: { maxAttempts: 4, baseDelayMs: 60 * 1000, maxDelayMs: 60 * 60 * 1000 },
  linkedin: { maxAttempts: 5, baseDelayMs: 2 * 60 * 1000, maxDelayMs: 2 * 60 * 60 * 1000 },
  facebook: { maxAttempts: 5, baseDelayMs: 2 * 60 * 1000, maxDelayMs: 2 * 60 * 60 * 1000 },
  instagram: { maxAttempts: 5, baseDelayMs: 2 * 60 * 1000, maxDelayMs: 2 * 60 * 60 * 1000 },
  threads: { maxAttempts: 5, baseDelayMs: 60 * 1000, maxDelayMs: 60 * 60 * 1000 },
  tiktok: { maxAttempts: 5, baseDelayMs: 5 * 60 * 1000, maxDelayMs: 4 * 60 * 60 * 1000 },
  youtube: { maxAttempts: 5, baseDelayMs: 5 * 60 * 1000, maxDelayMs: 4 * 60 * 60 * 1000 }
};

const AUTH_CODES = new Set([
  'reauthorization_required',
  'invalid_token',
  'token_expired',
  'invalid_grant',
  'social_account_disconnected',
  'oauth_exception'
]);

const PERMANENT_CODES = new Set([
  'content_too_long',
  'media_required',
  'video_required',
  'video_not_supported',
  'media_too_large',
  'too_many_media_items',
  'mixed_media_not_supported',
  'invalid_media_selection',
  'provider_disabled',
  'provider_not_configured',
  'human_approval_required',
  'post_not_found'
]);

function platformPolicy(platform) {
  return PLATFORM_POLICIES[platform] || { maxAttempts: 4, baseDelayMs: 60 * 1000, maxDelayMs: 60 * 60 * 1000 };
}

function retryAfterMs(error) {
  const raw = error && (error.retryAfterMs || error.retryAfterSeconds && Number(error.retryAfterSeconds) * 1000);
  const number = Number(raw || 0);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function classifyPublishError(error) {
  const statusCode = Number(error && error.statusCode || 0);
  const code = String(error && (error.code || error.providerCode || error.name) || 'publish_failed').toLowerCase();
  const message = String(error && error.message || '').toLowerCase();
  const reconnectRequired = AUTH_CODES.has(code) || statusCode === 401 || (
    statusCode === 403 && /(token|oauth|authorization|permission|scope|reconnect|expired)/i.test(message)
  );
  if (reconnectRequired) return { failureKind: 'authentication', reconnectRequired: true, retryable: false };
  if (statusCode === 429 || /rate.?limit|too many requests|throttl/i.test(`${code} ${message}`)) {
    return { failureKind: 'rate_limit', reconnectRequired: false, retryable: true };
  }
  if (PERMANENT_CODES.has(code) || (statusCode >= 400 && statusCode < 500 && ![408, 425, 429].includes(statusCode))) {
    return { failureKind: statusCode === 403 ? 'permission' : 'permanent', reconnectRequired: false, retryable: false };
  }
  if (error && error.retryable === true || [408, 425].includes(statusCode) || statusCode >= 500) {
    return { failureKind: 'transient', reconnectRequired: false, retryable: true };
  }
  return { failureKind: 'unknown', reconnectRequired: false, retryable: false };
}

function retryDelayMs({ platform, attempt, error }) {
  const policy = platformPolicy(platform);
  const providerDelay = retryAfterMs(error);
  const exponential = Math.min(policy.maxDelayMs, policy.baseDelayMs * (2 ** Math.max(0, Number(attempt || 1) - 1)));
  const jitter = Math.floor(exponential * 0.15 * Math.random());
  return Math.max(providerDelay, exponential + jitter);
}

function retryDecision({ job, error, protectUnknownOutcome = false }) {
  const classification = classifyPublishError(error);
  const policy = platformPolicy(job.platform);
  const maxAttempts = Math.max(1, Number(job.maxAttempts || policy.maxAttempts));
  const outcomeUnknown = Boolean(
    protectUnknownOutcome &&
    job.providerDispatchStartedAt &&
    classification.failureKind === 'transient' &&
    error && error.retrySafe !== true
  );
  const canRetry = !outcomeUnknown && classification.retryable && Number(job.attempts || 0) < maxAttempts;
  return {
    ...classification,
    ...(outcomeUnknown ? { failureKind: 'unknown', retryable: false } : {}),
    outcomeUnknown,
    maxAttempts,
    shouldRetry: canRetry,
    nextRetryAt: canRetry ? new Date(Date.now() + retryDelayMs({ platform: job.platform, attempt: job.attempts, error })) : null,
    deadLetter: !canRetry
  };
}

async function recordPublishJobEvent(job, eventType, details = {}) {
  if (!job) return null;
  return PublishJobEvent.create({
    publishJobId: job._id,
    projectId: job.projectId,
    destinationProjectId: job.destinationProjectId || job.projectId,
    eventType,
    fromStatus: details.fromStatus || '',
    toStatus: details.toStatus || job.status || '',
    attempt: Number(details.attempt ?? job.attempts ?? 0),
    errorCode: String(details.errorCode || job.errorCode || '').slice(0, 120),
    message: String(details.message || '').slice(0, 1200),
    metadata: details.metadata || {}
  }).catch(() => null);
}

module.exports = {
  PLATFORM_POLICIES,
  classifyPublishError,
  platformPolicy,
  recordPublishJobEvent,
  retryDecision,
  retryDelayMs
};
