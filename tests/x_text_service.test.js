const test = require('node:test');
const assert = require('node:assert/strict');

const {
  assertStandardXPost,
  fitStandardXPost,
  xPostMetrics
} = require('../services/xTextService');
const { sanitizeDrafts } = require('../services/socialDraftService');

test('xTextService uses X weighted length rules for links', () => {
  const metrics = xPostMetrics(`Read this ${'https://example.com/'.padEnd(220, 'a')}`);
  assert.equal(metrics.weightedLength, 33);
  assert.equal(metrics.valid, true);
});

test('xTextService fits generated copy and preserves a trailing link', () => {
  const url = 'https://moyi-cmo.com/resources/launch-guide';
  const fitted = fitStandardXPost(`${'A practical marketing insight '.repeat(20)}\n${url}`);
  const metrics = xPostMetrics(fitted);

  assert.equal(metrics.valid, true);
  assert.ok(metrics.weightedLength <= 280);
  assert.match(fitted, /\.\.\.\nhttps:\/\/moyi-cmo\.com\/resources\/launch-guide$/);
});

test('xTextService returns an actionable error for oversized edited copy', () => {
  assert.throws(
    () => assertStandardXPost('x'.repeat(281)),
    (error) => {
      assert.equal(error.code, 'content_too_long');
      assert.equal(error.statusCode, 422);
      assert.match(error.message, /This post is 281/);
      return true;
    }
  );
});

test('social draft generation fits AI-produced X copy for standard accounts', () => {
  const drafts = sanitizeDrafts({
    drafts: [{ channel: 'x', title: 'Launch', body: 'A useful marketing insight '.repeat(30) }]
  }, []);

  assert.equal(drafts.length, 1);
  assert.equal(xPostMetrics(drafts[0].body).valid, true);
  assert.match(drafts[0].body, /\.\.\.$/);
});
