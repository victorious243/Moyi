require('dotenv').config();

function booleanFromEnv(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).trim().toLowerCase());
}

function numberFromEnv(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function validUrl(value) {
  try {
    return new URL(value);
  } catch (error) {
    return null;
  }
}

function buildMongoUri() {
  if (process.env.MONGODB_USER && process.env.MONGODB_PASSWORD && process.env.MONGODB_HOST) {
    const username = encodeURIComponent(process.env.MONGODB_USER);
    const password = encodeURIComponent(process.env.MONGODB_PASSWORD);
    const host = process.env.MONGODB_HOST;
    const query = process.env.MONGODB_QUERY || 'retryWrites=true&w=majority&appName=Cluster0';

    return `mongodb+srv://${username}:${password}@${host}/?${query}`;
  }

  return process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/moyi';
}

const nodeEnv = process.env.NODE_ENV || 'development';
const appUrl = process.env.APP_URL || `http://localhost:${process.env.PORT || '3000'}`;
const appUrlObject = validUrl(appUrl);
const disableQueue = booleanFromEnv(process.env.DISABLE_QUEUE, false);

const env = {
  nodeEnv,
  isProduction: nodeEnv === 'production',
  port: process.env.PORT || '3000',
  mongoUri: buildMongoUri(),
  mongoDbName: process.env.MONGODB_DB || '',
  jwtSecret: process.env.JWT_SECRET || 'change-me-in-production',
  tokenEncryptionSecret: process.env.TOKEN_ENCRYPTION_SECRET || process.env.JWT_SECRET || 'change-me-in-production',
  redisUrl: process.env.REDIS_URL || 'redis://127.0.0.1:6379',
  openaiApiKey: process.env.OPENAI_API_KEY || '',
  googleClientId: process.env.GOOGLE_CLIENT_ID || '',
  googleClientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
  googleRedirectUri: process.env.GOOGLE_REDIRECT_URI || '',
  stripeSecretKey: process.env.STRIPE_SECRET_KEY || '',
  stripeWebhookSecret: process.env.STRIPE_WEBHOOK_SECRET || '',
  stripeStarterPriceId: process.env.STRIPE_STARTER_PRICE_ID || '',
  stripeProPriceId: process.env.STRIPE_PRO_PRICE_ID || '',
  stripeAgencyPriceId: process.env.STRIPE_AGENCY_PRICE_ID || '',
  appUrl,
  appUrlObject,
  appName: process.env.APP_NAME || 'Moyi AI CMO',
  crawlTimeoutMs: numberFromEnv(process.env.CRAWL_TIMEOUT_MS, 12000),
  crawlDelayMs: numberFromEnv(process.env.CRAWL_DELAY_MS, 150),
  maxPagesPerScan: numberFromEnv(process.env.MAX_PAGES_PER_SCAN, 50),
  disableQueue,
  queueEnabled: !disableQueue,
  hasExplicitRedisConfig: Boolean(process.env.REDIS_URL),
  trustProxyHops: numberFromEnv(process.env.TRUST_PROXY_HOPS, nodeEnv === 'production' ? 1 : 0),
  cookieDomain: process.env.COOKIE_DOMAIN || '',
  releaseSha: process.env.RELEASE_SHA || ''
};

function runtimeConfigProblems(target = env) {
  const problems = [];
  const hasMongoConfig = Boolean(
    process.env.MONGODB_URI || (process.env.MONGODB_USER && process.env.MONGODB_PASSWORD && process.env.MONGODB_HOST)
  );

  if (!target.appUrlObject) {
    problems.push('APP_URL must be a valid absolute URL.');
  }

  if (target.isProduction) {
    if (!process.env.JWT_SECRET || target.jwtSecret === 'change-me-in-production' || target.jwtSecret.length < 32) {
      problems.push('JWT_SECRET must be set to a long random value.');
    }

    if (
      !process.env.TOKEN_ENCRYPTION_SECRET ||
      target.tokenEncryptionSecret === 'change-me-in-production' ||
      target.tokenEncryptionSecret.length < 32
    ) {
      problems.push('TOKEN_ENCRYPTION_SECRET must be set to a long random value.');
    }

    if (!hasMongoConfig) {
      problems.push('MongoDB connection details must be configured.');
    }

    if (target.appUrlObject && target.appUrlObject.protocol !== 'https:') {
      problems.push('APP_URL must use https in production.');
    }

    if (!target.queueEnabled) {
      problems.push('DISABLE_QUEUE cannot be true in production. Run Redis and the scan worker.');
    }

    if (!target.redisUrl) {
      problems.push('REDIS_URL must be configured in production.');
    }

    if (target.trustProxyHops < 1) {
      problems.push('TRUST_PROXY_HOPS must be at least 1 in production.');
    }
  }

  if (target.crawlTimeoutMs < 1000) {
    problems.push('CRAWL_TIMEOUT_MS must be at least 1000.');
  }

  if (target.crawlDelayMs < 0) {
    problems.push('CRAWL_DELAY_MS cannot be negative.');
  }

  if (target.maxPagesPerScan < 1) {
    problems.push('MAX_PAGES_PER_SCAN must be at least 1.');
  }

  return problems;
}

function runtimeConfigWarnings(target = env) {
  const warnings = [];
  const hasGoogleConfig = Boolean(target.googleClientId && target.googleClientSecret && target.googleRedirectUri);
  const hasSomeGoogleConfig = Boolean(target.googleClientId || target.googleClientSecret || target.googleRedirectUri);
  const hasStripeConfig = Boolean(
    target.stripeSecretKey &&
    target.stripeWebhookSecret &&
    target.stripeStarterPriceId &&
    target.stripeProPriceId &&
    target.stripeAgencyPriceId
  );
  const hasSomeStripeConfig = Boolean(
    target.stripeSecretKey ||
    target.stripeWebhookSecret ||
    target.stripeStarterPriceId ||
    target.stripeProPriceId ||
    target.stripeAgencyPriceId
  );

  if (!target.openaiApiKey) {
    warnings.push('OPENAI_API_KEY is not configured. AI strategy generation will use fallback behavior or fail gracefully.');
  }

  if (hasSomeGoogleConfig && !hasGoogleConfig) {
    warnings.push('Google OAuth is only partially configured. Sign-in and Search Console routes will be unreliable until all Google env vars are set.');
  }

  if (hasSomeStripeConfig && !hasStripeConfig) {
    warnings.push('Stripe is only partially configured. Billing routes require STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, and all plan price IDs.');
  }

  return warnings;
}

function assertRuntimeConfig() {
  const problems = runtimeConfigProblems();
  if (!problems.length) return;

  const error = new Error(`Invalid runtime configuration:\n- ${problems.join('\n- ')}`);
  error.code = 'invalid_runtime_config';
  throw error;
}

module.exports = {
  ...env,
  assertRuntimeConfig,
  booleanFromEnv,
  numberFromEnv,
  runtimeConfigProblems,
  runtimeConfigWarnings,
  validUrl
};
