const env = require('../config/env');
const { getSharedRedis } = require('../services/redisService');

const memoryAttempts = new Map();

function memoryBucket(key, windowMs) {
  const now = Date.now();
  const bucket = memoryAttempts.get(key) || { count: 0, resetAt: now + windowMs };

  if (bucket.resetAt <= now) {
    bucket.count = 0;
    bucket.resetAt = now + windowMs;
  }

  bucket.count += 1;
  memoryAttempts.set(key, bucket);

  return bucket;
}

async function redisBucket(key, windowMs) {
  const redis = await getSharedRedis();
  const count = await redis.incr(key);

  if (count === 1) {
    await redis.pexpire(key, windowMs);
    return { count, resetAt: Date.now() + windowMs };
  }

  const ttl = await redis.pttl(key);
  return { count, resetAt: Date.now() + Math.max(ttl, 0) };
}

function createRateLimit({ windowMs, max, message }) {
  return async function rateLimit(req, res, next) {
    const key = req.ip || req.connection.remoteAddress || 'unknown';
    const storageKey = `rate-limit:${key}:${windowMs}:${max}`;
    let bucket;

    try {
      bucket = (env.isProduction || env.hasExplicitRedisConfig)
        ? await redisBucket(storageKey, windowMs)
        : memoryBucket(storageKey, windowMs);
    } catch (error) {
      bucket = memoryBucket(storageKey, windowMs);
    }

    if (bucket.count > max) {
      const error = new Error(message || 'Too many requests. Please try again soon.');
      error.statusCode = 429;
      const retryAfterSeconds = Math.max(1, Math.ceil((bucket.resetAt - Date.now()) / 1000));
      res.set('Retry-After', String(retryAfterSeconds));
      return next(error);
    }

    next();
  };
}

module.exports = createRateLimit;
