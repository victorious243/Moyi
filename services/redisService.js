const IORedis = require('ioredis');
const env = require('../config/env');

let sharedRedis;

function createRedisConnection({ lazyConnect = true, label = 'shared' } = {}) {
  return new IORedis(env.redisUrl, {
    connectionName: `moyi-${label}`,
    enableReadyCheck: true,
    lazyConnect,
    maxRetriesPerRequest: null
  });
}

async function ensureConnected(client) {
  if (client.status === 'wait') {
    await client.connect();
  }

  return client;
}

async function getSharedRedis() {
  if (!sharedRedis) {
    sharedRedis = createRedisConnection();
    sharedRedis.on('error', () => {});
  }

  return ensureConnected(sharedRedis);
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
  closeSharedRedis,
  createRedisConnection,
  getSharedRedis,
  pingRedis
};
