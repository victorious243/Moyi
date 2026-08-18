const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const test = require('node:test');
const {
  attachRedisErrorHandler,
  redisRetryDelay
} = require('../services/redisService');
const { waitForPublishQueue } = require('../services/contentDistributionEngineService');

test('Redis reconnect delay backs off and remains bounded', () => {
  assert.equal(redisRetryDelay(1), 500);
  assert.equal(redisRetryDelay(2), 1000);
  assert.equal(redisRetryDelay(4), 4000);
  assert.equal(redisRetryDelay(100), 30000);
});

test('Redis infrastructure errors are handled and duplicate logs are throttled', () => {
  const first = attachRedisErrorHandler(new EventEmitter(), 'test queue one');
  const second = attachRedisErrorHandler(new EventEmitter(), 'test queue two');
  const originalError = console.error;
  const messages = [];
  console.error = (message) => messages.push(String(message));

  try {
    const error = Object.assign(new Error('temporary DNS failure'), {
      code: 'EAI_AGAIN',
      hostname: 'redis-test.invalid'
    });
    first.emit('error', error);
    second.emit('error', error);
  } finally {
    console.error = originalError;
  }

  assert.equal(messages.length, 1);
  assert.match(messages[0], /Retrying automatically/);
});

test('publishing queue submissions fail fast so the web request cannot hang', async () => {
  const startedAt = Date.now();
  await assert.rejects(
    () => waitForPublishQueue(new Promise(() => {}), 20),
    (error) => {
      assert.equal(error.code, 'publish_queue_timeout');
      assert.equal(error.statusCode, 503);
      return true;
    }
  );
  assert.ok(Date.now() - startedAt < 500);
});
