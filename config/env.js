require('dotenv').config({ quiet: true });
const path = require('path');

const MIN_NODE_VERSION = '20.19.0';

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

function normalizeCookieDomain(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';

  if (/^https?:\/\//i.test(raw)) {
    const parsed = validUrl(raw);
    return parsed ? parsed.hostname : raw;
  }

  return raw
    .replace(/^Domain=/i, '')
    .replace(/;.*$/, '')
    .replace(/\/.*$/, '')
    .trim();
}

function compareVersions(actual, minimum) {
  const actualParts = String(actual || '').split('.').map((part) => Number(part));
  const minimumParts = String(minimum || '').split('.').map((part) => Number(part));
  for (let index = 0; index < 3; index += 1) {
    const actualPart = Number.isFinite(actualParts[index]) ? actualParts[index] : 0;
    const minimumPart = Number.isFinite(minimumParts[index]) ? minimumParts[index] : 0;
    if (actualPart > minimumPart) return 1;
    if (actualPart < minimumPart) return -1;
  }
  return 0;
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
  openaiImageModel: process.env.OPENAI_IMAGE_MODEL || 'gpt-image-2',
  openaiImageQuality: process.env.OPENAI_IMAGE_QUALITY || 'high',
  openaiImageSize: process.env.OPENAI_IMAGE_SIZE || 'auto',
  contentAiTimeoutMs: numberFromEnv(process.env.CONTENT_AI_TIMEOUT_MS, 60000),
  contentPipelineConcurrency: numberFromEnv(process.env.CONTENT_PIPELINE_CONCURRENCY, 3),
  contentImageStorageProvider: process.env.CONTENT_IMAGE_STORAGE_PROVIDER || 'machine',
  contentImageStoragePath: path.resolve(
    process.env.CONTENT_IMAGE_STORAGE_PATH || path.join(__dirname, '../storage/content-images')
  ),
  s3Bucket: process.env.S3_BUCKET || '',
  s3Region: process.env.S3_REGION || 'eu-west-1',
  s3Endpoint: process.env.S3_ENDPOINT || '',
  s3AccessKeyId: process.env.S3_ACCESS_KEY_ID || '',
  s3SecretAccessKey: process.env.S3_SECRET_ACCESS_KEY || '',
  s3ForcePathStyle: booleanFromEnv(process.env.S3_FORCE_PATH_STYLE, true),
  googleClientId: process.env.GOOGLE_CLIENT_ID || '',
  googleClientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
  googleRedirectUri: process.env.GOOGLE_REDIRECT_URI || '',
  stripeSecretKey: process.env.STRIPE_SECRET_KEY || '',
  stripeWebhookSecret: process.env.STRIPE_WEBHOOK_SECRET || '',
  stripeStarterPriceId: process.env.STRIPE_STARTER_PRICE_ID || '',
  stripeProPriceId: process.env.STRIPE_PRO_PRICE_ID || '',
  stripeAgencyPriceId: process.env.STRIPE_AGENCY_PRICE_ID || '',
  stripeStarterAnnualPriceId: process.env.STRIPE_STARTER_ANNUAL_PRICE_ID || '',
  stripeProAnnualPriceId: process.env.STRIPE_PRO_ANNUAL_PRICE_ID || '',
  stripeAgencyAnnualPriceId: process.env.STRIPE_AGENCY_ANNUAL_PRICE_ID || '',
  appUrl,
  appUrlObject,
  appName: process.env.APP_NAME || 'Moyi AI CMO',
  crawlTimeoutMs: numberFromEnv(process.env.CRAWL_TIMEOUT_MS, 12000),
  crawlDelayMs: numberFromEnv(process.env.CRAWL_DELAY_MS, 150),
  maxPagesPerScan: numberFromEnv(process.env.MAX_PAGES_PER_SCAN, 50),
  workerConcurrency: numberFromEnv(process.env.WORKER_CONCURRENCY, 2),
  disableQueue,
  queueEnabled: !disableQueue,
  hasExplicitRedisConfig: Boolean(process.env.REDIS_URL),
  trustProxyHops: numberFromEnv(process.env.TRUST_PROXY_HOPS, nodeEnv === 'production' ? 1 : 0),
  cookieDomain: normalizeCookieDomain(process.env.COOKIE_DOMAIN),
  releaseSha: process.env.RELEASE_SHA || '',
  passwordResetDeliveryUrl: process.env.PASSWORD_RESET_DELIVERY_URL || '',
  passwordResetDeliverySecret: process.env.PASSWORD_RESET_DELIVERY_SECRET || '',
  smtpHost: process.env.SMTP_HOST || '',
  smtpPort: numberFromEnv(process.env.SMTP_PORT, 587),
  smtpSecure: booleanFromEnv(process.env.SMTP_SECURE, false),
  smtpUser: process.env.SMTP_USER || '',
  smtpPass: process.env.SMTP_PASS || '',
  smtpFrom: process.env.SMTP_FROM || '',
  emailTestTo: process.env.EMAIL_TEST_TO || '',
  supportEmail: process.env.SUPPORT_EMAIL || process.env.EMAIL_TEST_TO || '',
  maxAiOperationsPerMonth: numberFromEnv(process.env.MAX_AI_OPERATIONS_PER_MONTH, 500)
};

