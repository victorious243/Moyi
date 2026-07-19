function createRateLimit({ windowMs, max, message }) {
  const attempts = new Map();

  return function rateLimit(req, res, next) {
    const key = req.ip || req.connection.remoteAddress || 'unknown';
    const now = Date.now();
    const bucket = attempts.get(key) || { count: 0, resetAt: now + windowMs };

    if (bucket.resetAt <= now) {
      bucket.count = 0;
      bucket.resetAt = now + windowMs;
    }

    bucket.count += 1;
    attempts.set(key, bucket);

    if (bucket.count > max) {
      const error = new Error(message || 'Too many requests. Please try again soon.');
      error.statusCode = 429;
      return next(error);
    }

    next();
  };
}

module.exports = createRateLimit;
