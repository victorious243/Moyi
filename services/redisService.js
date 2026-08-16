const IORedis = require('ioredis');
const env = require('../config/env');

let sharedRedis;
const REDIS_ERROR_LOG_WINDOW_MS = 60 * 1000;
const SHARED_REDIS_TIMEOUT_MS = 2500;
const redisErrorLogTimes = new Map();
const unavailableRedisEndpoints = new Set();

function redisRetryDelay(attempt) {
  const exponent = Math.max(0, Math.min(Number(attempt || 1) - 1, 6));
  return Math.min(30000, 500 * (2 ** exponent));
}

function redisErrorCode(error) {
  return String((error && (error.code || error.errno)) || 'REDIS_ERROR');
}

function redisErrorHost(error) {
  return String((error && error.hostname) || 'configured Redis endpoint');
}

function redisErrorKey(error) {
  return `${redisErrorCode(error)}:${redisErrorHost(error)}`;
}

function redisEndpointKey(error) {
  return redisErrorHost(error);
}

function reportRedisError(error, label = 'redis') {
  const key = redisErrorKey(error);
  const now = Date.now();
  unavailableRedisEndpoints.add(redisEndpointKey(error));
  if (now - Number(redisErrorLogTimes.get(key) || 0) < REDIS_ERROR_LOG_WINDOW_MS) return;

  redisErrorLogTimes.set(key, now);
  console.error(
    `Redis temporarily unavailable for ${label} (${redisErrorCode(error)}: ${redisErrorHost(error)}). Retrying automatically.`
  );
}

function attachRedisErrorHandler(emitter, label = 'redis') {
  if (!emitter || typeof emitter.on !== 'function') return emitter;
  emitter.on('error', (error) => reportRedisError(error, label));
  return emitter;
}

function createRedisConnection({
  lazyConnect = true,
  label = 'shared',
  maxRetriesPerRequest = null,
  commandTimeout = 0
} = {}) {
  const options = {
    connectionName: `moyi-${label}`,
    connectTimeout: 10000,
    enableReadyCheck: true,
    keepAlive: 10000,
    lazyConnect,
    maxRetriesPerRequest,
    retryStrategy: redisRetryDelay
  };
  if (commandTimeout > 0) options.commandTimeout = commandTimeout;

  const client = new IORedis(env.redisUrl, options);
  let latestEndpointKey = '';

  client.on('error', (error) => {
    latestEndpointKey = redisEndpointKey(error);
    reportRedisError(error, label);
  });
  client.on('ready', () => {
    if (!latestEndpointKey || !unavailableRedisEndpoints.delete(latestEndpointKey)) return;
    console.info(`Redis connection restored for ${label}.`);
    latestEndpointKey = '';
  });

  return client;
}

function rejectAfter(ms, message) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    timer.unref();
  });
}

async function ensureConnected(client, timeoutMs = 0) {
  if (client.status === 'wait') {
    const connection = client.connect();
    if (timeoutMs > 0) {
      await Promise.race([
        connection,
        rejectAfter(timeoutMs, `Redis connection timed out after ${timeoutMs}ms.`)
      ]);
    } else {
      await connection;
    }
  }

  return client;
}

async function getSharedRedis() {
  if (!sharedRedis) {
    sharedRedis = createRedisConnection({
      commandTimeout: SHARED_REDIS_TIMEOUT_MS,
      maxRetriesPerRequest: 1
    });
  }

  return ensureConnected(sharedRedis, SHARED_REDIS_TIMEOUT_MS);
}

async function pingRedis(client) {
  const redis = client || await getSharedRedis();
  return redis.ping();
}

async function closeSharedRedis() {
  if (!sharedRedis) return;

  const client = sharedRedis;
  sharedRedis = null;

  try {
    await client.quit();
  } catch (error) {
    client.disconnect();
  }
}

module.exports = {
  attachRedisErrorHandler,
  closeSharedRedis,
  createRedisConnection,
  getSharedRedis,
  pingRedis,
  redisRetryDelay,
  reportRedisError
};
