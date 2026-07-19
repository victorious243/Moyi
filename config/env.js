require('dotenv').config();

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

const env = {
  nodeEnv: process.env.NODE_ENV || 'development',
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
  appUrl: process.env.APP_URL || `http://localhost:${process.env.PORT || '3000'}`,
  appName: process.env.APP_NAME || 'Moyi AI CMO',
  crawlTimeoutMs: Number(process.env.CRAWL_TIMEOUT_MS || 12000),
  crawlDelayMs: Number(process.env.CRAWL_DELAY_MS || 150),
  maxPagesPerScan: Number(process.env.MAX_PAGES_PER_SCAN || 50)
};

module.exports = env;
