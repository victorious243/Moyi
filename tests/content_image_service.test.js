const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const mongoose = require('mongoose');
const env = require('../config/env');
const ContentImage = require('../models/ContentImage');
const {
  deleteFile,
  downloadBuffer,
  openDownloadStream,
  uploadBuffer
} = require('../services/contentImageStorageService');
const {
  detectImageMimeType,
  imagePrompt,
  validateUpload
} = require('../services/contentImageService');

function uploadFixture(buffer, mimetype) {
  return {
    buffer,
    mimetype,
    originalname: 'article-image',
    size: buffer.length
  };
}

test('content image prompt is grounded in the draft, business, proof, and user direction', () => {
  const prompt = imagePrompt({
    project: {
      name: 'Moyi',
      mainOffer: 'Evidence-backed AI CMO planning',
      targetAudience: 'SaaS founders',
      brandTone: 'Direct and credible'
    },
    draft: {
      title: 'How to turn search evidence into a growth plan',
      body: 'The guide explains how a team audits pages and prioritizes verified opportunities.',
      executionContext: {
        primaryCta: 'Run a website audit',
        proofPoints: ['Recommendations are linked to scan findings']
      }
    },
    guidance: 'Show a marketing lead reviewing a clear planning board.'
  });

  assert.match(prompt, /How to turn search evidence into a growth plan/);
  assert.match(prompt, /audits pages and prioritizes verified opportunities/);
  assert.match(prompt, /Evidence-backed AI CMO planning/);
  assert.match(prompt, /Recommendations are linked to scan findings/);
  assert.match(prompt, /marketing lead reviewing a clear planning board/);
  assert.match(prompt, /Do not add logos, statistics, product UI, people, locations, or claims/);
});

test('content image upload validation checks real file signatures', () => {
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00]);
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
  const webp = Buffer.from('RIFF0000WEBP', 'ascii');

  assert.equal(detectImageMimeType(jpeg), 'image/jpeg');
  assert.equal(detectImageMimeType(png), 'image/png');
  assert.equal(detectImageMimeType(webp), 'image/webp');
  assert.doesNotThrow(() => validateUpload(uploadFixture(jpeg, 'image/jpeg')));
  assert.doesNotThrow(() => validateUpload(uploadFixture(png, 'image/png')));
  assert.doesNotThrow(() => validateUpload(uploadFixture(webp, 'image/webp')));
  assert.throws(
    () => validateUpload(uploadFixture(Buffer.from('not an image'), 'image/png')),
    /does not match a valid/
  );
  assert.throws(
    () => validateUpload(uploadFixture(jpeg, 'image/png')),
    /does not match a valid/
  );
});

test('content image records require durable file and draft ownership metadata', () => {
  const image = new ContentImage({
    projectId: new mongoose.Types.ObjectId(),
    draftId: new mongoose.Types.ObjectId(),
    userId: new mongoose.Types.ObjectId(),
    storageProvider: 'machine',
    storageKey: '123e4567-e89b-12d3-a456-426614174000.jpg',
    source: 'generated',
    filename: 'moyi-article.jpg',
    mimeType: 'image/jpeg',
    byteLength: 4096,
    status: 'candidate'
  });

  assert.equal(image.validateSync(), undefined);

  image.storageKey = '';
  assert.ok(image.validateSync().errors.storageKey);
});

test('content image binaries are written to private machine storage, not MongoDB', async () => {
  const originalStoragePath = env.contentImageStoragePath;
  const temporaryRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'moyi-content-images-'));
  env.contentImageStoragePath = temporaryRoot;

  try {
    const source = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x01, 0x02]);
    const storageKey = await uploadBuffer({ buffer: source, mimeType: 'image/jpeg' });
    const storedPath = path.join(temporaryRoot, storageKey);
    const stored = await downloadBuffer(storageKey);

    assert.deepEqual(stored, source);
    assert.equal((await fs.promises.stat(storedPath)).mode & 0o777, 0o600);

    const streamed = [];
    for await (const chunk of openDownloadStream(storageKey)) streamed.push(chunk);
    assert.deepEqual(Buffer.concat(streamed), source);

    await deleteFile(storageKey);
    await assert.rejects(fs.promises.stat(storedPath), { code: 'ENOENT' });
  } finally {
    env.contentImageStoragePath = originalStoragePath;
    await fs.promises.rm(temporaryRoot, { recursive: true, force: true });
  }
});