function runtimeConfigProblems(target = env) {
  const problems = [];
  const hasMongoConfig = Boolean(
    process.env.MONGODB_URI || (process.env.MONGODB_USER && process.env.MONGODB_PASSWORD && process.env.MONGODB_HOST)
  );
  const rawContentImageStoragePath = String(process.env.CONTENT_IMAGE_STORAGE_PATH || '').trim();
  const storageProvider = String(target.contentImageStorageProvider || '').trim();

  if (!target.appUrlObject) {
    problems.push('APP_URL must be a valid absolute URL.');
  }

  if (process.env.COOKIE_DOMAIN && /^https?:\/\//i.test(process.env.COOKIE_DOMAIN)) {
    problems.push('COOKIE_DOMAIN must be a hostname only, for example moyi-cmo.com, not a full URL.');
  }

  if (compareVersions(process.versions.node, MIN_NODE_VERSION) < 0) {
    problems.push(`Node.js ${MIN_NODE_VERSION} or newer is required. Current version is ${process.version}.`);
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

    if (!(target.smtpHost && target.smtpUser && target.smtpPass && target.smtpFrom)) {
      problems.push('SMTP_HOST, SMTP_USER, SMTP_PASS, and SMTP_FROM must be configured in production so Moyi can send account and customer emails.');
    }

    if (!['machine', 's3'].includes(storageProvider)) {
      problems.push('CONTENT_IMAGE_STORAGE_PROVIDER must be machine or s3.');
    }

    if (storageProvider === 'machine' && !process.env.CONTENT_IMAGE_STORAGE_PATH) {
      problems.push('CONTENT_IMAGE_STORAGE_PATH must point to a persistent writable volume in production.');
    } else if (storageProvider === 'machine' && !path.isAbsolute(rawContentImageStoragePath)) {
      problems.push('CONTENT_IMAGE_STORAGE_PATH must be an absolute path in production, for example /var/lib/moyi/content-images.');
    } else if (storageProvider === 'machine' && ['/', '/var', '/var/www', '/var/www/'].includes(rawContentImageStoragePath)) {
      problems.push('CONTENT_IMAGE_STORAGE_PATH is too broad. Use a dedicated writable directory such as /var/lib/moyi/content-images.');
    }

    if (storageProvider === 's3' && !(target.s3Bucket && target.s3Region && target.s3AccessKeyId && target.s3SecretAccessKey)) {
      problems.push('S3 storage requires S3_BUCKET, S3_REGION, S3_ACCESS_KEY_ID, and S3_SECRET_ACCESS_KEY.');
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

  if (target.workerConcurrency < 1) {
    problems.push('WORKER_CONCURRENCY must be at least 1.');
  }

  if (target.smtpPort < 1 || target.smtpPort > 65535) {
    problems.push('SMTP_PORT must be a valid TCP port.');
  }

  if (target.maxAiOperationsPerMonth < 1) {
    problems.push('MAX_AI_OPERATIONS_PER_MONTH must be at least 1.');
  }

  if (target.contentAiTimeoutMs < 10000) {
    problems.push('CONTENT_AI_TIMEOUT_MS must be at least 10000.');
  }

  if (target.contentPipelineConcurrency < 1 || target.contentPipelineConcurrency > 5) {
    problems.push('CONTENT_PIPELINE_CONCURRENCY must be between 1 and 5.');
  }

  if (!['low', 'medium', 'high', 'auto'].includes(target.openaiImageQuality)) {
    problems.push('OPENAI_IMAGE_QUALITY must be low, medium, high, or auto.');
  }

  if (!/^\d+x\d+$/.test(target.openaiImageSize) && target.openaiImageSize !== 'auto') {
    problems.push('OPENAI_IMAGE_SIZE must use WIDTHxHEIGHT format or auto.');
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
    target.stripeAgencyPriceId &&
    target.stripeStarterAnnualPriceId &&
    target.stripeProAnnualPriceId &&
    target.stripeAgencyAnnualPriceId
  );
  const hasSomeStripeConfig = Boolean(
    target.stripeSecretKey ||
    target.stripeWebhookSecret ||
    target.stripeStarterPriceId ||
    target.stripeProPriceId ||
    target.stripeAgencyPriceId ||
    target.stripeStarterAnnualPriceId ||
    target.stripeProAnnualPriceId ||
    target.stripeAgencyAnnualPriceId
  );

  if (!target.openaiApiKey) {
    warnings.push('OPENAI_API_KEY is not configured. AI strategy generation will use fallback behavior or fail gracefully.');
  }

  if (hasSomeGoogleConfig && !hasGoogleConfig) {
    warnings.push('Google OAuth is only partially configured. Sign-in and Search Console routes will be unreliable until all Google env vars are set.');
  }

  if (hasSomeStripeConfig && !hasStripeConfig) {
    warnings.push('Stripe is only partially configured. Billing routes require the Stripe secret, webhook secret, and monthly and annual Price IDs for every paid plan.');
  }

  if (!target.smtpHost || !target.smtpUser || !target.smtpPass || !target.smtpFrom) {
    warnings.push('SMTP email is not fully configured. Password reset, test email, and customer communication email delivery will not work until SMTP env vars are set.');
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
  MIN_NODE_VERSION,
  assertRuntimeConfig,
  booleanFromEnv,
  compareVersions,
  numberFromEnv,
  normalizeCookieDomain,
  runtimeConfigProblems,
  runtimeConfigWarnings,
  validUrl
};
